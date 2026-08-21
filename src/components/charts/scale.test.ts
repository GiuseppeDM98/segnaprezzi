import { describe, expect, test } from 'vitest';

import {
  buildAreaPath,
  buildLinePath,
  createLinearScale,
  niceTicks,
  padDomain,
  pickLabelIndexes,
  trendOf,
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

describe('niceTicks', () => {
  test('should produce round steps covering the domain', () => {
    expect(niceTicks([98, 106], 4)).toEqual([98, 100, 102, 104, 106]);
  });

  test('should scale the step with the magnitude', () => {
    expect(niceTicks([0, 1000], 4)).toEqual([0, 250, 500, 750, 1000]);
  });

  test('should return the minimum for a flat domain', () => {
    expect(niceTicks([5, 5])).toEqual([5]);
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

describe('trendOf', () => {
  test('should compare the last value with the first', () => {
    expect(trendOf([1, 3, 2])).toBe('up');
    expect(trendOf([3, 1])).toBe('down');
    expect(trendOf([2, 5, 2])).toBe('flat');
    expect(trendOf([2])).toBe('flat');
  });
});
