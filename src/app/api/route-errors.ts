/**
 * The HTTP side of DomainError, shared by every route handler under /api.
 *
 * Design: services and repositories never know HTTP exists (AGENTS.md §1.7);
 * route handlers own the code→status mapping, and they all own the same one.
 * It lives here once, typed as an exhaustive Record<DomainErrorCode, number>,
 * so a code added to src/lib/errors.ts without a status fails to compile
 * instead of reaching a client as `undefined`. A plain module, not a route:
 * Next only treats files named route.ts as handlers.
 *
 * Every error body has the same shape, `{ error: { code, message } }`: the
 * offline sync engine reads `error.code` and translates it like any Server
 * Action failure.
 */
import { DomainError, type DomainErrorCode, ExtractionUnavailableError } from '@/lib/errors';

/** How long a client should wait before retrying a temporarily unavailable upstream. */
export const RETRY_AFTER_SECONDS = 30;

// WARNING: extending DomainErrorCode requires a row here and an
// `errors.<CODE>` message in every messages/*.json file (AGENTS.md §2.3).
export const HTTP_STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  EXTRACTION_FAILED: 422,
  INTERNAL: 500,
  INVALID_INPUT: 400,
  INVALID_DATE: 400,
  INVALID_PRICE: 400,
  INVALID_SIZE: 400,
  INVALID_STORE_KIND: 400,
  INCONSISTENT_FUEL_PRICES: 400,
  SESSION_NOT_FOUND: 404,
  STORE_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  SESSION_CLOSED: 409,
  PHOTO_TOO_LARGE: 413,
  UNSUPPORTED_PHOTO_TYPE: 415,
  EXTRACTION_UNAVAILABLE: 503,
};

/**
 * The uniform error response: the code's status and the
 * `{ error: { code, message } }` body.
 *
 * @param code - The DomainErrorCode the client will translate
 * @param message - Developer-facing detail; never shown to users
 * @param headers - Extra headers, e.g. Retry-After
 */
export function errorResponse(
  code: DomainErrorCode,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json(
    { error: { code, message } },
    { status: HTTP_STATUS_BY_CODE[code], headers },
  );
}

/** What a handler knows about the failing request, for the log line. */
export interface RouteErrorContext {
  /** Method and path, e.g. "POST /api/extract". */
  route: string;
  /** The session user, once requireUser() has returned. */
  userId?: string;
}

/**
 * Translate a thrown value into an error response.
 *
 * DomainErrors keep their code and get its status; EXTRACTION_UNAVAILABLE
 * also carries Retry-After, which tells the photo queue how long to hold off
 * (the queue treats 503 as retryable regardless). Anything else is a bug or
 * an outage: it is logged with the route, the user and the cause, and
 * collapses to a generic 500 — a stack trace or a libSQL message must never
 * reach the client.
 *
 * @param error - The value the handler caught
 * @param context - The route and, when known, the user
 */
export function toErrorResponse(error: unknown, context: RouteErrorContext): Response {
  if (error instanceof ExtractionUnavailableError) {
    return errorResponse(error.code, error.message, {
      'Retry-After': String(RETRY_AFTER_SECONDS),
    });
  }
  if (error instanceof DomainError) {
    return errorResponse(error.code, error.message);
  }

  console.error(`Unhandled error in ${context.route}`, {
    userId: context.userId,
    cause: error,
  });
  return errorResponse('INTERNAL', 'Unexpected error');
}
