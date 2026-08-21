# Spec 07 — Receipt Import (scontrino digitale)

> **Status**: Approved · **Last updated**: 2026-08-21
> **Depends on**: Spec 02 (schema, repositories, auth), Spec 03 (AI gateway
> pattern, product matching, review-screen contract), Spec 05 (design system).
> **Contract**: This spec elaborates on Spec 00 §6 (domain model, receipt
> additions), §8.1 (receipt extraction summary), and §9 (route map). It must
> never contradict `docs/specs/00-overview.md`. All code follows
> `docs/DEVELOPMENT_GUIDELINES.md` and `docs/COMMENTS.md`. UI follows
> `DESIGN.md`.

---

## 1. Goal & Scope

A shelf price tag is one observation, taken one photo at a time. A digital
receipt (the *scontrino digitale* that chains like Coop, Esselunga and Conad
send by e-mail or expose in their apps as PDF) is **thirty observations in one
file, and they are the prices actually paid**. This spec turns one uploaded
receipt into N confirmed `price_entries` rows — one per product line, never an
aggregate "whole trip" number: the inflation engine (Spec 04) compares the
same product over time, so only per-item prices are useful.

Receipts and tags are complementary (Spec 00 §3): *receipts prove paid
prices, tags carry unit prices*. A receipt line almost never states the package
size ("PASTA BAR SPAGH N5 500G  1,29" is the friendly case; "LATTE PS UHT
1,09" is the common one), so the value of this feature is not the AI
transcription — it is the **matching of abbreviated receipt lines to the user's
product catalog**, where the package size already lives, plus the **aliases the
app learns** from every confirmation so that the next receipt from the same
chain resolves by itself.

**In scope**

- `/add/receipt`: upload of one receipt file (PDF, or a photo of a paper
  receipt) — online only.
- `POST /api/extract-receipt`: validation, idempotency by content hash,
  `claude-haiku-4-5` structured extraction of every product line, line
  resolution against the catalog, response for review. **Nothing is written to
  `price_entries` before the user confirms.**
- Schema additions (Spec 00 §6 is already updated): `receipts`,
  `product_aliases`, `products.default_package_size`, `price_entries.quantity`,
  `price_entries.receipt_id`, entry source `receipt`.
- Receipt system prompt, Zod schema, gateway, cross-checks.
- Line resolution service: alias → fuzzy match → new product; unit-price
  derivation rules; "missing package size" handling.
- Review screen contract (`/add/receipt/review`) and `confirmReceipt` Server
  Action.
- Alias learning and alias maintenance on product merge.
- Error taxonomy and i18n keys. Tests.

**Out of scope**

- Offline receipt upload. A PDF never originates in a supermarket aisle;
  `/add/receipt` shows an "offline" notice and disables upload when
  `navigator.onLine` is false. No Dexie queue.
- Receipt OCR quality beyond what the model gives on a reasonable photo. The
  primary input is the digital PDF; paper-receipt photos are best-effort.
- Chain-specific parsers. The prompt is a generic Italian-receipt prompt with
  a compact worked example; no per-chain code paths.
- Bank/e-mail integrations that fetch receipts automatically (roadmap).
- Non-EUR receipts (`currency` stays `'EUR'`, Spec 00 §3).

### 1.1 End-to-end flow

```
   [/add/receipt]   file input: application/pdf | image/webp | image/jpeg
          │  images → compressPhoto() (Spec 03 §4); PDFs pass through, ≤ 5 MB
          ▼
   POST /api/extract-receipt          multipart: file + optional storeId
          │  requireUser()
          ├─► sha256(file) → receipts.content_hash lookup
          │       hit & status confirmed  → 409 RECEIPT_ALREADY_IMPORTED
          │       hit & status extracted  → return the stored extraction (idempotent)
          ├─► claude-haiku-4-5           document/image block → ReceiptExtraction
          ├─► flagReceiptForReview()     Σ lines vs receipt total, per-line confidence
          ├─► resolveReceiptLines()      alias → fuzzy top-3 → new; unit price derivation
          └─► receipts.insert(status 'extracted', ai_raw_json, content_hash)
          ▼
   { receiptId, header, lines[] }     ← the file itself is NOT stored (§5.3)
          ▼
   [/add/receipt/review]              list of line cards: product pick, size, qty, promo
          │  confirmReceipt()           one transaction
          ▼
   receipts.status 'confirmed' · N price_entries(source 'receipt') ·
   N product_aliases upserted · products.default_package_size back-filled
```

### 1.2 Files created by this spec

| Path | Layer | Purpose |
|---|---|---|
| `src/app/[locale]/(app)/add/receipt/page.tsx` | app | Upload screen (file input, store picker, offline notice) |
| `src/app/[locale]/(app)/add/receipt/review/page.tsx` | app | Review screen shell (line list) |
| `src/app/[locale]/(app)/add/receipt/review/actions.ts` | app | `confirmReceipt`, `discardReceipt` |
| `src/app/api/extract-receipt/route.ts` | app | `POST /api/extract-receipt` route handler |
| `src/components/receipt/receipt-dropzone.tsx` | client | File picker / drop target, progress |
| `src/components/receipt/receipt-line-card.tsx` | client | One editable line: product pick, size, qty, price |
| `src/components/receipt/receipt-summary-bar.tsx` | client | Sticky totals: lines matched / need size / new |
| `src/lib/ai/receipt-schema.ts` | gateway | `ReceiptExtraction` Zod schema |
| `src/lib/ai/receipt-prompt.ts` | gateway | System prompt (verbatim from §6.1) |
| `src/lib/ai/extract-receipt.ts` | gateway | Anthropic call (PDF/image) + error mapping |
| `src/lib/ai/flag-receipt.ts` | pure | Total cross-check, per-line flags |
| `src/lib/services/import-receipt.ts` | service | Orchestrates hash, AI, flags, resolution, persist |
| `src/lib/services/resolve-receipt-lines.ts` | service (pure) | Alias/fuzzy resolution + unit-price derivation |
| `src/lib/services/confirm-receipt.ts` | service | Transactional confirm |
| `src/lib/services/discard-receipt.ts` | service | Mark discarded |
| `src/lib/domain/receipt-lines.ts` | domain (pure) | `normalizeAlias`, `deriveUnitPriceMilli`, line status enum |
| `src/lib/db/schema/app.ts` | db | `receipts`, `productAliases`, new columns (edit) |
| `src/lib/db/repositories/receipts.ts` | repo | CRUD for `receipts` |
| `src/lib/db/repositories/product-aliases.ts` | repo | Lookup / upsert / move-on-merge |
| `drizzle/00NN_receipt_import.sql` | db | Generated migration |
| `messages/it.json`, `messages/en.json` | i18n | New keys (§10) |

Edits to existing files: `src/lib/domain/entries.ts` (`ENTRY_SOURCES` +
`'receipt'`), `src/lib/db/repositories/products.ts` (`default_package_size`
helpers, merge moves aliases), `src/lib/services/merge-products.ts` (alias
move), `src/lib/services/export-user-data.ts` (`schemaVersion: 2`, §2.6),
bottom-sheet "Add" menu (Spec 05) gains a "Scontrino" action.

---

## 2. Domain & Schema Changes

Spec 00 §6 is the contract; this section gives the Drizzle code and the
reasoning. All new columns follow Spec 02 §4.2 conventions (nanoid ids,
`timestamp_ms`, text enums typed via `$type<>()`, no SQL CHECK constraints).

### 2.1 `ENTRY_SOURCES` gains `'receipt'`

```ts
// src/lib/domain/entries.ts
export const ENTRY_SOURCES = ['photo', 'manual', 'fuel', 'receipt'] as const;
```

Everything that switches on `EntrySource` (history chips, export, Spec 05
icons) must handle the fourth value; TypeScript's exhaustiveness checks will
point at each site.

### 2.2 `products.default_package_size` (REAL, nullable)

```ts
// in products
// Why: receipts rarely print the package size. The last confirmed size of a
// product is the best guess for its next receipt line; tags and manual
// entries write it, receipts read it.
defaultPackageSize: real('default_package_size'),
```

Write rule (service layer, not a trigger): `createPriceEntry`,
`confirmShoppingSession` and `confirmReceipt` set
`default_package_size = package_size` of the entry they insert **when the
column is null or the entry's size differs from it** (last write wins; a
product whose size changes — the "shrinkflation" case — follows the newest
observation, which is what the next receipt is most likely to contain).

### 2.3 `price_entries.quantity` and `price_entries.receipt_id`

```ts
// in priceEntries
// Why: "2 x 1,29" on a receipt is one observation of price 1,29 bought twice.
// Two rows would double-weight the month's mean; a quantity keeps the mean
// honest and lets expenditure weights (Spec 04) count what was spent.
quantity: integer('quantity').notNull().default(1),
receiptId: text('receipt_id').references(() => receipts.id, { onDelete: 'set null' }),
```

Semantics, locked in Spec 00 §6: `total_price_cents` is the price of **one**
package (unchanged meaning for photo/manual/fuel, where `quantity` is always
1); the line's spend is `total_price_cents × quantity`. Spec 04's
`IndexEntry.quantity` and its expenditure weights already account for it;
this spec only has to map the new column in the repository projection.

### 2.4 `receipts`

```ts
export const receipts = sqliteTable(
  'receipts',
  {
    id: idColumn(),
    userId: userIdColumn(),
    storeId: text('store_id').references(() => stores.id, { onDelete: 'set null' }),
    status: text('status').$type<ReceiptStatus>().notNull().default('extracted'),
    // Why: the receipt's own date, not the upload moment — users import
    // last week's e-mails. Falls back to upload time when unreadable.
    purchasedAt: integer('purchased_at', { mode: 'timestamp_ms' }).notNull(),
    receiptTotalCents: integer('receipt_total_cents').notNull(),
    lineCount: integer('line_count').notNull(),
    // Why: idempotency and duplicate protection without storing the file.
    contentHash: text('content_hash').notNull(),
    fileKind: text('file_kind').$type<ReceiptFileKind>().notNull(),
    aiModel: text('ai_model').notNull(),
    aiRawJson: text('ai_raw_json').notNull(),
    confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index('receipts_user_id_idx').on(table.userId),
    uniqueIndex('receipts_user_hash_idx').on(table.userId, table.contentHash),
  ],
);
```

```ts
// src/lib/domain/receipts.ts
export const RECEIPT_STATUSES = ['extracted', 'confirmed', 'discarded'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const RECEIPT_FILE_KINDS = ['pdf', 'image'] as const;
export type ReceiptFileKind = (typeof RECEIPT_FILE_KINDS)[number];
```

A `receipts` row in status `extracted` is **not a price observation** — it is
an import in progress, kept server-side so the review screen survives a reload
and so a re-upload of the same file is idempotent. Rows older than 7 days in
status `extracted` are eligible for cleanup (`scripts/cleanup-receipts.ts`,
optional cron; not required for DoD).

### 2.5 `product_aliases`

```ts
export const productAliases = sqliteTable(
  'product_aliases',
  {
    id: idColumn(),
    userId: userIdColumn(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    // Normalized receipt description, see normalizeAlias() §7.1.
    alias: text('alias').notNull(),
    // Why: the same abbreviation can mean different things at different
    // chains; NULL = learned from a receipt without a known chain.
    storeChain: text('store_chain'),
    hitCount: integer('hit_count').notNull().default(1),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('product_aliases_user_alias_chain_idx').on(
      table.userId,
      table.alias,
      table.storeChain,
    ),
    index('product_aliases_product_idx').on(table.productId),
  ],
);
```

Cascade on product delete is correct here (an alias without its product is
meaningless); product **merge** (Spec 03/05 feature) must move aliases to the
surviving product — `moveAliases(fromProductId, toProductId)` in the
repository, called inside the merge transaction, with `onConflictDoUpdate`
summing `hit_count` when both products had the same alias.

### 2.6 Export payload

`src/lib/services/export-user-data.ts` bumps `schemaVersion` to `2` and adds
`receipts` (without `aiRawJson` — it is large and has no use outside
debugging; keep it for `priceEntries` as Spec 02 §9 mandates) and
`productAliases`. `priceEntries` gains `quantity` and `receiptId`.

### 2.7 Migration

One generated migration (`pnpm db:generate`, Spec 02 §5): two new tables,
three new columns. `quantity` has a SQL default, so existing rows are valid
without a backfill. `default_package_size` is backfilled by a one-off
statement inside the same migration:

```sql
UPDATE products SET default_package_size = (
  SELECT pe.package_size FROM price_entries pe
  WHERE pe.product_id = products.id AND pe.package_size > 0
  ORDER BY pe.recorded_at DESC LIMIT 1
) WHERE default_package_size IS NULL;
```

---

## 3. Upload Screen — `/add/receipt`

- Reached from the "Add" bottom sheet (Spec 05) and from `/history` empty
  state ("Hai uno scontrino digitale? Importalo").
- `<input type="file" accept="application/pdf,image/*" />` plus drag-and-drop
  on desktop. **One file per import.** Multi-file is a v1.1 nicety.
- Images go through `compressPhoto()` from Spec 03 §4 unchanged (≤ 1600 px,
  ≤ ~400 KB). A paper receipt is tall and narrow; 1600 px on the long edge
  keeps 8-pt thermal print legible in practice. PDFs are sent as-is, ≤ 5 MB.
- Optional store picker (same component as `/scan`, Spec 03 §3.2), defaulting
  to "detect from receipt". When the user picks a store, its `chain` is used
  for alias lookup and its `kind` for the prompt hint; when not, the service
  tries to match the extracted `storeChain`/`storeName` to the user's stores
  by normalized name and otherwise offers "create store" on the review screen.
- Offline (`navigator.onLine === false` or fetch failure): the upload button
  is disabled with copy `receipt.offline`. No queueing.
- Progress UX: a single indeterminate state "Leggo lo scontrino…" — a
  40-line receipt takes 6–12 s on Haiku 4.5; show the line counter as soon as
  the response lands, not before (no streaming in v1).
- On success: `router.push('/add/receipt/review?receiptId=…')`.

---

## 4. `POST /api/extract-receipt`

### 4.1 Request

`multipart/form-data`:

| Field | Type | Required | Rules |
|---|---|---|---|
| `file` | file | ✅ | `application/pdf`, `image/webp`, `image/jpeg`; ≤ 5 MB |
| `storeId` | string | ☐ | Must belong to the user (`STORE_NOT_FOUND` otherwise) |
| `storeKind` | string | ☐ | Prompt hint only; overridden by `store.kind` when `storeId` is given |

### 4.2 Validation & rejection rules

| Rule | Error |
|---|---|
| Not authenticated | `401 UNAUTHORIZED` |
| `file` missing / not a file | `400 INVALID_INPUT` |
| `file.size > 5 MB` | `413 RECEIPT_TOO_LARGE` |
| `file.type` not in allowlist **or** magic bytes disagree (`%PDF-`, RIFF/WEBP, JPEG SOI) | `415 UNSUPPORTED_RECEIPT_TYPE` |
| PDF with more than 10 pages | `422 RECEIPT_TOO_LONG` |
| Same content hash already `confirmed` | `409 RECEIPT_ALREADY_IMPORTED` |
| Same content hash in `extracted` | `200` with the stored extraction (idempotent) |
| Extraction retryable failure | `503 EXTRACTION_UNAVAILABLE`, `Retry-After: 30` |
| Extraction non-retryable / no product lines | `422 EXTRACTION_FAILED` |

Magic-byte checking matters more here than for camera photos: the file comes
from the user's disk, not from our own compressor. Page count is read from
the PDF with a cheap regex over `/Type /Page` objects — good enough for a
guard; a wrong count is not a security issue because the 5 MB cap bounds the
request regardless.

### 4.3 Orchestration — `src/lib/services/import-receipt.ts`

```ts
export interface ImportReceiptInput {
  userId: string;
  file: { bytes: Uint8Array; mediaType: ReceiptMediaType; kind: ReceiptFileKind };
  storeId: string | null;
  storeKind: StoreKind | null;
  now: number;
}

export interface ImportReceiptResult {
  receiptId: string;
  header: ReceiptHeader;          // store guess, date, total, needsReview, reasons
  lines: ResolvedReceiptLine[];   // §7.3
  model: string;
}
```

Steps:

1. `contentHash = sha256(bytes)` (Web Crypto, hex).
2. `receiptsRepo.findByHash(userId, contentHash)`: `confirmed` →
   `ReceiptAlreadyImportedError`; `extracted` → rebuild the result from the
   stored `ai_raw_json` (re-run steps 6–7, which are pure and cheap — the
   catalog may have changed since) and return; `discarded` → continue (the
   user changed their mind), reusing the row id.
3. Load the store when `storeId` is set; `store.kind` overrides `storeKind`,
   `store.chain` becomes `chainHint`.
4. `extractReceipt({ bytes, mediaType, storeKind, chainHint })` (§6.3).
5. `flagReceiptForReview(extraction)` (§6.4).
6. Resolve the store: explicit `storeId` wins; else match
   `extraction.storeChain`/`storeName` against the user's stores via
   `normalizeProductName` equality on `chain` or `name`; else `null` with
   `header.storeSuggestion = { chain, name }` for the review screen.
7. `resolveReceiptLines(extraction.lines, catalog, aliases, chain)` (§7).
8. Insert/update the `receipts` row (`status 'extracted'`, `ai_raw_json` =
   full extraction, `content_hash`, `purchased_at` = parsed date at 12:00
   Europe/Rome or `now`).
9. Return `{ receiptId, header, lines, model }`.

### 4.4 Route handler

Same shape as Spec 03 §6.7: parse `formData`, Zod on the scalar fields,
magic-byte check, call `importReceipt`, map `DomainError` → HTTP via Spec 01's
table. `export const maxDuration = 60` (Haiku on a 60-line PDF plus cold start
can exceed the 30 s default on Hobby). The gateway's own timeout is 45 s.

---

## 5. Storage Decision — the file is not kept

### 5.1 Why

A receipt is far more sensitive than a shelf tag: it carries date and time,
the exact store, often a loyalty-card number and the last digits of a payment
card, and a full picture of what a person buys. Spec 03 stores tag photos on
Vercel Blob with `access: 'public'` behind a high-entropy URL (Spec 03 §6.3),
an acceptable tradeoff for a photo of a price label. It is not acceptable
here.

### 5.2 Decision

**v1 does not persist the receipt file.** What is kept:

- `receipts.ai_raw_json` — the structured extraction, including every
  line's `rawLine` verbatim. This is the audit trail the review screen and
  any later debugging need.
- `receipts.content_hash` — idempotency and duplicate detection.

Consequences: the review screen cannot show the original document, only the
transcribed lines (with `rawLine` visible under each card); a failed
extraction cannot be re-run against the stored file — the user re-uploads.
Both are fine for v1. If v1.x wants the original, it goes to Blob with
`access: 'private'` and short-lived signed URLs, never public.

`price_entries.photo_url` stays `NULL` for receipt entries.

### 5.3 Bytes in memory only

The route reads the file into a `Uint8Array`, hashes it, base64-encodes it for
the API call, and drops it. Nothing is written to disk or to `/tmp`.

---

## 6. AI Extraction

The model is **`claude-haiku-4-5`** (Spec 00 §3): this is transcription of
already-structured text, and a 40-line receipt costs about two cents (§6.5).
The model id lives in its own constant, `RECEIPT_EXTRACTION_MODEL`, separate
from Spec 03's `EXTRACTION_MODEL`, so the two can diverge. If real receipts
show Haiku struggling with abbreviation disambiguation or discount-line
attribution, the sanctioned upgrade is `claude-sonnet-5` — a one-line change
plus an update of Spec 00 §3; do not reach for Opus-tier models for this task.

Input is a single `document` block (PDF, base64) or `image` block, followed by
a text instruction. The API renders PDF pages and reads their text layer
itself — no `pdf-parse`, no server-side rasterization.

### 6.1 System prompt — verbatim

This exact text is the value of `RECEIPT_SYSTEM_PROMPT` in
`src/lib/ai/receipt-prompt.ts`:

```text
You read Italian supermarket receipts (scontrini) — digital PDF receipts or
photos of paper receipts — and extract EVERY product line as structured data.
The goal is the price of each single item, never the trip total.

WHAT IS A PRODUCT LINE
- A product line is a purchased item with a price: "PASTA BAR SPAGH N5 500G
  1,29", "BANANE 0,812 x 1,49 5 1,21", "ACQUA NAT 6X1,5L 2 x 2,19 4,38".
- NOT product lines (skip them entirely): subtotals, "TOTALE", "TOTALE
  COMPLESSIVO", payment lines (CONTANTI, BANCOMAT, CARTA, RESTO), VAT
  summaries (IVA, imponibile), loyalty-point lines (PUNTI, SALDO PUNTI),
  shopping bags ONLY when printed as a fee line with no product (e.g. "SHOPPER"
  is a product; "IMPOSTA SACCHETTO" is not), headers, footers, barcodes,
  receipt numbers, cashier ids, ads and coupons for future purchases.
- Discount lines ("SCONTO", "SCONTO SOCI", "OFFERTA", "RISPARMIO", "-0,30",
  "ABBUONO", "PROMO", percentage lines) are NOT separate product lines: attach
  each one to the product line it refers to — normally the line immediately
  above it, or the line named in the discount text. Reduce that line's
  lineTotalCents by the discount and record the amount in discountCents.
- Deposit/return lines ("CAUZIONE", "VUOTO A RENDERE", negative returns):
  skip; do not attach to a product.

MONEY IS ALWAYS INTEGERS IN EURO CENTS
- Italian receipts use comma decimals: "1,29" → 129; "4,38" → 438.
- lineTotalCents: what was paid for the whole line AFTER line discounts.
- unitPriceCentsOnReceipt: the per-unit price when the receipt prints one —
  the "1,29" in "2 x 1,29", or the €/kg "9,90" in "0,512 kg x 9,90". Null when
  the receipt shows only a line total.
- receiptTotalCents: the amount actually paid ("TOTALE COMPLESSIVO" or the
  final "TOTALE" before payment lines). Null if not legible.

QUANTITY
- "2 x 1,29" or "2 PZ" → quantity 2, quantityKind "pieces".
- Weighed goods printed as "0,512 kg x 9,90 €/kg" (produce, deli, meat,
  cheese) → quantity 0.512, quantityKind "kg"; by litre → quantityKind "L".
- No quantity shown → quantity 1, quantityKind "pieces".

PACKAGE SIZE HINTS (do not invent them)
- If the description contains a size — "500G", "1L", "1,5L", "6X1,5L",
  "4 ROT", "200ML", "2X125G" — set packageSizeHint in BASE units (kg, L,
  pieces) and unitKindHint: "500G" → 0.5 / "weight"; "1,5L" → 1.5 / "volume";
  "6X1,5L" → 9 / "volume"; "2X125G" → 0.25 / "weight"; "4 ROT" → 4 / "count".
- Weighed goods: packageSizeHint = quantity in kg or L, unitKindHint
  "weight" or "volume".
- If no size appears in the description, packageSizeHint and unitKindHint are
  null. Never guess a package size from product knowledge.

DESCRIPTION AND BRAND
- rawLine: the line verbatim, including the price columns.
- description: the product name expanded from the receipt's abbreviation into
  readable Italian, without the brand and without the price: "PASTA BAR SPAGH
  N5 500G" → description "Spaghetti n.5 500g", brand "Barilla". Keep the size
  in the description when printed. If an abbreviation is ambiguous, keep it as
  printed rather than guessing, and lower that line's confidence.
- brand: the brand when recognizable from the abbreviation (BAR → Barilla,
  MUTTI, COOP, ESSEL → Esselunga, CONAD). Private labels are brands. Else null.

PROMOTIONS
- A line with an attached discount, a struck price, "OFFERTA", "SOTTOCOSTO",
  "PROMO" → isPromo true, promoKind "discount".
- Loyalty discounts — "SCONTO SOCI", "SOCIO COOP", "FIDATY", "CARTA INSIEME",
  "CARTA FEDELTÀ" → promoKind "loyalty".
- Multi-buy — "2X1", "3X2", "SECONDO PEZZO -50%" → promoKind "bundle".
- Coupon lines → promoKind "coupon".
- isPromo false → promoKind null.

CATEGORY — exactly one of:
food · beverages · household · personal-care · health · clothing · fuel ·
transport · utilities · recreation · pets · other
(Water, juice, coffee, wine, beer → beverages. Detergents, paper towels,
foil → household. Shampoo, toothpaste → personal-care. Pet food, litter →
pets. When unsure → other, and lower your confidence.)

HEADER
- storeChain: the chain ("Coop", "Esselunga", "Conad", "Lidl", "Eurospin",
  "Carrefour", "Pam") or null. storeName: the point of sale as printed
  (street/city) or null. purchasedAt: the receipt date and time in ISO 8601
  ("2026-08-19T18:42:00") or null if not legible.

CONFIDENCE
- Per line: 0..1 that description, quantity and lineTotalCents are right.
- Overall: 0..1 that you captured every product line and nothing else.
- Photos that are blurry, cut off or not a receipt: confidence below 0.3,
  transcribe what is legible, never invent a price or a line.

WORKED EXAMPLE (Coop-style layout)
Input lines:
  PASTA BAR SPAGH N5 500G          1,29
  LATTE PS UHT COOP 1L      2 x 1,09      2,18
  SCONTO SOCI                        -0,40
  BANANE            0,812 kg x 1,49       1,21
  IMPOSTA SACCHETTO                  0,03
  TOTALE COMPLESSIVO                 4,31
Output lines:
  1. description "Spaghetti n.5 500g", brand "Barilla", quantity 1 pieces,
     unitPriceCentsOnReceipt null, lineTotalCents 129, discountCents 0,
     packageSizeHint 0.5, unitKindHint "weight", isPromo false, food.
  2. description "Latte UHT parzialmente scremato 1L", brand "Coop",
     quantity 2 pieces, unitPriceCentsOnReceipt 109, lineTotalCents 178,
     discountCents 40, packageSizeHint 1, unitKindHint "volume", isPromo true,
     promoKind "loyalty", beverages.
  3. description "Banane", brand null, quantity 0.812 kg,
     unitPriceCentsOnReceipt 149, lineTotalCents 121, discountCents 0,
     packageSizeHint 0.812, unitKindHint "weight", isPromo false, food.
  (IMPOSTA SACCHETTO and TOTALE are skipped.) receiptTotalCents 431.
```

> **Sync warning** (as a `// WARNING` comment above the constant): the
> category list must match `CATEGORY_IDS` in `src/lib/domain/categories.ts`
> and the list in Spec 03 §7.1. Adding a category touches all three.

### 6.2 Zod schema — `src/lib/ai/receipt-schema.ts`

```ts
import { z } from 'zod';
import { CATEGORY_IDS } from '@/lib/domain/categories';
import { PROMO_KINDS } from '@/lib/domain/entries';
import { UNIT_KINDS } from '@/lib/domain/units';

export const QUANTITY_KINDS = ['pieces', 'kg', 'L'] as const;

export const receiptLineSchema = z.object({
  rawLine: z.string().min(1),
  description: z.string().min(1),
  brand: z.string().nullable(),
  category: z.enum(CATEGORY_IDS),
  quantity: z.number().positive(),
  quantityKind: z.enum(QUANTITY_KINDS),
  unitPriceCentsOnReceipt: z.number().int().nonnegative().nullable(),
  lineTotalCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative(),
  packageSizeHint: z.number().positive().nullable(),
  unitKindHint: z.enum(UNIT_KINDS).nullable(),
  isPromo: z.boolean(),
  promoKind: z.enum(PROMO_KINDS).nullable(),
  confidence: z.number().min(0).max(1),
});

export const receiptExtractionSchema = z.object({
  storeChain: z.string().nullable(),
  storeName: z.string().nullable(),
  purchasedAt: z.string().nullable(),
  receiptTotalCents: z.number().int().nonnegative().nullable(),
  lines: z.array(receiptLineSchema).max(200),
  confidence: z.number().min(0).max(1),
});

export type ReceiptLine = z.infer<typeof receiptLineSchema>;
export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;
```

`lines.max(200)` is a sanity bound, not a product limit: a 200-line receipt is
a restaurant inventory, and an unbounded array is how a malformed output
becomes a 100 KB `ai_raw_json`.

### 6.3 Gateway — `src/lib/ai/extract-receipt.ts`

Mirrors Spec 03 §7.3: same `Anthropic` client construction, same
`AiGatewayError` and `toAiGatewayError` (import them from
`extract-price-tag.ts` — do not duplicate), same `messages.parse` +
`zodOutputFormat` pattern.

```ts
export const RECEIPT_EXTRACTION_MODEL = 'claude-haiku-4-5';
export type ReceiptMediaType = 'application/pdf' | 'image/webp' | 'image/jpeg';

export interface ExtractReceiptInput {
  bytes: Uint8Array;
  mediaType: ReceiptMediaType;
  storeKind: StoreKind | null;
  chainHint: string | null;
}

export async function extractReceipt(
  input: ExtractReceiptInput,
  client: Anthropic = anthropicClient,
): Promise<ReceiptExtraction> {
  const data = Buffer.from(input.bytes).toString('base64');
  const fileBlock =
    input.mediaType === 'application/pdf'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: input.mediaType, data } };

  try {
    const response = await client.messages.parse({
      model: RECEIPT_EXTRACTION_MODEL,
      // 60 lines × ~120 output tokens of JSON ≈ 7K; leave headroom.
      max_tokens: 8000,
      temperature: 0,
      system: RECEIPT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [fileBlock, { type: 'text', text: buildReceiptInstruction(input) }],
        },
      ],
      output_config: { format: zodOutputFormat(receiptExtractionSchema) },
    });
    if (response.stop_reason === 'refusal') {
      throw new AiGatewayError('refused', false, 'Model refused to process the receipt');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiGatewayError('malformed-output', false, 'Receipt output truncated');
    }
    if (!response.parsed_output) {
      throw new AiGatewayError('malformed-output', false, `No parseable extraction (${response.stop_reason})`);
    }
    return response.parsed_output;
  } catch (error) {
    throw toAiGatewayError(error);
  }
}

function buildReceiptInstruction(input: ExtractReceiptInput): string {
  const parts = ['Extract every product line from this receipt.'];
  if (input.chainHint) parts.unshift(`Store chain: ${input.chainHint}.`);
  if (input.storeKind) parts.unshift(`Store kind: ${input.storeKind}.`);
  return parts.join(' ');
}
```

Notes:

- The gateway client for receipts uses `timeout: 45_000` (own instance or
  `client.withOptions({ timeout: 45_000 })`); Spec 03's 30 s is tuned for a
  single tag.
- `max_tokens` stop is treated as a hard failure, not a partial success: a
  truncated line list would silently drop the bottom of the receipt.
- No prompt caching: the system prompt is ~1.4K tokens, above the cacheable
  minimum, but imports arrive days apart; a cache breakpoint is harmless and
  may be added later, it is not part of DoD.
- The document block goes **before** the text block (API recommendation for
  documents).

### 6.4 Cross-checks — `src/lib/ai/flag-receipt.ts` (pure)

```ts
export const RECEIPT_TOTAL_TOLERANCE_CENTS = 5;   // rounding on discounts
export const MIN_LINE_CONFIDENCE = 0.6;
export const MIN_RECEIPT_CONFIDENCE = 0.5;

export type ReceiptReviewReason =
  | 'total-mismatch'      // Σ lineTotalCents ≠ receiptTotalCents (± tolerance)
  | 'low-confidence'      // overall confidence below MIN_RECEIPT_CONFIDENCE
  | 'no-total'            // receiptTotalCents null: cannot cross-check
  | 'no-date';            // purchasedAt null or unparseable

export type LineReviewReason =
  | 'low-confidence'
  | 'qty-price-mismatch'  // unitPriceCentsOnReceipt × quantity ≠ lineTotal + discount (±2 ct, pieces only)
  | 'zero-price';
```

`flagReceiptForReview(extraction, now)` returns `{ header: { needsReview,
reasons, purchasedAtMs }, lines: Array<{ needsReview, reasons }> }`.
`total-mismatch` forces the summary bar into a warning state ("Il totale delle
righe non torna: controlla le righe evidenziate") but never blocks
confirmation — the user is the authority, and a receipt with an unreadable
coupon line is still 38 good observations.

`purchasedAt` parsing: accept ISO with or without time; interpret as
Europe/Rome; reject dates in the future or more than 2 years past (→
`no-date`, falls back to `now`, editable on review).

### 6.5 Cost

`claude-haiku-4-5`: $1 / MTok input, $5 / MTok output. A two-page Coop PDF is
≈ 3–4K tokens (text layer + rendered pages), the system prompt ≈ 1.4K, the
output for 40 lines ≈ 5K tokens → **≈ $0.03 per receipt**. Four receipts a
week ≈ €0.50/month. A paper-receipt photo at 1600 px ≈ 2K image tokens —
cheaper than the PDF, worse quality. No budget guard in v1, same stance as
Spec 03 §7.5.

---

## 7. Line Resolution — `src/lib/services/resolve-receipt-lines.ts`

Pure service: takes the extraction, the user's non-archived products (with
`default_package_size`), the user's aliases, and the chain; returns one
`ResolvedReceiptLine` per extracted line. No I/O, fully unit-tested.

### 7.1 `normalizeAlias` — `src/lib/domain/receipt-lines.ts`

Receipt lines are matched by their **raw description token**, not by the
model's expanded `description` (which may vary run to run). Extract the
description part of `rawLine` by stripping trailing price/quantity columns
(`\s+\d+[.,]\d{2,3}\s*$` repeatedly, `\d+\s*x\s*`, `\d+[.,]\d+\s*kg`), then
apply Spec 03's `normalizeProductName` (lowercase, NFD diacritic strip,
punctuation → space, collapse whitespace). `"PASTA BAR SPAGH N5 500G
1,29"` → `"pasta bar spagh n5 500g"`.

### 7.2 Resolution order

For each line, in order, first hit wins:

1. **Alias exact** — `aliases[(normalizedAlias, chain)]`, then
   `aliases[(normalizedAlias, null)]`, then any chain (lowest priority).
   `match: { kind: 'alias', productId, score: 1 }`.
2. **Fuzzy** — `suggestProductMatches()` from Spec 03 §8, fed with
   `{ productName: description, brand }` (the model's expansion is better
   fuzzy input than the abbreviation) **and**, as a second query, the
   normalized alias itself; union of the two top-3 lists, best score first,
   deduplicated by product. Preselect `suggestions[0]` when score ≥ 0.7, as
   Spec 03 §9.1 does. `match: { kind: 'suggested', suggestions }`.
3. **New product** — `match: { kind: 'new', draft: { name: description,
   brand, category, unitKind } }` where `unitKind` = `unitKindHint` ??
   (`quantityKind === 'kg'` → `weight`, `'L'` → `volume`) ?? `'count'`.

### 7.3 Unit-price derivation — `deriveUnitPriceMilli` (pure)

The entry must satisfy Spec 03's invariant `unit_price_milli × package_size =
total_price_cents × 10`, where `total_price_cents` is the price of **one**
package after discounts:

```
perPackageCents = round(lineTotalCents / quantity)          // pieces
                = lineTotalCents                            // weighed (quantity is the size)
```

Package size, first available wins:

| Source | When | `sizeSource` |
|---|---|---|
| Weighed line | `quantityKind ∈ {kg, L}` → `package_size = quantity`, `quantity = 1` | `weighed` |
| `packageSizeHint` | description carried a size | `receipt` |
| `product.default_package_size` | matched/aliased product has one | `catalog` |
| — | none | **`missing`** → line status `needs-size` |

Then `unit_price_milli = round(perPackageCents × 10 / package_size)`. For
weighed lines with `unitPriceCentsOnReceipt` (€/kg printed), prefer the
printed figure × 10 and flag `qty-price-mismatch` if it disagrees with the
derived value by more than 1 %.

Count products (`unitKind 'count'`) with no hint and no catalog size default
to `package_size = 1` (one piece) — `sizeSource 'assumed-one'`, not
`missing`: a single "SHOPPER" or "PANE" line should not block the import.

### 7.4 Output type

```ts
export type ReceiptLineStatus = 'ready' | 'needs-size' | 'needs-product' | 'needs-review';

export interface ResolvedReceiptLine {
  index: number;                        // position on the receipt, stable id for the UI
  extraction: ReceiptLine;              // immutable, becomes part of ai_raw_json
  normalizedAlias: string;
  match:
    | { kind: 'alias'; productId: string; score: 1 }
    | { kind: 'suggested'; suggestions: ProductSuggestion[] }   // Spec 03 §8 type
    | { kind: 'new'; draft: { name: string; brand: string | null; category: CategoryId; unitKind: UnitKind } };
  fields: {                             // editable defaults for the review card
    quantity: number;                   // integer ≥ 1 after weighed normalization
    packageSize: number | null;         // null ⇒ needs-size
    sizeSource: 'weighed' | 'receipt' | 'catalog' | 'assumed-one' | 'missing';
    totalPriceCents: number;            // per package, after discount
    unitPriceMilli: number | null;      // null ⇒ needs-size
    isPromo: boolean;
    promoKind: PromoKind | null;
    category: CategoryId;
    unitKind: UnitKind;
  };
  status: ReceiptLineStatus;
  reviewReasons: LineReviewReason[];
}
```

Status precedence: `needs-size` > `needs-product` (no alias and no suggestion
≥ 0.4 — the user must pick or accept "new") > `needs-review` (flags from
§6.4) > `ready`. Only `ready` lines are pre-checked for confirmation; the
others are checked once the user resolves them. A line may also be
**excluded** by the user (swipe / toggle) — it stays in `ai_raw_json`, no
entry is created.

---

## 8. Review Screen — `/add/receipt/review`

### 8.1 Data

The page loads `receiptId` from the query, calls `getReceiptForReview(userId,
receiptId)` (service: reads the row, re-runs §6.4 and §7 on `ai_raw_json`
against the **current** catalog — aliases learned a minute ago on another tab
apply), and renders:

- **Header card**: store (resolved, or "Crea punto vendita: Coop – Via…"
  inline action), date (editable), receipt total vs lines total with the
  `total-mismatch` warning, line counters (ready / need size / new / excluded).
- **Line cards** (`receipt-line-card.tsx`), one per line, in receipt order,
  showing `rawLine` in monospace under the editable fields. Product picker is
  Spec 03's review-card picker (existing match, suggestions, "new"). Editing
  `packageSize`/`totalPriceCents`/`quantity` live-recomputes `unitPriceMilli`
  unless hand-edited (Spec 03 §9.1 behavior).
- **Same-day duplicate hint**: for lines whose product already has an entry
  with `recorded_at` on the same Europe/Rome day (any source), show "Già
  rilevato oggi da foto: 1,29 €" with a toggle *Aggiungi comunque / Escludi*.
  Default: **add** — a receipt price and a tag price of the same product the
  same day are both valid observations and the monthly mean absorbs them;
  the hint exists so the user is not surprised in `/history`.
- **Summary bar**: sticky; "Conferma N righe" disabled while any checked
  line is `needs-size` or `needs-product`.

Draft state lives in React state; a reload re-derives defaults from the
server (edits lost on hard reload, accepted v1, as in Spec 03).

### 8.2 `confirmReceipt` — Server Action

```ts
const confirmLineSchema = z.object({
  index: z.number().int().nonnegative(),
  product: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing'), productId: z.string().length(21) }),
    z.object({
      kind: z.literal('new'),
      name: z.string().min(1).max(120),
      brand: z.string().max(60).nullable(),
      category: z.enum(CATEGORY_IDS),
      unitKind: z.enum(UNIT_KINDS),
    }),
  ]),
  quantity: z.number().int().min(1).max(99),
  packageSize: z.number().positive(),
  totalPriceCents: z.number().int().positive(),
  unitPriceMilli: z.number().int().positive(),
  isPromo: z.boolean(),
  promoKind: z.enum(PROMO_KINDS).nullable(),
  learnAlias: z.boolean().default(true),
});

const confirmReceiptSchema = z.object({
  receiptId: z.string().length(21),
  storeId: z.string().length(21).nullable(),
  newStore: z.object({ name: z.string().min(1), chain: z.string().nullable(), kind: z.enum(STORE_KINDS) }).nullable(),
  purchasedAt: z.number().int(),          // epoch ms
  lines: z.array(confirmLineSchema).min(1).max(200),
});
```

The action is thin: Zod, `requireUser()`, `confirmReceiptService`,
`revalidatePath` for `/`, `/history`, `/products`, then redirect to
`/history?receipt=…`.

### 8.3 Behavior — service `confirmReceipt`

One `db.transaction`:

1. Load the receipt; `confirmed` → idempotent success (return the existing
   entry ids); `discarded` or another user's → `RECEIPT_NOT_FOUND`.
2. Server-side invariant check per line: `|unitPriceMilli × packageSize −
   totalPriceCents × 10| ≤ 10` (one cent) → else `INVALID_PRICE`.
3. Create `newStore` if provided (else use `storeId`, validated as the
   user's).
4. Dedupe `new` products within the batch by normalized name+brand (Spec 03
   §9.3 rule), create them with `default_package_size = packageSize`.
5. Verify `existing` product ids in one `IN (...)` query.
6. Insert entries via `createPriceEntries` with: `id` = `nanoid()`,
   `source 'receipt'`, `receipt_id`, `store_id`, `recorded_at = purchasedAt`,
   `quantity`, `total_price_cents`, `package_size`, `unit_price_milli`,
   `is_promo`, `promo_kind`, `currency 'EUR'`, `ai_confidence` = the line's
   confidence, `ai_model = RECEIPT_EXTRACTION_MODEL`, `ai_raw_json` = the
   line's `ReceiptLine` JSON, `photo_url NULL`.
7. For each line with `learnAlias`: upsert `product_aliases`
   `(userId, normalizedAlias, chain)` → `productId`, `hit_count + 1`,
   `last_seen_at`. The normalized alias is recomputed server-side from the
   stored `rawLine`, never trusted from the client.
8. Back-fill `products.default_package_size` per §2.2.
9. Update `receipts`: `status 'confirmed'`, `confirmed_at`, `store_id`,
   `purchased_at`, `line_count` = entries inserted.

`discardReceipt` sets `status 'discarded'`; the row stays so a re-upload of
the same hash resumes instead of recomputing.

---

## 9. Alias Learning — behavior summary

- Learned **only on confirmation**, only for lines the user confirmed with a
  product, and only when `learnAlias` is true (the card exposes "Ricorda
  questa riga" checked by default; unchecked for one-off weird lines).
- Keyed per user: aliases are private data, never shared (Spec 00 §3).
- Chain-scoped when the receipt's store has a `chain`; `NULL` chain otherwise.
  Lookup order in §7.2 prefers the chain-scoped alias.
- Product merge moves aliases (§2.5). Product archive keeps them (an archived
  product is still a valid match target for history; the review card shows
  the archived badge).
- `/products/[id]` lists the product's aliases with a delete action (Spec 05
  adds the UI; the repository function `deleteAlias` ships here).

---

## 10. Error Taxonomy & i18n Keys

New `DomainErrorCode`s (Spec 01 checklist: union, both message files, HTTP
map):

| New code | HTTP | i18n key |
|---|---|---|
| `RECEIPT_TOO_LARGE` | 413 | `errors.RECEIPT_TOO_LARGE` |
| `UNSUPPORTED_RECEIPT_TYPE` | 415 | `errors.UNSUPPORTED_RECEIPT_TYPE` |
| `RECEIPT_TOO_LONG` | 422 | `errors.RECEIPT_TOO_LONG` |
| `RECEIPT_ALREADY_IMPORTED` | 409 | `errors.RECEIPT_ALREADY_IMPORTED` |
| `RECEIPT_NOT_FOUND` | 404 | `errors.RECEIPT_NOT_FOUND` |
| `RECEIPT_NO_LINES` | 422 | `errors.RECEIPT_NO_LINES` |

Reused: `UNAUTHORIZED`, `INVALID_INPUT`, `INVALID_PRICE`, `STORE_NOT_FOUND`,
`PRODUCT_NOT_FOUND`, `EXTRACTION_UNAVAILABLE`, `EXTRACTION_FAILED`.

UX copy (IT primary, EN mirrored) under the `receipt.*` namespace:

| Key | IT |
|---|---|
| `receipt.title` | Importa scontrino |
| `receipt.dropzone` | Carica lo scontrino digitale (PDF) o una foto |
| `receipt.offline` | Serve la connessione per leggere uno scontrino |
| `receipt.reading` | Leggo lo scontrino… |
| `receipt.review.title` | Controlla le righe |
| `receipt.review.totalMismatch` | Il totale delle righe non torna con lo scontrino: controlla le righe evidenziate |
| `receipt.review.needsSize` | Indica il formato (es. 500 g) per calcolare il prezzo al kg |
| `receipt.review.needsProduct` | Scegli o crea il prodotto |
| `receipt.review.sameDay` | Già rilevato oggi ({source}): {price} |
| `receipt.review.learnAlias` | Ricorda questa riga |
| `receipt.review.confirm` | Conferma {count} righe |
| `receipt.review.excluded` | Esclusa |
| `receipt.status.ready` / `needsSize` / `needsProduct` / `needsReview` | Pronta / Manca il formato / Manca il prodotto / Da controllare |
| `history.source.receipt` | Scontrino |

---

## 11. Tests

### 11.1 `src/lib/ai/extract-receipt.test.ts` — mocked Anthropic client

| Case | Mock | Expect |
|---|---|---|
| PDF happy path | `parse` resolves `{ stop_reason: 'end_turn', parsed_output }` | Called with `model 'claude-haiku-4-5'`, `temperature 0`, `max_tokens 8000`, first content block `type 'document'` with `media_type 'application/pdf'`, `output_config.format` present |
| Image happy path | same | first content block `type 'image'`, `media_type 'image/webp'` |
| Chain + kind hints | — | instruction text starts with `Store kind: supermarket. Store chain: Coop.` |
| Truncated | `stop_reason 'max_tokens'` | `AiGatewayError('malformed-output', false)` |
| Refusal | `stop_reason 'refusal'` | `AiGatewayError('refused', false)` |
| 529 / timeout / 400 | SDK errors | same mapping as Spec 03 §13.1 |

### 11.2 `src/lib/ai/flag-receipt.test.ts`

Total within 5 ct → no flag; off by 6 ct → `total-mismatch`; null total →
`no-total`; future date → `no-date` + fallback `now`; `2 × 109 ≠ 178 + 40`
(should equal: 218 = 178 + 40 → no flag); a line at 0 → `zero-price`.

### 11.3 `src/lib/domain/receipt-lines.test.ts`

`normalizeAlias` table: `"PASTA BAR SPAGH N5 500G  1,29"` →
`"pasta bar spagh n5 500g"`; `"LATTE PS UHT COOP 1L  2 x 1,09  2,18"` →
`"latte ps uht coop 1l"`; `"BANANE  0,812 kg x 1,49  1,21"` → `"banane"`;
accents and punctuation stripped. `deriveUnitPriceMilli` table: 129 ct /
0.5 kg → 2580; 2 × 109 − 40 → per package 89 ct / 1 L → 890; weighed 121 ct /
0.812 kg → 1490 (printed €/kg 149 → 1490, agrees); count with no size →
package 1, 450 ct → 4500 `assumed-one`; weight with no size → `missing`.

### 11.4 `src/lib/services/resolve-receipt-lines.test.ts`

- Alias hit with chain beats alias without chain beats fuzzy.
- Fuzzy uses both the expanded description and the raw alias; union
  deduplicated; preselect at ≥ 0.7.
- No candidate → `new` draft with `unitKind` derived from hint/quantityKind.
- Status precedence: `needs-size` > `needs-product` > `needs-review` > `ready`.
- Weighed line: `quantity 1`, `packageSize 0.812`, `sizeSource 'weighed'`.

### 11.5 `src/lib/services/import-receipt.test.ts` (in-memory libSQL, Spec 02 §10 harness)

- Same hash twice while `extracted` → second call returns without calling
  the gateway (mock asserts zero calls).
- Same hash after `confirmed` → `RECEIPT_ALREADY_IMPORTED`.
- `discarded` → re-extracts, reuses the row id.
- Store resolution: explicit id wins; chain match by normalized name;
  no match → `storeSuggestion`.

### 11.6 `src/lib/services/confirm-receipt.test.ts`

- Inserts N entries with `source 'receipt'`, `quantity`, `receipt_id`,
  `photo_url NULL`; transaction rolls back entirely on an invalid product id.
- Idempotent on already-confirmed receipt.
- Aliases upserted with `hit_count` increment; `learnAlias false` → none.
- `default_package_size` back-filled on new and existing products.
- Invariant violation (±1 ct) → `INVALID_PRICE`, nothing written.
- Merge: `moveAliases` sums `hit_count` on conflict.

### 11.7 `tests/e2e/receipt-import.spec.ts` (Playwright)

Fixture PDF `tests/fixtures/receipt-coop-sample.pdf` (synthetic, generated by
`scripts/make-receipt-fixture.ts` — **never a real receipt**), API mocked at
the gateway via the Spec 03 test seam. Flow: upload → review shows 3 cards
(one `needs-size`) → fill size → confirm → `/history` shows 3 entries with the
receipt chip → re-upload → `RECEIPT_ALREADY_IMPORTED` toast.

---

## 12. Definition of Done

- [ ] All files from §1.2 exist at the exact paths and pass `pnpm biome
      check` and `pnpm typecheck`.
- [ ] Migration adds `receipts`, `product_aliases`,
      `products.default_package_size`, `price_entries.quantity` (default 1),
      `price_entries.receipt_id`; backfill statement included; `pnpm db:migrate`
      clean on an existing Spec 02 database.
- [ ] `ENTRY_SOURCES` includes `'receipt'`; every exhaustive switch compiles;
      `/history` shows the receipt chip.
- [ ] `POST /api/extract-receipt` enforces every rule in §4.2, including
      magic bytes and the 10-page cap; the file is never persisted (§5).
- [ ] `RECEIPT_SYSTEM_PROMPT` matches §6.1 verbatim; model
      `claude-haiku-4-5`; `temperature 0`; `max_tokens 8000`; document block
      for PDF, image block for images; `messages.parse` + `zodOutputFormat`.
- [ ] Same file uploaded twice → idempotent while `extracted`, 409 once
      `confirmed`.
- [ ] Review screen: lines in receipt order with `rawLine` visible; `needs-size`
      and `needs-product` block confirmation of those lines only; same-day
      duplicate hint shown; summary bar counters correct.
- [ ] `confirmReceipt` is transactional and idempotent; entries carry
      `source 'receipt'`, `quantity`, `receipt_id`, `ai_*` fields,
      `photo_url NULL`; aliases learned; `default_package_size` back-filled.
- [ ] Second import from the same chain resolves previously confirmed lines
      as `alias` matches with no user action (manual test on two synthetic
      receipts).
- [ ] Product merge moves aliases; `/products/[id]` lists and deletes them.
- [ ] The repository projection feeding Spec 04 maps `quantity`; Spec 04
      tests still pass unchanged.
- [ ] Export `schemaVersion 2` with `receipts` and `productAliases`.
- [ ] Every i18n key from §10 exists in `messages/it.json` **and**
      `messages/en.json`.
- [ ] All tests from §11 pass: `pnpm test` and `pnpm test:e2e`.
- [ ] `pnpm build` succeeds; no service imports `next/*`; no repository
      contains business rules; comments follow `docs/COMMENTS.md`; UI follows
      `DESIGN.md`.

---

## Implementation Prompt

Paste this into a fresh Claude Code session to implement this spec:

```text
You are implementing Spec 07 (Receipt Import) of segnaprezzi.

Before writing any code, read IN FULL, in this order:
1. AGENTS.md and CLAUDE.md (project conventions and current status)
2. WORKFLOW.md — session/collaboration rules: branch, commit, and
   guided-collaudo discipline.
3. docs/specs/00-overview.md — the canonical contract: names, money rules,
   receipt additions to the domain model, route map. Never contradict it.
4. docs/specs/07-receipt-import.md — the spec you are implementing.
5. docs/specs/03-capture-ai.md §7–§9 — the AI gateway, product matching and
   review-screen patterns this spec reuses (import, do not duplicate).
6. docs/DEVELOPMENT_GUIDELINES.md, docs/COMMENTS.md and DESIGN.md.

Then implement docs/specs/07-receipt-import.md completely:
- Create every file in its §1.2 inventory at the exact path, with the exact
  exported names, schemas, prompt text (§6.1 verbatim), and behaviors; apply
  the listed edits to existing files.
- The receipt model is claude-haiku-4-5 via client.messages.parse +
  zodOutputFormat, PDF as a base64 document block, exactly as §6.3 shows. Do
  not substitute the model or the API pattern; do not add pdf parsing
  libraries.
- The receipt file is never persisted (§5). Money is integers everywhere.
  total_price_cents is the price of ONE package; quantity counts packages.
- Nothing is written to price_entries before confirmReceipt.
- Route handlers and Server Actions stay thin: Zod at the boundary, services
  orchestrate, repositories persist, gateways talk to Anthropic.
- Write all tests in §11 and make them pass: pnpm test and pnpm test:e2e.
  Generate the e2e fixture synthetically — never commit a real receipt.
- Verify quality gates: pnpm biome check, pnpm typecheck, pnpm build.
- Commit with conventional commits, one logical change per commit
  (e.g. "feat: add receipts and product_aliases schema",
  "feat: add /api/extract-receipt pipeline", "feat: add receipt review").
- When done, update the "Current status" section of CLAUDE.md to record that
  Spec 07 is implemented, and note any deliberate deviations.
If the spec is ambiguous or conflicts with 00-overview, stop and ask before
inventing a resolution.
```

**Recommended model:** Claude Opus 5
**Recommended effort:** high

**Prerequisites:** Specs 01–06 implemented. This spec consumes Spec 02's
repositories and migration tooling, Spec 03's AI gateway error mapping,
`compressPhoto`, `suggestProductMatches` and review-card components, Spec
04's engine (which already weights by `quantity`), and Spec 05's design
system (`DESIGN.md`).
