/**
 * Full user data export. Thin orchestration over the
 * repositories — the route handler stays HTTP-only per the layer rules.
 */
import type { Db } from '@/lib/db/client';
import { listPriceEntries, type PriceEntryWithProduct } from '@/lib/db/repositories/price-entries';
import { listProducts } from '@/lib/db/repositories/products';
import { getUserSettings } from '@/lib/db/repositories/settings';
import { listAllShoppingSessions } from '@/lib/db/repositories/shopping-sessions';
import { listStores } from '@/lib/db/repositories/stores';
import type { Product, ShoppingSession, Store } from '@/lib/db/schema/app';
import type { IndexSettings } from '@/lib/inflation';
import { toIndexSettings } from './settings';

/**
 * Payload returned by GET /api/export. Bump schemaVersion on any shape
 * change. Version 2 added `quantity` on every entry together with the
 * receipt import's tables; version 3 is version 2 without that import
 * (`receipts`, `productAliases`, `receiptId`, `defaultPackageSize` are gone,
 * `quantity` stays). The import accepts every published version.
 */
export interface ExportPayload {
  schemaVersion: 3;
  exportedAt: string;
  settings: IndexSettings;
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
    quantity: number;
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
 * Assemble the full export payload for one user. Every aggregate is read
 * whole: the export is the genuinely full dataset, so entries walk every
 * page of listPriceEntries and sessions come from the uncapped
 * listAllShoppingSessions rather than a default page size.
 */
export async function exportUserData(db: Db, userId: string): Promise<ExportPayload> {
  const [settings, stores, products, shoppingSessions, entries] = await Promise.all([
    getUserSettings(db, userId),
    listStores(db, userId),
    listProducts(db, userId, { includeArchived: true }),
    listAllShoppingSessions(db, userId),
    listAllPriceEntries(db, userId),
  ]);

  return {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    settings: toIndexSettings(settings),
    stores: stores.map(toExportStore),
    products: products.map(toExportProduct),
    shoppingSessions: shoppingSessions.map(toExportShoppingSession),
    entries: entries.map(toExportEntry),
  };
}

/** Every price entry of the user, walking the repository's cursor to the end. */
async function listAllPriceEntries(db: Db, userId: string): Promise<PriceEntryWithProduct[]> {
  const entries: PriceEntryWithProduct[] = [];
  let cursor: string | undefined;
  do {
    const page = await listPriceEntries(db, userId, { cursor, limit: 100 });
    entries.push(...page.entries);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return entries;
}

// Guide: one mapper per aggregate, row → payload shape. Each one lists its
// fields explicitly rather than spreading the row, so a column added to the
// schema reaches the backup only by a deliberate change to ExportPayload.

function toExportStore(store: Store): ExportPayload['stores'][number] {
  return {
    id: store.id,
    name: store.name,
    chain: store.chain,
    city: store.city,
    kind: store.kind,
    createdAt: store.createdAt.toISOString(),
    updatedAt: store.updatedAt.toISOString(),
  };
}

function toExportProduct(product: Product): ExportPayload['products'][number] {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    unitKind: product.unitKind,
    notes: product.notes,
    isArchived: product.isArchived,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function toExportShoppingSession(
  session: ShoppingSession,
): ExportPayload['shoppingSessions'][number] {
  return {
    id: session.id,
    storeId: session.storeId,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function toExportEntry(entry: PriceEntryWithProduct): ExportPayload['entries'][number] {
  return {
    id: entry.id,
    productId: entry.productId,
    storeId: entry.storeId,
    sessionId: entry.sessionId,
    recordedAt: entry.recordedAt.toISOString(),
    totalPriceCents: entry.totalPriceCents,
    quantity: entry.quantity,
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
  };
}
