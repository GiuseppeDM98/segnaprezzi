# Spec 08 — Go-live & Operations

> **Status**: Approved · **Last updated**: 2026-08-21
> **Depends on**: Spec 01 §12 (Vercel deployment notes), Spec 02 (Turso schema, migrations, Better Auth), Spec 03 (Blob + Anthropic gateways), Spec 04 (ISTAT refresh workflow). Recommended after Spec 05 (so there is a dashboard to look at), required before Spec 06's real-device PWA verification.
> **Contract**: [Spec 00 — Overview](./00-overview.md). Nothing here may contradict it.

The promise of this spec: **the app runs on a public HTTPS URL, against a
real Turso database, a real Blob store and the real model, and the owner can
use it from a phone in a supermarket**. Every earlier spec was verified
locally with `/api/extract` intercepted; this one closes that gap and writes
down how the instance is operated afterwards.

This is an **operations spec**, not a feature spec: the code deliverables are
deliberately tiny (§5). Most of the work is account setup the owner performs
in dashboards and CLIs, with the agent preparing every command, declaring
every expected outcome in advance, and verifying every result mechanically
(WORKFLOW.md, Collaudo Guidato obligation 4).

---

## 1. Goal & scope

In scope:

1. A production environment: Turso database (primary in Frankfurt), Vercel
   project (functions in `fra1`), Vercel Blob store, Anthropic API key with
   a spend cap, production secrets, optional custom domain.
2. A preview environment that every pull request deploys to, with its own
   database and Blob store — previews never touch production data.
3. Local development wired to the same Vercel project (`vercel env pull`),
   so a developer gets a real Blob token without copying secrets by hand.
4. The first real end-to-end run of the capture pipeline — real
   `claude-haiku-4-5` call, real Blob upload — recorded as a collaudo.
5. A runbook (§8) for the recurring operations: deploy, roll back, apply a
   migration, rotate a secret, close signups, refresh ISTAT, back up, export.

Out of scope (roadmap or other specs): private signed Blob URLs (v1.1),
e-mail infrastructure, monitoring beyond Vercel's built-in logs, multi-region,
a staging environment distinct from previews.

### Files created or modified by this spec

```
vercel.json                      # NEW — function region pinned to fra1
src/lib/env.ts                   # BETTER_AUTH_URL resolved from VERCEL_URL on previews; VERCEL_* system vars declared
src/lib/auth/auth.ts             # trustedOrigins for preview aliases
.env.example                     # comments for the three Vercel scopes
README.md                        # "Deploy your own" section (self-hosting promise, Spec 00 §1)
docs/specs/00-overview.md        # §12 index row (already added with this spec)
AGENTS.md                        # operations checklist (§2.3 fan-out) and gotchas learned
CLAUDE.md                        # status + live URLs (no secrets)
```

---

## 2. Environments

Three environments, mapped onto Vercel's three environment-variable scopes.
Nothing is shared across rows except the Anthropic key and the code.

| | **Production** | **Preview** (every PR / non-main branch) | **Development** (`vercel env pull`) |
|---|---|---|---|
| URL | canonical domain (or `segnaprezzi.vercel.app`) | per-deployment `*.vercel.app` + branch alias | `http://localhost:3000` |
| `TURSO_DATABASE_URL` | `libsql://segnaprezzi-<org>.turso.io` | `libsql://segnaprezzi-preview-<org>.turso.io` | `file:local.db` |
| `TURSO_AUTH_TOKEN` | production token | preview token | *(empty)* |
| `BLOB_READ_WRITE_TOKEN` | store `segnaprezzi-photos` | store `segnaprezzi-photos-preview` | preview store token |
| `ANTHROPIC_API_KEY` | workspace `segnaprezzi`, spend cap | same key | same key |
| `BETTER_AUTH_SECRET` | production secret | preview secret (different) | local secret (different) |
| `BETTER_AUTH_URL` | `https://<canonical-domain>` | **unset** → resolved from `VERCEL_URL` (§5.2) | `http://localhost:3000` |
| `SIGNUP_ENABLED` | `true` until the owner has signed up, then `false` | `true` | `true` |

Why a separate preview database and store rather than a shared one: the seed
script refuses to run against anything but a local file database (Spec 02
§8, kept), so previews start empty and fill through real signups — test
accounts and test photos must be able to pile up and be wiped without ever
touching production rows or production blobs.

Why the same Anthropic key: a preview extraction costs a fraction of a cent;
a second workspace buys cost separation nobody will read. The spend cap (§3.4)
protects both.

---

## 3. Provisioning steps

Each step lists the commands or clicks, then the **expected outcome declared
before running it**. The agent runs every CLI step it can; the owner performs
the dashboard steps and reports back. Command flags below were written
against the CLIs current on 2026-08-21 — verify with `--help` before running,
and record any divergence as a "Correction" note in this spec.

### 3.1 Turso — two databases, primary in Frankfurt

```bash
turso auth login
turso db locations                                  # confirm `fra` = Frankfurt
turso group create segnaprezzi --location fra       # groups own the location
turso db create segnaprezzi --group segnaprezzi
turso db create segnaprezzi-preview --group segnaprezzi
turso db show segnaprezzi --url                     # → TURSO_DATABASE_URL (prod)
turso db show segnaprezzi-preview --url             # → TURSO_DATABASE_URL (preview)
turso db tokens create segnaprezzi --expiration none          # → TURSO_AUTH_TOKEN (prod)
turso db tokens create segnaprezzi-preview --expiration none  # → TURSO_AUTH_TOKEN (preview)
```

Why Frankfurt: Spec 01 §12 pins Vercel functions to `fra1`; the database
primary sits next to them so a query round-trip is ~1 ms instead of crossing
the Atlantic. If the two ever diverge, move the Turso primary, not the
function region. Why `--expiration none`: a server token that silently
expires takes the whole app down at an arbitrary moment; rotation is a
deliberate runbook step (§8.4), not a timer.

Apply the committed migrations to both databases, from the developer machine,
with the remote variables set **only for that command** (never written to
`.env.local`, which stays local-file):

```bash
TURSO_DATABASE_URL="libsql://segnaprezzi-<org>.turso.io" TURSO_AUTH_TOKEN="<prod token>" pnpm db:migrate
TURSO_DATABASE_URL="libsql://segnaprezzi-preview-<org>.turso.io" TURSO_AUTH_TOKEN="<preview token>" pnpm db:migrate
```

Expected outcome: `turso db shell segnaprezzi ".tables"` lists exactly the
tables of `src/lib/db/schema/` (`users`, `sessions`, `accounts`,
`verifications`, `user_settings`, `stores`, `products`, `shopping_sessions`,
`price_entries`, plus drizzle's `__drizzle_migrations`); `SELECT COUNT(*)
FROM users` is `0`. **Do not seed** — `scripts/seed.ts` refuses remote URLs
by design.

### 3.2 Vercel — project, region, Git integration

Owner, in the dashboard: *Add New → Project → Import* `GiuseppeDM98/segnaprezzi`.
Framework preset Next.js (auto), install/build commands auto from
`packageManager`, Node.js version **22.x**, root directory `/`. Do **not**
deploy yet — cancel the first deploy or let it fail: the environment variables
are not set.

Function region is committed in code rather than clicked (§5.1):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["fra1"]
}
```

Then, from the repository root: `vercel link` (select the project) — this
writes `.vercel/` (gitignored) and enables `vercel env pull`.

Expected outcome: Project Settings → Functions shows `fra1`; Settings → Git
shows production branch `main`, preview deployments enabled for all branches;
"Automatically expose System Environment Variables" is **on** (default — §5.2
depends on `VERCEL_URL` and `VERCEL_BRANCH_URL`).

### 3.3 Vercel Blob — two stores

Owner: *Storage → Create → Blob* twice: `segnaprezzi-photos` connected to the
**Production** scope only, `segnaprezzi-photos-preview` connected to the
**Preview** and **Development** scopes. Vercel injects `BLOB_READ_WRITE_TOKEN`
per scope automatically; nothing to copy.

Expected outcome: Settings → Environment Variables shows two
`BLOB_READ_WRITE_TOKEN` rows with disjoint scopes. Reminder from Spec 03:
blobs are `access: 'public'` at unguessable paths — treat URLs like bearer
tokens (README privacy note; private signed URLs are v1.1).

### 3.4 Anthropic — key with a spend cap

Owner, in the Anthropic Console: workspace `segnaprezzi`, monthly spend limit
(suggested **€10** — at well under €0.01 per photo that is ~1,500 photos a
month with margin; raise it consciously, never remove it), one API key named
`segnaprezzi-vercel`. The key is pasted into Vercel once (all three scopes)
and into the password manager; it never appears in a file in the repository
or in a chat message.

Expected outcome: the key works against the model constant in
`src/lib/ai/` (`claude-haiku-4-5`) — verified in phase C of the collaudo, not
with an ad-hoc curl that would put the key on a command line.

### 3.5 Secrets and the remaining variables

```bash
openssl rand -base64 32   # run three times: production, preview, local
```

Owner sets, in Settings → Environment Variables, the matrix of §2:
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` per scope, `ANTHROPIC_API_KEY`
(all scopes), `BETTER_AUTH_SECRET` per scope, `BETTER_AUTH_URL` in
**Production only** (`https://<canonical-domain>`, or the
`https://segnaprezzi.vercel.app` default domain until a custom one exists)
and in Development (`http://localhost:3000`), `SIGNUP_ENABLED=true`
everywhere for now.

Then, locally: `vercel env pull .env.local` — this **overwrites**
`.env.local` with the Development scope. Expected outcome: `.env.local` holds
`TURSO_DATABASE_URL="file:local.db"`, the preview Blob token, the Anthropic
key, the local secret; `pnpm dev` boots (env validation passes) and the
capture flow on localhost now reaches the real Blob store and the real model.

### 3.6 Custom domain (optional, recommended)

Owner: Settings → Domains → add the apex and `www`, with `www` redirecting to
the apex (or the reverse — pick one canonical host). Update
`BETTER_AUTH_URL` (Production) to the canonical `https://` origin and
redeploy: Better Auth's origin check trusts that URL, so a mismatch makes
every sign-in fail with `INVALID_ORIGIN`.

### 3.7 First production deploy

Merge (or push) to `main`. Expected outcome, checked by the throwaway smoke
script of §7 phase B against the production URL: `GET /` redirects to
`/login` (302, locale-prefixed), `GET /api/export` without a session is
`401`, `POST /api/auth/sign-up/email` creates the owner's account,
`GET /api/export` with that session returns the empty export payload
(`schemaVersion: 1`, empty arrays).

### 3.8 Close the door

Once the owner's account exists: set `SIGNUP_ENABLED=false` in **Production**
and redeploy (environment variable changes apply to the *next* deployment —
Deployments → ⋯ → Redeploy is enough). Expected outcome:
`POST /api/auth/sign-up/email` returns an error on production; sign-in still
works; previews still allow signups.

---

## 4. Operational rules (binding from now on)

1. **Migrations run from a developer machine, before the code that needs
   them is deployed** — never in the Vercel build step. The build runs for
   every preview and every production deploy in parallel; two builds racing
   `drizzle-kit migrate` against one database is how a migration gets applied
   twice or half. The order for a schema-changing PR is: open the PR (preview
   deploys against the preview DB, which you migrate first) → verify →
   migrate production → merge. Record this in the PR description.
2. **Previews never point at production.** The scope matrix in §2 is the
   whole protection; changing a Preview-scoped variable to a production value
   is a security incident, not a shortcut.
3. **Secrets live in Vercel and in the password manager, nowhere else.**
   `.env.local` is regenerated with `vercel env pull`, not edited by hand,
   and contains the Development scope only.
4. **Turning signups on or off is a redeploy**, not a restart — see §3.8.
5. **Back up before every production migration** (§8.5) and at least
   monthly; check the Turso plan's point-in-time-restore window and do not
   rely on it alone.
6. **The ISTAT refresh lands through its PR** (Spec 04 §8.4 workflow), never
   by editing `data/istat-nic.json` by hand on `main`.

---

## 5. Code deliverables

Small, and each one exists only because a dashboard setting cannot express it.

### 5.1 `vercel.json`

The two-line file of §3.2. Why in code: the region is part of the latency
contract with the database (§3.1), and a setting that lives only in a
dashboard is invisible to the next person who reads the repository.

### 5.2 `BETTER_AUTH_URL` on previews — `src/lib/env.ts` and `src/lib/auth/auth.ts`

Every preview deployment has a different hostname, so a single
`BETTER_AUTH_URL` value cannot be right for all of them, and Better Auth uses
that URL as the trusted origin of its CSRF/origin check (AGENTS.md §4.19 —
a request from an untrusted origin is rejected outright). Resolution:

- `src/lib/env.ts` declares the Vercel system variables as optional
  (`VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`,
  `VERCEL_ENV`) — it stays the only file reading `process.env` — and makes
  `BETTER_AUTH_URL` optional **only when** `VERCEL_URL` is present, resolving
  it to `https://${VERCEL_URL}`; with neither, validation still fails fast.
- `src/lib/auth/auth.ts` passes `trustedOrigins` built from the branch alias
  (`https://${VERCEL_BRANCH_URL}`) and the production URL
  (`https://${VERCEL_PROJECT_PRODUCTION_URL}`) when defined. Why the exact
  hosts rather than `https://*.vercel.app`: that wildcard trusts every
  project on Vercel, which is most of the internet's side projects.

Verified-by: phase B of the collaudo signs in on a preview deployment via
its per-deployment URL **and** via its branch alias. If Better Auth rejects
either, the fallback is a single fixed preview alias (a `preview` branch)
with `BETTER_AUTH_URL` set to it in the Preview scope — record the outcome as
a "Correction" here.

### 5.3 `.env.example`

Add a comment block describing the three scopes and `vercel env pull`; no
values change.

### 5.4 README — "Deploy your own"

Spec 00 §1 promises a self-hostable app; the README gets a short section
pointing at this spec: fork → Turso (§3.1) → Vercel import (§3.2) → Blob
(§3.3) → Anthropic key (§3.4) → variables (§3.5) → deploy → close signups
(§3.8). No duplicated command lists — link to the sections above.

---

## 6. Security checklist

Tick every item during the session; an unticked item blocks the milestone.

- [ ] No secret in any committed file (`git grep -iE 'sk-ant|libsql://|vercel_blob_rw'` is empty apart from this spec's placeholders).
- [ ] Production `BETTER_AUTH_URL` is `https://` and equals the canonical host; Better Auth sets `Secure` cookies there (automatic on HTTPS — verify with the browser's cookie inspector).
- [ ] `SIGNUP_ENABLED=false` in Production after the owner signed up (§3.8).
- [ ] Preview and Production scopes have disjoint databases and Blob stores (§2).
- [ ] Anthropic spend cap set (§3.4); Turso tokens are full-access because the app writes — there is no lower privilege to pick, so the token only ever lives in Vercel.
- [ ] Better Auth rate limiting is on in production (`rateLimit.enabled` follows `NODE_ENV === 'production'` — verify the installed version's actual behavior, AGENTS.md §4.19 style: check, don't assume).
- [ ] `/api/export` is `401` anonymously on production (phase D).
- [ ] The owner's account password lives in the password manager; no test account survives the collaudo on production (phase F).

---

## 7. Collaudo guidato (WORKFLOW.md)

Run against the **production** URL for phases A, B, D, E and F, and against a
**preview** deployment for the preview-specific checks. One throwaway script
(`collaudo-spec08.ts`, untracked, deleted in phase F) with invented "parole
spia", `check(label, actual, expected)` with expectations written before
running, results asserted on HTTP responses and on the database — never on
page appearance. A bare Node `fetch` must send `Origin` on every Better Auth
route (AGENTS.md §4.19).

| Fase | Copertura | Esito atteso |
|---|---|---|
| A — Invarianza | `pnpm lint`, `typecheck`, `test`, `test:e2e` on the merged `main`; production `GET /` → 302 to `/login`; `GET /api/export` anonymous → 401; `GET /en/login` renders | all green / codes as stated |
| B — Cambio di contesto | Sign-up + sign-in on production (owner's real account, §3.7); sign-in on a preview via its deployment URL **and** via its branch alias (§5.2); `SELECT COUNT(*) FROM users` on the production DB = 1 and on the preview DB = number of test accounts | sessions issued, no `INVALID_ORIGIN`, counts match |
| C — Comportamento nuovo | From a real phone on the production URL: `/scan` → photograph one real price tag → `/api/extract` returns a real extraction (`ai_model = claude-haiku-4-5`, `ai_confidence` set) → confirm; the blob exists at `users/<userId>/photos/<entryId>.webp` and `price_entries` holds the row with integer money | first ever real extraction succeeds; row and blob verified by query |
| D — Sotto la UI | Spec 03 §6.2 table against production by hand: 401, 400, 413, 415 — with the real Blob and model behind the route | same codes as locally |
| E — Casi negativi | Production signup after §3.8 → rejected; preview signup → accepted (same payload); a preview session's cookie replayed against production `GET /api/export` → 401 (own-resource / other-resource pair across environments) | as stated |
| F — Ripristino | Delete test accounts from the preview DB (direct SQL or the `deleteUserByEmail` helper pattern); delete test blobs from the preview store; confirm production holds only the owner's account and the one real entry (or delete it too); `collaudo-spec08.ts` removed; outcome recorded in `CLAUDE.md` | clean state, annotated |

What genuinely cannot be automated and stays with the owner: the dashboard
steps of §3, the phone in hand for phase C, and the judgement that the live
app is usable one-handed. Everything else the agent scripts.

---

## 8. Runbook

| Operation | How |
|---|---|
| 8.1 Deploy | Merge to `main`; Vercel builds and promotes. Previews: open a PR. |
| 8.2 Roll back | Deployments → previous production deployment → *Promote to Production* (instant, no rebuild). Roll back a migration separately — Drizzle migrations are forward-only; write a new one. |
| 8.3 Apply a migration | §4.1 order: migrate preview → verify on the PR's preview → back up production (8.5) → migrate production → merge. Command: `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… pnpm db:migrate`. |
| 8.4 Rotate a secret | `BETTER_AUTH_SECRET`: new value in Vercel + redeploy — every session is invalidated, users sign in again. Turso token: `turso db tokens create` → update Vercel → redeploy → `turso db tokens invalidate` the old one. Anthropic key: create new → update Vercel → redeploy → revoke old. Blob token: regenerate from Storage → redeploy. |
| 8.5 Back up | `turso db shell segnaprezzi .dump > backups/segnaprezzi-$(date +%F).sql` (local, gitignored, or the password manager's file vault). Photos: the Blob store is the only copy — `vercel blob list` + download before any destructive store operation. |
| 8.6 Close / open signups | `SIGNUP_ENABLED` in Production + redeploy (§3.8). |
| 8.7 Refresh ISTAT | Merge the monthly PR opened by `.github/workflows/update-istat.yml`, or run `pnpm istat:update` locally and open one. |
| 8.8 Export a user's data | Signed in as that user: `GET /api/export` (Spec 02 §9). |
| 8.9 Read logs | Vercel → Project → Logs (functions) — `/api/extract` logs the extraction failure code and user id, never the photo or the key. |

---

## 9. Definition of Done

- [ ] Production and preview Turso databases exist in Frankfurt, migrated, unseeded (§3.1).
- [ ] Vercel project linked to the repository, `vercel.json` pins `fra1`, Node 22, system env vars exposed (§3.2).
- [ ] Two Blob stores with disjoint scopes (§3.3); Anthropic key with a spend cap (§3.4); all variables set per the §2 matrix (§3.5).
- [ ] `vercel env pull .env.local` gives a working local environment that reaches the real Blob store and model.
- [ ] `src/lib/env.ts` / `src/lib/auth/auth.ts` changes of §5.2 in place, with tests for the resolution rules (unit tests on the env schema with and without `VERCEL_URL`).
- [ ] First production deploy verified (§3.7); signups closed on production (§3.8).
- [ ] Security checklist §6 fully ticked.
- [ ] Collaudo §7 executed phase by phase in chat and its outcome recorded in `CLAUDE.md` → "Current status", including the first real `claude-haiku-4-5` extraction and Blob upload.
- [ ] README "Deploy your own" section (§5.4); `.env.example` comments (§5.3).
- [ ] Spec 01 §12's open DoD item ("Vercel project connected, `fra1` region set, shell deployed") closed with a pointer to this spec.
- [ ] `AGENTS.md` gains the operational rules of §4 as a checklist entry and any gotcha met; `CLAUDE.md` records the live URLs (never a secret) and marks the milestone.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` green; one squashed commit per WORKFLOW.md.

---

## Implementation Prompt

```
You are running Spec 08 (Go-live & Operations) of segnaprezzi — an
operations session, not a feature session.

Before doing ANYTHING, read these files completely, in this order:
1. AGENTS.md
2. CLAUDE.md
3. WORKFLOW.md                 — session/collaboration rules: branch, commit,
                                  guided-collaudo discipline (this session IS
                                  a collaudo, phase by phase, in chat)
4. docs/specs/00-overview.md   — the canonical contract (names, env vars §11)
5. docs/specs/08-go-live.md    — THIS spec; follow it exactly
6. docs/specs/01-foundation.md §12 and docs/specs/02-database-auth.md §8–§9
   (deployment notes, seed guard, export route)
7. docs/DEVELOPMENT_GUIDELINES.md and docs/COMMENTS.md for the few code changes

Then:
- Implement the code deliverables of §5 first (vercel.json, env.ts and
  auth.ts preview-origin resolution with unit tests, .env.example comments,
  README "Deploy your own"), run pnpm lint / typecheck / test, and push the
  branch so a preview deployment exists.
- Walk the owner through §3 one step per message: give the exact commands
  or clicks, declare the expected outcome BEFORE they run, wait for their
  report, verify mechanically whatever you can (Turso CLI, HTTP calls, SQL).
  Never ask for a secret to be pasted into the chat; ask for confirmation
  that it was set.
- Run the collaudo of §7 phase by phase (A → F) with one throwaway,
  untracked script using invented "parole spia"; assert on HTTP and on the
  database, never on page appearance; delete the script in phase F.
- Tick §6 and §9 item by item; anything you could not verify is written down
  as "not verified", never glossed over.
- Record the outcome in CLAUDE.md "Current status" (live URLs, no secrets),
  fold gotchas into AGENTS.md, write SESSION_NOTES.md (Cosa / Perché / Nota),
  use it to update the durable docs, then delete it. One squashed commit,
  only after the owner's explicit OK.
```

**Recommended model:** Claude Sonnet 5
**Recommended effort:** high

**Prerequisites:** Specs 01–04 implemented (hard); Spec 05 recommended first
so the live instance has a dashboard to verify; must precede Spec 06's
real-device PWA checks (service worker, install prompt and iOS testing need a
real HTTPS origin).
