/**
 * Integer money math: money is integers only —
 * total_price_cents in euro cents, unit_price_milli in milli-euros per
 * base unit. Every helper returns an integer; floats exist only
 * transiently inside a computation, never in stored values.
 *
 * Scope: generic conversions plus the fuel two-of-three helpers; display
 * formatting AND input parsing live exclusively in
 * src/lib/format.ts — nothing here touches strings.
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

/*
 * Fuel two-of-three helpers. At the pump the user knows any
 * two of {unit price, quantity, total} and the third follows. Pump unit
 * prices carry three decimals — this is exactly why unit_price_milli exists;
 * deriving the total through a cents-scaled unit price would corrupt every
 * fuel entry.
 *
 * The arithmetic is unit-agnostic on purpose: petrol, diesel and LPG are sold
 * per litre, methane per kilogram, and the same two formulas
 * serve both.
 */

/**
 * Total paid, in euro cents, for `quantity` base units at `unitPriceMilli`.
 *
 * @example calculateFuelTotalCents(1799, 38.2) === 6872  // €1.799/L × 38.2 L = €68.72
 */
export function calculateFuelTotalCents(unitPriceMilli: number, quantity: number): number {
  return Math.round((unitPriceMilli * quantity) / 10);
}

/**
 * Quantity (litres, or kilograms for methane) implied by a total and a unit price.
 * Pumps display 2–3 decimals; rounding to 3 keeps the round-trip loss below
 * a cent while stopping float noise from reaching the form.
 *
 * @example calculateFuelQuantity(6872, 1799) === 38.199
 */
export function calculateFuelQuantity(totalPriceCents: number, unitPriceMilli: number): number {
  return Math.round(((totalPriceCents * 10) / unitPriceMilli) * 1000) / 1000;
}

/*
 * Integer -> euro conversions. These return NUMBERS, not strings: they exist
 * for editable numeric inputs, which need a value and not a formatted label.
 * All string rendering of money stays in src/lib/format.ts.
 */

/** Integer cents as a euro amount (249 -> 2.49). */
export function centsToEuros(cents: number): number {
  return cents / 100;
}

/** Integer milli-euros as a euro amount (1799 -> 1.799). */
export function milliToEuros(milli: number): number {
  return milli / 1000;
}
