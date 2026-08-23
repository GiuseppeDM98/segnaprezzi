/**
 * Turn extracted receipt lines into reviewable drafts.
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
 * is what makes the second import of a chain fast.
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

/** Above this score the top suggestion is safe to preselect. */
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
   * they are kept out of the capture matcher.
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
  /**
   * Positions of the identical receipt lines folded into this one; empty for
   * a line that stood alone. Their quantities are already in `fields`, and
   * `extraction` still points at the first of them — the raw text, and so the
   * alias to learn, is by construction the same for all of them.
   */
  mergedLineIndexes: number[];
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

  const resolved = input.lines.map((line, index) => {
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
      mergedLineIndexes: [],
    };
  });

  return collapseIdenticalLines(resolved);
}

/**
 * Fold identical lines into one draft carrying their combined quantity.
 *
 * A till prints the same article twice as often as it prints "2 x": both mean
 * one price, paid twice. The app already has an opinion about that shape —
 * `price_entries.quantity` exists precisely so "2 x 1,09" is ONE observation
 * bought twice rather than two observations — and honouring it only for the
 * receipts that happen to use the multiplier would let the same shopping trip
 * land in the index twice as heavily depending on how the shop chose to print
 * it. So this is a correctness fix wearing a UI request's clothes: two
 * separate rows would double that product's weight in the month's mean.
 *
 * Identical is read strictly, and deliberately so — same printed description,
 * same price for one package, same size, same promo, same resolved product.
 * Two "pesto" lines at different prices are two different observations (one
 * was on offer, or a different jar) and stay apart, which is also what a user
 * checking the receipt against the screen expects to see.
 *
 * Review reasons are unioned: if either line wanted a human, the survivor
 * does too.
 */
export function collapseIdenticalLines(lines: ResolvedReceiptLine[]): ResolvedReceiptLine[] {
  const survivors: ResolvedReceiptLine[] = [];
  const byIdentity = new Map<string, ResolvedReceiptLine>();

  for (const line of lines) {
    const identity = identityKeyOf(line);
    const survivor = byIdentity.get(identity);
    if (!survivor) {
      byIdentity.set(identity, line);
      survivors.push(line);
      continue;
    }
    survivor.fields.quantity += line.fields.quantity;
    survivor.mergedLineIndexes.push(line.index);
    for (const reason of line.reviewReasons) {
      if (!survivor.reviewReasons.includes(reason)) {
        survivor.reviewReasons.push(reason);
      }
    }
  }

  return survivors;
}

/**
 * The fields that must all agree before two lines are the same purchase.
 *
 * `normalizedAlias` rather than the product: two lines that merely resolved
 * to the same catalog product can still be different articles the matcher
 * generalized (a 500 g and a 1 kg pack both landing on "Pasta"), and folding
 * those would invent a purchase the customer never made. The printed text
 * being identical is the evidence that the till itself considered them the
 * same article.
 */
function identityKeyOf(line: ResolvedReceiptLine): string {
  return [
    line.normalizedAlias,
    line.fields.totalPriceCents,
    line.fields.packageSize ?? 'no-size',
    line.fields.unitKind,
    line.fields.isPromo ? (line.fields.promoKind ?? 'promo') : 'full-price',
    line.selectedProduct?.productId ?? 'unresolved',
  ].join('|');
}

/**
 * Status precedence: a missing size blocks harder than an
 * undecided product, which blocks harder than a flag the user only has to
 * look at.
 *
 * Deliberate design choice, not the naive rule: a line with NO candidate does
 * NOT block — it becomes a genuinely new product, and `resolveProductPicks`
 * still dedupes it against the catalog by normalized name — while an
 * ambiguous one (a suggestion scoring 0.5, below the 0.7 preselect bar)
 * becomes `needs-product` and blocks. That looks backwards until you
 * consider the only failure that actually costs something: whereas a line
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

/** Three lookup tables so alias precedence is three Map.get calls. */
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

/** Alias exact → fuzzy → new, first hit wins. */
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
