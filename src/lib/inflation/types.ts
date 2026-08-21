import type { CategoryId } from '@/lib/domain/categories';

/**
 * Minimal projection of one price entry needed by the index engine (Spec 04).
 * Owned by Spec 04; defined here now because the repository layer (Spec 02
 * §6.4, listEntriesForIndex) already needs the shape to type its return
 * value. recordedAt is epoch ms, not a Date, matching every other pure
 * domain/inflation boundary (Spec 00 §3: time is always a parameter).
 */
export interface IndexEntry {
  productId: string;
  category: CategoryId;
  recordedAt: number;
  unitPriceMilli: number;
  totalPriceCents: number;
  isPromo: boolean;
}
