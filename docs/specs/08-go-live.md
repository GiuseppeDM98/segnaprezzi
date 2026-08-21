# Spec 08 — Go-live & Operations

> **Status**: Approved · **Last updated**: 2026-08-21 (rewritten for a
> **single environment** — the preview environment of the previous revision
> was removed on the owner's decision; see §1.1)
> **Depends on**: Specs 01–07, all implemented. Spec 01 §12 (Vercel notes),
> Spec 02 (schema, migrations, Better Auth), Spec 03 (Blob + Anthropic
> gateways), Spec 04 (ISTAT refresh workflow), Spec 07 (receipt pipeline).
> **Contract**: [Spec 00 — Overview](./00-overview.md). Nothing here may
> contradict it.

The promise of this spec: **the app runs on a public HTTPS URL, against a
real Turso database, a real Blob store and the real model, and the owner can
use it from a phone in a supermarket**. Every earlier spec was verified
locally with the Anthropic call intercepted; this one closes that gap and
writes down how the instance is operated afterwards.

It is also **the session where every carried-over guided collaudo is finally
walked** — Specs 05, 06 and 07 each left manual checks that only a real
deployment on a real phone can answer (§7.2). They accumulated on purpose:
they are all the same twenty minutes with a phone in hand, and doing them
once against the live instance is worth more than three times against
localhost.

This is an **operations spec**, not a feature spec: the code deliverable is
one file (§5). Everything else is account setup the owner performs in
dashboards and CLIs, with the agent preparing every command, declaring every
expected outcome in advance, and verifying every result mechanically
(WORKFLOW.md, Collaudo Guidato obligation 4).

---

## 1. Goal & scope

In scope:

1. **One** environment: one Turso database (primary in Frankfurt), one Vercel
   project (functions in `fra1`, preview deployments **off**), one Vercel Blob
   store, one Anthropic API key with a spend cap, production secrets, optional
   custom domain.
2. Local development wired to the same Vercel project (`vercel env pull`), so
   the developer machine gets a real Blob token and the real model without
   copying secrets by hand.
3. The first real end-to-end runs: a real `claude-haiku-4-5` extraction from a
   photographed shelf tag, and a real supermarket receipt PDF read by the real
   model (Spec 07's one unverifiable claim).
4. The accumulated guided collaudo (§7): Spec 08's own checks plus the manual
   items Specs 05, 06 and 07 handed forward.
5. A runbook (§8) for the recurring operations: deploy, roll back, apply a
   migration, rotate a secret, close signups, refresh ISTAT, back up, export.

Out of scope (roadmap or other specs): a preview or staging environment
(§1.1), private signed Blob URLs (v1.1), e-mail infrastructure, monitoring
beyond Vercel's built-in logs, multi-region.

### 1.1 Why one environment — the decision this revision records

The previous revision of this spec provisioned a second database, a second
Blob store and a second set of secrets for preview deployments, plus the
ordering rule that comes with them ("migrate preview, verify on the PR,
migrate production, merge") and the code to make Better Auth trust a hostname
that changes on every deployment.

That is the right shape for a team. It is the wrong shape here, and the
reasoning is worth writing down rather than re-deriving later:

- **There is one user and one branch.** Previews exist so that a change can
  be seen by someone who is not the author before it reaches real data. With
  a single owner who is also the author, the preview URL and the production
  URL show the same person the same thing.
- **The verification previews would provide already happens locally.** Since
  Spec 06 the whole Playwright suite (91 tests, four projects) runs against
  `pnpm build && pnpm start` — a real production build with a real service
  worker — and `pnpm lint`/`typecheck`/`test` gate every commit. A preview
  deployment would re-run the same code against a database that starts empty.
- **A second environment is not free.** Six more variables, two more things to
  rotate, two more things to migrate in the right order, one more place a
  secret can be pasted into the wrong scope — and every one of those is a way
  to take the *production* instance down while trying to protect it.
- **The risk previews isolate is removed more directly by not having them.**
  A preview deployment writing to production data is impossible when there
  are no preview deployments (§3.2).

If the project ever gains a second contributor, the preview environment comes
back — the removed revision is in this file's git history, and §5.2 of it has
the `BETTER_AUTH_URL`-from-`VERCEL_URL` resolution already worked out. Until
then, "fast and easy" is a legitimate engineering requirement, not a corner
cut.

### 1.2 Files created or modified by this spec

```
vercel.json                      # NEW — region pinned to fra1, preview deployments disabled
.env.example                     # comment block: which variables come from `vercel env pull`
README.md                        # "Deploy your own" section (self-hosting promise, Spec 00 §1)
AGENTS.md                        # operations checklist (§2.3 fan-out) and any gotcha met
CLAUDE.md                        # status + live URL (never a secret) + collaudo outcome
docs/specs/01-foundation.md      # Correction note superseding its preview-deploy paragraph
```

**No file under `src/` changes.** That is the clearest measure of what the
single-environment decision bought: the previous revision needed
`src/lib/env.ts` and `src/lib/auth/auth.ts` to cope with a hostname that
differs per deployment, with unit tests for the resolution rules. With one
fixed origin, `BETTER_AUTH_URL` is simply set to it and the existing
fail-fast env validation is already correct.

---

## 2. The one environment

Two columns, and only because a laptop is not a server. Everything in the
left column is a value set once in the Vercel dashboard.

| | **Production** (Vercel) | **Development** (`vercel env pull`) |
|---|---|---|
| URL | canonical domain, or `segnaprezzi.vercel.app` | `http://localhost:3000` |
| `TURSO_DATABASE_URL` | `libsql://segnaprezzi-<org>.turso.io` | `file:local.db` |
| `TURSO_AUTH_TOKEN` | production token | *(empty)* |
| `BLOB_READ_WRITE_TOKEN` | store `segnaprezzi-photos` | the **same** store's token |
| `ANTHROPIC_API_KEY` | the one key, spend-capped | the same key |
| `BETTER_AUTH_SECRET` | production secret | a **different** local secret |
| `BETTER_AUTH_URL` | `https://<canonical-host>` | `http://localhost:3000` |
| `SIGNUP_ENABLED` | `true` until the owner has signed up, then `false` | `true` |

Preview scope: **empty, deliberately**. Nothing is set there, so even if a
deployment were somehow created outside `main`, `src/lib/env.ts` would fail
fast at boot rather than run against production credentials. Belt and braces
on top of §3.2's switch.

**The one thing this sharing costs, stated plainly:** local development
uploads its test photos to the *same* Blob store as production. The database
is separate (`file:local.db`), so those blobs are never referenced by a
production row — they are orphans, invisible in the app, billed by the byte.
They are cheap (≤ 400 KB each) and §8.5 says how to sweep them. The
alternative — a second Blob store — is exactly the complexity §1.1 removed.
Local development never writes to the production **database**, which is the
part that would actually hurt.

---

## 3. Provisioning steps

Each step lists the commands or clicks, then the **expected outcome declared
before running it**. The agent runs every CLI step it can; the owner performs
the dashboard steps and reports back. Command flags below were written
against the CLIs current on 2026-08-21 — verify with `--help` before running,
and record any divergence as a "Correction" note in this spec.

### 3.1 Turso — one database, primary in Frankfurt

```bash
turso auth login
turso db locations                                  # confirm `fra` = Frankfurt
turso group create segnaprezzi --location fra       # groups own the location
turso db create segnaprezzi --group segnaprezzi
turso db show segnaprezzi --url                     # → TURSO_DATABASE_URL
turso db tokens create segnaprezzi --expiration none  # → TURSO_AUTH_TOKEN
```

Why Frankfurt: Spec 01 §12 pins Vercel functions to `fra1`; the database
primary sits next to them so a query round-trip is ~1 ms instead of crossing
the Atlantic. If the two ever diverge, move the Turso primary, not the
function region. Why `--expiration none`: a server token that silently
expires takes the whole app down at an arbitrary moment; rotation is a
deliberate runbook step (§8.4), not a timer.

Apply the committed migrations from the developer machine, with the remote
variables set **only for that command** — never written into `.env.local`,
which stays on the local file database:

```bash
# Git Bash / macOS / Linux
TURSO_DATABASE_URL="libsql://segnaprezzi-<org>.turso.io" TURSO_AUTH_TOKEN="<token>" pnpm db:migrate
```

```powershell
# PowerShell has no inline env-var prefix — set, run, then clear
$env:TURSO_DATABASE_URL = "libsql://segnaprezzi-<org>.turso.io"
$env:TURSO_AUTH_TOKEN   = "<token>"
pnpm db:migrate
Remove-Item Env:TURSO_DATABASE_URL, Env:TURSO_AUTH_TOKEN
```

Expected outcome: `turso db shell segnaprezzi ".tables"` lists exactly the
tables of `src/lib/db/schema/` — `users`, `sessions`, `accounts`,
`verifications`, `user_settings`, `stores`, `products`, `shopping_sessions`,
`price_entries`, `receipts`, `product_aliases` — plus drizzle's
`__drizzle_migrations` with **two** rows (`0000_perpetual_santa_claus`,
`0001_receipt_import`); `SELECT COUNT(*) FROM users` is `0`. **Do not seed** —
`scripts/seed.ts` refuses a non-`file:` URL by design (Spec 02 §8), and that
guard is the reason it is safe to have this command in a spec at all.

### 3.2 Vercel — project, region, previews off

Owner, in the dashboard: *Add New → Project → Import*
`GiuseppeDM98/segnaprezzi`. Framework preset Next.js (auto), install/build
commands auto from `packageManager`, Node.js version **22.x**, root directory
`/`. Do **not** deploy yet — cancel the first deploy or let it fail: the
environment variables are not set.

Region and the preview switch are committed in code rather than clicked
(§5.1):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["fra1"],
  "git": {
    "deploymentEnabled": {
      "main": true
    }
  }
}
```

`git.deploymentEnabled` maps branch names to booleans; every branch not
listed is disabled, so only `main` ever deploys. **Verify this rather than
assume it** (the flag's default-for-unlisted-branches behavior is the kind of
thing that changes): push the Spec 08 branch and confirm no deployment
appears for it. If a deployment does appear, fall back to Settings → Git →
**Ignored Build Step** with

```bash
bash -c '[ "$VERCEL_ENV" = "production" ]'
```

(exit 0 builds, exit 1 skips) and record the divergence as a "Correction"
here. Either way the Preview scope stays empty (§2), so a stray deployment
cannot boot.

Then, from the repository root: `vercel link` (select the project) — this
writes `.vercel/` (gitignored) and enables `vercel env pull`.

Expected outcome: Project Settings → Functions shows `fra1`; Settings → Git
shows production branch `main`; pushing any other branch produces no
deployment.

### 3.3 Vercel Blob — one store

Owner: *Storage → Create → Blob*, name `segnaprezzi-photos`, connected to the
**Production** *and* **Development** scopes (not Preview). Vercel injects
`BLOB_READ_WRITE_TOKEN` into both automatically; nothing to copy.

Expected outcome: Settings → Environment Variables shows one
`BLOB_READ_WRITE_TOKEN` row scoped to Production + Development. Reminder from
Spec 03: blobs are `access: 'public'` at unguessable paths — treat the URLs
like bearer tokens (README privacy note; private signed URLs are v1.1). Note
that receipts never reach this store at all (Spec 07 §5): a receipt file is
hashed, read and dropped.

### 3.4 Anthropic — key with a spend cap

Owner, in the Anthropic Console: workspace `segnaprezzi`, monthly spend limit
(suggested **€10**), one API key named `segnaprezzi-vercel`. The key is pasted
into Vercel once (Production + Development) and into the password manager; it
never appears in a file in the repository or in a chat message.

Why €10 is the right order of magnitude: a tag photo costs well under €0.01
(Spec 03 §7.5) and a receipt about €0.03 (Spec 07 §6.5) — €10 is roughly
1,500 photos or 300 receipts a month. Raise it consciously; never remove it.

Expected outcome: the key works against the two model constants in
`src/lib/ai/` (both `claude-haiku-4-5`) — verified in phase C of the collaudo,
not with an ad-hoc curl that would put the key on a command line and into the
shell history.

### 3.5 Secrets and the remaining variables

```bash
openssl rand -base64 32   # run twice: one for production, one for local
```

Owner sets, in Settings → Environment Variables, the matrix of §2:
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (Production only — Development
uses `file:local.db`), `ANTHROPIC_API_KEY` (Production + Development),
`BETTER_AUTH_SECRET` (a different value per scope), `BETTER_AUTH_URL`
(`https://<canonical-host>` in Production, `http://localhost:3000` in
Development), `SIGNUP_ENABLED=true` in both for now.

Then, locally: `vercel env pull .env.local` — this **overwrites**
`.env.local` with the Development scope. Expected outcome: `.env.local` holds
`TURSO_DATABASE_URL="file:local.db"`, the Blob token, the Anthropic key and
the local secret; `pnpm dev` boots (env validation passes) and the capture and
receipt flows on localhost now reach the real Blob store and the real model
for the first time.

### 3.6 Custom domain (optional, recommended)

Owner: Settings → Domains → add the apex and `www`, with `www` redirecting to
the apex (or the reverse — pick one canonical host). Update `BETTER_AUTH_URL`
(Production) to the canonical `https://` origin and redeploy: Better Auth's
origin check trusts that URL, so a mismatch makes every sign-in fail with an
origin error (AGENTS.md §4.19).

### 3.7 First production deploy

Merge (or push) to `main`. Expected outcome, checked by the throwaway script
of §7 phase A against the production URL: `GET /` redirects to `/login` (302,
locale-aware), `GET /api/export` without a session is `401`,
`POST /api/auth/sign-up/email` creates the owner's account, and `GET
/api/export` with that session returns the empty export payload
(`schemaVersion: 2`, empty arrays including `receipts` and `productAliases`).

### 3.8 Close the door

Once the owner's account exists **and phase E's isolation pair has run**
(§7.1 — that test needs a second account, so the order matters): set
`SIGNUP_ENABLED=false` in Production and redeploy. Environment-variable
changes apply to the *next* deployment; Deployments → ⋯ → Redeploy is enough.
Expected outcome: `POST /api/auth/sign-up/email` returns an error;
sign-in still works.

---

## 4. Operational rules (binding from now on)

1. **Migrations run from a developer machine, before the code that needs them
   is deployed** — never in the Vercel build step, which runs on every deploy
   and would race itself. The order for a schema-changing PR is: back up
   (§8.5) → `pnpm db:migrate` against the remote → verify the tables → merge.
   Record it in the PR description.
2. **The database is the one thing with no undo.** Vercel rolls back in one
   click (§8.2); Drizzle migrations are forward-only. Back up before every
   production migration.
3. **Secrets live in Vercel and in the password manager, nowhere else.**
   `.env.local` is regenerated with `vercel env pull`, not edited by hand.
4. **Turning signups on or off is a redeploy**, not a restart — see §3.8.
5. **The ISTAT refresh lands through its PR** (Spec 04 §8.4 workflow), never
   by editing `data/istat-nic.json` by hand on `main`.
6. **`main` is the only branch that deploys** (§3.2). If that ever needs to
   change, change it in `vercel.json` — not in the dashboard, where the next
   reader of the repository will never find it.

---

## 5. Code deliverables

### 5.1 `vercel.json`

The file of §3.2, and the only source-tree change this spec makes. Why in
code rather than in a dashboard: the region is half of the latency contract
with the database (§3.1), and "only `main` deploys" is a security property —
both belong where they can be read, reviewed and blamed.

### 5.2 `.env.example`

Add a comment block saying which variables `vercel env pull` fills in and
which stay local (`TURSO_DATABASE_URL="file:local.db"`), and that the file it
writes is the Development scope. No values change.

### 5.3 README — "Deploy your own"

Spec 00 §1 promises a self-hostable app; the README gets a short section
pointing at this spec: fork → Turso (§3.1) → Vercel import (§3.2) → Blob
(§3.3) → Anthropic key (§3.4) → variables (§3.5) → deploy → close signups
(§3.8). No duplicated command lists — link to the sections above.

---

## 6. Security checklist

Tick every item during the session; an unticked item blocks the milestone.

- [ ] No secret in any committed file: `git grep -iE 'sk-ant|libsql://|vercel_blob_rw'` returns nothing but this spec's placeholders.
- [ ] Production `BETTER_AUTH_URL` is `https://` and equals the canonical host; Better Auth sets `Secure` cookies there (automatic on HTTPS — verify in the browser's cookie inspector).
- [ ] `SIGNUP_ENABLED=false` in Production after the owner signed up and after phase E (§3.8).
- [ ] The Preview scope is empty and only `main` deploys (§3.2).
- [ ] Anthropic spend cap set (§3.4). The Turso token is full-access because the app writes — there is no lower privilege to pick, which is exactly why it only ever lives in Vercel.
- [ ] Better Auth rate limiting is on in production (`rateLimit.enabled` follows `NODE_ENV === 'production'`) — verify the installed version's actual behavior, don't assume (AGENTS.md §4.42 measured it at 3 requests / 10 s on `/sign-in*`).
- [ ] `GET /api/export` is `401` anonymously on production (phase D).
- [ ] The user-scoping invariant holds on the live instance: the own-resource / other-resource pair of phase E passes (AGENTS.md §1.9).
- [ ] The owner's password lives in the password manager; the throwaway account created for phase E is deleted in phase F.

---

## 7. Collaudo guidato (WORKFLOW.md)

Everything runs against the **production** URL. One throwaway script
(`collaudo-spec08.ts`, untracked, deleted in phase F) with invented "parole
spia", `check(label, actual, expected)` so every expectation is committed to
disk before the script runs, and results asserted on HTTP responses and on the
database — never on page appearance alone. A bare Node `fetch` must send an
explicit `Origin` header on every Better Auth route (AGENTS.md §4.19).

### 7.1 Phases

| Fase | Copertura | Esito atteso |
|---|---|---|
| A — Invarianza | `pnpm lint`, `typecheck`, `test`, `test:e2e` on the merged `main`; then against production: `GET /` → 302 to `/login`, `GET /api/export` anonymous → 401, `GET /en/login` renders, `GET /sw.js` and `GET /manifest.webmanifest` are served | all green / codes as stated |
| B — Cambio di contesto | Sign-up + sign-in as the owner on production (§3.7); `SELECT COUNT(*) FROM users` on the production DB = 1; the session cookie is `Secure` + `HttpOnly` | session issued, no origin error, count matches |
| C — Comportamento nuovo | **The first real AI calls.** From a real phone on the production URL: (1) `/scan` → photograph one real shelf tag → the extraction comes back with `ai_model = claude-haiku-4-5` and a real `ai_confidence` → confirm; the blob exists at `users/<userId>/photos/<entryId>.webp` and `price_entries` holds the row with integer money. (2) `/add/receipt` → upload one **real** supermarket PDF → check the extracted lines against the paper, then confirm; N entries with `source='receipt'`, the aliases learned, `receipts.status='confirmed'`, and **no** file stored anywhere | both pipelines succeed against the real model; rows and blob verified by query; the receipt file is provably absent from Blob |
| D — Sotto la UI | Spec 03 §6.2 and Spec 07 §4.2 rejection tables by hand against production: 401, 400, 413, 415 on `/api/extract`; 401, 400, 413 (>5 MB), 415 (a `.txt` renamed `.pdf` — magic bytes), 409 (re-upload the receipt of phase C) on `/api/extract-receipt` | same codes as locally, now with the real Blob and model behind the route |
| E — Casi negativi | **Before §3.8.** Create a throwaway second account; from its session, request the owner's product via `/products/<owner product id>` and the owner's entry ids — expect 404/absent — while the same request for its *own* resource succeeds (the positive control WORKFLOW.md requires). Then close signups (§3.8) and confirm `POST /api/auth/sign-up/email` is rejected | isolation holds in both directions; signup closed |
| F — Ripristino | Delete the throwaway account (`deleteUserByEmail` helper pattern) and any blob it created; decide whether the phase-C tag entry and receipt entries stay (they are real prices — keeping them is the honest choice) ; `collaudo-spec08.ts` removed; outcome recorded in `CLAUDE.md` | clean state, annotated |

### 7.2 The carried-over manual checks (Specs 05, 06, 07)

These are the items previous sessions could not answer and explicitly handed
to this one. None is automatable: they are aesthetic judgement, physical
hardware, or a real vendor document. The owner runs them on a real phone
against the production URL, and each one gets a yes/no recorded in
`CLAUDE.md`.

**From Spec 05 (UI & design system)**

- [ ] The look-and-feel pass at 390 px on a real phone, in **both** themes:
      the dashboard hero, the zebra lists, the green-bar tint, the mono/grotesk
      pairing. Does it read as the printed statement `DESIGN.md` describes?
- [ ] One-handed usability: is the tab bar, the Scan disc and the sticky
      confirm bar reachable with a thumb?

**From Spec 06 (PWA & offline)**

- [ ] Install from Chrome on Android — the prompt appears, the app opens full
      screen with no browser chrome.
- [ ] Install from iOS Safari via the share sheet, following the app's own
      `IosInstallSheet` instructions — do they match what Safari actually
      shows on the installed iOS version?
- [ ] The maskable icon on a real launcher: not cropped, not letterboxed, the
      mark centred on the paper plate.
- [ ] A Background Sync drain **after closing the tab** on Chromium: capture
      offline, close the tab, restore connectivity, reopen — the photos went
      up on their own.
- [ ] The FAB → viewfinder morph with a real camera behind it.

**From Spec 07 (receipt import)**

- [ ] One real Coop/Esselunga/Conad PDF through the real model (phase C
      above), read line by line against the paper: are the discount lines
      attached to the right products? Are the abbreviations expanded
      sensibly? Is the total cross-check within tolerance? This is the only
      check that can say whether the §6.1 prompt holds up on a document
      nobody wrote for it.
- [ ] The second receipt from the same chain: do the previously confirmed
      lines resolve themselves as aliases, with nothing to do?

What genuinely cannot be automated and stays with the owner: the dashboard
steps of §3, the phone in hand for phase C and §7.2, and the judgement that
the live app is usable one-handed in an actual supermarket. Everything else
the agent scripts.

---

## 8. Runbook

| Operation | How |
|---|---|
| 8.1 Deploy | Merge to `main`; Vercel builds and promotes. No other branch deploys (§3.2). |
| 8.2 Roll back | Deployments → previous production deployment → *Promote to Production* (instant, no rebuild). Roll back a migration separately — Drizzle migrations are forward-only; write a new one. |
| 8.3 Apply a migration | §4.1 order: back up (8.5) → `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… pnpm db:migrate` → verify `.tables` → merge. |
| 8.4 Rotate a secret | `BETTER_AUTH_SECRET`: new value in Vercel + redeploy — every session is invalidated, users sign in again. Turso token: `turso db tokens create` → update Vercel → redeploy → `turso db tokens invalidate` the old one. Anthropic key: create new → update Vercel → redeploy → revoke old. Blob token: regenerate from Storage → redeploy. |
| 8.5 Back up | `turso db shell segnaprezzi .dump > backups/segnaprezzi-$(date +%F).sql` (kept locally / in the password manager's file vault, never committed). Photos: the Blob store is the only copy — `vercel blob list` + download before any destructive store operation. |
| 8.6 Sweep orphan blobs | `vercel blob list` and remove `users/<id>/photos/*` for any `<id>` that is not a row in the production `users` table — those are local-development leftovers (§2). Never delete a path whose entry id appears in `price_entries.photo_url`. |
| 8.7 Close / open signups | `SIGNUP_ENABLED` in Production + redeploy (§3.8). |
| 8.8 Refresh ISTAT | Merge the monthly PR opened by `.github/workflows/update-istat.yml`, or run `pnpm istat:update` locally and open one. |
| 8.9 Export a user's data | Signed in as that user: `GET /api/export` (Spec 02 §9, now `schemaVersion: 2`). |
| 8.10 Read logs | Vercel → Project → Logs (functions). `/api/extract` and `/api/extract-receipt` log the failure code and the user id, never the photo, the receipt or the key. |

---

## 9. Definition of Done

- [ ] One Turso database in Frankfurt, migrated to `0001_receipt_import`, unseeded (§3.1).
- [ ] Vercel project linked, `vercel.json` pins `fra1` and limits deployments to `main`, Node 22; a push to a non-`main` branch produces no deployment (§3.2).
- [ ] One Blob store scoped to Production + Development (§3.3); Anthropic key with a spend cap (§3.4); all variables set per the §2 matrix (§3.5); the Preview scope is empty.
- [ ] `vercel env pull .env.local` gives a working local environment that reaches the real Blob store and the real model.
- [ ] First production deploy verified (§3.7); signups closed after phase E (§3.8).
- [ ] Security checklist §6 fully ticked.
- [ ] Collaudo §7.1 executed phase by phase in chat, including the first real `claude-haiku-4-5` extraction, the first real receipt PDF, and the Blob upload.
- [ ] Every carried-over item in §7.2 answered yes or no in `CLAUDE.md` — an unanswered box is recorded as "not verified", never quietly dropped.
- [ ] README "Deploy your own" section (§5.3); `.env.example` comments (§5.2).
- [ ] Spec 01 §12's open DoD item ("Vercel project connected, `fra1` region set, shell deployed") closed with a pointer to this spec, and its preview-deploy paragraph superseded by a Correction note.
- [ ] `AGENTS.md` gains the operational rules of §4 and any gotcha met; `CLAUDE.md` records the live URL (never a secret), the collaudo outcome and the milestone.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` green; one squashed commit per WORKFLOW.md, only after the owner's explicit OK.

---

## Implementation Prompt

```
You are running Spec 08 (Go-live & Operations) of segnaprezzi — an
operations session, not a feature session. It is also the session where the
guided collaudi carried over from Specs 05, 06 and 07 are finally walked.

Before doing ANYTHING, read these files completely, in this order:
1. AGENTS.md
2. CLAUDE.md
3. WORKFLOW.md                 — session/collaboration rules: branch, commit,
                                  guided-collaudo discipline (this session IS
                                  a collaudo, phase by phase, in chat)
4. docs/specs/00-overview.md   — the canonical contract (names, env vars §11)
5. docs/specs/08-go-live.md    — THIS spec; follow it exactly. Note §1.1:
                                  there is ONE environment on purpose. Do not
                                  reintroduce a preview database, a preview
                                  Blob store or preview-scoped variables.
6. docs/specs/01-foundation.md §12, docs/specs/02-database-auth.md §8–§9,
   docs/specs/07-receipt-import.md §4–§5 (deployment notes, seed guard,
   export route, receipt rejection table)
7. docs/DEVELOPMENT_GUIDELINES.md and docs/COMMENTS.md

Then:
- Ship the code deliverables of §5 first (vercel.json, .env.example comments,
  README "Deploy your own"), run pnpm lint / typecheck / test, and push the
  branch. Confirm that pushing it created NO deployment — that is §3.2's
  first verification.
- Walk the owner through §3 one step per message: give the exact commands or
  clicks, declare the expected outcome BEFORE they run, wait for their
  report, verify mechanically whatever you can (Turso CLI, HTTP calls, SQL).
  Never ask for a secret to be pasted into the chat; ask for confirmation
  that it was set.
- Run the collaudo of §7.1 phase by phase (A -> F) with one throwaway,
  untracked script using invented "parole spia"; assert on HTTP and on the
  database, never on page appearance; delete the script in phase F. Mind the
  ordering: phase E needs a second account, so it runs BEFORE §3.8 closes
  signups.
- Then hand the owner the §7.2 list — the carried-over manual checks from
  Specs 05, 06 and 07 — one group per message, and record each answer.
- Tick §6 and §9 item by item; anything you could not verify is written down
  as "not verified", never glossed over.
- Record the outcome in CLAUDE.md "Current status" (live URL, no secrets),
  fold gotchas into AGENTS.md, write SESSION_NOTES.md (Cosa / Perché / Nota),
  use it to update the durable docs, then delete it. One squashed commit,
  only after the owner's explicit OK.
```

**Recommended model:** Claude Sonnet 5
**Recommended effort:** high

**Prerequisites:** Specs 01–07 implemented (all are). This is the last spec of
v1; nothing depends on it except the real-device and real-model checks that
Specs 05, 06 and 07 deferred to it (§7.2).
