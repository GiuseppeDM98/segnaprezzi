/**
 * ISTAT comparison helper (Spec 04 §8.3). The official series itself is a
 * static committed file (data/istat-nic.json) loaded by the caller — this
 * module only rebases it.
 */

/**
 * Rebase an official index series so that `baseYm` = 100, aligning it with
 * the personal index (whose base month is the user's first month of data).
 * Both series then read 100 at the user's base month, so the gap between
 * the curves IS the "you vs Italy" story.
 *
 * Returns null when `baseYm` is not present in the series (the user's
 * history may predate or outrun the committed ISTAT data) — the caller
 * hides the overlay instead of guessing.
 */
export function rebaseIstat(
  months: Record<string, number>,
  baseYm: string,
): Record<string, number> | null {
  const baseValue = months[baseYm];
  if (baseValue === undefined || baseValue === 0) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(months).map(([ym, value]) => [ym, (value / baseValue) * 100]),
  );
}
