import { describe, expect, test } from 'vitest';

import { type GroupableEntry, groupEntriesByDay } from './history-groups';

const DAY_MS = 86_400_000;
const NOW = 100 * DAY_MS;

/** A fake calendar: whole UTC days before NOW. */
const daysAgoOf = (epochMs: number): number =>
  Math.floor(NOW / DAY_MS) - Math.floor(epochMs / DAY_MS);

function entry(
  id: string,
  recordedAt: number,
  overrides: Partial<GroupableEntry> = {},
): GroupableEntry {
  return {
    id,
    recordedAt,
    sessionId: null,
    totalPriceCents: 100,
    store: null,
    ...overrides,
  };
}

describe('groupEntriesByDay', () => {
  test('should return no groups for an empty timeline', () => {
    expect(groupEntriesByDay([], daysAgoOf)).toEqual([]);
  });

  test('should start a new group at every change of calendar day', () => {
    // Arrange
    const entries = [
      entry('a', NOW + 5_000),
      entry('b', NOW + 1_000),
      entry('c', NOW - 1_000),
      entry('d', NOW - 3 * DAY_MS),
    ];

    // Act
    const groups = groupEntriesByDay(entries, daysAgoOf);

    // Assert
    expect(groups.map((group) => [group.daysAgo, group.dayEpochMs])).toEqual([
      [0, NOW + 5_000],
      [1, NOW - 1_000],
      [3, NOW - 3 * DAY_MS],
    ]);
  });

  test('should fold consecutive entries of one session into a block with their total', () => {
    // Arrange
    const store = { name: 'Esselunga' };
    const entries = [
      entry('a', NOW + 3_000, { sessionId: 's1', totalPriceCents: 250, store }),
      entry('b', NOW + 2_000, { sessionId: 's1', totalPriceCents: 199, store }),
      entry('c', NOW + 1_000, { sessionId: 's1', totalPriceCents: 51, store }),
    ];

    // Act
    const [day] = groupEntriesByDay(entries, daysAgoOf);

    // Assert
    expect(day.blocks).toHaveLength(1);
    expect(day.blocks[0]).toMatchObject({
      kind: 'session',
      sessionId: 's1',
      storeName: 'Esselunga',
      startedAt: NOW + 1_000,
      totalCents: 500,
    });
    expect(day.blocks[0].entries.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  test('should keep consecutive standalone entries in one plain block', () => {
    // Arrange
    const entries = [entry('a', NOW + 2_000), entry('b', NOW + 1_000)];

    // Act
    const [day] = groupEntriesByDay(entries, daysAgoOf);

    // Assert
    expect(day.blocks).toEqual([{ kind: 'plain', key: 'plain-a', entries }]);
  });

  test('should split a session around a standalone entry with distinct block keys', () => {
    // Arrange
    const entries = [
      entry('a', NOW + 3_000, { sessionId: 's1' }),
      entry('b', NOW + 2_000),
      entry('c', NOW + 1_000, { sessionId: 's1' }),
    ];

    // Act
    const [day] = groupEntriesByDay(entries, daysAgoOf);

    // Assert
    expect(day.blocks.map((block) => [block.kind, block.key])).toEqual([
      ['session', 'session-a'],
      ['plain', 'plain-b'],
      ['session', 'session-c'],
    ]);
  });

  test('should split a session that crosses midnight into one block per day', () => {
    // Arrange
    const entries = [
      entry('a', NOW + 1_000, { sessionId: 's1', totalPriceCents: 300 }),
      entry('b', NOW - 1_000, { sessionId: 's1', totalPriceCents: 200 }),
    ];

    // Act
    const groups = groupEntriesByDay(entries, daysAgoOf);

    // Assert
    expect(groups.map((group) => group.blocks.map((block) => block.kind))).toEqual([
      ['session'],
      ['session'],
    ]);
    expect(
      groups
        .flatMap((group) => group.blocks)
        .map((block) => block.kind === 'session' && block.totalCents),
    ).toEqual([300, 200]);
  });
});
