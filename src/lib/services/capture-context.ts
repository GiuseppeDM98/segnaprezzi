/**
 * Read models for the capture screens (/scan, /add/manual).
 *
 * Design: pages are Server Components and must not reach into repositories
 * (AGENTS.md §1.5), so the small amount of data each capture screen needs to
 * render is assembled here. Everything returned is plain JSON — Dates become
 * epoch milliseconds — because these values are handed straight to Client
 * Components, which cannot receive Date instances across the boundary in a
 * stable way.
 */
import type { Db } from '@/lib/db/client';
import { listProducts } from '@/lib/db/repositories/products';
import { getResumableShoppingSession } from '@/lib/db/repositories/shopping-sessions';
import type { CategoryId } from '@/lib/domain/categories';
import type { UnitKind } from '@/lib/domain/units';

export interface ProductSummary {
  id: string;
  name: string;
  brand: string | null;
  category: CategoryId;
  unitKind: UnitKind;
}

export interface ResumableSessionSummary {
  id: string;
  status: string;
  /** Epoch milliseconds UTC. */
  startedAt: number;
}

export interface ScanContext {
  resumableSession: ResumableSessionSummary | null;
}

/** Everything /scan needs to render the capture screen server-side. */
export async function getScanContext(db: Db, userId: string): Promise<ScanContext> {
  const session = await getResumableShoppingSession(db, userId);
  return {
    resumableSession: session
      ? { id: session.id, status: session.status, startedAt: session.startedAt.getTime() }
      : null,
  };
}

export interface ManualEntryContext {
  products: ProductSummary[];
}

/** The catalog the manual entry form searches. */
export async function getManualEntryContext(db: Db, userId: string): Promise<ManualEntryContext> {
  const products = await listProducts(db, userId, { includeArchived: false });
  return {
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      unitKind: product.unitKind,
    })),
  };
}
