import { describe, expect, test } from 'vitest';

import {
  AREA_CHART_PADDING,
  buildAreaChartGeometry,
  buildAreaPath,
  buildLinePath,
  buildNiceTicks,
  calculatePriceDirection,
  calculateSeriesChangeRatio,
  createLinearScale,
  FLAT_RATIO_EPSILON,
  padDomain,
  pickLabelIndexes,
} from './scale';

describe('createLinearScale', () => {
  test('should map the domain endpoints onto the range endpoints', () => {
    const scale = createLinearScale([0, 10], [0, 100]);
    expect(scale(0)).toBe(0);
    expect(scale(10)).toBe(100);
    expect(scale(2.5)).toBe(25);
  });

  test('should invert the range for SVG y axes', () => {
    const scale = createLinearScale([100, 110], [200, 0]);
    expect(scale(100)).toBe(200);
    expect(scale(110)).toBe(0);
  });

  test('should map a flat domain to the middle of the range', () => {
    const scale = createLinearScale([5, 5], [0, 100]);
    expect(scale(5)).toBe(50);
  });
});

describe('padDomain', () => {
  test('should pad by a fraction of the span on both sides', () => {
    expect(padDomain([100, 110], 0.1)).toEqual([99, 111]);
  });

  test('should give a flat series an absolute pad', () => {
    const [min, max] = padDomain([100, 100]);
    expect(min).toBeLessThan(100);
    expect(max).toBeGreaterThan(100);
  });

  test('should fall back to a unit domain when empty', () => {
    expect(padDomain([])).toEqual([0, 1]);
  });
});

describe('buildLinePath', () => {
  test('should move to the first point and line to the rest', () => {
    expect(
      buildLinePath([
        { x: 0, y: 10 },
        { x: 5, y: 2.456 },
      ]),
    ).toBe('M0 10L5 2.46');
  });

  test('should lift the pen across null gaps', () => {
    expect(
      buildLinePath([
        { x: 0, y: 1 },
        { x: 1, y: null },
        { x: 2, y: 3 },
        { x: 3, y: 4 },
      ]),
    ).toBe('M0 1M2 3L3 4');
  });
});

describe('buildAreaPath', () => {
  test('should close the polygon down to the baseline', () => {
    expect(
      buildAreaPath(
        [
          { x: 0, y: 10 },
          { x: 20, y: 5 },
        ],
        30,
      ),
    ).toBe('M0 10L20 5L20 30L0 30Z');
  });

  test('should return an empty path for no points', () => {
    expect(buildAreaPath([], 30)).toBe('');
  });
});

describe('buildNiceTicks', () => {
  test('should produce round steps covering the domain', () => {
    expect(buildNiceTicks([98, 106], 4)).toEqual([98, 100, 102, 104, 106]);
  });

  test('should scale the step with the magnitude', () => {
    expect(buildNiceTicks([0, 1000], 4)).toEqual([0, 250, 500, 750, 1000]);
  });

  test('should return the minimum for a flat domain', () => {
    expect(buildNiceTicks([5, 5])).toEqual([5]);
  });
});

describe('pickLabelIndexes', () => {
  test('should keep every index when there is room', () => {
    expect(pickLabelIndexes(3, 4)).toEqual([0, 1, 2]);
  });

  test('should always include the first and the last index', () => {
    const indexes = pickLabelIndexes(12, 4);
    expect(indexes[0]).toBe(0);
    expect(indexes.at(-1)).toBe(11);
    expect(indexes.length).toBeLessThanOrEqual(5);
  });
});

describe('calculatePriceDirection', () => {
  const percentFormat = new Intl.NumberFormat('it-IT', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  test.each([0, 0.00005, 0.0004, 0.00049999, -0.0004, -0.00049999])(
    'should call %s flat because it renders as 0,0%%',
    (ratio) => {
      expect(percentFormat.format(Math.abs(ratio))).toBe('0,0%');
      expect(calculatePriceDirection(ratio)).toBe('flat');
    },
  );

  test('should start rising and falling exactly where the display shows 0,1%', () => {
    expect(percentFormat.format(FLAT_RATIO_EPSILON)).toBe('0,1%');
    expect(calculatePriceDirection(FLAT_RATIO_EPSILON)).toBe('up');
    expect(calculatePriceDirection(-FLAT_RATIO_EPSILON)).toBe('down');
  });

  test('should classify clear moves by their sign', () => {
    expect(calculatePriceDirection(0.042)).toBe('up');
    expect(calculatePriceDirection(-0.013)).toBe('down');
  });
});

describe('calculateSeriesChangeRatio', () => {
  test('should compare the last value with the first', () => {
    expect(calculateSeriesChangeRatio([2, 5, 3])).toBeCloseTo(0.5);
    expect(calculateSeriesChangeRatio([4, 1, 2])).toBeCloseTo(-0.5);
  });

  test('should return 0 when there is nothing to compare', () => {
    expect(calculateSeriesChangeRatio([])).toBe(0);
    expect(calculateSeriesChangeRatio([2])).toBe(0);
    expect(calculateSeriesChangeRatio([0, 3])).toBe(0);
  });
});

describe('buildAreaChartGeometry', () => {
  const baseInput = {
    values: [100, 110],
    compareValues: [],
    markerValues: [],
    width: 600,
    height: 200,
  };

  test('should place the plot inside the padding', () => {
    const geometry = buildAreaChartGeometry(baseInput);
    expect(geometry.plotLeft).toBe(AREA_CHART_PADDING.left);
    expect(geometry.plotRight).toBe(600 - AREA_CHART_PADDING.right);
    expect(geometry.plotTop).toBe(AREA_CHART_PADDING.top);
    expect(geometry.plotBottom).toBe(200 - AREA_CHART_PADDING.bottom);
  });

  test('should keep a minimum plot width before the container is measured', () => {
    const geometry = buildAreaChartGeometry({ ...baseInput, width: 0 });
    expect(geometry.plotRight - geometry.plotLeft).toBe(40);
  });

  test('should span the first and last month across the plot', () => {
    const geometry = buildAreaChartGeometry(baseInput);
    expect(geometry.x(0)).toBe(geometry.plotLeft);
    expect(geometry.x(1)).toBe(geometry.plotRight);
  });

  test('should keep the line off the top and bottom edges', () => {
    const geometry = buildAreaChartGeometry(baseInput);
    expect(geometry.y(100)).toBeLessThan(geometry.plotBottom);
    expect(geometry.y(110)).toBeGreaterThan(geometry.plotTop);
  });

  test('should widen the y domain for comparison values and markers', () => {
    const plain = buildAreaChartGeometry(baseInput);
    const withCompare = buildAreaChartGeometry({ ...baseInput, compareValues: [90, null] });
    const withMarker = buildAreaChartGeometry({ ...baseInput, markerValues: [120] });
    expect(withCompare.y.domain[0]).toBeLessThan(plain.y.domain[0]);
    expect(withMarker.y.domain[1]).toBeGreaterThan(plain.y.domain[1]);
  });

  test('should draw the line, the area down to the plot bottom and the comparison with gaps', () => {
    const geometry = buildAreaChartGeometry({ ...baseInput, compareValues: [105, null] });
    expect(geometry.linePath.startsWith(`M${geometry.plotLeft} `)).toBe(true);
    expect(geometry.areaPath.endsWith(`L${geometry.plotLeft} ${geometry.plotBottom}Z`)).toBe(true);
    expect(geometry.comparePath).not.toContain('L');
  });

  test('should lay sparse y ticks over the padded domain, three steps wide', () => {
    const geometry = buildAreaChartGeometry({ ...baseInput, values: [100, 137] });
    expect(geometry.yTicks.length).toBeGreaterThan(0);
    expect(geometry.yTicks.length).toBeLessThanOrEqual(4);
    expect(geometry.yTicks).toEqual(buildNiceTicks(geometry.y.domain, 3));
  });

  test('should thin the month labels on a narrow chart', () => {
    const values = Array.from({ length: 13 }, (_, index) => 100 + index);
    const narrow = buildAreaChartGeometry({ ...baseInput, values, width: 360 });
    const wide = buildAreaChartGeometry({ ...baseInput, values, width: 800 });
    expect(narrow.labelIndexes.length).toBeLessThanOrEqual(4);
    expect(wide.labelIndexes.length).toBeGreaterThan(narrow.labelIndexes.length);
    expect(wide.labelIndexes.length).toBeLessThanOrEqual(6);
  });

  test('should map a pointer x to the nearest month and clamp outside the plot', () => {
    const values = [100, 101, 102, 103, 104];
    const geometry = buildAreaChartGeometry({ ...baseInput, values });
    expect(geometry.indexAtX(geometry.x(2) + 1)).toBe(2);
    expect(geometry.indexAtX(geometry.x(3) - 1)).toBe(3);
    expect(geometry.indexAtX(0)).toBe(0);
    expect(geometry.indexAtX(10_000)).toBe(4);
  });
});
