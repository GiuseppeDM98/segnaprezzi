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
import { getReceiptLineBlockingReason, normalizeAlias } from '@/lib/domain/receipt-lines';
import type { ProductPick } from '@/lib/domain/schemas';
import type { StoreKind } from '@/lib/domain/stores';
import {
  InvalidInputError,
  InvalidPriceError,
  InvalidSizeError,
  ReceiptExtractionStaleError,
  ReceiptNotFoundError,
  StoreNotFoundError,
} from '@/lib/errors';
import { resolveProductPicks } from './create-price-entry';
import { parseReceiptExtraction } from './import-receipt';

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
  shouldLearnAlias: boolean;
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
 * @throws ReceiptExtractionStaleError when its stored extraction no longer parses
 * @throws InvalidInputError when a line index is not on the stored receipt, or repeats
 * @throws InvalidPriceError when a line's three money numbers cannot all be true
 * @throws InvalidSizeError, InvalidInputError when a line is otherwise not confirmable
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

    const extraction = parseReceiptExtraction(receipt.aiRawJson, receipt.id);
    if (!extraction) {
      throw new ReceiptExtractionStaleError(receipt.id);
    }

    assertLineIndexesValid(input.lines, extraction.lines.length);
    for (const line of input.lines) {
      assertLineConfirmable(line);
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
 * Refuse a line the review screen would have refused: the same
 * getReceiptLineBlockingReason, so the server never stores what the screen
 * calls blocked. The unit-price check is the one that matters most — both
 * sides of the invariant are the milli-euro price of one whole package, and
 * a client that edited one field without the others would otherwise write a
 * unit price that contradicts its own total, while the index reads the unit
 * price.
 *
 * Why needsProductDecision is false: the confirm request carries the pick
 * itself, so the decision has been made by the time it arrives.
 *
 * @throws InvalidInputError when a new product's name is blank
 * @throws InvalidSizeError when the package size is not positive
 * @throws InvalidPriceError when a price is not positive or the three disagree
 */
function assertLineConfirmable(line: ConfirmReceiptLineInput): void {
  const reason = getReceiptLineBlockingReason(
    {
      packageSize: line.packageSize,
      totalPriceCents: line.totalPriceCents,
      unitPriceMilli: line.unitPriceMilli,
      needsProductDecision: false,
    },
    line.product.kind === 'new' ? line.product.name : null,
  );
  switch (reason) {
    case null:
      return;
    case 'product':
      throw new InvalidInputError(`Line ${line.index}: the new product has no name`);
    case 'size':
      throw new InvalidSizeError(
        `Line ${line.index}: packageSize ${line.packageSize} is not positive`,
      );
    case 'price':
      throw new InvalidPriceError(`Line ${line.index}: a price is not positive`);
    case 'unit-price':
      throw new InvalidPriceError(
        `Line ${line.index}: unitPriceMilli x packageSize (${line.unitPriceMilli * line.packageSize}) does not match totalPriceCents (${line.totalPriceCents * 10})`,
      );
  }
}

/**
 * Refuse a line index the stored extraction does not have, or one sent twice.
 *
 * Why it matters: the index is client-sent, and it is what ties an entry to
 * its printed line. An index past the end would write an entry with no
 * aiRawJson, no confidence and no alias; a repeated one would record the
 * same printed line twice. Lines may be absent (the user skipped them), so
 * only membership and uniqueness are checked, not completeness.
 *
 * @param extractedLineCount - Number of lines in the stored extraction
 * @throws InvalidInputError naming the first offending index
 */
function assertLineIndexesValid(
  lines: ConfirmReceiptLineInput[],
  extractedLineCount: number,
): void {
  const seen = new Set<number>();
  for (const line of lines) {
    if (!Number.isInteger(line.index) || line.index < 0 || line.index >= extractedLineCount) {
      throw new InvalidInputError(
        `Line ${line.index} is not on the stored receipt (${extractedLineCount} lines)`,
      );
    }
    if (seen.has(line.index)) {
      throw new InvalidInputError(`Line ${line.index} is sent more than once`);
    }
    seen.add(line.index);
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
    if (!line.shouldLearnAlias || !extracted) {
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
