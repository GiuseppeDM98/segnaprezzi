/**
 * Settings use cases: the two index options the user may
 * change and the backup import that restores a previous /api/export file.
 */
import { z } from 'zod';

import type { Db } from '@/lib/db/client';
import { upsertPriceEntries } from '@/lib/db/repositories/price-entries';
import { upsertProductAliases } from '@/lib/db/repositories/product-aliases';
import { listProductIds, upsertProducts } from '@/lib/db/repositories/products';
import { getUserSettings, updateUserSettings } from '@/lib/db/repositories/settings';
import {
  listShoppingSessionIds,
  upsertShoppingSessions,
} from '@/lib/db/repositories/shopping-sessions';
import { listStores, upsertStores } from '@/lib/db/repositories/stores';
import { CATEGORY_IDS } from '@/lib/domain/categories';
import { ENTRY_SOURCES, PROMO_KINDS, SESSION_STATUSES } from '@/lib/domain/entries';
import { nanoidSchema } from '@/lib/domain/schemas';
import { STORE_KINDS } from '@/lib/domain/stores';
import { UNIT_KINDS } from '@/lib/domain/units';
import { ValidationError } from '@/lib/errors';

export interface IndexSettings {
  includePromosInIndex: boolean;
  carryForwardMonths: number;
}

/** The two index options, healed to defaults if the row is missing. */
export async function getIndexSettings(db: Db, userId: string): Promise<IndexSettings> {
  const settings = await getUserSettings(db, userId);
  return {
    includePromosInIndex: settings.includePromosInIndex,
    carryForwardMonths: settings.carryForwardMonths,
  };
}

/** Persist a partial change to the index options. */
export async function updateIndexSettings(
  db: Db,
  userId: string,
  patch: Partial<IndexSettings>,
): Promise<IndexSettings> {
  const updated = await updateUserSettings(db, userId, patch);
  return {
    includePromosInIndex: updated.includePromosInIndex,
    carryForwardMonths: updated.carryForwardMonths,
  };
}

/*
 * Backup import. The file is a previous GET /api/export payload.
 * Dates travel as ISO strings and become Dates here; ids are re-validated as
 * nanoid(21) so a hand-edited file cannot smuggle arbitrary keys into the
 * tables.
 *
 * Both schema versions are accepted: a v1 backup predates receipt import and simply
 * carries no quantity, so it defaults to 1. What a v2 backup does NOT restore
 * is the `receipts` import records — they hold no observation (the entries
 * do) and their `ai_raw_json` is deliberately absent from the export, so a
 * restored row would be a receipt whose audit trail is empty. Entries
 * therefore come back with `receipt_id` cleared, exactly as they come back
 * with a store or session id the user no longer owns cleared. The learned
 * `productAliases` ARE restored: they are fully round-trippable, and losing
 * them would make every future receipt start from fuzzy matching again.
 */
const isoDateSchema = z.iso.datetime().transform((value) => new Date(value));

export const exportPayloadSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  settings: z.object({
    includePromosInIndex: z.boolean(),
    carryForwardMonths: z.number().int().min(0).max(6),
  }),
  stores: z.array(
    z.object({
      id: nanoidSchema,
      name: z.string().min(1).max(200),
      chain: z.string().max(100).nullable(),
      city: z.string().max(100).nullable(),
      kind: z.enum(STORE_KINDS),
    }),
  ),
  products: z.array(
    z.object({
      id: nanoidSchema,
      name: z.string().min(1).max(200),
      brand: z.string().max(100).nullable(),
      category: z.enum(CATEGORY_IDS),
      unitKind: z.enum(UNIT_KINDS),
      notes: z.string().max(2000).nullable(),
      defaultPackageSize: z.number().positive().nullable().default(null),
      isArchived: z.boolean(),
    }),
  ),
  shoppingSessions: z.array(
    z.object({
      id: nanoidSchema,
      storeId: nanoidSchema.nullable(),
      status: z.enum(SESSION_STATUSES),
      startedAt: isoDateSchema,
      completedAt: isoDateSchema.nullable(),
    }),
  ),
  entries: z.array(
    z.object({
      id: nanoidSchema,
      productId: nanoidSchema,
      storeId: nanoidSchema.nullable(),
      sessionId: nanoidSchema.nullable(),
      recordedAt: isoDateSchema,
      totalPriceCents: z.number().int().min(1),
      quantity: z.number().int().min(1).max(99).default(1),
      packageSize: z.number().positive(),
      unitPriceMilli: z.number().int().min(1),
      isPromo: z.boolean(),
      promoKind: z.enum(PROMO_KINDS).nullable(),
      source: z.enum(ENTRY_SOURCES),
      currency: z.string().length(3),
      photoUrl: z.string().nullable(),
      aiConfidence: z.number().min(0).max(1).nullable(),
      aiModel: z.string().nullable(),
      aiRawJson: z.string().nullable(),
    }),
  ),
  productAliases: z
    .array(
      z.object({
        id: nanoidSchema,
        productId: nanoidSchema,
        alias: z.string().min(1).max(200),
        storeChain: z.string().max(100).nullable(),
        hitCount: z.number().int().min(1),
        lastSeenAt: isoDateSchema,
      }),
    )
    .default([]),
});

export type ExportPayloadInput = z.infer<typeof exportPayloadSchema>;

export interface ImportResult {
  stores: number;
  products: number;
  sessions: number;
  entries: number;
  aliases: number;
  /** Entries dropped because they referenced a product that is not the user's. */
  skippedEntries: number;
}

/**
 * Merge a backup into the user's data by id — never a wipe. Rows that
 * already exist are updated, new ones inserted, and anything whose id
 * belongs to another user is skipped by the repositories' ownership guard.
 * Entries are re-linked only to products/stores/sessions the user owns
 * after the upserts, because the FK checks existence, not ownership.
 *
 * @throws ValidationError when the JSON is not a segnaprezzi export
 */
export async function importUserData(db: Db, userId: string, raw: unknown): Promise<ImportResult> {
  const parsed = exportPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('Not a segnaprezzi export', [z.prettifyError(parsed.error)]);
  }
  const payload = parsed.data;

  return db.transaction(async (tx) => {
    await upsertStores(tx, userId, payload.stores);
    await upsertProducts(tx, userId, payload.products);

    const ownedStoreIds = new Set((await listStores(tx, userId)).map((store) => store.id));
    await upsertShoppingSessions(
      tx,
      userId,
      payload.shoppingSessions.map((session) => ({
        ...session,
        storeId: session.storeId && ownedStoreIds.has(session.storeId) ? session.storeId : null,
      })),
    );

    const [ownedProductIds, ownedSessionIds] = await Promise.all([
      listProductIds(tx, userId),
      listShoppingSessionIds(tx, userId),
    ]);
    const importable = payload.entries.filter((entry) => ownedProductIds.has(entry.productId));
    await upsertPriceEntries(
      tx,
      userId,
      importable.map((entry) => ({
        ...entry,
        storeId: entry.storeId && ownedStoreIds.has(entry.storeId) ? entry.storeId : null,
        sessionId: entry.sessionId && ownedSessionIds.has(entry.sessionId) ? entry.sessionId : null,
        // See the note above the schema: import records are not restored, so
        // there is nothing for an entry to point at.
        receiptId: null,
      })),
    );

    const importableAliases = payload.productAliases.filter((alias) =>
      ownedProductIds.has(alias.productId),
    );
    await upsertProductAliases(tx, userId, importableAliases);

    await updateUserSettings(tx, userId, payload.settings);

    return {
      stores: payload.stores.length,
      products: payload.products.length,
      sessions: payload.shoppingSessions.length,
      entries: importable.length,
      aliases: importableAliases.length,
      skippedEntries: payload.entries.length - importable.length,
    };
  });
}
