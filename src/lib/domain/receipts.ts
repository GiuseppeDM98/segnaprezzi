/**
 * Receipt-level enums and the one piece of calendar arithmetic the import
 * needs. Pure — no I/O, no framework imports.
 */

export const RECEIPT_STATUSES = ['extracted', 'confirmed', 'discarded'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_FILE_KINDS = ['pdf', 'image'] as const;
export type ReceiptFileKind = (typeof RECEIPT_FILE_KINDS)[number];

/** Media types POST /api/extract-receipt accepts. */
export const RECEIPT_MEDIA_TYPES = ['application/pdf', 'image/webp', 'image/jpeg'] as const;
export type ReceiptMediaType = (typeof RECEIPT_MEDIA_TYPES)[number];

/** Which file kind a media type belongs to. */
export const RECEIPT_FILE_KIND_BY_MEDIA_TYPE: Record<ReceiptMediaType, ReceiptFileKind> = {
  'application/pdf': 'pdf',
  'image/webp': 'image',
  'image/jpeg': 'image',
};

/*
 * Rome wall-clock → epoch ms.
 *
 * Teacher: a receipt prints local time ("19/08/2026 18:42"), and the model
 * hands it back as a naive ISO string with no offset. Reading it as UTC
 * would move a late-evening purchase into the next calendar day — and the
 * inflation engine buckets by Rome months, so the last purchase of
 * a month would land in the wrong one. The conversion below asks the Intl
 * timezone database for Rome's offset rather than hardcoding CET/CEST.
 *
 * Why 'en-CA': its formatted parts come out ISO-like, so the offset can be
 * recovered by reformatting an instant in Rome and reading it back as UTC.
 * Why module level: constructing a DateTimeFormat costs orders of magnitude
 * more than calling .format().
 */
const romePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Rome's UTC offset in milliseconds at the given instant (+1h or +2h). */
function romeOffsetMsAt(utcMs: number): number {
  const parts = romePartsFormatter.formatToParts(new Date(utcMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  // Sub-second precision is irrelevant here and would leak the input's ms.
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export interface RomeWallClock {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Convert a Europe/Rome wall-clock reading into epoch milliseconds UTC.
 *
 * Two passes: the first guesses the instant with the offset that applies at
 * the same wall clock read as UTC, the second corrects it with the offset
 * that actually applies at the guessed instant. That settles every case
 * except the one hour that repeats at the autumn DST switch, where the
 * earlier (summer-time) instant is returned — a purchase timestamp is not
 * worth more machinery than that.
 *
 * @param wallClock - The reading as printed on the receipt
 * @returns Epoch milliseconds UTC
 */
export function romeWallClockToEpochMs(wallClock: RomeWallClock): number {
  const naiveUtc = Date.UTC(
    wallClock.year,
    wallClock.month - 1,
    wallClock.day,
    wallClock.hour,
    wallClock.minute,
    wallClock.second,
  );
  const firstGuess = naiveUtc - romeOffsetMsAt(naiveUtc);
  return naiveUtc - romeOffsetMsAt(firstGuess);
}

/**
 * The Europe/Rome calendar day of an instant, as "YYYY-MM-DD".
 *
 * Used by the receipt review screen's "already recorded today" hint: two
 * observations of the same product belong to the same day when the user
 * would call it the same day, which is a Rome question, not a UTC one.
 */
export function toRomeYearMonthDay(epochMs: number): string {
  const parts = romePartsFormatter.formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

/** ISO 8601 date, optionally with a time: "2026-08-19" or "2026-08-19T18:42:00". */
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * Parse the model's `purchasedAt` string as a Europe/Rome wall clock.
 *
 * A date without a time becomes noon Rome time: a receipt says *which day*
 * it belongs to, and noon is the reading that stays on that day under any
 * offset.
 *
 * @param raw - ISO-ish string from the extraction, or null
 * @returns Epoch milliseconds UTC, or null when the string is unusable
 */
export function parseReceiptPurchasedAt(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  const match = ISO_DATE_TIME.exec(raw.trim());
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  const hasTime = hour !== undefined;
  const wallClock: RomeWallClock = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: hasTime ? Number(hour) : 12,
    minute: hasTime ? Number(minute) : 0,
    second: hasTime && second !== undefined ? Number(second) : 0,
  };
  if (wallClock.month < 1 || wallClock.month > 12 || wallClock.day < 1 || wallClock.day > 31) {
    return null;
  }
  const epochMs = romeWallClockToEpochMs(wallClock);
  return Number.isFinite(epochMs) ? epochMs : null;
}
