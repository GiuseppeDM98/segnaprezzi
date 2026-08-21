import { describe, expect, test } from 'vitest';

import { calculateFuelQuantity, calculateFuelTotalCents, calculateUnitPriceMilli } from './money';

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
