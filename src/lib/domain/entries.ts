/**
 * Text enums stored on price_entries and shopping_sessions.
 */
// WARNING: adding a source here also requires updating:
// - messages/it.json and messages/en.json (keys under "productDetail.source")
// - SOURCE_ICONS in src/components/entries/entry-sheet.tsx
// Every exhaustive switch on EntrySource is checked by the compiler.
export const ENTRY_SOURCES = ['photo', 'manual', 'fuel', 'receipt'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const PROMO_KINDS = ['discount', 'loyalty', 'coupon', 'bundle'] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export const SESSION_STATUSES = ['active', 'reviewing', 'completed', 'discarded'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
