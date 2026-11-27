# Workflow — standing instructions

> **Standing instructions for any AI agent working on this repo.** They are not suggestions and not
> per-session: they hold until this file says otherwise.
>
> **They live in the repo, not in agent memory**: memory is per machine and per install, so the
> rules drift apart; a tracked file travels with the clone. An agent with persistent memory saves
> one pointer to this file, not the rules. If the owner states a new rule, it is added *here*, in that session's commit: to section 3 if it holds
> for this repo only; if it holds for every repo, ask the owner, because it enters the standard
> first (`claude-config/prompts/WORKFLOW_STANDARD.md`) and reaches the repos from there.
>
> Sections 1-2 are the portable standard, identical across every repo that adopts it. Section 3 is
> the only project-specific part: it says what "automate it yourself" and "show me the app"
> concretely mean *here*.

---

## 1. Session and collaboration rules

1. **Never commit without explicit approval.** Do not run `git commit` (nor `--amend`) until the
   owner gives the OK for that specific commit. Finish the work, summarise the diff, then ask.
   Branches and edits need no approval — only the commit does.

2. **One branch per session.** Before starting implementation work, create a new branch from the
   branch that is active at the start of the session. Check which one that is; never assume `master`/`main`.

3. **One commit per session.** Everything from a session is squashed into a single commit.

4. **Always answer in Italian** when working on this repo. This applies to the conversational
   channel; code, identifiers and comments stay in English. **Every tracked document is written in
   the repo's documentation language** (2026-11-01): English in the open repos, Italian where the
   repo's documentation is Italian (its WORKFLOW.md says which). In an English-language repo, Italian
   is reserved for the UI text a document quotes, page and feature names and the owner's own words, quoted as such. A guide still in the
   other language is rewritten when a session rewrites it anyway, never in a session of its own.

5. **Questions and proposals are asked interactively** (2026-09-11). A decision that is the owner's —
   which layers to build, on which surfaces, a wording — goes through the agent's interactive
   question tool, in groups of four, one topic at a time, multi-select where the options are not
   exclusive, the recommended option first; never a numbered list of questions in prose.

6. **Figures in tests are invented and round, never the owner's** (2026-10-12). A unit-test
   fixture, an E2E decoy or a seed carries amounts like 2500, 1120, 50: the owner's real data never
   enters the repo, not even as an expected value. A copy of real data that § 3 provides for the
   guided tour serves the tour only, and phase G removes it.
   **Nothing of the owner's real data in a tracked file** (2026-09-20, 2026-10-15; code comments
   too since 2026-11-15): a draft, comment, critique, screenshot, fixture or example sentence takes
   invented figures and generic names, never an amount, holding, account, start date or family
   detail from the real data. A public repo has no exception; a private one may waive or narrow it
   only in § 3, with the owner's decision and its date. Public data that is not the owner's (a
   listed company's published accounts) is not the owner's data.

7. **After an audit or an analysis, stop and wait for the owner's go-ahead** (2026-10-19). An audit,
   a review or an analysis ends with the findings; no file changes until the owner has chosen which
   fixes to apply and in what order (through rule 5).

8. **Dependencies: compare at session start, upgrade in a session of their own** (2026-10-26). If
   the repo has a lockfile, a session first installs from it with every server stopped (`npm ci`,
   `pnpm install --frozen-lockfile`; 2026-11-17: the audit reads the lock),
   then runs the package manager's audit and compares it with
   `doc/guide/dipendenze.md`, which records the date of the last audit, the framework version and
   every open advisory with the owner's decision. The answer is one line: «dipendenze: invariate
   dal <data>» or «N avvisi nuovi: …». A new advisory is written into the guide with its decision,
   asked through rule 5; nothing is upgraded in that session. An upgrade is a session on its own
   branch with its own verification; never `audit fix --force` or the command an advisory suggests:
   the version is chosen and installed by hand, preferring a release at least a few days old. A
   missing guide is created by the session that notices it (`TEMPLATES.md`). A repo without a
   lockfile skips this rule.

9. **`SESSION_NOTES.md` is the session's temporary container** (2026-10-26). A working file in the
   repo root, created at the start of the session and never committed. Before the closing prompt it
   ends with one block per thing learned: *Cosa* (what was done), *Perché* (the decision behind
   it), *Nota* (traps and measurements, dated), *Dove va a fine sessione* (`AGENTS.md`
   if it holds for the whole repo · `doc/guide/<tema>.md` if a domain lesson · `WORKFLOW.md` if a
   session rule · `CLAUDE.md` if project state · a comment at the right line if it is the why of one
   line). The closing prompt writes every entry into its destination and deletes the file before
   the single commit; a note that names no destination is lost. A `SESSION_NOTES.md` still on the
   remote means a session was not closed.

10. **The commit's «Model: … · effort …» line is read from the spec, never asked** (2026-11-18). A
    session that implements a spec writes the model and effort the spec names (its prompt, or its
    row in the series index); the one that retires it writes the SAME pair as the implementation's
    commit (`git log`). The owner is asked only when no spec is behind the session or it ran at
    another model or effort.

---

## 2. Guided verification (*collaudo guidato*)

When a freshly implemented feature has to be verified by hand, do **not** hand over a checklist and
disappear. The verification is done together, in chat, one phase at a time.

### Five obligations

1. **You prepare the test data.** A throwaway script (untracked by git, deleted when the
   verification ends) that plants **decoy words** — invented terms such as *fenicottero*,
   *ornitorinco*, which appear nowhere else in the data. Never entered by hand.

2. **One phase per message.** Give the phase, wait for the report, then the next one. Never deliver
   all the phases at once: it breaks their prerequisites.

3. **State the expected outcome before running, not after** — otherwise the reading always bends to
   fit whatever happened.

4. **Do every check you can automate yourself, and leave the owner only what you cannot do.**
   If the sessions are scriptable, write a throwaway script that opens a **real browser**
   with an authenticated session — your own if the role allows it, otherwise a
   throwaway test identity — and verify every outcome **against the database or the HTTP response,
   never against the look of the page alone**. Report phase by phase, expected outcome first.
   **Any automated end-to-end test that you are able to run, you run**: never declare a feature
   verified with an automated check left unrun. Left to the owner is only what is genuinely not
   automatable: visual and aesthetic judgement, physical hardware (a real barcode scanner), or a
   login no script can drive (a real OAuth flow with MFA).
   **The whole suite is launched last, when no file of the repo is left to change** (2026-11-22): a
   run fingerprints its tree, and a file edited meanwhile kills it or
   makes it measure a tree that is gone. Finish every edit first, the deletion of
   `SESSION_NOTES.md` included, touch nothing in that repo until the suite reports, and run it
   again if a file changes after. Other repos and the scratchpad may change.
   **A long run in the background is watched, not waited on** (2026-11-25): for the full suite, a
   build or a benchmark, a monitor reports progress **every five minutes** and **at once**
   when a service the run needs (emulators, dev server, database) stops answering. A dead service
   stops the run: restart both, never read the reds it left as results.
   **A browser suite on a shared backend runs on several workers, each in its own data universe**
   (2026-11-26): a database, project or tenant picked by the worker's index and seeded alike, never
   accounts cloned inside one. The count is measured: the fastest whole run green twice (on a
   hybrid CPU start from the performance cores). Above two workers the trace is kept only at the
   one retry of a red, and a test green only there is «flaky», read like a red. No spec names the
   backend, a parked session or another file's data by literal (one helper does) or reads what
   another file wrote. A fixed sleep becomes a condition, unless it IS the gesture under test.
   Nothing else runs on the machine, and the run's ports are free, while it is measured or gated;
   the whole run on a production build, an area run on the dev server. § 3 carries the line
   `Browser tests: workers <N> · isolation <mechanism> · whole run <wall> on <date> (<tests>
   tests)`; `workers 1` gives its reason.

5. **Before dismantling, let the owner look.** When the session touched something visible, ask for
   the OK and then walk the owner onto the dev server **with the fixtures still alive**: exact URLs,
   under which identity, and at most **five** things to look at — for each, what must happen and
   what would be the bug. **The tour starts at the owner's go** (2026-10-05): finish everything that
   needs no eyes, say it is ready, and wait. **A tour the spec plans is always done, and before the
   commit** (2026-11-14): never offered as optional, never traded for green tests, never begun
   without the owner's go; the diff summary and the commit's OK (rule 1) follow the tour
   (2026-11-21). The assistant opens the windows itself (2026-11-21): a before/after comparison as
   two windows side by side, an action as the page already on it. Where obligation 4 allows it,
   **open the page for the owner, already authenticated**: one item per message, one page at a
   time, waiting for the outcome; two pages together only for a comparison (the same URL under two
   identities), saying which window is which.
   Only what a probe cannot say: layout, whether the screen says what it must say, the words,
   whether an action gives feedback. State also **what that tour does not cover**, and never ask
   the owner to redo by hand something already verified. Whatever the tour finds becomes an
   assertion before the session ends: the tour does not replace the tests.
   **The windows have a width and a way to close** (2026-11-24): a phone check opens at a FIXED
   viewport (`viewport: { width: 390, height: 844 }`, a helper option), never `viewport: null`.
   The helper closes the windows it opened with the
   platform's tool (`taskkill /T /F` on Windows), sparing its own parents.

**A before/after comparison of screenshots is shown cropped, one item at a time** (2026-10-30): never
a folder of files. The agent opens a browser window on an HTML page with BEFORE and AFTER **cropped
to the area that changes** (one above the other; side by side for phone screenshots), **enlarged**
when the difference is a few pixels, titled with where to look, the crop checked with a headless
screenshot first. The message says «Comparison N of M», what changes and which side is which; the
window rules of obligation 5 apply.

**A window ends by itself, and is closed by its tree** (2026-11-09). The script that opens a visible
browser exits when the owner closes the **page** (`disconnected` alone never fires), when the browser goes, or after a time limit — one
wait, written **once** in a helper the throwaway scripts import. A window is closed by its root
with the whole tree (stopping the background task kills only the shell), then the count says zero.
**Once the owner confirms an item, the agent closes its windows** (2026-11-13; the comparison page
too, 2026-11-21: it opens in a driven window, never in the owner's default browser): it stops the
helper by its root, checks the count at zero and only then opens
the next item. The owner never closes a window to move on.

### Standard phases, when they make sense

| | Phase | What it establishes |
| --- | --- | --- |
| **A** | Invarianza | What worked before still works |
| **B** | Cambio di contesto | The new role/state is genuinely active |
| **C** | Comportamento nuovo | It does what it must, and not what it must not (obligation 4) |
| **D** | Sotto la UI | The same rules hold when the route is called directly |
| **E** | Casi negativi | Someone without rights is refused, with the right error |
| **F** | Giro guidato | The only phase the owner executes: they look with their own eyes, fixtures still alive |
| **G** | Ripristino | Configuration restored, fixtures removed, script deleted |

### A negative test alone never proves a security guard

It always takes the pair: **own resource** (positive control — must succeed) and **someone else's
resource** (the test — must fail), with the same identical file or record.

### Closing a verification

Restore any configuration that was changed, remove fixtures and test attachments, delete the script,
and **record the outcome somewhere that survives the session** (`CLAUDE.md` or equivalent).

**No collaudo script outlives its session** (2026-11-09; the services too, 2026-11-13). `node ~/.claude/processi-collaudo.mjs` counts the
trees of `scripts/collaudo-*` alive in the repo and the services a session starts and forgets (the
Firebase emulators, the Next.js `dev`/`start` servers), and says whose they are: this session's
(closed with `--chiudi`), another open session's (never touched), or unknown (named to the owner,
closed with `--chiudi --anche-ignote` only on their yes). The count is the **first gate** of every
repo's gate list: zero, or none starts. The standard `settings.json` runs it with `--hook` at
`SessionEnd`; a session that dies
without ending is caught by the next gate and by the count at every session start
(`prompts/01_SESSION_START.md`).
*A verification that was not recorded counts as not done.*

**The outcome is one line, the signals are not** (2026-10-19). In `CLAUDE.md` the session's status
entry says what was done, where it is documented, what is open and what comes next; it replaces the
previous one. The session's signals — type-check, test counts, E2E runs, flakes, skipped phases, the
guided tour's walk and findings (2026-10-23) — go in the commit message and, where they teach
something, in the area's guide, never in `CLAUDE.md`, which is injected into every turn: of the
tour it keeps only the outcome, done and closed or what is left open.

---

## 3. What this means in THIS repo

*(Written in English to match the language of the rest of this repo's
documentation — `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/`. This is
the only local, repo-specific section; Part 1 above is the portable standard
and stays in the language it was given in.)*

### Current state: automatable, and exercised

The repository has real application code and obligation 4 of the Collaudo
Guidato rule is fully honorable: the first real collaudo ran against running
code end to end, executed in six phases with 63 automated checks plus the
full E2E suite. Evidence, with the per-phase results, was recorded in
`CLAUDE.md` → "Current status" at the time; since `CLAUDE.md` keeps only the
latest state, the per-phase table now lives in git history.

What that collaudo established about how obligation 4 works in practice here:

- **Fixtures**: a throwaway `collaudo-spec03.ts` at the repository root
  (untracked, deleted at the end of phase F) with invented "parole spia" —
  fenicottero, ornitorinco, quokka, narvalo — so a fixture can never be
  mistaken for seeded or real data. Cleanup is `pnpm db:seed`, which wipes and
  recreates both seed users, so no fixture can survive by accident.
- **Expectations declared before execution, mechanically**: every check is
  written as `check(label, actual, expected)` inside the script, so the
  expected value is committed to disk before the script runs and the reading
  cannot adapt to the result.
- **A real browser where the UI is the thing under test** (phase C): Chromium
  at 390×844 with a real session, driven through /scan → /scan/review →
  confirm, asserting on the database afterwards. Where the UI is *not* the
  thing under test (phases B, D, E), plain HTTP and direct service calls are
  faster and prove more.
- **Authenticating from a script**: `POST /api/auth/sign-in/email` works, but a
  bare Node `fetch()` must send an explicit `Origin` header or Better Auth
  rejects it with `MISSING_OR_NULL_ORIGIN` — see `docs/guide/auth.md` §4.19.
- **What genuinely could not be automated**, and was handed to the owner: the
  look and one-handed usability of the new screens on localhost. Note this is
  a sanity check, not an aesthetic verdict — the UI keeps evolving.
- **What could not be verified by anyone**, and must be said rather than
  glossed over: the real `claude-opus-5-5` call and the real Vercel Blob
  upload, which need `ANTHROPIC_API_KEY` and `BLOB_READ_WRITE_TOKEN`. In the
  collaudo `/api/extract` was intercepted; the rest of the chain was real.

### Package manager and quality-gate commands

pnpm (Node 22+). The exact commands are already documented once, in
`CONTRIBUTING.md` → "Everyday commands" and `CLAUDE.md` → "Session protocol"
— do not duplicate them here, just note the three relevant for collaudo:

- `node ~/.claude/processi-collaudo.mjs` — collaudo count, **the first gate**: zero collaudo
  trees and forgotten services (the Next `dev` server), or the gates do not start (§ 2).
- `pnpm test` — Vitest, unit/integration.
- `pnpm test:e2e` — Playwright, E2E.

### E2E: Playwright, and how it will authenticate

`playwright.config.ts` has four projects: `mobile` (Chromium, 390×844 mobile
emulation), `desktop` (smoke and accessibility only), `offline-queue` and `pwa`.
Its `webServer` builds and starts a PRODUCTION server (`pnpm build && pnpm start`)
on `http://localhost:3000` (`PORT=<n> pnpm test:e2e` moves it); tests live under
`tests/e2e/`.

Browser tests: workers 4 (Playwright's default on this machine, not measured against other counts) · isolation one local SQLite file shared by the workers, each spec on its own seed user or throwaway rows · whole run 1,6 min on 2026-11-27 (87 tests)

Auth scripting was designed deliberately, specifically so it wouldn't be
improvised session by session:

- **Two** deterministic seed users (credentials in `scripts/seed-users.ts`, the single source of truth
  imported by both `scripts/seed.ts` and `tests/e2e/fixtures/users.ts`) — one
  with a full realistic dataset, one minimal — precisely so the
  own-resource/other's-resource pair required by Part 1 never needs an ad hoc
  disposable account.
- The scriptable session shortcut is confirmed, not assumed: Better Auth's
  own REST route, `POST /api/auth/sign-in/email`, is called directly
  (`tests/e2e/helpers/auth.ts` → `loginViaApi`) instead of driving the
  `/login` form. `tests/e2e/global-setup.ts` logs in both seed users once per
  run and caches `storageState` under `playwright/.auth/` (gitignored; the paths
  are named once, `AUTH_STATE` in `tests/e2e/helpers/auth.ts`) — the
  form is only exercised by the one test that specifically tests the form.
- A throwaway signup account (needed only for the signup-flow test itself,
  not for the isolation pair above) is created the same way, via
  `POST /api/auth/sign-up/email`, and deleted afterward with
  `tests/e2e/helpers/db.ts` → `deleteUserByEmail` (direct DB access, guarded
  the same way `scripts/seed.ts` guards against running against a non-local
  database) — not by hand, per Part 1 obligation 1.

If a future session finds this design doesn't hold up in practice (e.g. the
`webServer`/`globalSetup` ordering assumption turns out wrong for the
installed Playwright version), fix the design itself, not by working around
it ad hoc in a session script.

### Local isolated environment

No Docker/emulator is used or needed. Per `CONTRIBUTING.md` → "Development
setup": set `TURSO_DATABASE_URL=file:local.db` in `.env.local` (no
`TURSO_AUTH_TOKEN` needed against a local file DB), then `pnpm db:migrate` and
`pnpm db:seed`. `scripts/seed.ts` **refuses to run against anything but a
local file DB** (a deliberate seed safety check) and is idempotent-by-wipe,
so it is safe to use as the throwaway
fixture mechanism obligation 1 asks for — prefer extending/reusing it (or a
short-lived script alongside it, deleted after the collaudo) over inventing a
separate fixture path.

### Inspecting real data state (not just page appearance)

`GET /api/export` returns a full JSON export of the authenticated user's own
data and 401s anonymously. It is the primary tool for the "verify on the
database, never on page appearance alone" requirement — call it with the test
session's cookies and assert on the JSON body; the E2E suite does exactly
this. Where the export does not yet surface a column the collaudo needs, a
direct `@libsql/client` query in the throwaway script is the fallback (used,
for example, to reach `ai_confidence`, `promo_kind` and the session
statuses). Drizzle Studio
(`pnpm db:studio`, from `CONTRIBUTING.md`) stays available for eyeballing, but
it is a human tool, not scriptable, so prefer the other two.

### Local paths for the standard's rules

Rule 8 names `doc/guide/dipendenze.md`; this repo keeps its documentation under
`docs/`, so the dependency guide is `docs/guide/dipendenze.md` and any future
`doc/guide/<tema>.md` of the standard lives in `docs/guide/` here. `COMMENTS.md` and
`DEVELOPMENT_GUIDELINES.md` are in the repository root, where the standard
expects them (moved from `docs/` on 2026-10-26).

### Branches

Default and integration branch: **`main`** (confirmed via `git branch -a` —
`origin/main` is the only remote branch; there is no separate `develop`/
`staging`). The per-session branch required by Part 1 obligation 2 should
follow the naming scheme already documented in
`DEVELOPMENT_GUIDELINES.md` → "Branch Naming"
(`feature/…`, `fix/…`, `refactor/…`, `chore/…`, lowercase, hyphen-separated) —
this file doesn't introduce a second scheme.

### Where to annotate a collaudo's outcome, and the session log

Two places, with different jobs.

- **`SESSION_NOTES.md`** (repository root) — a **scratch handoff**, not a
  permanent log. At the end of a session write it with three fixed fields:
  *Cosa* (what was implemented), *Perché* (the reasoning behind the decisions,
  not just the list of changes), *Nota* (gotchas that would cost the next
  person time). Then use it to fold those findings into the durable docs —
  `AGENTS.md` for patterns and gotchas, `CLAUDE.md` for status,
  `Draft Release Temp.md` for anything user-facing — and **delete it**. It is
  never committed. Writing it first is what stops the fold from degenerating
  into a changelog: a diff already shows what changed, and only this step
  captures why a fork in the road was taken. Introduced 2026-08-21.
- **`CLAUDE.md` → "Current status"** — the current state of the codebase, the
  milestone table, and milestone-level collaudo outcomes (per-phase results,
  what was verified and what could not be). Updated in the same commit as the
  milestone, per the instruction in that file.

For a collaudo that doesn't close a whole milestone (a fix, a follow-up), a
`SESSION_NOTES.md` entry plus the PR description is enough; add a line to
`CLAUDE.md`'s status only if it is load-bearing for a future session.
