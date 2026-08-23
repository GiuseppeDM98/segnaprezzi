/**
 * Display formatting.
 *
 * Design: this module is the single boundary between integer money
 * (total_price_cents, unit_price_milli) and human-readable strings. No other
 * module may call Intl.NumberFormat for money, percentages, or index values
 * — one place to fix locale bugs, one place to test them. Components receive
 * pre-formatted strings; animation components never format numbers.
 *
 * Integer conversions live in src/lib/domain/money.ts; this file owns only
 * string rendering, date rendering and input parsing.
 */
import { centsToEuros, milliToEuros } from '@/lib/domain/money';
import type { UnitKind } from '@/lib/domain/units';

export type AppLocale = 'it' | 'en';

/** Intl locale tags behind the two app locales. */
const INTL_LOCALES: Record<AppLocale, string> = { it: 'it-IT', en: 'en-US' };

/** Unit symbols per base unit, per locale ("pz" is the Italian "pezzo"). */
const UNIT_SYMBOLS: Record<AppLocale, Record<UnitKind, string>> = {
  it: { weight: 'kg', volume: 'L', count: 'pz' },
  en: { weight: 'kg', volume: 'L', count: 'pc' },
};

/** U+2212, the true minus sign — a hyphen is not a number sign. */
const MINUS = '−';

/*
 * Why a cache: constructing an Intl.NumberFormat is orders of magnitude more
 * expensive than calling .format(), and a product list formats hundreds of
 * prices per render. Keyed on locale + options.
 */
const numberFormatCache = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: AppLocale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALES[locale], options);
    numberFormatCache.set(key, formatter);
  }
  return formatter;
}

const dateFormatCache = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: AppLocale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALES[locale], {
      timeZone: 'Europe/Rome',
      ...options,
    });
    dateFormatCache.set(key, formatter);
  }
  return formatter;
}

/** Replace ASCII hyphen-minus with the typographic minus sign. */
function withTrueMinus(formatted: string): string {
  return formatted.replace(/-/g, MINUS);
}

/** Format euro cents as currency: 249 → "2,49 €" (it) / "€2.49" (en). */
export function formatMoney(cents: number, locale: AppLocale): string {
  return withTrueMinus(
    numberFormat(locale, { style: 'currency', currency: 'EUR' }).format(centsToEuros(cents)),
  );
}

/**
 * Format a unit price in milli-euros per base unit: 2340 → "2,34 €/kg".
 * Renders 2 decimals, or 3 when the value is not a whole number of cents
 * (fuel: 1799 → "1,799 €/L"). Unit symbols: /kg, /L, /pz (it) · /pc (en).
 */
export function formatUnitPrice(milli: number, unitKind: UnitKind, locale: AppLocale): string {
  const decimals = milli % 10 === 0 ? 2 : 3;
  const amount = numberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(milliToEuros(milli));
  return `${withTrueMinus(amount)}/${UNIT_SYMBOLS[locale][unitKind]}`;
}

/**
 * Format a ratio as a signed percentage: 0.042 → "+4,2%" (it) / "+4.2%" (en).
 * Always signed; negatives use U+2212; exactly zero renders unsigned ("0,0%").
 * `decimals` defaults to 1.
 */
export function formatPct(
  ratio: number,
  locale: AppLocale,
  options: { decimals?: number } = {},
): string {
  const decimals = options.decimals ?? 1;
  const formatted = numberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    // Why 'exceptZero': we want "+4,2%" and "−1,3%" but a plain
    // "0,0%" — Intl's signDisplay has exactly that mode.
    signDisplay: 'exceptZero',
  }).format(ratio);
  return withTrueMinus(formatted);
}

/** Format a chained index value: 104.23 → "104,2" (it) / "104.2" (en). */
export function formatIndexValue(value: number, locale: AppLocale): string {
  return withTrueMinus(
    numberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value),
  );
}

/**
 * Format a package size in base units, choosing the friendliest sub-unit:
 * weight 0.5 → "500 g", 1.5 → "1,5 kg" · volume 0.33 → "330 mL", 38.2 → "38,2 L"
 * · count 6 → "6 pz" (it) / "6 pc" (en).
 */
export function formatPackageSize(size: number, unitKind: UnitKind, locale: AppLocale): string {
  const plain = numberFormat(locale, { maximumFractionDigits: 3 });
  if (unitKind === 'count') {
    return `${plain.format(size)} ${UNIT_SYMBOLS[locale].count}`;
  }
  // Below one base unit the label on the pack says grams / millilitres.
  if (size < 1) {
    const subUnit = unitKind === 'weight' ? 'g' : 'mL';
    return `${plain.format(Math.round(size * 1000))} ${subUnit}`;
  }
  return `${plain.format(size)} ${UNIT_SYMBOLS[locale][unitKind]}`;
}

/** Format a plain integer count with locale grouping: 1234 → "1.234" (it). */
export function formatCount(value: number, locale: AppLocale): string {
  return numberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/**
 * Format a 'YYYY-MM' month key as a short label: "2026-04" → "apr 2026" (it)
 * / "Apr 2026" (en). Used for axis labels and the index base caption.
 */
export function formatMonth(ym: string, locale: AppLocale): string {
  const [year, month] = ym.split('-').map(Number);
  // Mid-month noon UTC keeps the label in the right month in any timezone.
  const date = new Date(Date.UTC(year, month - 1, 15, 12));
  return dateFormat(locale, { month: 'short', year: 'numeric' }).format(date);
}

/** Three-letter month label only: "2026-04" → "apr" (it) / "Apr" (en). */
export function formatMonthShort(ym: string, locale: AppLocale): string {
  const [year, month] = ym.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 15, 12));
  return dateFormat(locale, { month: 'short' }).format(date);
}

/** Full calendar date in Europe/Rome: "5 apr 2026" (it) / "Apr 5, 2026" (en). */
export function formatDate(epochMs: number, locale: AppLocale): string {
  return dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(epochMs),
  );
}

/** Date and wall-clock time in Europe/Rome: "5 apr 2026, 10:30". */
export function formatDateTime(epochMs: number, locale: AppLocale): string {
  return dateFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epochMs));
}

/** Wall-clock time in Europe/Rome: "10:30". */
export function formatTime(epochMs: number, locale: AppLocale): string {
  return dateFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(epochMs));
}

/** Weekday + day + month, for timeline day headers: "sab 5 apr" (it). */
export function formatDayHeading(epochMs: number, locale: AppLocale): string {
  return dateFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(epochMs),
  );
}

/**
 * Relative day distance in whole Europe/Rome calendar days between two
 * instants (0 = same day, 1 = yesterday). Pure; `now` is a parameter so the
 * timeline headers are testable.
 */
export function calendarDaysBetween(epochMs: number, nowMs: number): number {
  const dayKey = dateFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const toUtcDay = (ms: number): number => {
    const parts = dayKey.formatToParts(new Date(ms));
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000;
  };
  return toUtcDay(nowMs) - toUtcDay(epochMs);
}

/**
 * Relative date label: "oggi" / "ieri" / "3 giorni fa" / "2 mesi fa", via
 * Intl.RelativeTimeFormat. Falls back to the plain date beyond a year.
 */
export function formatRelativeDate(epochMs: number, nowMs: number, locale: AppLocale): string {
  const days = calendarDaysBetween(epochMs, nowMs);
  const relative = new Intl.RelativeTimeFormat(INTL_LOCALES[locale], { numeric: 'auto' });
  if (days < 7) {
    return relative.format(-days, 'day');
  }
  if (days < 30) {
    return relative.format(-Math.floor(days / 7), 'week');
  }
  if (days < 365) {
    return relative.format(-Math.floor(days / 30), 'month');
  }
  return formatDate(epochMs, locale);
}

/**
 * Parse a user-typed decimal ("2,49", "2.49", "2,49 €") into a number.
 * Accepts both comma and dot regardless of locale — Italian users on English
 * keyboards type dots. Returns null when the input is not a number.
 */
export function parseDecimalInput(raw: string): number | null {
  const normalized = raw.replace(/[€\s]/g, '').replace(',', '.');
  if (normalized === '' || !/^-?\d*\.?\d+$/.test(normalized)) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Render a number the way an editable decimal input should show it: plain
 * digits, no grouping, no currency, and the decimal separator of the active
 * locale ("1,843" in it, "1.843" in en).
 *
 * Why the locale reaches this far: the review screen showed the same amount
 * twice, as "1.34 €" inside the box and "1,34 €" in the total a few
 * pixels below — and to an Italian reader a dot is a thousands separator.
 * Round-tripping is unaffected: parseDecimalInput accepts either separator,
 * whatever the locale, because people type what their keyboard offers.
 */
export function formatInputDecimal(value: number, locale: AppLocale, maxDecimals = 3): string {
  const plain = Number(value.toFixed(maxDecimals)).toString();
  return locale === 'it' ? plain.replace('.', ',') : plain;
}
