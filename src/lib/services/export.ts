/**
 * Full user data export (Spec 02 §9). Thin orchestration over the
 * repositories — the route handler stays HTTP-only per the layer rules
 * (Spec 00 §5).
 */
import type { Db } from '@/lib/db/client';
import { listPriceEntries } from '@/lib/db/repositories/price-entries';
import { listProductAliases } from '@/lib/db/repositories/product-aliases';
import { listProducts } from '@/lib/db/repositories/products';
import { listReceipts } from '@/lib/db/repositories/receipts';
import { getUserSettings } from '@/lib/db/repositories/settings';
import { listShoppingSessions } from '@/lib/db/repositories/shopping-sessions';
import { listStores } from '@/lib/db/repositories/stores';

/**
 * Payload returned by GET /api/export. Bump schemaVersion on any shape
 * change. Version 2 (Spec 07 §2.6) adds `receipts` and `productAliases`, and
 * `quantity` / `receiptId` on every entry.
 */
export interface ExportPayload {
  schemaVersion: 2;
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
    defaultPackageSize: number | null;
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
    receiptId: string | null;
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
  /**
   * Import records, deliberately WITHOUT `aiRawJson`: it is large, it is only
   * useful for debugging the extraction, and the entries it produced carry
   * their own per-line copy already.
   */
  receipts: Array<{
    id: string;
    storeId: string | null;
    status: string;
    purchasedAt: string;
    receiptTotalCents: number;
    lineCount: number;
    contentHash: string;
    fileKind: string;
    aiModel: string;
    confirmedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  productAliases: Array<{
    id: string;
    productId: string;
    alias: string;
    storeChain: string | null;
    hitCount: number;
    lastSeenAt: string;
    createdAt: string;
  }>;
}

/**
 * Assemble the full export payload for one user. All entries are fetched
 * unpaginated (Spec 02 §9 — the export is the genuinely full dataset), so
 * this walks every page of listPriceEntries rather than taking the default
 * page size.
 */
export async function exportUserData(db: Db, userId: string): Promise<ExportPayload> {
  const [settings, stores, products, shoppingSessions, receipts, productAliases] =
    await Promise.all([
      getUserSettings(db, userId),
      listStores(db, userId),
      listProducts(db, userId, { includeArchived: true }),
      listShoppingSessions(db, userId, { limit: 100 }),
      listReceipts(db, userId),
      listProductAliases(db, userId),
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
        receiptId: entry.receiptId,
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
      });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return {
    schemaVersion: 2,
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
      defaultPackageSize: product.defaultPackageSize,
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
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      storeId: receipt.storeId,
      status: receipt.status,
      purchasedAt: receipt.purchasedAt.toISOString(),
      receiptTotalCents: receipt.receiptTotalCents,
      lineCount: receipt.lineCount,
      contentHash: receipt.contentHash,
      fileKind: receipt.fileKind,
      aiModel: receipt.aiModel,
      confirmedAt: receipt.confirmedAt?.toISOString() ?? null,
      createdAt: receipt.createdAt.toISOString(),
      updatedAt: receipt.updatedAt.toISOString(),
    })),
    productAliases: productAliases.map((alias) => ({
      id: alias.id,
      productId: alias.productId,
      alias: alias.alias,
      storeChain: alias.storeChain,
      hitCount: alias.hitCount,
      lastSeenAt: alias.lastSeenAt.toISOString(),
      createdAt: alias.createdAt.toISOString(),
    })),
  };
}
