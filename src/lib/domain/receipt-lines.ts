/**
 * Pure line arithmetic for receipt import (Spec 07 §7.1, §7.3): the alias
 * key a receipt line is remembered under, and the package-size / unit-price
 * derivation every line goes through before it can become a price entry.
 *
 * Design: a receipt line states what was paid for a whole line ("2 x 1,09
 * 2,18") but almost never states the package size, which is what makes a
 * price comparable over time. This module turns the printed columns into the
 * (quantity, packageSize, totalPriceCents, unitPriceMilli) quadruple the
 * price_entries contract wants, and reports WHERE the size came from so the
 * review screen can ask the user when it came from nowhere.
 */
import { calculateUnitPriceMilli } from './money';
import type { UnitKind } from './units';

/** How the receipt printed a line's quantity (Spec 07 §6.1 "QUANTITY"). */
export const QUANTITY_KINDS = ['pieces', 'kg', 'L'] as const;
export type QuantityKind = (typeof QUANTITY_KINDS)[number];

/** Where a line's package size came from — drives the "needs size" prompt. */
export type SizeSource = 'weighed' | 'receipt' | 'catalog' | 'assumed-one' | 'missing';

/** Review state of one line (Spec 07 §7.4). */
export const RECEIPT_LINE_STATUSES = [
  'ready',
  'needs-size',
  'needs-product',
  'needs-review',
] as const;
export type ReceiptLineStatus = (typeof RECEIPT_LINE_STATUSES)[number];

/**
 * Relative gap allowed between the €/kg the receipt printed and the one
 * derived from the line total. One percent: weighed lines round the weight
 * to the gram and the total to the cent, so the two never agree exactly.
 */
const PRINTED_UNIT_PRICE_TOLERANCE = 0.01;

/*
 * Alias normalization.
 *
 * Why the RAW line and not the model's expanded `description`: the alias is
 * a lookup key that must be identical across imports, and an LLM expansion
 * ("PASTA BAR SPAGH N5" → "Spaghetti n.5") can vary run to run. The printed
 * abbreviation cannot. What has to go is only the numeric columns the
 * printer appends, which differ every time the same product is bought.
 */

/** Trailing money column ("  1,29", "  2,18"), stripped repeatedly. */
const TRAILING_MONEY = /\s+\d+[.,]\d{2,3}\s*$/;
/** A weighed quantity with its unit ("0,812 kg"). */
const WEIGHED_QUANTITY = /\d+[.,]\d+\s*kg\b/gi;
/** A standalone multiplier token ("2 x"), never the "6X" inside "6X1,5L". */
const QUANTITY_MULTIPLIER = /(^|\s)\d+\s*x(?=\s|$)/gi;
/** The multiplier's leftover "x" once its operands are gone. */
const DANGLING_MULTIPLIER = /\s+x\s*$/i;

/**
 * Normalize one printed receipt line into its alias key.
 *
 * @param rawLine - The line verbatim, price columns included
 * @returns Lowercase, accent-free, punctuation-free description
 *
 * @example normalizeAlias('PASTA BAR SPAGH N5 500G  1,29') === 'pasta bar spagh n5 500g'
 * @example normalizeAlias('BANANE  0,812 kg x 1,49  1,21') === 'banane'
 */
export function normalizeAlias(rawLine: string): string {
  let description = rawLine;
  while (TRAILING_MONEY.test(description)) {
    description = description.replace(TRAILING_MONEY, '');
  }
  description = description
    .replace(WEIGHED_QUANTITY, ' ')
    .replace(QUANTITY_MULTIPLIER, ' ')
    .replace(DANGLING_MULTIPLIER, ' ');
  return normalizeAliasText(description);
}

/**
 * Lowercase, strip diacritics, turn punctuation into spaces, collapse
 * whitespace — the same normalization Spec 03 §8 applies to product names,
 * repeated here because `domain/` may not import a service.
 */
function normalizeAliasText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DeriveUnitPriceInput {
  /** What the whole line cost, after its discounts, in euro cents. */
  lineTotalCents: number;
  /** As printed: a package count, or a weight/volume for weighed goods. */
  quantity: number;
  quantityKind: QuantityKind;
  /** The per-unit price the receipt printed, if any (€/kg or the "1,29" of "2 x 1,29"). */
  unitPriceCentsOnReceipt: number | null;
  /** Size read out of the description ("500G" → 0.5), in base units. */
  packageSizeHint: number | null;
  /** products.default_package_size of the matched product, in base units. */
  catalogPackageSize: number | null;
  unitKind: UnitKind;
}

export interface DerivedLineFields {
  /** Packages bought; always an integer ≥ 1 (weighed lines collapse to 1). */
  quantity: number;
  /** Content of ONE package in base units; null when nobody knows it. */
  packageSize: number | null;
  sizeSource: SizeSource;
  /** Price of ONE package, in euro cents. */
  totalPriceCents: number;
  /** Milli-euros per base unit; null while packageSize is null. */
  unitPriceMilli: number | null;
  /** The printed €/kg and the derived one disagree by more than 1 %. */
  hasPrintedUnitPriceMismatch: boolean;
}

/**
 * Turn one extracted receipt line into price-entry fields.
 *
 * The entry contract (Spec 03) is `unit_price_milli × package_size =
 * total_price_cents × 10`, where `total_price_cents` is the price of ONE
 * package. Two shapes of line reach that contract differently:
 *
 * - **Weighed** ("0,812 kg x 1,49  1,21"): the quantity IS the package size,
 *   so the line is one "package" of 0.812 kg costing the whole line total.
 * - **Counted** ("2 x 1,09  2,18"): the line total covers `quantity`
 *   packages, so one package costs total ÷ quantity, and the size has to
 *   come from the description, the catalog, or the user.
 *
 * @param input - One extracted line plus what the catalog knows about it
 * @returns Editable defaults for the review card; `sizeSource 'missing'`
 *   means the line cannot be confirmed until the user supplies a size
 */
export function deriveUnitPriceMilli(input: DeriveUnitPriceInput): DerivedLineFields {
  const isWeighed = input.quantityKind === 'kg' || input.quantityKind === 'L';

  const quantity = isWeighed ? 1 : Math.max(1, Math.round(input.quantity));
  const totalPriceCents = isWeighed
    ? input.lineTotalCents
    : Math.round(input.lineTotalCents / quantity);

  const { packageSize, sizeSource } = resolvePackageSize(input, isWeighed);

  if (packageSize === null || packageSize <= 0 || totalPriceCents <= 0) {
    return {
      quantity,
      packageSize,
      sizeSource,
      totalPriceCents,
      unitPriceMilli: null,
      hasPrintedUnitPriceMismatch: false,
    };
  }

  const derivedMilli = calculateUnitPriceMilli(totalPriceCents, packageSize);

  // A weighed line prints the €/kg the scale actually used; it beats a value
  // re-derived from two already-rounded numbers. Counted lines print the
  // per-package price instead, which is not a unit price at all.
  const printedMilli =
    isWeighed && input.unitPriceCentsOnReceipt !== null && input.unitPriceCentsOnReceipt > 0
      ? input.unitPriceCentsOnReceipt * 10
      : null;
  const hasPrintedUnitPriceMismatch =
    printedMilli !== null &&
    Math.abs(printedMilli - derivedMilli) > PRINTED_UNIT_PRICE_TOLERANCE * derivedMilli;

  return {
    quantity,
    packageSize,
    sizeSource,
    totalPriceCents,
    unitPriceMilli: printedMilli ?? derivedMilli,
    hasPrintedUnitPriceMismatch,
  };
}

/** Package size of ONE package, first available source wins (Spec 07 §7.3). */
function resolvePackageSize(
  input: DeriveUnitPriceInput,
  isWeighed: boolean,
): { packageSize: number | null; sizeSource: SizeSource } {
  if (isWeighed && input.quantity > 0) {
    return { packageSize: input.quantity, sizeSource: 'weighed' };
  }
  if (input.packageSizeHint !== null && input.packageSizeHint > 0) {
    return { packageSize: input.packageSizeHint, sizeSource: 'receipt' };
  }
  if (input.catalogPackageSize !== null && input.catalogPackageSize > 0) {
    return { packageSize: input.catalogPackageSize, sizeSource: 'catalog' };
  }
  // A single "SHOPPER" or "PANE" is one piece by definition — blocking the
  // whole import on it would be pedantry, not accuracy.
  if (input.unitKind === 'count') {
    return { packageSize: 1, sizeSource: 'assumed-one' };
  }
  return { packageSize: null, sizeSource: 'missing' };
}
