/**
 * Find and remove entry photos in Vercel Blob that no price entry references
 * any more.
 *
 * Why this exists at all: until the deletion paths learned to clean up after
 * themselves, deleting an observation removed the row and left its photo, and
 * deleting an account emptied the database while the blobs survived it. The
 * code no longer creates orphans — this prunes the ones already there, and
 * doubles as the audit that proves it.
 *
 * What counts as an orphan: a blob under `users/{userId}/photos/` whose URL
 * appears in no `price_entries.photo_url`. Matching is on the stored URL, not
 * on the id in the pathname, because the URL is what the app actually wrote
 * and what a restored backup would carry.
 *
 * DRY RUN BY DEFAULT — it reports and deletes nothing. Pass `--delete` to
 * actually remove what it found. There is no undo: a deleted blob whose entry
 * still exists would leave a broken thumbnail in the history forever, so the
 * safe default is the one that only ever prints.
 *
 *   pnpm photos:prune            # report
 *   pnpm photos:prune --delete   # remove
 *
 * DANGER, and the reason for the guard below: the script decides what is an
 * orphan by comparing ONE database against ONE blob store. Point it at a
 * local database while BLOB_READ_WRITE_TOKEN still names the production
 * store and every production photo looks unreferenced — one `--delete` and
 * they are all gone. Run it with the environment of the deployment you mean
 * (`vercel env pull`), and read the two lines it prints before confirming.
 */
import { del, list } from '@vercel/blob';
import { isNotNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { priceEntries } from '@/lib/db/schema/app';

/** Blobs listed per request; the store's maximum. */
const PAGE_SIZE = 1000;

async function main(): Promise<void> {
  const isDeleting = process.argv.includes('--delete');

  // Every photo URL the database still vouches for, across every user: this
  // script is an operator tool run against one deployment's store, and a
  // per-user pass would have to re-list the same blobs once per user.
  const rows = await db
    .select({ photoUrl: priceEntries.photoUrl })
    .from(priceEntries)
    .where(isNotNull(priceEntries.photoUrl));
  const referenced = new Set(rows.map((row) => row.photoUrl as string));
  // Printed, not just counted: this line and the next are how an operator
  // notices they are about to prune a store their database knows nothing of.
  console.log(`Database: ${describeDatabase()}`);
  console.log(`Referenced photos in the database: ${referenced.size}`);

  const orphans: Array<{ url: string; size: number }> = [];
  let scanned = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'users/', cursor, limit: PAGE_SIZE });
    for (const blob of page.blobs) {
      scanned += 1;
      if (!referenced.has(blob.url)) {
        orphans.push({ url: blob.url, size: blob.size });
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const totalBytes = orphans.reduce((sum, orphan) => sum + orphan.size, 0);
  console.log(`Blobs scanned: ${scanned}`);
  console.log(`Orphans: ${orphans.length} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
  for (const orphan of orphans) {
    console.log(`  ${orphan.url}`);
  }

  if (orphans.length === 0) {
    return;
  }
  if (!isDeleting) {
    console.log('\nDry run — nothing was deleted. Re-run with --delete to remove them.');
    return;
  }

  // In batches: `del` takes many URLs at once, but not an unbounded list.
  for (let index = 0; index < orphans.length; index += PAGE_SIZE) {
    await del(orphans.slice(index, index + PAGE_SIZE).map((orphan) => orphan.url));
  }
  console.log(`\nDeleted ${orphans.length} orphaned photos.`);
}

/** The database being compared, with any credentials stripped. */
function describeDatabase(): string {
  const url = process.env.TURSO_DATABASE_URL ?? '(unset)';
  return url.startsWith('file:') ? `${url} (LOCAL FILE)` : url.split('?')[0];
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
