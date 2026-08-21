/**
 * Unit kinds and their base units. All unit prices are stored
 * per base unit: kg for weight, L for volume, piece for count. Tags shown
 * per 100 g / 100 mL are normalized at extraction time.
 */
export const UNIT_KINDS = ['weight', 'volume', 'count'] as const;

export type UnitKind = (typeof UNIT_KINDS)[number];

/** Display symbol of the base unit for each unit kind (used in "€/kg" style labels). */
export const BASE_UNIT_SYMBOLS: Record<UnitKind, 'kg' | 'L' | 'pz'> = {
  weight: 'kg',
  volume: 'L',
  count: 'pz',
};

export interface SizeUnitOption {
  /** i18n key suffix under the `units` namespace. */
  key: string;
  /** Multiplier that turns a value in this unit into base units. */
  toBase: number;
}

/**
 * Units a package size may be typed in, per unit kind. Storage is always in
 * base units, but nobody reads "0.5 kg" off a 500 g pack — the
 * forms accept the printed unit and convert on the way in.
 */
export const SIZE_UNIT_OPTIONS: Record<UnitKind, SizeUnitOption[]> = {
  weight: [
    { key: 'kg', toBase: 1 },
    { key: 'g', toBase: 0.001 },
  ],
  volume: [
    { key: 'liter', toBase: 1 },
    { key: 'milliliter', toBase: 0.001 },
  ],
  count: [{ key: 'piece', toBase: 1 }],
};

/**
 * Precision kept when converting a typed size into base units: micro-units,
 * far finer than any package label prints.
 */
const BASE_UNIT_PRECISION = 1e6;

/**
 * Convert a size typed in one of SIZE_UNIT_OPTIONS into base units.
 *
 * Why the rounding: 700 * 0.001 is 0.7000000000000001 in binary floating
 * point, and that noise would be persisted verbatim into package_size and
 * shown back to the user as the size of their passata.
 *
 * @param value - Size as typed, in the chosen unit
 * @param toBase - The unit's toBase multiplier
 * @returns The size in base units (kg, L or pieces)
 */
export function convertToBaseUnits(value: number, toBase: number): number {
  return Math.round(value * toBase * BASE_UNIT_PRECISION) / BASE_UNIT_PRECISION;
}
