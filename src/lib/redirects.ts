/**
 * Post-login redirect targets.
 *
 * The middleware's auth gate sends anonymous visitors to /login with the
 * page they wanted in `redirectTo`, and the auth forms navigate there after
 * signing in. The parameter is part of a URL anyone can craft, so it is
 * untrusted input: left unchecked, a link to
 * `/login?redirectTo=https://evil.example` turns the login form into an open
 * redirect that lands a freshly signed-in user on someone else's site.
 */

/** Where a missing or rejected redirect target sends the user. */
export const DEFAULT_REDIRECT_PATH = '/';

/*
 * Control characters are rejected because browsers strip tabs and newlines
 * from URLs before parsing them: "/\t/evil.example" would become
 * "//evil.example", a protocol-relative URL to another host.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Return `raw` when it is a same-origin path, the home path otherwise.
 *
 * Allowlist, not denylist: only a string starting with a single "/" passes.
 * "//host" (protocol-relative) and any backslash ("/\host", which browsers
 * read as "//host") are rejected, as is anything carrying control characters.
 *
 * @param raw - The `redirectTo` query parameter, or null when absent
 * @returns A path safe to hand to the router
 */
export function sanitizeRedirectPath(raw: string | null): string {
  if (
    raw === null ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    CONTROL_CHARACTERS.test(raw)
  ) {
    return DEFAULT_REDIRECT_PATH;
  }
  return raw;
}
