import { describe, expect, test } from 'vitest';

import {
  buildUnitPriceFormatter,
  calendarDaysBetween,
  formatDate,
  formatDateInputValue,
  formatDateTimeLocalValue,
  formatIndexValue,
  formatInputDecimal,
  formatMoney,
  formatMonth,
  formatPackageSize,
  formatPct,
  formatProductLabel,
  formatRelativeDate,
  formatUnitPrice,
  parseDateInputValue,
  parseDateTimeLocalValue,
  parseDecimalInput,
} from './format';

const NBSP = ' ';
const MINUS = '−';

describe('formatMoney', () => {
  test('should render euro cents as Italian currency with a trailing euro sign', () => {
    expect(formatMoney(249, 'it')).toBe(`2,49${NBSP}€`);
  });

  test('should render euro cents as English currency with a leading euro sign', () => {
    expect(formatMoney(249, 'en')).toBe('€2.49');
  });

  test('should group thousands and never divide before formatting', () => {
    // it-IT groups from five digits up (CLDR minimumGroupingDigits = 2).
    expect(formatMoney(1_234_567, 'it')).toBe(`12.345,67${NBSP}€`);
  });

  test('should use the true minus sign for negative amounts', () => {
    expect(formatMoney(-150, 'en')).toBe(`${MINUS}€1.50`);
  });
});

describe('formatUnitPrice', () => {
  test('should render two decimals when the milli value is a whole number of cents', () => {
    expect(formatUnitPrice(2340, 'weight', 'it')).toBe(`2,34${NBSP}€/kg`);
  });

  test('should render three decimals for fuel-style prices', () => {
    expect(formatUnitPrice(1799, 'volume', 'it')).toBe(`1,799${NBSP}€/L`);
  });

  test('should localize the piece symbol', () => {
    expect(formatUnitPrice(448, 'count', 'it')).toBe(`0,448${NBSP}€/pz`);
    expect(formatUnitPrice(450, 'count', 'en')).toBe('€0.45/pc');
  });
});

describe('buildUnitPriceFormatter', () => {
  test('should format every price with the bound unit kind and locale', () => {
    const format = buildUnitPriceFormatter('volume', 'en');

    expect(format(1799)).toBe(formatUnitPrice(1799, 'volume', 'en'));
    expect(format(2340)).toBe(formatUnitPrice(2340, 'volume', 'en'));
  });
});

describe('formatPct', () => {
  test('should always sign non-zero ratios', () => {
    expect(formatPct(0.042, 'it')).toBe('+4,2%');
    expect(formatPct(0.042, 'en')).toBe('+4.2%');
  });

  test('should use the true minus sign for negatives', () => {
    expect(formatPct(-0.013, 'it')).toBe(`${MINUS}1,3%`);
    expect(formatPct(-0.013, 'en')).toBe(`${MINUS}1.3%`);
  });

  test('should render exactly zero unsigned', () => {
    expect(formatPct(0, 'it')).toBe('0,0%');
  });

  test('should honor the decimals option', () => {
    expect(formatPct(0.04235, 'en', { decimals: 2 })).toBe('+4.24%');
  });
});

describe('formatIndexValue', () => {
  test('should render one decimal in the locale', () => {
    expect(formatIndexValue(104.23, 'it')).toBe('104,2');
    expect(formatIndexValue(104.23, 'en')).toBe('104.2');
  });
});

describe('formatPackageSize', () => {
  test('should pick grams below one kilogram', () => {
    expect(formatPackageSize(0.5, 'weight', 'it')).toBe('500 g');
  });

  test('should keep kilograms at or above one', () => {
    expect(formatPackageSize(1.5, 'weight', 'it')).toBe('1,5 kg');
  });

  test('should pick millilitres below one litre', () => {
    expect(formatPackageSize(0.33, 'volume', 'en')).toBe('330 mL');
  });

  test('should render litres with the locale decimal separator', () => {
    expect(formatPackageSize(38.2, 'volume', 'it')).toBe('38,2 L');
  });

  test('should render pieces with the localized symbol', () => {
    expect(formatPackageSize(6, 'count', 'it')).toBe('6 pz');
    expect(formatPackageSize(6, 'count', 'en')).toBe('6 pc');
  });
});

describe('formatMonth', () => {
  test('should label a month key in the locale', () => {
    expect(formatMonth('2026-04', 'it')).toBe('apr 2026');
    expect(formatMonth('2026-04', 'en')).toBe('Apr 2026');
  });
});

describe('formatDate', () => {
  test('should render the Europe/Rome calendar day', () => {
    // 2026-03-31T22:30Z is already April 1st in Rome (UTC+2).
    expect(formatDate(Date.parse('2026-03-31T22:30:00Z'), 'it')).toBe('1 apr 2026');
  });
});

describe('calendarDaysBetween', () => {
  test('should count Rome calendar days, not 24-hour spans', () => {
    const now = Date.parse('2026-04-02T00:30:00+02:00');
    expect(calendarDaysBetween(Date.parse('2026-04-01T23:30:00+02:00'), now)).toBe(1);
    expect(calendarDaysBetween(now, now)).toBe(0);
  });
});

describe('formatRelativeDate', () => {
  const now = Date.parse('2026-04-10T12:00:00+02:00');

  test('should say today and yesterday', () => {
    expect(formatRelativeDate(now, now, 'it')).toBe('oggi');
    expect(formatRelativeDate(now - 86_400_000, now, 'en')).toBe('yesterday');
  });

  test('should fall back to weeks and months', () => {
    expect(formatRelativeDate(now - 10 * 86_400_000, now, 'en')).toBe('last week');
    expect(formatRelativeDate(now - 65 * 86_400_000, now, 'en')).toBe('2 months ago');
  });
});

describe('parseDecimalInput', () => {
  test.each([
    ['2,49', 2.49],
    ['2.49', 2.49],
    ['2,49 €', 2.49],
    [' 38,2 ', 38.2],
    ['1', 1],
    [',5', 0.5],
  ])('should parse %s as %d', (raw, expected) => {
    expect(parseDecimalInput(raw)).toBe(expected);
  });

  test.each([
    ['', null],
    ['abc', null],
    ['1,2,3', null],
    ['1..2', null],
  ])('should return null for %s', (raw, expected) => {
    expect(parseDecimalInput(raw)).toBe(expected);
  });
});

describe('formatInputDecimal', () => {
  test('should render a plain decimal without grouping or trailing zeros', () => {
    expect(formatInputDecimal(1.843, 'en')).toBe('1.843');
    expect(formatInputDecimal(68.7, 'en')).toBe('68.7');
    expect(formatInputDecimal(2, 'en')).toBe('2');
  });

  test('should use the comma an Italian keyboard types', () => {
    expect(formatInputDecimal(1.843, 'it')).toBe('1,843');
    expect(formatInputDecimal(2, 'it')).toBe('2');
  });

  test('should round-trip through parseDecimalInput in either locale', () => {
    expect(parseDecimalInput(formatInputDecimal(1.34, 'it'))).toBe(1.34);
    expect(parseDecimalInput(formatInputDecimal(1.34, 'en'))).toBe(1.34);
  });
});

describe('formatProductLabel', () => {
  test('should put the brand before the name', () => {
    expect(formatProductLabel('Mutti', 'Passata')).toBe('Mutti Passata');
  });

  test('should show the name alone when there is no brand', () => {
    expect(formatProductLabel(null, 'Passata')).toBe('Passata');
  });
});

/*
 * The date-input values read the device's local clock, so these build their
 * instants from local components too: the expectations hold in any timezone
 * the suite runs in.
 */
describe('formatDateInputValue', () => {
  test('should render the local calendar day zero-padded', () => {
    expect(formatDateInputValue(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
  });
});

describe('formatDateTimeLocalValue', () => {
  test('should render the local wall clock to the minute', () => {
    expect(formatDateTimeLocalValue(new Date(2026, 7, 19, 18, 42, 31).getTime())).toBe(
      '2026-08-19T18:42',
    );
  });

  test('should zero-pad single-digit months, days, hours and minutes', () => {
    expect(formatDateTimeLocalValue(new Date(2026, 2, 1, 7, 5).getTime())).toBe('2026-03-01T07:05');
  });
});

describe('parseDateInputValue', () => {
  test('should read the day at local noon', () => {
    expect(parseDateInputValue('2026-01-05')).toBe(new Date(2026, 0, 5, 12, 0).getTime());
  });

  test('should give back the day formatDateInputValue wrote', () => {
    const epochMs = new Date(2026, 7, 19, 23, 30).getTime();

    const parsed = parseDateInputValue(formatDateInputValue(epochMs));

    expect(parsed).not.toBeNull();
    expect(formatDateInputValue(parsed as number)).toBe('2026-08-19');
  });

  test('should return null for an emptied input', () => {
    expect(parseDateInputValue('')).toBeNull();
  });
});

describe('parseDateTimeLocalValue', () => {
  test('should read the local wall clock to the minute', () => {
    expect(parseDateTimeLocalValue('2026-08-19T18:42')).toBe(
      new Date(2026, 7, 19, 18, 42).getTime(),
    );
  });

  test('should return null for an emptied input', () => {
    expect(parseDateTimeLocalValue('')).toBeNull();
  });
});
