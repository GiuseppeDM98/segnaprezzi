/**
 * Store kinds (Spec 00 §6, stores.kind).
 */
export const STORE_KINDS = ['supermarket', 'fuel_station', 'other'] as const;
export type StoreKind = (typeof STORE_KINDS)[number];
