import { describe, expect, it } from 'vitest';

import { rebaseIstat } from './istat';

describe('rebaseIstat', () => {
  it('should rebase the series so that the base month reads 100', () => {
    const months = { '2025-05': 121.6, '2025-06': 121.8, '2025-07': 122.1 };

    const rebased = rebaseIstat(months, '2025-06');

    expect(rebased).not.toBeNull();
    expect(rebased?.['2025-06']).toBe(100);
    expect(rebased?.['2025-05']).toBeCloseTo((121.6 / 121.8) * 100, 10);
    expect(rebased?.['2025-07']).toBeCloseTo((122.1 / 121.8) * 100, 10);
  });

  it('should return null when the base month is not in the series', () => {
    expect(rebaseIstat({ '2025-05': 121.6 }, '2024-01')).toBeNull();
  });

  it('should return null when the base value is zero', () => {
    expect(rebaseIstat({ '2025-05': 0, '2025-06': 121.8 }, '2025-05')).toBeNull();
  });

  it('should not mutate the input series', () => {
    const months = { '2025-05': 121.6, '2025-06': 121.8 };

    rebaseIstat(months, '2025-05');

    expect(months).toEqual({ '2025-05': 121.6, '2025-06': 121.8 });
  });
});
