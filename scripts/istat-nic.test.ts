import { describe, expect, it } from 'vitest';

import {
  type BaseSeries,
  decodeBaseSeries,
  describeBase,
  IstatUpdateError,
  linkBases,
  type SdmxJsonDataMessage,
  serializeIstatNicFile,
} from './istat-nic';

/** A minimal SDMX-JSON 1.0 message in the shape the live service returns. */
function buildMessage(
  overrides: Partial<SdmxJsonDataMessage> = {},
  observations: Record<string, Record<string, unknown[]>> = {
    '0:0:0:0:0': { '0': [122.5], '1': [122.6] },
    '0:0:1:0:0': { '2': [100.4], '3': [101.1] },
  },
): SdmxJsonDataMessage {
  return {
    dataSets: [
      {
        series: Object.fromEntries(
          Object.entries(observations).map(([key, value]) => [key, { observations: value }]),
        ),
      },
    ],
    structure: {
      dimensions: {
        series: [
          { id: 'FREQ', values: [{ id: 'M' }] },
          { id: 'REF_AREA', values: [{ id: 'IT' }] },
          {
            id: 'DATA_TYPE',
            values: [
              { id: '39', name: 'consumer price index for the whole nation (base 2015=100)' },
              { id: '85', name: 'consumer price index for the whole nation (base 2025=100)' },
            ],
          },
          { id: 'MEASURE', values: [{ id: '4' }] },
          { id: 'ECOICOP_2', values: [{ id: '00' }] },
        ],
        observation: [
          {
            id: 'TIME_PERIOD',
            values: [{ id: '2025-11' }, { id: '2025-12' }, { id: '2026-01' }, { id: '2026-02' }],
          },
        ],
      },
    },
    ...overrides,
  };
}

describe('decodeBaseSeries', () => {
  it('should map series keys to base years and observation keys to months, oldest base first', () => {
    const bases = decodeBaseSeries(buildMessage());

    expect(bases.map((base) => base.baseYear)).toEqual([2015, 2025]);
    expect([...bases[0].months]).toEqual([
      ['2025-11', 122.5],
      ['2025-12', 122.6],
    ]);
    expect([...bases[1].months]).toEqual([
      ['2026-01', 100.4],
      ['2026-02', 101.1],
    ]);
  });

  it('should reject a message without the expected structure', () => {
    expect(() => decodeBaseSeries({})).toThrow(IstatUpdateError);
    expect(() => decodeBaseSeries(buildMessage({ dataSets: [] }))).toThrow(
      'unexpected SDMX-JSON shape',
    );
  });

  it('should reject a null observation, a malformed period, and an empty series', () => {
    expect(() => decodeBaseSeries(buildMessage({}, { '0:0:0:0:0': { '0': [null] } }))).toThrow(
      'observation value is not a positive number',
    );
    expect(() => decodeBaseSeries(buildMessage({}, { '0:0:0:0:0': { '9': [122.5] } }))).toThrow(
      'observation period is not a YYYY-MM key',
    );
    expect(() => decodeBaseSeries(buildMessage({}, { '0:0:0:0:0': {} }))).toThrow('empty series');
  });

  it('should reject a series whose DATA_TYPE label carries no base year', () => {
    const message = buildMessage();
    const dataType = message.structure?.dimensions?.series?.[2].values?.[0];
    if (dataType) {
      dataType.name = 'consumer price index, no base here';
    }

    expect(() => decodeBaseSeries(message)).toThrow('cannot read the base year of a series');
  });
});

describe('linkBases', () => {
  function buildYear(year: number, values: number[]): Array<[string, number]> {
    return values.map((value, monthIndex) => [
      `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
      value,
    ]);
  }

  it('should rescale older bases so that each reference year averages 100 in the newest base', () => {
    // Arrange: base 2015 covers 2025 (average 120), base 2025 starts in 2026.
    const bases: BaseSeries[] = [
      {
        baseYear: 2015,
        months: new Map([
          ...buildYear(2025, [114, 115, 116, 117, 118, 119, 121, 122, 123, 124, 125, 126]),
        ]),
      },
      { baseYear: 2025, months: new Map(buildYear(2026, [100.4, 101.1])) },
    ];

    // Act
    const linked = linkBases(bases);

    // Assert: 2025 values are divided by 120 and multiplied by 100; the
    // newest base is untouched.
    expect(linked.baseYear).toBe(2025);
    expect(linked.months.get('2025-01')).toBeCloseTo(95, 10);
    expect(linked.months.get('2025-12')).toBeCloseTo(105, 10);
    expect(linked.months.get('2026-01')).toBe(100.4);
    expect(linked.months.size).toBe(14);
  });

  it('should chain through several bases', () => {
    const bases: BaseSeries[] = [
      { baseYear: 1995, months: new Map(buildYear(2010, Array(12).fill(140))) },
      {
        baseYear: 2010,
        months: new Map([
          ...[2011, 2012, 2013, 2014].flatMap((year) => buildYear(year, Array(12).fill(102))),
          ...buildYear(2015, Array(12).fill(108)),
        ]),
      },
      { baseYear: 2015, months: new Map(buildYear(2016, [99.6])) },
    ];

    const linked = linkBases(bases);

    // 2010 in base 2015: 140 / 140 × 100 = 100 (base 2010), then × 100 / 108.
    expect(linked.months.get('2010-06')).toBeCloseTo((100 * 100) / 108, 4);
    expect(linked.months.get('2011-06')).toBeCloseTo((102 * 100) / 108, 4);
    expect(linked.months.get('2015-06')).toBeCloseTo(100, 10);
    expect(linked.months.get('2016-01')).toBe(99.6);
  });

  it('should refuse an older base that does not cover the full reference year', () => {
    const bases: BaseSeries[] = [
      { baseYear: 2015, months: new Map(buildYear(2025, [122.5, 122.6])) },
      { baseYear: 2025, months: new Map(buildYear(2026, [100.4])) },
    ];

    expect(() => linkBases(bases)).toThrow('older base does not cover the full reference year');
  });

  it('should refuse overlapping bases and gaps in the linked series', () => {
    const fullYear = Array(12).fill(120);
    const overlapping: BaseSeries[] = [
      { baseYear: 2015, months: new Map([...buildYear(2025, fullYear), ['2026-01', 123]]) },
      { baseYear: 2025, months: new Map(buildYear(2026, [100.4])) },
    ];
    const gapped: BaseSeries[] = [
      { baseYear: 2015, months: new Map(buildYear(2025, fullYear)) },
      { baseYear: 2025, months: new Map([['2026-03', 100.4]]) },
    ];

    expect(() => linkBases(overlapping)).toThrow('two bases publish the same month');
    expect(() => linkBases(gapped)).toThrow('the linked series has a gap');
  });
});

describe('describeBase', () => {
  it('should name the newest base and list the linked ones', () => {
    const bases: BaseSeries[] = [
      { baseYear: 2015, months: new Map() },
      { baseYear: 2025, months: new Map() },
    ];

    expect(describeBase(bases)).toBe(
      '2025=100 (earlier bases 2015 chain-linked on their reference-year averages)',
    );
    expect(describeBase([bases[1]])).toBe('2025=100');
  });
});

describe('serializeIstatNicFile', () => {
  it('should emit sorted month keys, two-space indentation and a trailing newline', () => {
    const serialized = serializeIstatNicFile({
      source: 'test',
      indexName: 'NIC all items',
      base: '2025=100',
      updatedAt: '2026-08-21T00:00:00.000Z',
      months: { '2026-02': 101.1, '2026-01': 100.4 },
    });

    expect(serialized).toBe(
      `${JSON.stringify(
        {
          source: 'test',
          indexName: 'NIC all items',
          base: '2025=100',
          updatedAt: '2026-08-21T00:00:00.000Z',
          months: { '2026-01': 100.4, '2026-02': 101.1 },
        },
        null,
        2,
      )}\n`,
    );
    expect(serialized.indexOf('2026-01')).toBeLessThan(serialized.indexOf('2026-02'));
  });
});
