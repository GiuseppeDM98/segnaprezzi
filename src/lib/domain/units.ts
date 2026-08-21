/**
 * Unit kinds and their base units (Spec 00 §6). All unit prices are stored
 * per base unit: kg for weight, L for volume, piece for count. Tags shown
 * per 100 g / 100 mL are normalized at extraction time (Spec 03).
 */
export const UNIT_KINDS = ['weight', 'volume', 'count'] as const;

export type UnitKind = (typeof UNIT_KINDS)[number];

/** Display symbol of the base unit for each unit kind (used in "€/kg" style labels). */
export const BASE_UNIT_SYMBOLS: Record<UnitKind, 'kg' | 'L' | 'pz'> = {
  weight: 'kg',
  volume: 'L',
  count: 'pz',
};
