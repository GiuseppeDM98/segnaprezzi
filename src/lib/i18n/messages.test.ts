import { describe, expect, test } from 'vitest';

import en from '../../../messages/en.json';
import it from '../../../messages/it.json';

/**
 * Spec 05 §9: both message files must stay key-complete — a key added to
 * one locale without its twin fails CI here instead of rendering a raw key.
 */
function collectKeys(tree: unknown, prefix = ''): string[] {
  if (typeof tree !== 'object' || tree === null) {
    return [prefix];
  }
  return Object.entries(tree).flatMap(([key, value]) =>
    collectKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

/** Placeholders used by a message, so "{count}" in one locale implies the other. */
function placeholdersOf(message: string): string[] {
  return [...message.matchAll(/\{(\w+)[,}]/g)].map((match) => match[1]).sort();
}

describe('message catalogs', () => {
  test('should have the same key tree in Italian and English', () => {
    expect(collectKeys(en).sort()).toEqual(collectKeys(it).sort());
  });

  test('should use the same placeholders for every key', () => {
    const flatten = (tree: unknown, prefix = ''): Record<string, string> =>
      typeof tree === 'string'
        ? { [prefix]: tree }
        : Object.assign(
            {},
            ...Object.entries(tree as Record<string, unknown>).map(([key, value]) =>
              flatten(value, prefix ? `${prefix}.${key}` : key),
            ),
          );
    const flatIt = flatten(it);
    const flatEn = flatten(en);
    for (const [key, message] of Object.entries(flatIt)) {
      expect({ key, placeholders: placeholdersOf(flatEn[key]) }).toEqual({
        key,
        placeholders: placeholdersOf(message),
      });
    }
  });
});
