/*
 * Domain error primitives (docs/specs/01-foundation.md §9).
 *
 * Design: expected failures travel through the layers as DomainError
 * subclasses carrying a stable machine-readable `code`. The code is the
 * contract: Server Actions serialize it, route handlers map it to HTTP
 * status, and the UI translates it (messages/<locale>.json, `errors`
 * namespace). The `message` is developer-facing context for logs — it is
 * never shown to users, so it can be specific without being localized.
 */

// WARNING: adding a code here requires updating:
// - the `errors` namespace in messages/it.json and messages/en.json
// - the code→HTTP-status mapping in route handlers (Spec 03)
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'EXTRACTION_FAILED'
  | 'INTERNAL'
  // Spec 03 §2.5 — capture, review, and quick-entry failures.
  | 'INVALID_INPUT'
  | 'INVALID_DATE'
  | 'INVALID_PRICE'
  | 'INVALID_SIZE'
  | 'INVALID_STORE_KIND'
  | 'INCONSISTENT_FUEL_PRICES'
  | 'SESSION_NOT_FOUND'
  | 'STORE_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'PHOTO_TOO_LARGE'
  | 'UNSUPPORTED_PHOTO_TYPE'
  | 'EXTRACTION_UNAVAILABLE';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    // Why: `new.target.name` keeps subclass names in stack traces and logs
    // without each subclass having to set `this.name` itself.
    this.name = new.target.name;
    this.code = code;
  }
}

/** A referenced resource does not exist or belongs to another user. */
export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} ${id} not found`);
  }
}

/** Input failed business validation beyond what Zod schemas express. */
export class ValidationError extends DomainError {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super('VALIDATION_FAILED', message);
    this.issues = issues;
  }
}

/** The caller has no authenticated session, or the session is invalid. */
export class UnauthorizedError extends DomainError {
  constructor(message = 'Not authenticated') {
    super('UNAUTHORIZED', message);
  }
}

/** The AI could not produce a usable extraction from the photo (Spec 03). */
export class ExtractionError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('EXTRACTION_FAILED', message, options);
  }
}

/*
 * Spec 03 error classes. Each one exists because a caller must be able to
 * react differently: the offline queue retries EXTRACTION_UNAVAILABLE but
 * parks EXTRACTION_FAILED, and the review screen sends the user back to the
 * capture screen on SESSION_CLOSED but to the product picker on
 * PRODUCT_NOT_FOUND.
 */

/** The shopping session does not exist, or belongs to another user (Spec 03 §2.2). */
export class SessionNotFoundError extends DomainError {
  constructor(sessionId: string) {
    super('SESSION_NOT_FOUND', `Shopping session ${sessionId} not found`);
  }
}

/** The shopping session reached a terminal status and accepts no more writes. */
export class SessionClosedError extends DomainError {
  constructor(sessionId: string, status: string) {
    super('SESSION_CLOSED', `Shopping session ${sessionId} is ${status}`);
  }
}

/** The referenced store does not exist for this user. */
export class StoreNotFoundError extends DomainError {
  constructor(storeId: string) {
    super('STORE_NOT_FOUND', `Store ${storeId} not found`);
  }
}

/** The referenced product does not exist for this user. */
export class ProductNotFoundError extends DomainError {
  constructor(productId: string) {
    super('PRODUCT_NOT_FOUND', `Product ${productId} not found`);
  }
}

/** A fuel entry was attached to a store that is not a fuel station (Spec 03 §11.3). */
export class InvalidStoreKindError extends DomainError {
  constructor(message: string) {
    super('INVALID_STORE_KIND', message);
  }
}

/** unitPriceMilli x liters and totalPriceCents disagree beyond pump rounding. */
export class InconsistentFuelPricesError extends DomainError {
  constructor(message: string) {
    super('INCONSISTENT_FUEL_PRICES', message);
  }
}

/** recordedAt falls outside the accepted window (Spec 03 §10.3). */
export class InvalidDateError extends DomainError {
  constructor(message: string) {
    super('INVALID_DATE', message);
  }
}

/** A money field is outside its accepted range (Spec 03 §10.3). */
export class InvalidPriceError extends DomainError {
  constructor(message: string) {
    super('INVALID_PRICE', message);
  }
}

/** packageSize is outside its accepted range (Spec 03 §10.3). */
export class InvalidSizeError extends DomainError {
  constructor(message: string) {
    super('INVALID_SIZE', message);
  }
}

/** Input failed boundary (Zod) validation — the generic 400 of this spec. */
export class InvalidInputError extends DomainError {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super('INVALID_INPUT', message);
    this.issues = issues;
  }
}

/** The extraction upstream is temporarily unavailable; the caller should retry. */
export class ExtractionUnavailableError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('EXTRACTION_UNAVAILABLE', message, options);
  }
}

/** Serializable error shape returned by Server Actions. */
export type ActionError = {
  code: DomainErrorCode;
  message: string;
  issues?: string[];
};

/**
 * Map any thrown value to the serializable ActionError shape.
 *
 * DomainError instances keep their code and message; ValidationError also
 * carries its issues. Anything else collapses to a generic INTERNAL error —
 * unknown errors may contain connection strings, SQL, or stack details that
 * must never reach the client.
 */
export function toActionError(error: unknown): ActionError {
  if (error instanceof ValidationError || error instanceof InvalidInputError) {
    return { code: error.code, message: error.message, issues: error.issues };
  }
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'INTERNAL', message: 'Unexpected error' };
}

// Guide: every Server Action returns this discriminated shape — the client
// narrows on `ok` and translates `error.code` on failure.
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/**
 * Map a thrown value to an ActionError, logging whatever was not expected.
 *
 * DomainError subclasses are the anticipated failures of a use case and need
 * no log line — the client will show them to the user. Anything else is a bug
 * or an outage: it must leave a traceable entry with its context while the
 * client still only ever sees a generic INTERNAL error.
 *
 * @param operation - Name of the failing use case, for the log line
 * @param context - Extra identifiers worth having when reading the log
 */
export function toLoggedActionError(
  operation: string,
  error: unknown,
  context: Record<string, unknown> = {},
): ActionError {
  if (!(error instanceof DomainError)) {
    console.error(`${operation} failed`, { ...context, cause: error });
  }
  return toActionError(error);
}
