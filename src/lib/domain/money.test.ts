import { describe, expect, test } from 'vitest';

import {
  calculateFuelQuantity,
  calculateFuelTotalCents,
  calculateUnitPriceMilli,
  isUnitPriceConsistent,
} from './money';

/*
 * These tests cover the fuel half of the money helpers. The rounding is the
 * whole point: pump unit prices carry three decimals, so every one of these
 * cases would lose money (or invent it) if the arithmetic went through cents.
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
    // format's, not a disagreement, and refusing it refused the receipt.
    expect(isUnitPriceConsistent(309, 270, calculateUnitPriceMilli(309, 270))).toBe(true);
  });

  test('should still reject a real disagreement on a large pack', () => {
    // Half the price of the same box: far more than rounding can explain.
    expect(isUnitPriceConsistent(309, 270, 6)).toBe(false);
  });
});
