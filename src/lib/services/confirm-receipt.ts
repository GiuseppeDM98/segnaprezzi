/**
 * Turn a reviewed receipt into price entries.
 *
 * Design: one transaction, and the only place in the receipt pipeline that
 * writes observations. It is replay-safe — an already-confirmed receipt
 * returns its existing entry ids without writing — because the confirm
 * request can be retried by a phone that never saw the response.
 *
 * Two things are recomputed server-side rather than trusted from the client:
 * the unit-price invariant (a wrong number here poisons a price history for
 * good) and the alias key, which is derived from the stored `rawLine` so a
 * crafted request cannot teach the catalog a mapping the receipt never made.
 */

import { nanoid } from 'nanoid';
import { RECEIPT_EXTRACTION_MODEL } from '@/lib/ai/extract-receipt';
import type { Db, DbTransaction } from '@/lib/db/client';
import {
  createPriceEntriesIgnoringDuplicates,
  listPriceEntryIdsByReceipt,
} from '@/lib/db/repositories/price-entries';
import { learnProductAliases } from '@/lib/db/repositories/product-aliases';
import { updateDefaultPackageSizes } from '@/lib/db/repositories/products';
import { getReceiptById, updateReceipt } from '@/lib/db/repositories/receipts';
import { createStore, getStoreById } from '@/lib/db/repositories/stores';
import type { PromoKind } from '@/lib/domain/entries';
import { normalizeAlias } from '@/lib/domain/receipt-lines';
import type { ProductPick } from '@/lib/domain/schemas';
import type { StoreKind } from '@/lib/domain/stores';
import { InvalidPriceError, ReceiptNotFoundError, StoreNotFoundError } from '@/lib/errors';
import { resolveProductPicks } from './create-price-entry';
import { parseReceiptExtraction } from './import-receipt';

/**
 * Slack on `unitPriceMilli × packageSize = totalPriceCents × 10`: one cent,
 * which is exactly the rounding the derivation itself can introduce.
 */
const INVARIANT_TOLERANCE_MILLI = 10;

export interface ConfirmReceiptLineInput {
  /** Position on the receipt — indexes into the stored extraction. */
  index: number;
  product: ProductPick;
  quantity: number;
  packageSize: number;
  /** Price of ONE package, in euro cents. */
  totalPriceCents: number;
  unitPriceMilli: number;
  isPromo: boolean;
  promoKind: PromoKind | null;
  /** Remember this line's abbreviation for the next receipt. */
  learnAlias: boolean;
}

export interface ConfirmReceiptInput {
  receiptId: string;
  storeId: string | null;
  newStore: { name: string; chain: string | null; kind: StoreKind } | null;
  /** Epoch ms UTC; becomes every entry's recorded_at. */
  purchasedAt: number;
  lines: ConfirmReceiptLineInput[];
}

export interface ConfirmReceiptResult {
  receiptId: string;
  entryIds: string[];
  createdProductIds: string[];
  storeId: string | null;
}

/**
 * Persist the confirmed lines of one receipt.
 *
 * @param db - Database handle; the whole confirm runs in one transaction
 * @param userId - Always from the server session
 * @returns The receipt id, the entry ids, and anything created on the way
 * @throws ReceiptNotFoundError when the receipt is not the user's, or discarded
 * @throws InvalidPriceError when a line's three money numbers cannot all be true
 * @throws StoreNotFoundError, ProductNotFoundError on a foreign reference
 */
export async function confirmReceipt(
  db: Db,
  userId: string,
  input: ConfirmReceiptInput,
): Promise<ConfirmReceiptResult> {
  return db.transaction(async (tx) => {
    const receipt = await getReceiptById(tx, userId, input.receiptId);
    if (!receipt || receipt.status === 'discarded') {
      throw new ReceiptNotFoundError(input.receiptId);
    }

    // A confirmed receipt is a replay, not an error: hand back what is
    // already there so the client can navigate on.
    if (receipt.status === 'confirmed') {
      return {
        receiptId: receipt.id,
        entryIds: await listPriceEntryIdsByReceipt(tx, userId, receipt.id),
        createdProductIds: [],
        storeId: receipt.storeId,
      };
    }

    const extraction = parseReceiptExtraction(receipt.aiRawJson);
    if (!extraction) {
      throw new ReceiptNotFoundError(input.receiptId);
    }

    for (const line of input.lines) {
      assertPriceInvariant(line);
    }

    const store = await resolveStore(tx, userId, input);
    const { productIds, createdProductIds } = await resolveProductPicks(
      tx,
      userId,
      input.lines.map((line) => line.product),
    );

    const recordedAt = new Date(input.purchasedAt);
    const inserted = await createPriceEntriesIgnoringDuplicates(
      tx,
      userId,
      input.lines.map((line, position) => {
        const extracted = extraction.lines[line.index];
        return {
          id: nanoid(),
          productId: productIds[position],
          storeId: store.id,
          receiptId: receipt.id,
          recordedAt,
          totalPriceCents: line.totalPriceCents,
          quantity: line.quantity,
          packageSize: line.packageSize,
          unitPriceMilli: line.unitPriceMilli,
          isPromo: line.isPromo,
          promoKind: line.isPromo ? line.promoKind : null,
          source: 'receipt' as const,
          // A receipt is never a photo we stored: photo_url stays null.
          photoUrl: null,
          aiConfidence: extracted?.confidence ?? null,
          aiModel: RECEIPT_EXTRACTION_MODEL,
          aiRawJson: extracted ? JSON.stringify(extracted) : null,
        };
      }),
    );

    await learnAliases(tx, userId, {
      lines: input.lines,
      extraction,
      productIds,
      storeChain: store.chain,
      now: new Date(),
    });

    await updateDefaultPackageSizes(
      tx,
      userId,
      input.lines.map((line, position) => ({
        productId: productIds[position],
        packageSize: line.packageSize,
      })),
    );

    await updateReceipt(tx, userId, receipt.id, {
      status: 'confirmed',
      confirmedAt: new Date(),
      storeId: store.id,
      purchasedAt: recordedAt,
      lineCount: input.lines.length,
    });

    return {
      receiptId: receipt.id,
      entryIds: inserted.map((entry) => entry.id),
      createdProductIds,
      storeId: store.id,
    };
  });
}

/**
 * The invariant every price entry satisfies: both sides are the
 * milli-euro price of one whole package. A client that edited one field
 * without the others would otherwise write a unit price that contradicts
 * its own total — and the index reads the unit price.
 */
function assertPriceInvariant(line: ConfirmReceiptLineInput): void {
  const derivedMilli = line.unitPriceMilli * line.packageSize;
  const totalMilli = line.totalPriceCents * 10;
  if (Math.abs(derivedMilli - totalMilli) > INVARIANT_TOLERANCE_MILLI) {
    throw new InvalidPriceError(
      `Line ${line.index}: unitPriceMilli x packageSize (${derivedMilli}) does not match totalPriceCents (${totalMilli})`,
    );
  }
}

/**
 * Create the store the user typed on the review screen, or validate the one
 * they picked. The chain comes back with it because that is what scopes the
 * aliases learned below.
 */
async function resolveStore(
  tx: DbTransaction,
  userId: string,
  input: ConfirmReceiptInput,
): Promise<{ id: string | null; chain: string | null }> {
  if (input.newStore) {
    const created = await createStore(tx, userId, input.newStore);
    return { id: created.id, chain: created.chain };
  }
  if (!input.storeId) {
    return { id: null, chain: null };
  }
  const store = await getStoreById(tx, userId, input.storeId);
  if (!store) {
    throw new StoreNotFoundError(input.storeId);
  }
  return { id: store.id, chain: store.chain };
}

interface LearnAliasesInput {
  lines: ConfirmReceiptLineInput[];
  extraction: NonNullable<ReturnType<typeof parseReceiptExtraction>>;
  /** Product ids positionally matching `lines`. */
  productIds: string[];
  storeChain: string | null;
  now: Date;
}

/**
 * Remember every line the user asked to remember.
 *
 * The key is recomputed here from the STORED rawLine, never taken from the
 * request: the client may legitimately edit prices and sizes, but the
 * abbreviation the printer used is a fact about the document, and letting a
 * request name it would let one teach the catalog an arbitrary mapping.
 */
async function learnAliases(
  tx: DbTransaction,
  userId: string,
  input: LearnAliasesInput,
): Promise<void> {
  const learnable = input.lines.flatMap((line, position) => {
    const extracted = input.extraction.lines[line.index];
    if (!line.learnAlias || !extracted) {
      return [];
    }
    const alias = normalizeAlias(extracted.rawLine);
    if (alias.length === 0) {
      return [];
    }
    return [
      {
        productId: input.productIds[position],
        alias,
        storeChain: input.storeChain,
        lastSeenAt: input.now,
      },
    ];
  });

  await learnProductAliases(tx, userId, learnable);
}
