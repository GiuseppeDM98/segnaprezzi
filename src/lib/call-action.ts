/**
 * Client-side guard around Server Action calls.
 *
 * Design: a Server Action returns an ActionResult for every failure it can
 * see, but the call itself is a network request — when the connection drops
 * or the deployment changes under the page, the promise rejects instead of
 * resolving. A screen that only narrows on `ok` then leaves its pending flag
 * set forever and the rejection goes unhandled. Every client call site goes
 * through `callAction`, so a rejection becomes one more `ok: false` the
 * screen already knows how to show.
 *
 * Client-safe: imports types only, so it never drags server code into a
 * client bundle.
 */
import type { ActionError, ActionResult } from '@/lib/errors';

/**
 * Await a Server Action call, turning a rejected request into a failed result.
 *
 * The failure is reported as INTERNAL: DomainErrorCode has no network code
 * yet, and INTERNAL's message ("something went wrong, try again") is the
 * right instruction for a request that never got an answer. The rejection is
 * logged with the operation name, because nothing else will record it.
 *
 * @param operation - Name of the action being called, for the log line
 * @param call - The pending action call, e.g. `createStore(input)`
 * @returns The action's own result, or `{ ok: false }` with code INTERNAL
 */
export async function callAction<T>(
  operation: string,
  call: Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    return await call;
  } catch (cause) {
    console.error(`${operation} request failed`, { cause });
    return { ok: false, error: { code: 'INTERNAL', message: 'Action request failed' } };
  }
}

/**
 * The message to show for a failed action.
 *
 * Why two sources: a known code says why the action failed ("store not
 * found"), which is more useful than the screen's generic sentence; INTERNAL
 * carries no cause the user can act on, so the screen's own message — which
 * at least says what did not happen ("not saved") — reads better.
 *
 * @param error - The failed result's error
 * @param translateError - The `errors` namespace translator (`errors.<CODE>`)
 * @param fallback - The screen's message for an INTERNAL failure
 */
export function describeActionError(
  error: ActionError,
  translateError: (code: string) => string,
  fallback: string,
): string {
  return error.code === 'INTERNAL' ? fallback : translateError(error.code);
}
