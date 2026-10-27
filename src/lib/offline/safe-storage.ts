/**
 * localStorage access that never throws.
 *
 * Why: Safari in private mode throws on getItem/setItem instead of returning
 * null, and so does any browser with storage disabled or full; inside the
 * service worker `localStorage` does not exist at all. What callers keep
 * here is always a convenience (the install-nag budget, the id of the spesa
 * in progress), never worth a crashed screen: a failed read reads as
 * "nothing stored", a failed write as "not remembered".
 */

/** The stored value for `key`, or null when absent or when storage is unavailable. */
export function readStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Store `value` under `key`; silently a no-op when storage is unavailable. */
export function writeStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered: see the module comment.
  }
}

/** Remove `key`; silently a no-op when storage is unavailable. */
export function removeStorageItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing stored can be removed: see the module comment.
  }
}
