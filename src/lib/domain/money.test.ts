import { describe, expect, test } from 'vitest';

import {
  calculateFuelQuantity,
  calculateFuelTotalCents,
  calculateUnitPriceMilli,
  computeDerivedUnitPriceMilli,
  isUnitPriceConsistent,
  isWithinCrossCheckTolerance,
} from './money';

/*
 * The fuel cases below are about rounding: pump unit prices carry three
 * decimals, so each of them would lose money (or invent it) if the
 * arithmetic went through cents.
 */

describe('calculateFuelTotalCents', () => {
  test('should charge a full tank at a three-decimal pump price', () => {
    expect(calculateFuelTotalCents(1799, 38.2)).toBe(6872);
  });

  test('should round a half-cent up', () => {
    expect(calculateFuelTotalCents(1799, 10)).toBe(1799);
  });

  test('should handle a round price per litre', () => {
    expect(calculateFuelTotalCents(2000, 25)).toBe(5000);
  });
});

describe('calculateFuelQuantity', () => {
  test('should derive litres from a total and a three-decimal unit price', () => {
    expect(calculateFuelQuantity(6872, 1799)).toBe(38.199);
  });

  test('should derive kilograms the same way, for methane', () => {
    // €1,899/kg for €28,49 of CNG.
    expect(calculateFuelQuantity(2849, 1899)).toBe(15.003);
  });

  test('should round-trip a total within one cent', () => {
    const quantity = calculateFuelQuantity(5000, 1849);

    expect(Math.abs(calculateFuelTotalCents(1849, quantity) - 5000)).toBeLessThanOrEqual(1);
  });
});

describe('calculateUnitPriceMilli', () => {
  test('should scale a half-kilo pack up to a price per kilo', () => {
    expect(calculateUnitPriceMilli(249, 0.5)).toBe(4980);
  });

  test('should keep three decimals of precision on a fuel-sized quantity', () => {
    expect(calculateUnitPriceMilli(9160, 50.9)).toBe(1800);
  });
});

describe('computeDerivedUnitPriceMilli', () => {
  test('should derive the unit price from the total and the size', () => {
    expect(computeDerivedUnitPriceMilli(129, 0.5, false)).toBe(2580);
  });

  test('should leave a unit price the user typed alone', () => {
    expect(computeDerivedUnitPriceMilli(129, 0.5, true)).toBeNull();
  });

  test('should derive nothing while the size is missing', () => {
    expect(computeDerivedUnitPriceMilli(129, null, false)).toBeNull();
  });

  test('should derive nothing from a zero total or a zero size', () => {
    expect(computeDerivedUnitPriceMilli(0, 0.5, false)).toBeNull();
    expect(computeDerivedUnitPriceMilli(129, 0, false)).toBeNull();
  });
});

describe('isUnitPriceConsistent', () => {
  test('should accept a triple derived from its own price and size', () => {
    expect(isUnitPriceConsistent(249, 0.5, calculateUnitPriceMilli(249, 0.5))).toBe(true);
  });

  test('should accept the cent of rounding a weighed line prints', () => {
    // 0,812 kg at the printed 1,49 EUR/kg is 1,20988 EUR, printed as 1,21.
    expect(isUnitPriceConsistent(121, 0.812, 1490)).toBe(true);
  });

  test('should reject a unit price that predates the line discount', () => {
    // 0,5 kg at 2,00 EUR/kg is 1,00 EUR, but 0,80 was paid: two prices.
    expect(isUnitPriceConsistent(80, 0.5, 2000)).toBe(false);
  });

  test('should reject a hand-typed unit price that no longer matches its size', () => {
    expect(isUnitPriceConsistent(165, 1, 1500)).toBe(false);
  });

  test('should accept the only integer unit price a 270-piece pack can have', () => {
    // 3,09 EUR for 9x30 tissues is 0,01144 EUR each: 11 milli is the closest
    // an integer gets, and 11 x 270 = 2,97 EUR. The gap is the storage
    // format's, not a disagreement, and refusing it refused a real purchase.
    expect(isUnitPriceConsistent(309, 270, calculateUnitPriceMilli(309, 270))).toBe(true);
  });

  test('should still reject a real disagreement on a large pack', () => {
    // Half the price of the same box: far more than rounding can explain.
    expect(isUnitPriceConsistent(309, 270, 6)).toBe(false);
  });
});

describe('isWithinCrossCheckTolerance', () => {
  test('should accept a tag whose unit price matches its total exactly', () => {
    expect(isWithinCrossCheckTolerance(129, 0.5, 2580)).toBe(true);
  });

  test('should accept a gap of exactly 2% of the total', () => {
    // 1000 milli total, 1020 milli derived: the boundary is inclusive.
    expect(isWithinCrossCheckTolerance(100, 1, 1020)).toBe(true);
    expect(isWithinCrossCheckTolerance(100, 1, 980)).toBe(true);
  });

  test('should flag a gap just beyond 2% in either direction', () => {
    expect(isWithinCrossCheckTolerance(100, 1, 1021)).toBe(false);
    expect(isWithinCrossCheckTolerance(100, 1, 979)).toBe(false);
  });

  test('should flag a promo tag whose unit price is the pre-discount one', () => {
    expect(isWithinCrossCheckTolerance(80, 0.5, 2000)).toBe(false);
  });
});
