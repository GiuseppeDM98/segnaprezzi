/*
 * The matcher's behaviour table. These rows are
 * the contract: they encode which real Italian shelf-tag-vs-catalog pairs
 * must match and which must not, so a scoring tweak that breaks one of them
 * is a regression, not a refinement.
 */
import { describe, expect, test } from 'vitest';
import {
  calculateDiceSimilarity,
  normalizeProductName,
  suggestProductMatches,
} from './match-products';

function candidate(id: string, name: string, brand: string | null, isRecent = false) {
  return { id, name, brand, hasRecentEntryAtStore: isRecent };
}

describe('normalizeProductName', () => {
  test.each([
    ['Spaghetti Barilla N.5', 'spaghetti barilla n 5'],
    ['Caffè Qualità Rossa', 'caffe qualita rossa'],
    ['Acqua  Naturale 1,5L', 'acqua naturale 1 5l'],
    ['PASSATA (700 g)', 'passata 700 g'],
  ])('should normalize %j to %j', (raw, expected) => {
    expect(normalizeProductName(raw)).toBe(expected);
  });
});

describe('suggestProductMatches', () => {
  test.each([
    // [description, extractedName, extractedBrand, candidateName, candidateBrand, isSuggested, minScore]
    [
      'same product, different word order and pack size',
      'Spaghetti N.5',
      'Barilla',
      'Spaghetti n.5 500g',
      'Barilla',
      true,
      0.8,
    ],
    [
      'abbreviated catalog name rescued by the brand bonus',
      'Latte Parzialmente Scremato',
      'Granarolo',
      'Latte PS 1L',
      'Granarolo',
      true,
      0.5,
    ],
    [
      'diacritics stripped on both sides',
      'Caffè Qualità Rossa',
      'Lavazza',
      'Caffe Qualita Rossa Macinato 250g',
      'Lavazza',
      true,
      0.7,
    ],
    [
      'same brand, different product — suggested but low (brand bonus pulls it over)',
      'Passata',
      'Mutti',
      'Polpa di Pomodoro 400g',
      'Mutti',
      true,
      0.4,
    ],
    [
      'unrelated product, different brand',
      'Acqua Naturale 1,5L',
      'San Benedetto',
      'Coca-Cola 1.5L',
      'Coca-Cola',
      false,
      0,
    ],
  ])('%s', (_description, name, brand, candidateName, candidateBrand, isSuggested, minScore) => {
    const suggestions = suggestProductMatches({ productName: name, brand }, [
      candidate('p1', candidateName, candidateBrand),
    ]);

    if (isSuggested) {
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].score).toBeGreaterThanOrEqual(minScore);
    } else {
      expect(suggestions).toHaveLength(0);
    }
  });

  test('should rank the recently-bought-here product first on equal names', () => {
    const suggestions = suggestProductMatches(
      { productName: 'Passata di pomodoro', brand: 'Mutti' },
      [
        candidate('elsewhere', 'Passata di pomodoro', 'Mutti', false),
        candidate('here', 'Passata di pomodoro', 'Mutti', true),
      ],
    );

    expect(suggestions[0].productId).toBe('here');
  });

  test('should cap the score at 1 and return at most 3 suggestions', () => {
    const twins = ['a', 'b', 'c', 'd'].map((id) => candidate(id, 'Spaghetti n.5', 'Barilla', true));

    const suggestions = suggestProductMatches(
      { productName: 'Spaghetti n.5', brand: 'Barilla' },
      twins,
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].score).toBe(1);
  });

  test('should return exact similarity 1 for identical normalized strings', () => {
    expect(calculateDiceSimilarity('barilla spaghetti', 'barilla spaghetti')).toBe(1);
  });
});
