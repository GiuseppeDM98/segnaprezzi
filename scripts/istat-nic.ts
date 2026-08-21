/**
 * Pure half of the ISTAT refresh (Spec 04 §8): decode the SDMX-JSON message,
 * chain-link the published bases into one series, serialize the committed
 * file. No I/O here — scripts/update-istat.ts does the fetching and writing,
 * and this module is what scripts/istat-nic.test.ts exercises.
 *
 * Teacher — linking bases: an index base is arbitrary (the reference year
 * averages 100), so levels from different bases cannot be compared directly:
 * 2025-12 reads 122.6 in base 2015 and 2026-01 reads 100.4 in base 2025,
 * which is not an 18% deflation. Statistical offices splice bases with a
 * linking coefficient ("coefficiente di raccordo"): dividing every value of
 * the older base by that base's average over the newer base's reference year
 * and multiplying by 100 re-expresses it in the newer base, because by
 * definition the newer base averages exactly 100 over that year. ISTAT's own
 * published coefficients are this same ratio, rounded. Chaining each base
 * onto the next yields one continuous series in the most recent base; month-
 * over-month ratios — all the personal index ever compares against — are
 * unaffected by the splice. The JSON file records that base and the linking.
 */

const YM_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const BASE_YEAR_PATTERN = /base (\d{4})=100/;
/** Linked values are rounded here — 1e-4 on a level near 100 is far below the source's one decimal. */
const LINKED_VALUE_DECIMALS = 4;

/** The subset of an SDMX-JSON 1.0 data message the refresh reads. */
export interface SdmxJsonDataMessage {
  dataSets?: Array<{
    series?: Record<string, { observations?: Record<string, unknown[]> }>;
  }>;
  structure?: {
    dimensions?: {
      series?: Array<{ id?: string; values?: Array<{ id?: string; name?: string }> }>;
      observation?: Array<{ id?: string; values?: Array<{ id?: string }> }>;
    };
  };
}

/** One base's monthly levels, as published. */
export interface BaseSeries {
  baseYear: number;
  months: Map<string, number>;
}

/** Shape of data/istat-nic.json (Spec 04 §8.1). */
export interface IstatNicFile {
  source: string;
  indexName: string;
  base: string;
  updatedAt: string;
  months: Record<string, number>;
}

/** A refusal to write: the message says what, `details` says where. */
export class IstatUpdateError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'IstatUpdateError';
    this.details = details;
  }
}

/**
 * Decode the SDMX-JSON 1.0 message into one series per base year, oldest
 * base first.
 *
 * Series keys are colon-separated dimension value indexes in key-position
 * order (FREQ:REF_AREA:DATA_TYPE:MEASURE:ECOICOP); observation keys index
 * the TIME_PERIOD values listed in the structure. The base year is read from
 * the DATA_TYPE label ("… (base 2015=100) …").
 */
export function decodeBaseSeries(message: SdmxJsonDataMessage): BaseSeries[] {
  const seriesDimensions = message.structure?.dimensions?.series ?? [];
  const dataTypePosition = seriesDimensions.findIndex((dimension) => dimension.id === 'DATA_TYPE');
  const dataTypes = seriesDimensions[dataTypePosition]?.values;
  const timePeriods = message.structure?.dimensions?.observation?.find(
    (dimension) => dimension.id === 'TIME_PERIOD',
  )?.values;
  const series = message.dataSets?.[0]?.series;
  if (dataTypePosition === -1 || !dataTypes || !timePeriods || !series) {
    throw new IstatUpdateError('unexpected SDMX-JSON shape', {
      body: JSON.stringify(message).slice(0, 500),
    });
  }

  const decoded: BaseSeries[] = [];
  for (const [seriesKey, { observations }] of Object.entries(series)) {
    const dataType = dataTypes[Number(seriesKey.split(':')[dataTypePosition])];
    const baseYear = Number(BASE_YEAR_PATTERN.exec(dataType?.name ?? '')?.[1]);
    if (!Number.isInteger(baseYear)) {
      throw new IstatUpdateError('cannot read the base year of a series', { seriesKey, dataType });
    }

    const months = new Map<string, number>();
    for (const [observationKey, values] of Object.entries(observations ?? {})) {
      const ym = timePeriods[Number(observationKey)]?.id ?? '';
      const value = values[0];
      if (!YM_PATTERN.test(ym)) {
        throw new IstatUpdateError('observation period is not a YYYY-MM key', {
          seriesKey,
          observationKey,
          ym,
        });
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new IstatUpdateError('observation value is not a positive number', {
          seriesKey,
          ym,
          value,
        });
      }
      months.set(ym, value);
    }
    if (months.size === 0) {
      throw new IstatUpdateError('empty series', { seriesKey, baseYear });
    }
    decoded.push({ baseYear, months });
  }
  if (decoded.length === 0) {
    throw new IstatUpdateError('no series in the response');
  }
  return decoded.sort((a, b) => a.baseYear - b.baseYear);
}

// Why a local copy of the engine's helper: the inflation barrel deliberately
// exports only its public API, and importing a sibling module from outside
// the folder is forbidden (Spec 04 §2). Three lines are cheaper than a leak.
function addMonthsToYm(ym: string, delta: number): string {
  const [year, month] = ym.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) + delta;
  return `${Math.floor(totalMonths / 12)}-${String((totalMonths % 12) + 1).padStart(2, '0')}`;
}

/**
 * Chain every older base onto the most recent one (see the teacher note at
 * the top) and return one continuous, gap-free monthly series in that base.
 * Throws when an older base does not cover the full reference year of the
 * next one, when two bases publish the same month, or when a month is
 * missing from the result.
 */
export function linkBases(bases: readonly BaseSeries[]): BaseSeries {
  const newest = bases[bases.length - 1];
  const linked = new Map<string, number>(newest.months);
  // Walk from the newest base backwards: each older base is scaled by its
  // own average over the reference year of the base that follows it, then
  // by whatever factor already maps that following base onto the newest.
  let factor = 1;
  for (let position = bases.length - 2; position >= 0; position -= 1) {
    const older = bases[position];
    const referenceYear = bases[position + 1].baseYear;
    const referenceValues: number[] = [];
    for (let monthIndex = 1; monthIndex <= 12; monthIndex += 1) {
      const value = older.months.get(`${referenceYear}-${String(monthIndex).padStart(2, '0')}`);
      if (value === undefined) {
        throw new IstatUpdateError(
          'older base does not cover the full reference year of the next base',
          { olderBase: older.baseYear, referenceYear },
        );
      }
      referenceValues.push(value);
    }
    const referenceAverage = referenceValues.reduce((sum, value) => sum + value, 0) / 12;
    factor *= 100 / referenceAverage;
    for (const [ym, value] of older.months) {
      if (linked.has(ym)) {
        throw new IstatUpdateError('two bases publish the same month', {
          ym,
          olderBase: older.baseYear,
        });
      }
      linked.set(ym, Number((value * factor).toFixed(LINKED_VALUE_DECIMALS)));
    }
  }

  const sortedMonths = [...linked.keys()].sort();
  for (let position = 1; position < sortedMonths.length; position += 1) {
    if (addMonthsToYm(sortedMonths[position - 1], 1) !== sortedMonths[position]) {
      throw new IstatUpdateError('the linked series has a gap', {
        after: sortedMonths[position - 1],
        before: sortedMonths[position],
      });
    }
  }
  return { baseYear: newest.baseYear, months: linked };
}

/** Describe the base of a linked series for the file's `base` field. */
export function describeBase(bases: readonly BaseSeries[]): string {
  const newest = bases[bases.length - 1];
  const older = bases.slice(0, -1).map((base) => base.baseYear);
  if (older.length === 0) {
    return `${newest.baseYear}=100`;
  }
  return `${newest.baseYear}=100 (earlier bases ${older.join(', ')} chain-linked on their reference-year averages)`;
}

/** 2-space indent, sorted month keys, trailing newline — the committed diff stays minimal. */
export function serializeIstatNicFile(file: IstatNicFile): string {
  const sortedMonths = Object.fromEntries(
    Object.entries(file.months).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return `${JSON.stringify({ ...file, months: sortedMonths }, null, 2)}\n`;
}
