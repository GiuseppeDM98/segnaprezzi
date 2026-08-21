/**
 * Deterministic identifiers for seeded rows, shared by scripts/seed.ts and
 * the E2E fixtures. Pure data helper, no I/O.
 *
 * Why this exists: Spec 00 §6 makes every id a nanoid(21), and Spec 03's
 * confirm boundary validates that exact length — a shorter, human-readable
 * seed id (the original `'seed-prod-latte'`) is rejected the moment a review
 * card suggests a seeded product, which breaks the capture flow against a
 * seeded database. Padding keeps the ids readable AND reproducible while
 * satisfying the contract.
 */

/** Length of every app-side id (nanoid(21), Spec 00 §6). */
const ID_LENGTH = 21;

/**
 * Turn a readable seed label into a contract-shaped id.
 *
 * @param label - Readable name, at most 21 characters from the nanoid alphabet
 * @returns The label padded with '0' to exactly 21 characters
 */
export function seedId(label: string): string {
  return label.padEnd(ID_LENGTH, '0').slice(0, ID_LENGTH);
}
