/**
 * Fuzzy matching between an AI extraction and the user's product catalog.
 *
 * Sørensen–Dice over character bigrams was chosen over Levenshtein because
 * shelf tags and catalog names differ mostly by word order and extra tokens
 * ("Spaghetti Barilla N.5" vs "Barilla spaghetti n5 500 g"), not by typos.
 * We only keep word-internal bigrams (none spanning a space), which makes
 * the score insensitive to word order — exactly the invariance we want.
 *
 * Pure: the service passes the candidates in, so the whole module is
 * table-testable without a database.
 */

export interface MatchCandidate {
  id: string;
  name: string;
  brand: string | null;
  /** True when the product has an entry at the capture store in the last 90 days. */
  hasRecentEntryAtStore: boolean;
}

export interface ProductSuggestion {
  productId: string;
  name: string;
  brand: string | null;
  score: number;
}

const SUGGESTION_THRESHOLD = 0.4;
const MAX_SUGGESTIONS = 3;
const EXACT_BRAND_BONUS = 0.15;
const STORE_RECENCY_BONUS = 0.05;

/**
 * Normalize a product name for comparison: lowercase, strip diacritics
 * (NFD + remove combining marks: "qualità" → "qualita"), turn punctuation
 * into spaces ("n.5" → "n 5"), collapse whitespace.
 */
export function normalizeProductName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sørensen–Dice similarity over word-internal character bigrams:
 * dice = 2 × |A ∩ B| / (|A| + |B|), with multiset intersection.
 * Returns 0..1. Strings shorter than one bigram only match exactly.
 */
export function calculateDiceSimilarity(a: string, b: string): number {
  if (a === b) {
    return a.length > 0 ? 1 : 0;
  }
  const bigramsA = collectBigrams(a);
  const bigramsB = collectBigrams(b);
  const totalA = sumCounts(bigramsA);
  const totalB = sumCounts(bigramsB);
  if (totalA === 0 || totalB === 0) {
    return 0;
  }
  let sharedCount = 0;
  for (const [bigram, countA] of bigramsA) {
    sharedCount += Math.min(countA, bigramsB.get(bigram) ?? 0);
  }
  return (2 * sharedCount) / (totalA + totalB);
}

/**
 * Rank catalog candidates against an extraction.
 *
 * rawScore = dice("brand name" vs "brand name") + bonuses:
 * +0.15 when both brands are present and equal after normalization,
 * +0.05 when the candidate was recently bought at the same store.
 * The ≥ 0.4 threshold and the ranking use the UNCAPPED rawScore — so the
 * recency bonus still breaks ties between perfect dice matches — while the
 * reported `score` field is capped at 1. Top 3 returned.
 */
export function suggestProductMatches(
  extraction: { productName: string; brand: string | null },
  candidates: MatchCandidate[],
): ProductSuggestion[] {
  const target = normalizeProductName(`${extraction.brand ?? ''} ${extraction.productName}`);
  const targetBrand = extraction.brand === null ? null : normalizeProductName(extraction.brand);

  const scoredCandidates = candidates.map((candidate) => {
    const candidateText = normalizeProductName(`${candidate.brand ?? ''} ${candidate.name}`);
    let rawScore = calculateDiceSimilarity(target, candidateText);

    const candidateBrand = candidate.brand === null ? null : normalizeProductName(candidate.brand);
    if (targetBrand !== null && targetBrand !== '' && targetBrand === candidateBrand) {
      rawScore += EXACT_BRAND_BONUS;
    }
    if (candidate.hasRecentEntryAtStore) {
      rawScore += STORE_RECENCY_BONUS;
    }

    return {
      rawScore,
      suggestion: {
        productId: candidate.id,
        name: candidate.name,
        brand: candidate.brand,
        score: Math.min(rawScore, 1),
      },
    };
  });

  return scoredCandidates
    .filter((candidate) => candidate.rawScore >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, MAX_SUGGESTIONS)
    .map((candidate) => candidate.suggestion);
}

function collectBigrams(text: string): Map<string, number> {
  const bigrams = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const bigram = text.slice(i, i + 2);
    if (bigram.includes(' ')) {
      continue;
    }
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  return bigrams;
}

function sumCounts(bigrams: Map<string, number>): number {
  let total = 0;
  for (const count of bigrams.values()) {
    total += count;
  }
  return total;
}
