/**
 * The manual entry form's pure rules: which catalog products match the
 * search box, what the price fields add up to (with the unit price derived
 * or typed), and how the product choice becomes the action's input and the
 * next entry's catalog row.
 *
 * Design: the form's components only render and the hook only holds state;
 * every number the form shows or sends is computed here, from the raw field
 * values, without touching React. The conversions themselves (euros to cents
 * and milli-euros, a typed size to base units, the cross-check tolerance)
 * live in src/lib/domain; this module only composes them for the form.
 */
import type { CategoryId } from '@/lib/domain/categories';
import {
  calculateUnitPriceMilli,
  isWithinCrossCheckTolerance,
  toCents,
  toMilli,
} from '@/lib/domain/money';
import {
  convertToBaseUnits,
  SIZE_UNIT_OPTIONS,
  type SizeUnitOption,
  type UnitKind,
} from '@/lib/domain/units';
import type { ProductSummary } from '@/lib/services/capture-context';
import type { CreateManualEntryInput } from './actions';

/** At most this many catalog matches are listed under the search box. */
export const MAX_PRODUCT_HITS = 8;

/** A product being created inline, as the user is typing it. */
export interface NewProductChoice {
  kind: 'new';
  name: string;
  brand: string;
  category: CategoryId;
  unitKind: UnitKind;
}

/** The form's product: a catalog pick, one being created, or none yet. */
export type ProductChoice = { kind: 'existing'; product: ProductSummary } | NewProductChoice | null;

/** The raw values of the price fields, as the inputs hold them. */
export interface PriceFieldValues {
  /** Euros as typed; null while the field is empty. */
  totalEuros: number | null;
  /** Size in the chosen unit; null while the field is empty. */
  sizeValue: number | null;
  sizeUnit: SizeUnitOption;
  /** Euros per base unit as typed; only read once the user owns the unit price. */
  unitPriceEuros: number | null;
  isUnitPriceEdited: boolean;
}

/** What the price fields add up to; 0 stands for "not given yet" throughout. */
export interface ManualPrice {
  totalPriceCents: number;
  /** In base units (kg, L, pieces). */
  packageSize: number;
  /** total ÷ size; 0 until both are given. */
  derivedUnitPriceMilli: number;
  /** The unit price sent on save: typed when the user owns it, derived otherwise. */
  unitPriceMilli: number;
  /** A typed unit price that disagrees with total ÷ size beyond the tolerance. */
  hasCrossCheckWarning: boolean;
}

/** The unit kind the price fields are in: the picked product's, else the new one's. */
export function activeUnitKindOf(choice: ProductChoice): UnitKind {
  return choice?.kind === 'existing' ? choice.product.unitKind : (choice?.unitKind ?? 'weight');
}

/**
 * The size units offered for a unit kind and the one in use.
 *
 * @param sizeUnitKey the unit last chosen; one that does not belong to this
 *   kind (the kind just changed) falls back to the kind's first unit.
 */
export function resolveSizeUnit(
  unitKind: UnitKind,
  sizeUnitKey: string,
): { options: SizeUnitOption[]; unit: SizeUnitOption } {
  const options = SIZE_UNIT_OPTIONS[unitKind];
  return { options, unit: options.find((option) => option.key === sizeUnitKey) ?? options[0] };
}

/**
 * Turn the price fields into the numbers the form shows and saves.
 *
 * The unit price is derived from total ÷ size until the user types one; from
 * then on the typed one is used and only cross-checked. The check is the same
 * one the extraction flag runs, so a tag warns here exactly when a photo of
 * it would.
 */
export function computeManualPrice(values: PriceFieldValues): ManualPrice {
  const totalPriceCents = values.totalEuros === null ? 0 : toCents(values.totalEuros);
  const packageSize =
    values.sizeValue === null ? 0 : convertToBaseUnits(values.sizeValue, values.sizeUnit.toBase);
  const derivedUnitPriceMilli =
    totalPriceCents > 0 && packageSize > 0
      ? calculateUnitPriceMilli(totalPriceCents, packageSize)
      : 0;
  const unitPriceMilli = values.isUnitPriceEdited
    ? values.unitPriceEuros === null
      ? 0
      : toMilli(values.unitPriceEuros)
    : derivedUnitPriceMilli;
  const hasCrossCheckWarning =
    values.isUnitPriceEdited &&
    totalPriceCents > 0 &&
    packageSize > 0 &&
    unitPriceMilli > 0 &&
    !isWithinCrossCheckTolerance(totalPriceCents, packageSize, unitPriceMilli);
  return {
    totalPriceCents,
    packageSize,
    derivedUnitPriceMilli,
    unitPriceMilli,
    hasCrossCheckWarning,
  };
}

/**
 * The catalog products whose name or brand contains the query, case-insensitively.
 *
 * @returns the trimmed, lower-cased query (empty when there is none, which
 *   lists nothing) and at most MAX_PRODUCT_HITS products in catalog order.
 */
export function filterProductHits(
  products: readonly ProductSummary[],
  query: string,
): { normalizedQuery: string; hits: ProductSummary[] } {
  const normalizedQuery = query.trim().toLowerCase();
  const hits = normalizedQuery
    ? products
        .filter(
          (product) =>
            product.name.toLowerCase().includes(normalizedQuery) ||
            product.brand?.toLowerCase().includes(normalizedQuery),
        )
        .slice(0, MAX_PRODUCT_HITS)
    : [];
  return { normalizedQuery, hits };
}

/** The action's product input for a choice; an empty brand is sent as no brand. */
export function toProductInput(
  choice: NonNullable<ProductChoice>,
): CreateManualEntryInput['product'] {
  return choice.kind === 'existing'
    ? { kind: 'existing', productId: choice.product.id }
    : {
        kind: 'new',
        name: choice.name,
        brand: choice.brand || null,
        category: choice.category,
        unitKind: choice.unitKind,
      };
}

/** The catalog row a just-created product becomes, so the next entry can find it. */
export function toCreatedProduct(choice: NewProductChoice, productId: string): ProductSummary {
  return {
    id: productId,
    name: choice.name,
    brand: choice.brand || null,
    category: choice.category,
    unitKind: choice.unitKind,
  };
}
