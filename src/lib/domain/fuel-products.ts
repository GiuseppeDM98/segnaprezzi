/**
 * Quick-pick fuels for the pump form (Spec 03 §11.1).
 *
 * Design: the stored product name is the canonical Italian one and is fixed
 * for every locale — switching the UI language must not fork the user's
 * product catalog into "Benzina" and "Petrol" rows that the index engine
 * would then treat as two unrelated products. Only the button labels are
 * localized.
 *
 * Each pick carries its own `unitKind` because Italian pumps do not all sell
 * by volume: petrol, diesel and LPG are dispensed and priced per litre, but
 * CNG (metano) is dispensed and priced per kilogram. Storing kilograms under
 * `unit_kind: 'volume'` would make the product claim a unit it is not sold in
 * — a data error no later screen could repair.
 */
import type { UnitKind } from './units';

// WARNING: adding a fuel here requires labels in messages/it.json and
// messages/en.json under addFuel.products.*.
export const FUEL_QUICK_PICKS = [
  { key: 'benzina', canonicalName: 'Benzina', unitKind: 'volume' },
  { key: 'diesel', canonicalName: 'Diesel', unitKind: 'volume' },
  { key: 'gpl', canonicalName: 'GPL', unitKind: 'volume' },
  { key: 'metano', canonicalName: 'Metano', unitKind: 'weight' },
] as const satisfies ReadonlyArray<{ key: string; canonicalName: string; unitKind: UnitKind }>;

export type FuelQuickPick = (typeof FUEL_QUICK_PICKS)[number];
export type FuelQuickPickKey = FuelQuickPick['key'];

/** The quick pick for a key: its canonical product name and the unit it is sold in. */
export function getFuelQuickPick(key: FuelQuickPickKey): FuelQuickPick {
  // The find always succeeds: FuelQuickPickKey is derived from this very list.
  const pick = FUEL_QUICK_PICKS.find((candidate) => candidate.key === key);
  if (!pick) {
    throw new Error(`Unknown fuel quick pick: ${key}`);
  }
  return pick;
}
