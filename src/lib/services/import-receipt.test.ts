import type { Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ReceiptExtraction } from '@/lib/ai/receipt-schema';
import type { Db } from '@/lib/db/client';
import { createProduct } from '@/lib/db/repositories/products';
import { createReceipt, getReceiptById } from '@/lib/db/repositories/receipts';
import { createStore } from '@/lib/db/repositories/stores';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';

/*
 * The gateway is mocked at the module boundary: this suite is about the
 * orchestration around it — the content hash, the idempotency branches, the
 * store resolution — and every one of those decisions is made before or
 * after the model is consulted, never inside it.
 */
const extractReceiptMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/extract-receipt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/extract-receipt')>();
  return { ...actual, extractReceipt: extractReceiptMock };
});

const { importReceipt, getReceiptForReview } = await import('./import-receipt');
const { confirmReceipt } = await import('./confirm-receipt');
const { ReceiptAlreadyImportedError, ReceiptNoLinesError, ReceiptNotFoundError } = await import(
  '@/lib/errors'
);

/** 19 August 2026 — the fixture receipt's day, inside every plausibility window. */
const NOW = Date.UTC(2026, 7, 19, 18, 0);

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const OTHER_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

function extraction(overrides: Partial<ReceiptExtraction> = {}): ReceiptExtraction {
  return {
    storeChain: 'Coop',
    storeName: 'Coop Via Roma',
    purchasedAt: '2026-08-19T18:42:00',
    receiptTotalCents: 129,
    confidence: 0.9,
    lines: [
      {
        rawLine: 'PASTA BAR SPAGH N5 500G  1,29',
        description: 'Spaghetti n.5 500g',
        brand: 'Barilla',
        category: 'food',
        quantity: 1,
        quantityKind: 'pieces',
        unitPriceCentsOnReceipt: null,
        lineTotalCents: 129,
        discountCents: 0,
        packageSizeHint: 0.5,
        unitKindHint: 'weight',
        isPromo: false,
        promoKind: null,
        confidence: 0.95,
      },
    ],
    ...overrides,
  };
}

function importInput(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    file: { bytes: PDF_BYTES, mediaType: 'application/pdf' as const, kind: 'pdf' as const },
    storeId: null,
    storeKind: null,
    now: NOW,
    ...overrides,
  };
}

let db: Db;
let client: Client;
let userId: string;

beforeEach(async () => {
  extractReceiptMock.mockReset();
  extractReceiptMock.mockResolvedValue(extraction());
  ({ db, client } = await createTestDb());
  ({ id: userId } = await createTestUser(db));
});

afterEach(() => {
  client.close();
});

describe('importReceipt', () => {
  test('should persist the extraction and return one draft per product line', async () => {
    const result = await importReceipt(db, importInput(userId));

    expect(result.lines).toHaveLength(1);
    expect(result.header.purchasedAt).toBe(Date.UTC(2026, 7, 19, 16, 42));
    expect(result.model).toBe('claude-haiku-4-5');

    const stored = await getReceiptById(db, userId, result.receiptId);
    expect(stored).toMatchObject({ status: 'extracted', lineCount: 1, fileKind: 'pdf' });
    // The file itself is never persisted — only its hash and the extraction.
    expect(stored?.contentHash).toHaveLength(64);
    expect(JSON.parse(stored?.aiRawJson ?? '{}').lines[0].rawLine).toContain('PASTA BAR SPAGH');
  });

  test('should reuse the stored extraction for the same file, without calling the model', async () => {
    const first = await importReceipt(db, importInput(userId));
    extractReceiptMock.mockClear();

    const second = await importReceipt(db, importInput(userId));

    expect(extractReceiptMock).not.toHaveBeenCalled();
    expect(second.receiptId).toBe(first.receiptId);
    expect(second.lines).toHaveLength(1);
  });

  test('should re-resolve against the CURRENT catalog on an idempotent re-upload', async () => {
    const first = await importReceipt(db, importInput(userId));
    expect(first.lines[0].match.kind).toBe('new');

    // The user created the product in another tab in the meantime.
    await createProduct(db, userId, {
      name: 'Spaghetti n.5 500g',
      brand: 'Barilla',
      category: 'food',
      unitKind: 'weight',
    });

    const second = await importReceipt(db, importInput(userId));

    expect(second.lines[0].match.kind).toBe('suggested');
  });

  test('should refuse a file whose import was already confirmed', async () => {
    const first = await importReceipt(db, importInput(userId));
    await db.transaction(async (tx) => {
      await tx.run(
        // Confirming is confirm-receipt's job; this suite only needs the state.
        `UPDATE receipts SET status = 'confirmed' WHERE id = '${first.receiptId}'`,
      );
    });

    await expect(importReceipt(db, importInput(userId))).rejects.toBeInstanceOf(
      ReceiptAlreadyImportedError,
    );
  });

  test('should re-extract a discarded receipt and reuse its row id', async () => {
    const first = await importReceipt(db, importInput(userId));
    await db.run(`UPDATE receipts SET status = 'discarded' WHERE id = '${first.receiptId}'`);
    extractReceiptMock.mockClear();

    const second = await importReceipt(db, importInput(userId));

    expect(extractReceiptMock).toHaveBeenCalledTimes(1);
    expect(second.receiptId).toBe(first.receiptId);
    const stored = await getReceiptById(db, userId, second.receiptId);
    expect(stored?.status).toBe('extracted');
  });

  test('should give two different files two different receipts', async () => {
    const first = await importReceipt(db, importInput(userId));
    const second = await importReceipt(
      db,
      importInput(userId, {
        file: { bytes: OTHER_PDF_BYTES, mediaType: 'application/pdf', kind: 'pdf' },
      }),
    );

    expect(second.receiptId).not.toBe(first.receiptId);
  });

  test('should reject an extraction with no product line', async () => {
    extractReceiptMock.mockResolvedValue(extraction({ lines: [], receiptTotalCents: 0 }));

    await expect(importReceipt(db, importInput(userId))).rejects.toBeInstanceOf(
      ReceiptNoLinesError,
    );
  });

  test('should let an explicitly picked store win over the printed chain', async () => {
    const coop = await createStore(db, userId, {
      name: 'Coop Via Roma',
      chain: 'Coop',
      city: null,
      kind: 'supermarket',
    });
    const esselunga = await createStore(db, userId, {
      name: 'Esselunga Papiniano',
      chain: 'Esselunga',
      city: null,
      kind: 'supermarket',
    });

    const result = await importReceipt(db, importInput(userId, { storeId: esselunga.id }));

    expect(result.header.storeId).toBe(esselunga.id);
    expect(result.header.storeId).not.toBe(coop.id);
  });

  test('should match the printed chain against the user stores by normalized name', async () => {
    const coop = await createStore(db, userId, {
      name: 'Supermercato di quartiere',
      chain: 'COOP',
      city: null,
      kind: 'supermarket',
    });

    const result = await importReceipt(db, importInput(userId));

    expect(result.header.storeId).toBe(coop.id);
    expect(result.header.storeSuggestion).toBeNull();
  });

  test('should offer the printed store for creation when nothing matches', async () => {
    const result = await importReceipt(db, importInput(userId));

    expect(result.header.storeId).toBeNull();
    expect(result.header.storeSuggestion).toEqual({
      chain: 'Coop',
      name: 'Coop Via Roma',
    });
  });
});

describe('the second receipt from a chain', () => {
  /*
   * The Definition of Done calls for a manual check on two synthetic
   * receipts; this is that check, automated. It is the whole promise of the
   * feature: after one correction, the same abbreviation resolves itself.
   */
  test('should resolve a previously confirmed line as an alias, with no user action', async () => {
    const store = await createStore(db, userId, {
      name: 'Coop Via Roma',
      chain: 'Coop',
      city: null,
      kind: 'supermarket',
    });

    const first = await importReceipt(db, importInput(userId, { storeId: store.id }));
    expect(first.lines[0].match.kind).toBe('new');
    expect(first.lines[0].selectedProduct).toBeNull();

    const confirmed = await confirmReceipt(db, userId, {
      receiptId: first.receiptId,
      storeId: store.id,
      newStore: null,
      purchasedAt: first.header.purchasedAt,
      lines: [
        {
          index: 0,
          product: {
            kind: 'new',
            name: 'Spaghetti n.5 500g',
            brand: 'Barilla',
            category: 'food',
            unitKind: 'weight',
          },
          quantity: 1,
          packageSize: 0.5,
          totalPriceCents: 129,
          unitPriceMilli: 2580,
          isPromo: false,
          promoKind: null,
          learnAlias: true,
        },
      ],
    });

    // A different file, next week, printing the same abbreviation at a
    // different price.
    extractReceiptMock.mockResolvedValue(
      extraction({
        purchasedAt: '2026-08-26T18:42:00',
        receiptTotalCents: 135,
        lines: [
          {
            ...extraction().lines[0],
            rawLine: 'PASTA BAR SPAGH N5 500G  1,35',
            lineTotalCents: 135,
          },
        ],
      }),
    );

    const second = await importReceipt(
      db,
      importInput(userId, {
        file: { bytes: OTHER_PDF_BYTES, mediaType: 'application/pdf', kind: 'pdf' },
        storeId: store.id,
        now: Date.UTC(2026, 7, 26, 18, 0),
      }),
    );

    expect(second.lines[0].match).toEqual({
      kind: 'alias',
      productId: confirmed.createdProductIds[0],
      score: 1,
    });
    expect(second.lines[0].status).toBe('ready');
    // And the catalog now supplies the size, so nothing is left to fill in.
    expect(second.lines[0].fields).toMatchObject({
      packageSize: 0.5,
      unitPriceMilli: 2700,
    });
  });
});

describe('getReceiptForReview', () => {
  test('should rebuild the review from the stored extraction', async () => {
    const imported = await importReceipt(db, importInput(userId));

    const review = await getReceiptForReview(db, userId, imported.receiptId, NOW);

    expect(review.receiptId).toBe(imported.receiptId);
    expect(review.lines).toHaveLength(1);
    expect(review.header.purchasedAt).toBe(Date.UTC(2026, 7, 19, 16, 42));
  });

  test('should refuse another user receipt', async () => {
    const imported = await importReceipt(db, importInput(userId));
    const { id: otherUserId } = await createTestUser(db);

    await expect(
      getReceiptForReview(db, otherUserId, imported.receiptId, NOW),
    ).rejects.toBeInstanceOf(ReceiptNotFoundError);
  });

  test('should refuse a discarded receipt', async () => {
    const imported = await importReceipt(db, importInput(userId));
    await db.run(`UPDATE receipts SET status = 'discarded' WHERE id = '${imported.receiptId}'`);

    await expect(getReceiptForReview(db, userId, imported.receiptId, NOW)).rejects.toBeInstanceOf(
      ReceiptNotFoundError,
    );
  });

  test('should refuse a receipt whose stored extraction no longer parses', async () => {
    const receipt = await createReceipt(db, userId, {
      status: 'extracted',
      storeId: null,
      purchasedAt: new Date(NOW),
      receiptTotalCents: 100,
      lineCount: 1,
      contentHash: 'a'.repeat(64),
      fileKind: 'pdf',
      aiModel: 'claude-haiku-4-5',
      aiRawJson: '{"lines": "not an array"}',
    });

    await expect(getReceiptForReview(db, userId, receipt.id, NOW)).rejects.toBeInstanceOf(
      ReceiptNotFoundError,
    );
  });
});
