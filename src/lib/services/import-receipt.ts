/**
 * The POST /api/extract-receipt use case and the read model
 * the review screen loads.
 *
 * Design: exactly one row is written here — the `receipts` import record, in
 * status `extracted`. Not a single `price_entries` row exists until the user
 * confirms, because a receipt line is a *proposal* until a human has
 * agreed that "LATTE PS UHT" is the litre of milk in their catalog.
 *
 * The uploaded file never touches disk or Blob storage: it is hashed,
 * base64-ed into one API call, and dropped. The hash is what makes a
 * re-upload idempotent, and `ai_raw_json` — every `rawLine` included — is the
 * audit trail that replaces the document we deliberately do not keep.
 */
import { createHash } from 'node:crypto';

import { AiGatewayError } from '@/lib/ai/extract-price-tag';
import { extractReceipt, RECEIPT_EXTRACTION_MODEL } from '@/lib/ai/extract-receipt';
import { flagReceiptForReview, type ReceiptReviewReason } from '@/lib/ai/flag-receipt';
import { type ReceiptExtraction, receiptExtractionSchema } from '@/lib/ai/receipt-schema';
import type { Db } from '@/lib/db/client';
import { listObservationsForProductsInRange } from '@/lib/db/repositories/price-entries';
import { listProductAliases } from '@/lib/db/repositories/product-aliases';
import { listProducts } from '@/lib/db/repositories/products';
import {
  createReceipt,
  getReceiptByHash,
  getReceiptById,
  updateReceipt,
} from '@/lib/db/repositories/receipts';
import { getStoreById, listStores } from '@/lib/db/repositories/stores';
import type { EntrySource } from '@/lib/domain/entries';
import {
  type ReceiptFileKind,
  type ReceiptMediaType,
  toRomeYearMonthDay,
} from '@/lib/domain/receipts';
import type { StoreKind } from '@/lib/domain/stores';
import {
  ExtractionError,
  ExtractionUnavailableError,
  ReceiptAlreadyImportedError,
  ReceiptNoLinesError,
  ReceiptNotFoundError,
  StoreNotFoundError,
} from '@/lib/errors';
import { normalizeProductName } from './match-products';
import {
  type ResolveCandidateProduct,
  type ResolvedReceiptLine,
  resolveReceiptLines,
} from './resolve-receipt-lines';

/** Rome-day window used by the "already recorded today" hint. */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReceiptStoreSuggestion {
  chain: string | null;
  name: string | null;
}

export interface ReceiptHeader {
  /** Store resolved for this import, or null when the user must choose. */
  storeId: string | null;
  storeChain: string | null;
  /** What the receipt said, when no store of the user matched it. */
  storeSuggestion: ReceiptStoreSuggestion | null;
  /** Epoch ms UTC. */
  purchasedAt: number;
  receiptTotalCents: number | null;
  linesTotalCents: number;
  needsReview: boolean;
  reasons: ReceiptReviewReason[];
  fileKind: ReceiptFileKind;
}

export interface SameDayObservation {
  /** Epoch ms UTC of the existing observation. */
  recordedAt: number;
  totalPriceCents: number;
  source: EntrySource;
}

export interface ReceiptReview {
  receiptId: string;
  header: ReceiptHeader;
  lines: ResolvedReceiptLine[];
  /** Keyed by line index: what the user already recorded for that product today. */
  sameDayByLineIndex: Record<number, SameDayObservation>;
  model: string;
}

export interface ImportReceiptInput {
  userId: string;
  file: { bytes: Uint8Array; mediaType: ReceiptMediaType; kind: ReceiptFileKind };
  storeId: string | null;
  storeKind: StoreKind | null;
  /** Epoch ms UTC; injected so the flags and the date fallback are testable. */
  now: number;
}

/**
 * Read one uploaded receipt and hand back something reviewable.
 *
 * @param db - Database handle; only the `receipts` row is written
 * @param input - The file bytes plus the store the user picked, if any
 * @returns The import record id, its header, and one draft per product line
 * @throws ReceiptAlreadyImportedError when this exact file was confirmed before
 * @throws ReceiptNoLinesError when the model found no product line
 * @throws ExtractionUnavailableError / ExtractionError per the gateway's retryable/non-retryable split
 */
export async function importReceipt(db: Db, input: ImportReceiptInput): Promise<ReceiptReview> {
  const contentHash = createHash('sha256').update(input.file.bytes).digest('hex');
  const existing = await getReceiptByHash(db, input.userId, contentHash);

  if (existing?.status === 'confirmed') {
    throw new ReceiptAlreadyImportedError(existing.id);
  }

  // An extraction already on file is re-used verbatim: re-reading the same
  // document costs money and cannot say anything new. Steps 6-7 still re-run,
  // because the catalog may have grown since — possibly from another tab
  // confirming a sibling receipt a minute ago.
  if (existing?.status === 'extracted') {
    const stored = parseReceiptExtraction(existing.aiRawJson);
    if (stored) {
      return buildReview(db, {
        userId: input.userId,
        receiptId: existing.id,
        extraction: stored,
        storeId: input.storeId ?? existing.storeId,
        fileKind: existing.fileKind,
        now: input.now,
      });
    }
  }

  const store = input.storeId ? await getStoreById(db, input.userId, input.storeId) : null;
  if (input.storeId && !store) {
    throw new StoreNotFoundError(input.storeId);
  }

  const extraction = await runExtraction({
    bytes: input.file.bytes,
    mediaType: input.file.mediaType,
    storeKind: store?.kind ?? input.storeKind,
    chainHint: store?.chain ?? null,
    userId: input.userId,
  });

  if (extraction.lines.length === 0) {
    throw new ReceiptNoLinesError('The receipt contains no product line');
  }

  const review = await buildReview(db, {
    userId: input.userId,
    // A discarded row is reused rather than replaced: the unique
    // (user_id, content_hash) index makes a second row impossible anyway,
    // and the user simply changed their mind about the same document.
    receiptId: existing?.id ?? null,
    extraction,
    storeId: input.storeId,
    fileKind: input.file.kind,
    now: input.now,
  });

  const persisted = await persistExtractedReceipt(db, {
    userId: input.userId,
    receiptId: existing?.id ?? null,
    contentHash,
    extraction,
    header: review.header,
    fileKind: input.file.kind,
  });

  return { ...review, receiptId: persisted };
}

/**
 * Rebuild the review of a receipt already on file.
 *
 * The stored extraction is immutable, but the resolution is not: aliases
 * learned since — even a minute ago, in another tab — must apply, so flagging
 * and line resolution re-run on every load rather than being frozen at upload time.
 *
 * @throws ReceiptNotFoundError when the receipt is not the user's, or was discarded
 */
export async function getReceiptForReview(
  db: Db,
  userId: string,
  receiptId: string,
  now: number,
): Promise<ReceiptReview> {
  const receipt = await getReceiptById(db, userId, receiptId);
  if (!receipt || receipt.status === 'discarded') {
    throw new ReceiptNotFoundError(receiptId);
  }

  const extraction = parseReceiptExtraction(receipt.aiRawJson);
  if (!extraction) {
    throw new ReceiptNotFoundError(receiptId);
  }

  const review = await buildReview(db, {
    userId,
    receiptId: receipt.id,
    extraction,
    storeId: receipt.storeId,
    fileKind: receipt.fileKind,
    now,
  });
  // The stored purchase date wins: the user may have corrected it on a
  // previous visit, and re-deriving it from the extraction would undo that.
  return {
    ...review,
    header: { ...review.header, purchasedAt: receipt.purchasedAt.getTime() },
  };
}

interface BuildReviewInput {
  userId: string;
  receiptId: string | null;
  extraction: ReceiptExtraction;
  storeId: string | null;
  fileKind: ReceiptFileKind;
  now: number;
}

/** Flag, resolve the store, resolve the lines. */
async function buildReview(db: Db, input: BuildReviewInput): Promise<ReceiptReview> {
  const flags = flagReceiptForReview(input.extraction, input.now);

  const [products, aliases, stores] = await Promise.all([
    listProducts(db, input.userId, { includeArchived: true }),
    listProductAliases(db, input.userId),
    listStores(db, input.userId),
  ]);

  const store = resolveStore(stores, input.storeId, input.extraction);
  const candidates: ResolveCandidateProduct[] = products.map((product) => ({
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    unitKind: product.unitKind,
    defaultPackageSize: product.defaultPackageSize,
    isArchived: product.isArchived,
    // The store-recency bonus is a capture-screen affordance:
    // a receipt already states its store, so nothing here is "nearby".
    hasRecentEntryAtStore: false,
  }));

  const lines = resolveReceiptLines({
    lines: input.extraction.lines,
    lineFlags: flags.lines,
    candidates,
    aliases: aliases.map((alias) => ({
      productId: alias.productId,
      alias: alias.alias,
      storeChain: alias.storeChain,
    })),
    storeChain: store.chain,
  });

  return {
    receiptId: input.receiptId ?? '',
    header: {
      storeId: store.id,
      storeChain: store.chain,
      storeSuggestion: store.suggestion,
      purchasedAt: flags.header.purchasedAtMs,
      receiptTotalCents: input.extraction.receiptTotalCents,
      linesTotalCents: flags.header.linesTotalCents,
      needsReview: flags.header.needsReview,
      reasons: flags.header.reasons,
      fileKind: input.fileKind,
    },
    lines,
    sameDayByLineIndex: await loadSameDayObservations(
      db,
      input.userId,
      lines,
      flags.header.purchasedAtMs,
    ),
    model: RECEIPT_EXTRACTION_MODEL,
  };
}

interface ResolvedStore {
  id: string | null;
  chain: string | null;
  suggestion: ReceiptStoreSuggestion | null;
}

/**
 * The store this receipt belongs to: an explicit pick wins,
 * otherwise the printed chain/name is matched against the user's stores by
 * normalized text, otherwise the review screen is told what to offer.
 */
function resolveStore(
  stores: Array<{ id: string; name: string; chain: string | null }>,
  storeId: string | null,
  extraction: ReceiptExtraction,
): ResolvedStore {
  if (storeId) {
    const picked = stores.find((store) => store.id === storeId);
    if (picked) {
      return { id: picked.id, chain: picked.chain, suggestion: null };
    }
  }

  const printedChain = extraction.storeChain ? normalizeProductName(extraction.storeChain) : null;
  const printedName = extraction.storeName ? normalizeProductName(extraction.storeName) : null;

  const matched = stores.find((store) => {
    const chain = store.chain ? normalizeProductName(store.chain) : null;
    const name = normalizeProductName(store.name);
    return (
      (printedChain !== null && (chain === printedChain || name === printedChain)) ||
      (printedName !== null && name === printedName)
    );
  });

  if (matched) {
    return { id: matched.id, chain: matched.chain, suggestion: null };
  }

  return {
    id: null,
    chain: extraction.storeChain,
    suggestion:
      extraction.storeChain || extraction.storeName
        ? { chain: extraction.storeChain, name: extraction.storeName }
        : null,
  };
}

/**
 * Observations the user already has for these products on the receipt's Rome
 * day. A receipt price and a tag price of the same product on the same
 * day are both valid, so the hint never blocks anything — it exists so the
 * timeline holds no surprises.
 */
async function loadSameDayObservations(
  db: Db,
  userId: string,
  lines: ResolvedReceiptLine[],
  purchasedAtMs: number,
): Promise<Record<number, SameDayObservation>> {
  const productIds = [
    ...new Set(
      lines
        .map((line) => line.selectedProduct?.productId)
        .filter((productId): productId is string => productId !== undefined),
    ),
  ];
  if (productIds.length === 0) {
    return {};
  }

  const day = toRomeYearMonthDay(purchasedAtMs);
  const observations = await listObservationsForProductsInRange(
    db,
    userId,
    productIds,
    new Date(purchasedAtMs - DAY_MS),
    new Date(purchasedAtMs + DAY_MS),
  );

  // The window above is deliberately wider than a day (offsets differ); the
  // exact Rome calendar day is filtered here.
  const newestByProduct = new Map<string, SameDayObservation>();
  for (const observation of observations) {
    const observedMs = observation.recordedAt.getTime();
    if (toRomeYearMonthDay(observedMs) !== day || newestByProduct.has(observation.productId)) {
      continue;
    }
    newestByProduct.set(observation.productId, {
      recordedAt: observedMs,
      totalPriceCents: observation.totalPriceCents,
      source: observation.source,
    });
  }

  const byLineIndex: Record<number, SameDayObservation> = {};
  for (const line of lines) {
    const productId = line.selectedProduct?.productId;
    const observation = productId ? newestByProduct.get(productId) : undefined;
    if (observation) {
      byLineIndex[line.index] = observation;
    }
  }
  return byLineIndex;
}

interface PersistInput {
  userId: string;
  receiptId: string | null;
  contentHash: string;
  extraction: ReceiptExtraction;
  header: ReceiptHeader;
  fileKind: ReceiptFileKind;
}

/** Insert the import record, or refresh the one a discarded attempt left. */
async function persistExtractedReceipt(db: Db, input: PersistInput): Promise<string> {
  const values = {
    storeId: input.header.storeId,
    status: 'extracted' as const,
    purchasedAt: new Date(input.header.purchasedAt),
    receiptTotalCents: input.header.receiptTotalCents ?? input.header.linesTotalCents,
    lineCount: input.extraction.lines.length,
    contentHash: input.contentHash,
    fileKind: input.fileKind,
    aiModel: RECEIPT_EXTRACTION_MODEL,
    aiRawJson: JSON.stringify(input.extraction),
  };

  if (input.receiptId) {
    const updated = await updateReceipt(db, input.userId, input.receiptId, {
      ...values,
      confirmedAt: null,
    });
    if (updated) {
      return updated.id;
    }
  }

  const created = await createReceipt(db, input.userId, values);
  return created.id;
}

/**
 * Re-validate an extraction read back from the database (`ai_raw_json`).
 *
 * Why validate stored data: `ai_raw_json` was written by an older version of
 * this app as easily as by the current one, and a schema that gained a field
 * would otherwise crash the review screen instead of asking for a re-upload.
 */
export function parseReceiptExtraction(raw: string): ReceiptExtraction | null {
  try {
    const parsed = receiptExtractionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Call the gateway and translate its internal error into the domain
 * contract, exactly as the photo extraction path does: retryable becomes "we will try
 * again" (503), non-retryable becomes "this file will never extract" (422).
 */
async function runExtraction(input: {
  bytes: Uint8Array;
  mediaType: ReceiptMediaType;
  storeKind: StoreKind | null;
  chainHint: string | null;
  userId: string;
}): Promise<ReceiptExtraction> {
  try {
    return await extractReceipt({
      bytes: input.bytes,
      mediaType: input.mediaType,
      storeKind: input.storeKind,
      chainHint: input.chainHint,
    });
  } catch (error) {
    if (!(error instanceof AiGatewayError)) {
      throw error;
    }
    console.error('Receipt extraction failed', {
      userId: input.userId,
      mediaType: input.mediaType,
      failureCode: error.failureCode,
      isRetryable: error.isRetryable,
      cause: error.cause ?? error.message,
    });
    if (error.isRetryable) {
      throw new ExtractionUnavailableError(error.message, { cause: error });
    }
    throw new ExtractionError(error.message, { cause: error });
  }
}
