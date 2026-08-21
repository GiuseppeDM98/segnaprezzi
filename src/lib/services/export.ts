/**
 * Full user data export (Spec 02 §9). Thin orchestration over the
 * repositories — the route handler stays HTTP-only per the layer rules
 * (Spec 00 §5).
 */
import type { Db } from '@/lib/db/client';
import { listPriceEntries } from '@/lib/db/repositories/price-entries';
import { listProducts } from '@/lib/db/repositories/products';
import { getUserSettings } from '@/lib/db/repositories/settings';
import { listShoppingSessions } from '@/lib/db/repositories/shopping-sessions';
import { listStores } from '@/lib/db/repositories/stores';

/** Payload returned by GET /api/export. Bump schemaVersion on any shape change. */
export interface ExportPayload {
  schemaVersion: 1;
  exportedAt: string;
  settings: {
    includePromosInIndex: boolean;
    carryForwardMonths: number;
  };
  stores: Array<{
    id: string;
    name: string;
    chain: string | null;
    city: string | null;
    kind: string;
    createdAt: string;
    updatedAt: string;
  }>;
  products: Array<{
    id: string;
    name: string;
    brand: string | null;
    category: string;
    unitKind: string;
    notes: string | null;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  shoppingSessions: Array<{
    id: string;
    storeId: string | null;
    status: string;
    startedAt: string;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  entries: Array<{
    id: string;
    productId: string;
    storeId: string | null;
    sessionId: string | null;
    recordedAt: string;
    totalPriceCents: number;
    packageSize: number;
    unitPriceMilli: number;
    isPromo: boolean;
    promoKind: string | null;
    source: string;
    currency: string;
    photoUrl: string | null;
    aiConfidence: number | null;
    aiModel: string | null;
    aiRawJson: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

/**
 * Assemble the full export payload for one user. All entries are fetched
 * unpaginated (Spec 02 §9 — the export is the genuinely full dataset), so
 * this walks every page of listPriceEntries rather than taking the default
 * page size.
 */
export async function exportUserData(db: Db, userId: string): Promise<ExportPayload> {
  const [settings, stores, products, shoppingSessions] = await Promise.all([
    getUserSettings(db, userId),
    listStores(db, userId),
    listProducts(db, userId, { includeArchived: true }),
    listShoppingSessions(db, userId, { limit: 100 }),
  ]);

  const entries: ExportPayload['entries'] = [];
  let cursor: string | undefined;
  do {
    const page = await listPriceEntries(db, userId, { cursor, limit: 100 });
    for (const entry of page.entries) {
      entries.push({
        id: entry.id,
        productId: entry.productId,
        storeId: entry.storeId,
        sessionId: entry.sessionId,
        recordedAt: entry.recordedAt.toISOString(),
        totalPriceCents: entry.totalPriceCents,
        packageSize: entry.packageSize,
        unitPriceMilli: entry.unitPriceMilli,
        isPromo: entry.isPromo,
        promoKind: entry.promoKind,
        source: entry.source,
        currency: entry.currency,
        photoUrl: entry.photoUrl,
        aiConfidence: entry.aiConfidence,
        aiModel: entry.aiModel,
        aiRawJson: entry.aiRawJson,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      includePromosInIndex: settings.includePromosInIndex,
      carryForwardMonths: settings.carryForwardMonths,
    },
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      chain: store.chain,
      city: store.city,
      kind: store.kind,
      createdAt: store.createdAt.toISOString(),
      updatedAt: store.updatedAt.toISOString(),
    })),
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      unitKind: product.unitKind,
      notes: product.notes,
      isArchived: product.isArchived,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    })),
    shoppingSessions: shoppingSessions.map((session) => ({
      id: session.id,
      storeId: session.storeId,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    })),
    entries,
  };
}
