/**
 * Account rules the server and the forms must agree on. Pure — no imports,
 * so client components can read them without pulling in the auth server.
 */

/**
 * Shortest password an account accepts. Better Auth enforces it on the
 * server (src/lib/auth/auth.ts); the forms read it to stop a password that
 * is too short on the device, before a round-trip the server would refuse.
 */
export const MIN_PASSWORD_LENGTH = 8;
