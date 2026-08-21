import { describe, expect, test } from 'vitest';

import { convertToBaseUnits, SIZE_UNIT_OPTIONS } from './units';

/*
 * The conversions the entry forms run on every keystroke. The float-noise
 * cases are the reason this lives in the domain rather than in a form: they
 * are silently persisted into package_size otherwise.
 */

describe('convertToBaseUnits', () => {
  test('should convert grams to kilos without float noise', () => {
    expect(convertToBaseUnits(700, 0.001)).toBe(0.7);
  });

  test('should convert millilitres to litres without float noise', () => {
    expect(convertToBaseUnits(330, 0.001)).toBe(0.33);
  });

  test('should leave a value already in base units untouched', () => {
    expect(convertToBaseUnits(1.5, 1)).toBe(1.5);
  });

  test('should keep a count exact', () => {
    expect(convertToBaseUnits(6, 1)).toBe(6);
  });
});

describe('SIZE_UNIT_OPTIONS', () => {
  test('should offer the base unit first for every unit kind', () => {
    for (const options of Object.values(SIZE_UNIT_OPTIONS)) {
      expect(options[0].toBase).toBe(1);
    }
  });
});
