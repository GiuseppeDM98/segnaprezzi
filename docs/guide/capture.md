# Tag capture, AI extraction and photo storage

Read this guide before touching `src/lib/ai`, `src/lib/blob`, the
`/api/extract` route, the review flow's price invariant, photo deletion, or
the prune tool. The short version is the stub in AGENTS.md § Domain guides.

## 4.7 Vercel Blob needs a real token even in dev.

There is no local Blob
emulator. Pull the dev token from the linked Vercel project:
`vercel link` once, then `vercel env pull .env.local` (this fills
`BLOB_READ_WRITE_TOKEN`). Without it, `/api/extract` fails at the upload step
— photo capture UI can still be developed offline against the queue.

## 4.51 Don't reach for `client.withOptions()` when a gateway needs different SDK options — give it its own `Anthropic` instance.

`src/lib/ai/`'s test
seam is an injected client shaped `{ messages: { parse } }`; a
`withOptions({ timeout })` call inside the gateway means every mock must also
implement `withOptions`. When receipts had their own gateway it constructed
its own client and re-used `extract-price-tag.ts`'s exported
`toAiGatewayError`, so the failure classification lived in exactly one place
— the rule a second gateway must follow again.

## 4.54 When a real-world document surfaces a prompt gap, add a worked example matching its *exact* shape — and when the model still cannot be made reliable, look for an invariant in the document itself.

Both lessons come
from the retired receipt pipeline and apply to the shelf-tag prompt as well.
A generic rule ("don't guess ambiguous abbreviations") was true in principle
and too weak in practice to override a plausible-looking wrong guess; a
concrete counter-example in the prompt fixed it, because the model follows
examples far more reliably than an instruction it can rationalize past.
Prompt changes can only be verified against a real document, never by a
unit test. And when three prompt attempts did not stop Haiku from counting
six identical lines as seven, what worked was arithmetic on the printed
total — deterministic, tested, and visible to the user. A self-check rule
in a prompt ("Σ must not exceed the total") is **dangerous** without its
legitimate exceptions spelled out: the model will delete a real line to
satisfy it.

## 4.59 Blobs do not participate in the database's cascades, and nothing will remind you.

`price_entries` cascades from `users`, so deleting an account
emptied every table — while the shelf photos sat in Vercel Blob forever, which
is a privacy failure rather than a storage bill. Deleting a single observation
had the same hole. Any new path that destroys entries owes the store an
explicit cleanup: `deleteOwnedPhotos(userId, urls)` for a known set (it filters
to the user's own prefix and swallows its failures) or `deleteAllUserPhotos`
for a whole account, wired to Better Auth's `deleteUser.afterDelete(user,
request)` hook. Order matters: drop the row first and the blob after, because
an orphan blob is recoverable and a row whose photo is gone is not.
`pnpm photos:prune` reports what has already leaked.

## 4.61 A prune tool that compares one database against one blob store must refuse a mismatched pair.

`scripts/prune-photos.ts` calls a blob an orphan
when no `price_entries.photo_url` references it — so pointing it at
`file:local.db` while `BLOB_READ_WRITE_TOKEN` still names production makes
every real photo look unreferenced, and `--delete` would take all of them. It
prints the database it is comparing, and refuses to delete when the database
references no photo at all (`--force` overrides). Any future operator script
that diffs two systems needs the same shape of guard: name both sides, and
treat "one side is suspiciously empty" as an error, not as a big cleanup.

## 4.63 The unit-price invariant's tolerance must SCALE with the package size, or the app refuses its own arithmetic.

`unit_price_milli` is an
integer, so rounding it costs up to half a milli-euro per base unit: half a
cent on a 1 kg pack, but **13,5 cents on a 270-piece box of tissues**
(3,09 € → 0,01144 € each → storable only as 11 milli, which multiplies back
to 2,97 €). Against a fixed one-cent slack that is a violation, so a write
threw `INVALID_PRICE` over a number the app itself had derived.
`isUnitPriceConsistent` (`domain/money.ts`, `UNIT_PRICE_TOLERANCE_MILLI`)
therefore allows `max(10, packageSize / 2)` milli, and it is the ONE
predicate the review screens, the fuel form and every write ask. Two rules
generalize: when a stored value is quantized, a tolerance on a quantity
DERIVED from it has to carry the quantization, not a constant somebody once
found reasonable; and a server-side assertion the client cannot evaluate is
a rejection nobody can act on — share the predicate or do not assert it.

## 4.64–4.66 Retired with receipt import (2026-10-27).

They covered the
printed-€/kg-before-discount case, the Σ-lines-vs-printed-total
reconciliation and Haiku's miscount of repeated lines; the durable parts
moved into §4.54 and §4.63. The numbers stay reserved so older references
in `git log` still point somewhere.

## 4.70 Claude Opus 5.5 rejects `temperature`, and its thinking tokens are paid out of `max_tokens`.

Moving `EXTRACTION_MODEL` from
`claude-haiku-4-5` to `claude-opus-5-5` meant: delete `temperature: 0` (400
on this model, not a warning); thinking is always on and the only control is
`output_config.effort` (`high` here, the owner's choice for a dense image
where a misread digit is a wrong price); raise `max_tokens` to 8000 because
the thinking budget counts against it and a 1500 cap could truncate the
structured answer; and give the gateway 60 s with `maxDuration = 90` on
`/api/extract` (Fluid compute is on, so the Hobby plan's 300 s ceiling is the
real one — `maxDuration` is ours to set, not Vercel's). The test asserts the
absence of `temperature` on purpose: it is the one regression a careless
revert would reintroduce. Pricing moved from $1/$5 to $4/$20 per MTok; a
tag is still a few cents.
