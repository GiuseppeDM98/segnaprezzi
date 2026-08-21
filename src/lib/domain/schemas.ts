/**
 * Reusable Zod field schemas for the boundaries that accept price-entry data
 * (AGENTS.md §1.8). Spec 03 has four such boundaries — POST /api/extract,
 * confirmShoppingSession, createManualEntry, createFuelEntry — and three of
 * them validate the same money, size and product-pick shapes. Declaring them
 * once here is what keeps the bounds from drifting apart per boundary.
 *
 * These are field shapes only: no I/O, no business rules. Range rules that
 * depend on the current time (the recordedAt window) belong to the service
 * layer, which owns `now`.
 */
import { z } from 'zod';

import type { DomainErrorCode } from '@/lib/errors';
import { CATEGORY_IDS } from './categories';
import { UNIT_KINDS } from './units';

/** App-side ids are nanoid(21) over the URL-safe alphabet (Spec 00 §6). */
export const nanoidSchema = z.string().regex(/^[A-Za-z0-9_-]{21}$/);

/** Epoch milliseconds UTC — the only time representation that crosses a boundary. */
export const epochMsSchema = z.number().int().positive();

/** Euro cents, €0.01 … €10,000 (Spec 03 §10.3). */
export const totalPriceCentsSchema = z.number().int().min(1).max(1_000_000);

/** Package content in base units (kg, L, pieces), up to 10,000 (Spec 03 §10.3). */
export const packageSizeSchema = z.number().positive().max(10_000);

/** Milli-euros per base unit (Spec 03 §10.3). */
export const unitPriceMilliSchema = z.number().int().min(1).max(100_000_000);

/**
 * The product a new entry attaches to: an existing catalog row, or the data
 * needed to create one. Shared verbatim by the review confirm step (Spec 03
 * §9.2) and the manual entry form (§10.2).
 */
export const productPickSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), productId: nanoidSchema }),
  z.object({
    kind: z.literal('new'),
    name: z.string().min(1).max(200),
    brand: z.string().min(1).max(100).nullable(),
    category: z.enum(CATEGORY_IDS),
    unitKind: z.enum(UNIT_KINDS),
  }),
]);

export type ProductPick = z.infer<typeof productPickSchema>;

// WARNING: every field listed here must keep an `errors.<CODE>` message in
// messages/it.json and messages/en.json — the UI renders the mapped code
// directly (AGENTS.md §1.11).
const ERROR_CODE_BY_FIELD: Record<string, DomainErrorCode> = {
  recordedAt: 'INVALID_DATE',
  totalPriceCents: 'INVALID_PRICE',
  unitPriceMilli: 'INVALID_PRICE',
  liters: 'INVALID_SIZE',
  packageSize: 'INVALID_SIZE',
};

/**
 * Map a failed Zod parse to the error code Spec 03 §10.3 assigns to that
 * field, defaulting to the generic INVALID_INPUT.
 *
 * Why per-field codes: "check the price" and "check the date" are different
 * instructions to the user, and the UI only ever sees the code — a single
 * INVALID_INPUT for every bound violation would collapse them into one
 * unhelpful message.
 *
 * @param error - The ZodError from a failed safeParse
 * @returns The most specific DomainErrorCode the failing field maps to
 */
export function toFieldErrorCode(error: z.ZodError): DomainErrorCode {
  for (const issue of error.issues) {
    // Walk from the leaf inward: nested paths like ['entries', 0, 'packageSize']
    // carry the meaningful field name last.
    for (let index = issue.path.length - 1; index >= 0; index--) {
      const segment = issue.path[index];
      if (typeof segment === 'string' && segment in ERROR_CODE_BY_FIELD) {
        return ERROR_CODE_BY_FIELD[segment];
      }
    }
  }
  return 'INVALID_INPUT';
}
