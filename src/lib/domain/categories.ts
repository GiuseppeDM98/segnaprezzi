/**
 * Category taxonomy for products. Code-defined — there is no
 * categories table; the DB stores the id string, the UI localizes labels
 * via next-intl message keys `categories.<id>`.
 */

// WARNING: adding or renaming a category also requires updating:
// - messages/it.json and messages/en.json (keys under "categories")
// - the AI extraction prompt in src/lib/ai/
// - the ISTAT comparison mapping, if category-level comparison exists
export const CATEGORY_IDS = [
  'food',
  'beverages',
  'household',
  'personal-care',
  'health',
  'clothing',
  'fuel',
  'transport',
  'utilities',
  'recreation',
  'pets',
  'other',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

/** Report whether an arbitrary string is a known category id. */
export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_IDS as readonly string[]).includes(value);
}
