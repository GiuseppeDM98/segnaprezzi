/**
 * Text enums stored on price_entries and shopping_sessions (Spec 00 §6).
 */
// Spec 07 appends 'receipt' (with price_entries.quantity / receipt_id and the
// receipts + product_aliases tables) in its own migration — Spec 00 §6 lists
// the full contract.
export const ENTRY_SOURCES = ['photo', 'manual', 'fuel'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const PROMO_KINDS = ['discount', 'loyalty', 'coupon', 'bundle'] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export const SESSION_STATUSES = ['active', 'reviewing', 'completed', 'discarded'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
