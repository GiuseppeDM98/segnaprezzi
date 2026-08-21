/**
 * Turn extracted receipt lines into reviewable drafts (Spec 07 §7).
 *
 * Design: this is the heart of receipt import, and it is deliberately pure —
 * the caller fetches the catalog and the aliases, this decides. The value of
 * the feature is not the transcription (a receipt is already text); it is
 * getting "PASTA BAR SPAGH N5 500G" onto the product row where the package
 * size lives, so that 1,29 € becomes 2,58 €/kg and joins a price history.
 *
 * Three ways to get there, in order of confidence: an alias the user taught
 * the app on a previous receipt, a fuzzy match against the catalog, or a new
 * product. Only the first needs no human at all, which is why alias learning
 * (§9) is what makes the second import of a chain fast.
 */

import type { LineReviewReason } from '@/lib/ai/flag-receipt';
import type { ReceiptLine } from '@/lib/ai/receipt-schema';
import type { CategoryId } from '@/lib/domain/categories';
import type { PromoKind } from '@/lib/domain/entries';
import {
  deriveUnitPriceMilli,
  normalizeAlias,
  type ReceiptLineStatus,
  type SizeSource,
} from '@/lib/domain/receipt-lines';
import type { UnitKind } from '@/lib/domain/units';
import {
  type MatchCandidate,
  normalizeProductName,
  type ProductSuggestion,
  suggestProductMatches,
} from './match-products';

/** Above this score the top suggestion is safe to preselect (Spec 03 §9.1). */
const PRESELECT_SCORE_THRESHOLD = 0.7;

/** Only the first three suggestions ever reach a card. */
const MAX_SUGGESTIONS = 3;

export interface ResolveCandidateProduct extends MatchCandidate {
  category: CategoryId;
  unitKind: UnitKind;
  /** products.default_package_size, in base units; null when never observed. */
  defaultPackageSize: number | null;
  /**
   * Archived products stay reachable through an alias — the user merged or
   * retired them deliberately, and their history is still the right place
   * for this line — but they are kept out of fuzzy suggestions, exactly as
   * Spec 03 §8 keeps them out of the capture matcher.
   */
  isArchived: boolean;
}

export interface ResolvedProductPick {
  productId: string;
  name: string;
  brand: string | null;
  isArchived: boolean;
}

export interface ResolveAlias {
  productId: string;
  /** Already normalized (normalizeAlias) at write time. */
  alias: string;
  storeChain: string | null;
}

export type ReceiptLineMatch =
  | { kind: 'alias'; productId: string; score: 1 }
  | { kind: 'suggested'; suggestions: ProductSuggestion[] }
  | {
      kind: 'new';
      draft: { name: string; brand: string | null; category: CategoryId; unitKind: UnitKind };
    };

export interface ResolvedReceiptLineFields {
  /** Packages bought; integer ≥ 1 after weighed normalization. */
  quantity: number;
  /** Content of ONE package in base units; null ⇒ needs-size. */
  packageSize: number | null;
  sizeSource: SizeSource;
  /** Price of ONE package, after the line's discounts. */
  totalPriceCents: number;
  /** null ⇒ needs-size. */
  unitPriceMilli: number | null;
  isPromo: boolean;
  promoKind: PromoKind | null;
  category: CategoryId;
  unitKind: UnitKind;
}

export interface ResolvedReceiptLine {
  /** Position on the receipt — the stable id the review screen and confirm use. */
  index: number;
  /** Immutable; this exact object becomes the entry's ai_raw_json. */
  extraction: ReceiptLine;
  normalizedAlias: string;
  match: ReceiptLineMatch;
  /** Preselected product, when the match is confident enough to not ask. */
  selectedProduct: ResolvedProductPick | null;
  fields: ResolvedReceiptLineFields;
  status: ReceiptLineStatus;
  reviewReasons: LineReviewReason[];
}

export interface ResolveReceiptLinesInput {
  lines: ReceiptLine[];
  /** Positionally matching per-line flags from flagReceiptForReview. */
  lineFlags: Array<{ reasons: LineReviewReason[] }>;
  candidates: ResolveCandidateProduct[];
  aliases: ResolveAlias[];
  /** Chain of the resolved store, when known — scopes the alias lookup. */
  storeChain: string | null;
}

/**
 * Resolve every extracted line against the user's catalog.
 *
 * @param input - The extraction, its flags, and everything the user already has
 * @returns One draft per line, in receipt order
 */
export function resolveReceiptLines(input: ResolveReceiptLinesInput): ResolvedReceiptLine[] {
  const aliasIndex = buildAliasIndex(input.aliases);
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));

  return input.lines.map((line, index) => {
    const normalizedAlias = normalizeAlias(line.rawLine);
    const match = matchLine(line, normalizedAlias, input, aliasIndex);
    const selectedProductId = pickPreselectedProductId(match);
    const matchedProduct = selectedProductId ? candidateById.get(selectedProductId) : undefined;
    const selectedProduct: ResolvedProductPick | null = matchedProduct
      ? {
          productId: matchedProduct.id,
          name: matchedProduct.name,
          brand: matchedProduct.brand,
          isArchived: matchedProduct.isArchived,
        }
      : null;

    const unitKind = line.unitKindHint ?? matchedProduct?.unitKind ?? inferUnitKind(line);
    const derived = deriveUnitPriceMilli({
      lineTotalCents: line.lineTotalCents,
      quantity: line.quantity,
      quantityKind: line.quantityKind,
      unitPriceCentsOnReceipt: line.unitPriceCentsOnReceipt,
      packageSizeHint: line.packageSizeHint,
      catalogPackageSize: matchedProduct?.defaultPackageSize ?? null,
      unitKind,
    });

    const reviewReasons = [...(input.lineFlags[index]?.reasons ?? [])];
    if (derived.hasPrintedUnitPriceMismatch && !reviewReasons.includes('qty-price-mismatch')) {
      reviewReasons.push('qty-price-mismatch');
    }

    return {
      index,
      extraction: line,
      normalizedAlias,
      match,
      selectedProduct,
      fields: {
        quantity: derived.quantity,
        packageSize: derived.packageSize,
        sizeSource: derived.sizeSource,
        totalPriceCents: derived.totalPriceCents,
        unitPriceMilli: derived.unitPriceMilli,
        isPromo: line.isPromo,
        promoKind: line.isPromo ? line.promoKind : null,
        category: matchedProduct?.category ?? line.category,
        unitKind,
      },
      status: resolveStatus(derived.packageSize, match, selectedProduct, reviewReasons),
      reviewReasons,
    };
  });
}

/**
 * Status precedence (Spec 07 §7.4): a missing size blocks harder than an
 * undecided product, which blocks harder than a flag the user only has to
 * look at.
 *
 * Deviation from §7.4's literal rule, deliberate: the spec assigns
 * `needs-product` to lines with NO candidate and leaves an ambiguous one (a
 * suggestion scoring 0.5, below the 0.7 preselect bar) as `ready`. That is
 * backwards for the only failure that actually costs something. A line with
 * no candidate becomes a genuinely new product — and `resolveProductPicks`
 * still dedupes it against the catalog by normalized name — whereas a line
 * the matcher *half* recognised is exactly the one that silently creates a
 * duplicate of an existing product, and a duplicate removes that product
 * from every month-over-month relative it should have contributed to.
 *
 * So: undecided means "the matcher found candidates but none convincing".
 * Blocking every unmatched line instead would make the first receipt from a
 * chain thirty mandatory taps, which is a different way of losing the user.
 */
function resolveStatus(
  packageSize: number | null,
  match: ReceiptLineMatch,
  selectedProduct: ResolvedProductPick | null,
  reviewReasons: LineReviewReason[],
): ReceiptLineStatus {
  if (packageSize === null) {
    return 'needs-size';
  }
  if (selectedProduct === null && match.kind === 'suggested') {
    return 'needs-product';
  }
  if (reviewReasons.length > 0) {
    return 'needs-review';
  }
  return 'ready';
}

type AliasIndex = {
  byChain: Map<string, string>;
  byAliasOnly: Map<string, string>;
  anyChain: Map<string, string>;
};

/** Three lookup tables so §7.2's alias precedence is three Map.get calls. */
function buildAliasIndex(aliases: ResolveAlias[]): AliasIndex {
  const byChain = new Map<string, string>();
  const byAliasOnly = new Map<string, string>();
  const anyChain = new Map<string, string>();

  for (const alias of aliases) {
    if (alias.storeChain !== null) {
      byChain.set(aliasChainKey(alias.alias, alias.storeChain), alias.productId);
    } else {
      byAliasOnly.set(alias.alias, alias.productId);
    }
    if (!anyChain.has(alias.alias)) {
      anyChain.set(alias.alias, alias.productId);
    }
  }

  return { byChain, byAliasOnly, anyChain };
}

function aliasChainKey(alias: string, storeChain: string): string {
  return `${normalizeProductName(storeChain)} ${alias}`;
}

/** Alias exact → fuzzy → new, first hit wins (Spec 07 §7.2). */
function matchLine(
  line: ReceiptLine,
  normalizedAlias: string,
  input: ResolveReceiptLinesInput,
  aliasIndex: AliasIndex,
): ReceiptLineMatch {
  const aliasProductId =
    (input.storeChain
      ? aliasIndex.byChain.get(aliasChainKey(normalizedAlias, input.storeChain))
      : undefined) ??
    aliasIndex.byAliasOnly.get(normalizedAlias) ??
    aliasIndex.anyChain.get(normalizedAlias);

  if (aliasProductId) {
    return { kind: 'alias', productId: aliasProductId, score: 1 };
  }

  const suggestions = suggestReceiptMatches(line, normalizedAlias, input.candidates);
  if (suggestions.length > 0) {
    return { kind: 'suggested', suggestions };
  }

  return {
    kind: 'new',
    draft: {
      name: line.description,
      brand: line.brand,
      category: line.category,
      unitKind: line.unitKindHint ?? inferUnitKind(line),
    },
  };
}

/**
 * Fuzzy-match a line twice and merge the results.
 *
 * Why two queries: the model's expanded description ("Spaghetti n.5 500g")
 * is far better fuzzy input than the printed abbreviation, but the
 * abbreviation is what the catalog name sometimes literally contains, and
 * an expansion that guessed wrong loses the line entirely. Taking the union
 * and keeping each product's best score costs one extra pass over a catalog
 * of hundreds.
 */
function suggestReceiptMatches(
  line: ReceiptLine,
  normalizedAlias: string,
  candidates: ResolveCandidateProduct[],
): ProductSuggestion[] {
  const suggestable = candidates.filter((candidate) => !candidate.isArchived);
  const byDescription = suggestProductMatches(
    { productName: line.description, brand: line.brand },
    suggestable,
  );
  const byAlias = suggestProductMatches({ productName: normalizedAlias, brand: null }, suggestable);

  const bestByProduct = new Map<string, ProductSuggestion>();
  for (const suggestion of [...byDescription, ...byAlias]) {
    const known = bestByProduct.get(suggestion.productId);
    if (!known || suggestion.score > known.score) {
      bestByProduct.set(suggestion.productId, suggestion);
    }
  }

  return [...bestByProduct.values()]
    .sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId))
    .slice(0, MAX_SUGGESTIONS);
}

/** An alias is certain; a suggestion only preselects itself above 0.7. */
function pickPreselectedProductId(match: ReceiptLineMatch): string | null {
  if (match.kind === 'alias') {
    return match.productId;
  }
  if (match.kind === 'suggested') {
    const top = match.suggestions[0];
    return top && top.score >= PRESELECT_SCORE_THRESHOLD ? top.productId : null;
  }
  return null;
}

/** Fall back to what the printed quantity implies, then to pieces. */
function inferUnitKind(line: ReceiptLine): UnitKind {
  if (line.quantityKind === 'kg') {
    return 'weight';
  }
  if (line.quantityKind === 'L') {
    return 'volume';
  }
  return 'count';
}
