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

/**
 * Floor of the slack allowed on
 * `unitPriceMilli x packageSize = totalPriceCents x 10`: one cent, the
 * rounding a price stored to the cent can introduce on its own.
 */
export const UNIT_PRICE_TOLERANCE_MILLI = 10;

/**
 * Whether a (total, size, unit price) triple can all be true at once.
 *
 * Why it lives here and not next to the one caller: the same question is
 * asked in three places that must never disagree — the receipt line
 * derivation picks between a printed and a derived unit price with it, the
 * review screen names the card that fails it, and `confirmReceipt` refuses
 * to store a triple that does not. Two copies of this arithmetic would
 * eventually be two different tolerances, which is a rejection the user
 * cannot see coming.
 *
 * Teacher: the tolerance has to GROW with the package size. A unit price is
 * an integer number of milli-euros, so rounding it costs up to half a milli
 * per base unit — half a cent on a 1 kg pack, but 13,5 cents on a 270-piece
 * box of tissues (3,09 EUR / 270 = 0,01144 EUR each, storable only as 11).
 * A fixed one-cent slack therefore called the app's own derivation
 * inconsistent as soon as a package held more than twenty units, and refused
 * the whole receipt over a number nobody had touched. Anything a real
 * disagreement produces — a discount, an edited field — is worth far more
 * than `packageSize / 2`.
 *
 * @param totalPriceCents - Price of ONE package, in euro cents
 * @param packageSize - Content of one package, in base units (kg / L / pieces)
 * @param unitPriceMilli - Milli-euros per base unit
 * @returns true when the three agree to within the rounding they can cause
 *
 * @example isUnitPriceConsistent(129, 0.5, 2580) === true
 * @example isUnitPriceConsistent(309, 270, 11) === true   // 9x30 tissues: 11 milli is as close as integers get
 * @example isUnitPriceConsistent(80, 0.5, 2000) === false // 2,00 EUR/kg was the price before the discount
 */
export function isUnitPriceConsistent(
  totalPriceCents: number,
  packageSize: number,
  unitPriceMilli: number,
): boolean {
  const tolerance = Math.max(UNIT_PRICE_TOLERANCE_MILLI, packageSize / 2);
  return Math.abs(unitPriceMilli * packageSize - centsToMilli(totalPriceCents)) <= tolerance;
}
