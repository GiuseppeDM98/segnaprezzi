import type { Client } from '@libsql/client';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { ReceiptExtraction } from '@/lib/ai/receipt-schema';
import type { Db } from '@/lib/db/client';
import { listPriceEntries } from '@/lib/db/repositories/price-entries';
import {
  listAliasesForProduct,
  listProductAliases,
  upsertProductAliases,
} from '@/lib/db/repositories/product-aliases';
import { createProduct, getProductById, mergeProducts } from '@/lib/db/repositories/products';
import { createReceipt, getReceiptById } from '@/lib/db/repositories/receipts';
import { createStore } from '@/lib/db/repositories/stores';
import { createTestDb, createTestUser } from '@/lib/db/testing/create-test-db';
import { InvalidPriceError, ProductNotFoundError, ReceiptNotFoundError } from '@/lib/errors';
import { type ConfirmReceiptLineInput, confirmReceipt } from './confirm-receipt';

/** 19 August 2026, 18:42 Rome. */
const PURCHASED_AT = Date.UTC(2026, 7, 19, 16, 42);

const EXTRACTION: ReceiptExtraction = {
  storeChain: 'Coop',
  storeName: 'Coop Via Roma',
  purchasedAt: '2026-08-19T18:42:00',
  receiptTotalCents: 307,
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
    {
      rawLine: 'LATTE PS UHT COOP 1L  2 x 1,09  1,78',
      description: 'Latte UHT parzialmente scremato 1L',
      brand: 'Coop',
      category: 'beverages',
      quantity: 2,
      quantityKind: 'pieces',
      unitPriceCentsOnReceipt: 109,
      lineTotalCents: 178,
      discountCents: 40,
      packageSizeHint: 1,
      unitKindHint: 'volume',
      isPromo: true,
      promoKind: 'loyalty',
      confidence: 0.88,
    },
  ],
};

function spaghettiLine(overrides: Partial<ConfirmReceiptLineInput> = {}): ConfirmReceiptLineInput {
  return {
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
    ...overrides,
  };
}

function latteLine(overrides: Partial<ConfirmReceiptLineInput> = {}): ConfirmReceiptLineInput {
  return {
    index: 1,
    product: {
      kind: 'new',
      name: 'Latte UHT parzialmente scremato 1L',
      brand: 'Coop',
      category: 'beverages',
      unitKind: 'volume',
    },
    quantity: 2,
    packageSize: 1,
    totalPriceCents: 89,
    unitPriceMilli: 890,
    isPromo: true,
    promoKind: 'loyalty',
    learnAlias: true,
    ...overrides,
  };
}

let db: Db;
let client: Client;
let userId: string;
let receiptId: string;
let storeId: string;

async function seedReceipt(): Promise<string> {
  const receipt = await createReceipt(db, userId, {
    status: 'extracted',
    storeId,
    purchasedAt: new Date(PURCHASED_AT),
    receiptTotalCents: 307,
    lineCount: 2,
    contentHash: 'b'.repeat(64),
    fileKind: 'pdf',
    aiModel: 'claude-haiku-4-5',
    aiRawJson: JSON.stringify(EXTRACTION),
  });
  return receipt.id;
}

beforeEach(async () => {
  ({ db, client } = await createTestDb());
  ({ id: userId } = await createTestUser(db));
  const store = await createStore(db, userId, {
    name: 'Coop Via Roma',
    chain: 'Coop',
    city: 'Milano',
    kind: 'supermarket',
  });
  storeId = store.id;
  receiptId = await seedReceipt();
});

afterEach(() => {
  client.close();
});

describe('confirmReceipt', () => {
  test('should insert one receipt entry per confirmed line', async () => {
    const result = await confirmReceipt(db, userId, {
      receiptId,
      storeId,
      newStore: null,
      purchasedAt: PURCHASED_AT,
      lines: [spaghettiLine(), latteLine()],
    });

    expect(result.entryIds).toHaveLength(2);
    const page = await listPriceEntries(db, userId, {});
    expect(page.entries).toHaveLength(2);

    const latte = page.entries.find((entry) => entry.quantity === 2);
    expect(latte).toMatchObject({
      source: 'receipt',
      receiptId,
      storeId,
      quantity: 2,
      totalPriceCents: 89,
      unitPriceMilli: 890,
      isPromo: true,
      promoKind: 'loyalty',
      photoUrl: null,
      aiModel: 'claude-haiku-4-5',
      currency: 'EUR',
    });
    // The per-line extraction travels with the entry as its audit trail.
    expect(JSON.parse(latte?.aiRawJson ?? '{}').rawLine).toContain('LATTE PS UHT');
    expect(latte?.aiConfidence).toBeCloseTo(0.88);
    expect(latte?.recordedAt.getTime()).toBe(PURCHASED_AT);
  });

  test('should mark the receipt confirmed with the number of entries it produced', async () => {
    await confirmReceipt(db, userId, {
      receiptId,
      storeId,
      newStore: null,
      purchasedAt: PURCHASED_AT,
      lines: [spaghettiLine()],
    });

    const receipt = await getReceiptById(db, userId, receiptId);
    expect(receipt).toMatchObject({ status: 'confirmed', lineCount: 1, storeId });
    expect(receipt?.confirmedAt).not.toBeNull();
  });

  test('should be idempotent on an already-confirmed receipt', async () => {
    const first = await confirmReceipt(db, userId, {
      receiptId,
      storeId,
      newStore: null,
      purchasedAt: PURCHASED_AT,
      lines: [spaghettiLine(), latteLine()],
    });

    const second = await confirmReceipt(db, userId, {
      receiptId,
      storeId,
      newStore: null,
      purchasedAt: PURCHASED_AT,
      lines: [spaghettiLine(), latteLine()],
    });

    expect(second.entryIds.sort()).toEqual(first.entryIds.sort());
    const page = await listPriceEntries(db, userId, {});
    expect(page.entries).toHaveLength(2);
  });

  test('should learn one chain-scoped alias per line that asked for it', async () => {
    await confirmReceipt(db, userId, {
      receiptId,
      storeId,
      newStore: null,
      purchasedAt: PURCHASED_AT,
      lines: [spaghettiLine(), latteLine({ learnAlias: false })],
    });

    const aliases = await listProductAliases(db, userId);
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({
      // Recomputed server-side from the STORED rawLine, never sent by the client.
      alias: 'pasta bar spagh n5 500g',
      storeChain: 'Coop',
      hitCount: 1,
    });
  });

  test('should increment hit_count when the same line is confirmed again', async () => {
    await confirmReceipt(db, userId, {
      receiptId,
      storeId,
      newStore: null,
      purchasedAt: PURCHASED_AT,
      lines: [spaghettiLine()],
    });
    const [productId] = (await listProductAliases(db, userId)).map((alias) => alias.productId);

    // A second receipt with the same abbreviation, resolved to the same product.
    const secondReceipt = await createReceipt(db, userId, {
      status: 'extracted',
      storeId,
      purchasedAt: new Date(PURCHASED_AT),
      receiptTotalCents: 135,
      lineCount: 1,
      contentHash: 'c'.repeat(64),
      fileKind: 'pdf',
      aiModel: 'claude-haiku-4-5',
      aiRawJson: JSON.stringify(EXTRACTION),
    });
    await confirmReceipt(db, userId, {
      receiptId: secondReceipt.id,
      storeId,
      newStore: null,
      purchasedAt: PURCHASED_AT,
      lines: [spaghettiLine({ product: { kind: 'existing', productId } })],
    });

    const aliases = await listProductAliases(db, userId);
    expect(aliases).toHaveLength(1);
    expect(aliases[0].hitCount).toBe(2);
  });

  test('should back-fill default_package_size on created and existing products', async () => {
    const existing = await createProduct(db, userId, {
      name: 'Latte UHT parzialmente scremato 1L',
      brand: 'Coop',
      category: 'beverages',
      unitKind: 'volume',
    });
    expect(existing.defaultPackageSize).toBeNull();

    const result = await confirmReceipt(db, userId, {
      receiptId,
      storeId,
      newStore: null,
      purchasedAt: PURCHASED_AT,
      lines: [
        spaghettiLine(),
        latteLine({ product: { kind: 'existing', productId: existing.id } }),
      ],
    });

    expect(await getProductById(db, userId, existing.id)).toMatchObject({
      defaultPackageSize: 1,
    });
    expect(await getProductById(db, userId, result.createdProductIds[0])).toMatchObject({
      defaultPackageSize: 0.5,
    });
  });

  test('should create the store the user typed on the review screen', async () => {
    const result = await confirmReceipt(db, userId, {
      receiptId,
      storeId: null,
      newStore: { name: 'Coop Papiniano', chain: 'Coop', kind: 'supermarket' },
      purchasedAt: PURCHASED_AT,
      lines: [spaghettiLine()],
    });

    expect(result.storeId).not.toBeNull();
    const page = await listPriceEntries(db, userId, {});
    expect(page.entries[0].store?.name).toBe('Coop Papiniano');
    // The alias is scoped to the chain of the store just created.
    expect((await listProductAliases(db, userId))[0].storeChain).toBe('Coop');
  });

  test('should reject a line whose three money numbers cannot all be true', async () => {
    await expect(
      confirmReceipt(db, userId, {
        receiptId,
        storeId,
        newStore: null,
        purchasedAt: PURCHASED_AT,
        // 2580 x 0.5 = 1290 milli, but the total claims 2000 cents.
        lines: [spaghettiLine({ totalPriceCents: 2000 })],
      }),
    ).rejects.toBeInstanceOf(InvalidPriceError);

    const page = await listPriceEntries(db, userId, {});
    expect(page.entries).toHaveLength(0);
  });

  test('should roll the whole transaction back on an invalid product id', async () => {
    await expect(
      confirmReceipt(db, userId, {
        receiptId,
        storeId,
        newStore: null,
        purchasedAt: PURCHASED_AT,
        lines: [
          spaghettiLine(),
          latteLine({ product: { kind: 'existing', productId: 'x'.repeat(21) } }),
        ],
      }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);

    const page = await listPriceEntries(db, userId, {});
    expect(page.entries).toHaveLength(0);
    expect(await listProductAliases(db, userId)).toHaveLength(0);
    expect(await getReceiptById(db, userId, receiptId)).toMatchObject({ status: 'extracted' });
  });

  test('should refuse another user receipt', async () => {
    const { id: otherUserId } = await createTestUser(db);

    await expect(
      confirmReceipt(db, otherUserId, {
        receiptId,
        storeId: null,
        newStore: null,
        purchasedAt: PURCHASED_AT,
        lines: [spaghettiLine()],
      }),
    ).rejects.toBeInstanceOf(ReceiptNotFoundError);
  });

  test('should move aliases onto the survivor when two products are merged', async () => {
    await confirmReceipt(db, userId, {
      receiptId,
      storeId,
      newStore: null,
      purchasedAt: PURCHASED_AT,
      lines: [spaghettiLine(), latteLine()],
    });
    const aliases = await listProductAliases(db, userId);
    const [spaghetti, latte] = ['pasta bar spagh n5 500g', 'latte ps uht coop 1l'].map(
      (alias) => aliases.find((row) => row.alias === alias)?.productId as string,
    );

    await mergeProducts(db, userId, latte, spaghetti);

    expect(await listAliasesForProduct(db, userId, latte)).toHaveLength(0);
    expect(await listAliasesForProduct(db, userId, spaghetti)).toHaveLength(2);
  });

  test('should sum hit_count when both merged products carried the same alias', async () => {
    /*
     * Two rows with the same chain-less alias cannot be created through
     * learnProductAliases — it looks the key up first — but SQLite treats
     * NULLs as DISTINCT in the unique index, so a restored backup can bring
     * a pair in. That is the state this branch exists for.
     */
    const survivor = await createProduct(db, userId, {
      name: 'Spaghetti n.5 500g',
      brand: 'Barilla',
      category: 'food',
      unitKind: 'weight',
    });
    const duplicate = await createProduct(db, userId, {
      name: 'Spaghetti Barilla 500 g',
      brand: 'Barilla',
      category: 'food',
      unitKind: 'weight',
    });
    await upsertProductAliases(db, userId, [
      {
        id: nanoid(),
        productId: survivor.id,
        alias: 'pasta bar spagh n5 500g',
        storeChain: null,
        hitCount: 3,
        lastSeenAt: new Date(PURCHASED_AT),
      },
      {
        id: nanoid(),
        productId: duplicate.id,
        alias: 'pasta bar spagh n5 500g',
        storeChain: null,
        hitCount: 4,
        lastSeenAt: new Date(PURCHASED_AT),
      },
    ]);

    await mergeProducts(db, userId, duplicate.id, survivor.id);

    const survivorAliases = await listAliasesForProduct(db, userId, survivor.id);
    expect(survivorAliases).toHaveLength(1);
    expect(survivorAliases[0].hitCount).toBe(7);
    expect(await listAliasesForProduct(db, userId, duplicate.id)).toHaveLength(0);
  });
});
