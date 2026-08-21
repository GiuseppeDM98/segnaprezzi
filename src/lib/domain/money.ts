/**
 * Integer money math (Spec 00 §3: money is integers only —
 * total_price_cents in euro cents, unit_price_milli in milli-euros per
 * base unit). Every helper returns an integer; floats exist only
 * transiently inside a computation, never in stored values.
 *
 * Scope: generic conversions only. Fuel-specific helpers arrive with
 * Spec 03 §11.2; display formatting lives exclusively in
 * src/lib/format.ts (Spec 05) — nothing here produces strings.
 */

/** Convert a euro amount (e.g. parsed user input 1.29) to integer cents. */
export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

/** Convert a euro amount to integer milli-euros (1 € = 1000 milli). */
export function toMilli(euros: number): number {
  return Math.round(euros * 1000);
}

/** Convert integer cents to integer milli-euros (1 cent = 10 milli; exact, no rounding). */
export function centsToMilli(cents: number): number {
  return cents * 10;
}

/**
 * Derive the unit price (milli-euros per base unit) from a total price in
 * cents and a package size in base units (kg / L / pieces).
 * Why milli, not cents: small packages would round away precision —
 * €1.29 for 0.5 kg is exactly 2580 milli/kg.
 */
export function calculateUnitPriceMilli(totalPriceCents: number, packageSize: number): number {
  return Math.round(centsToMilli(totalPriceCents) / packageSize);
}
