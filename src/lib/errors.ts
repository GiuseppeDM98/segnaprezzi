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
  | 'INTERNAL';

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
  if (error instanceof ValidationError) {
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
