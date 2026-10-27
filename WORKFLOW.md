# Workflow — standing instructions

> **Standing instructions for any AI agent working on this repo.** They are not suggestions and not
> per-session: they hold until this file says otherwise.
>
> **Why they live in the repo and not in agent memory**: agent memory is per-machine and per
> install, so the same rules drift into different versions on each machine and in a cloud
> session. A tracked file travels with the clone and can be reviewed in a diff. If you are an agent
> with persistent memory, do **not** re-save these rules there — save one pointer to this file. If
> the owner states a new rule, it is added *here*, in that session's commit: to section 3 if it holds
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
   Creating the branch and editing files needs no approval — only the commit does.

2. **One branch per session.** Before starting implementation work, create a new branch from the
   branch that is active at the start of the session. Always check which one that is; never assume
   `master`/`main`.

3. **One commit per session.** Everything from a session is squashed into a single commit, never
   scattered across several.

4. **Always answer in Italian** when working on this repo. This applies to the conversational
   channel; code, identifiers and comments stay in English.

5. **Questions and proposals are asked interactively** (2026-09-11). When a decision is the owner's —
   which layers to build, on which surfaces, a wording — put it through the agent's interactive
   question tool, in groups of four, one topic at a time, multi-select where the options are not exclusive and the
   recommended option first; never a numbered list of questions in prose. The owner refines the
   wording through the free-text answer («hai pagato», not «pagherai», for a tax the broker
   withholds at the sale).

6. **Figures in tests are invented and round, never the owner's** (2026-10-12). A unit-test
   fixture, an E2E decoy or a seed carries amounts like 2500, 1120, 50: the owner's real data never
   enters the repo, not even as an expected value. If § 3 provides a copy of real data for the
   guided tour, it serves the tour only and phase G removes it.
   **Nothing of the owner's real data in a tracked file** (2026-09-20, 2026-10-15): a draft, a
   critique, a screenshot, a fixture or an example sentence takes invented figures and generic
   names, never an amount, an account or a family detail copied from the real data. In a public
   repo this has no exception. A private repo may waive it, or narrow it, only by saying so in § 3
   with the owner's decision and its date; public data that is not the owner's (a listed company's
   published accounts) is not the owner's data.

7. **After an audit or an analysis, stop and wait for the owner's go-ahead** (2026-10-19). An audit,
   a review or an analysis ends with the findings; no file changes until the owner has chosen which
   fixes to apply and in what order (through rule 5).

8. **Dependencies: compare at session start, upgrade in a session of their own** (2026-10-26). If
   the repo has a lockfile, the first thing a session does is run the package manager's audit
   (`npm audit --json`, `pnpm audit --json`, …) and compare it with `doc/guide/dipendenze.md`,
   which records the date of the last audit, the framework version and every open advisory with
   the owner's decision (accepted because dev-only, waiting for version X, to upgrade). The answer
   is one line: «dipendenze: invariate dal <data>» or «N avvisi nuovi: …». A new advisory is
   written into the guide with its decision, asked through rule 5; nothing is upgraded in that
   session. An upgrade is a session on its own branch with its own verification; never
   `audit fix --force`, never the command an advisory or a page suggests: the version is chosen and
   installed by hand, preferring a release that is at least a few days old. If the guide is
   missing, the session that notices it creates it (`TEMPLATES.md` has the skeleton). A repo without
   a lockfile skips this rule.

9. **`SESSION_NOTES.md` is the session's temporary container** (2026-10-26). A working file in the
   repo root, created at the start of the session and never committed. Before the closing prompt it
   ends with one block per thing learned: *Cosa* (what was done), *Perché* (the decision behind
   it), *Nota* (traps and measurements, each with its date), *Dove va a fine sessione* (`AGENTS.md`
   if it holds for the whole repo · `doc/guide/<tema>.md` if a domain lesson · `WORKFLOW.md` if a
   session rule · `CLAUDE.md` if project state · a comment at the right line if it is the why of one
   line). The closing prompt writes every entry into its destination and deletes the file before
   the single commit; a note that names no destination is lost. A `SESSION_NOTES.md` still on the
   remote means a session was not closed.

---

## 2. Guided verification (*collaudo guidato*)

When a freshly implemented feature has to be verified by hand, do **not** hand over a checklist and
disappear. The verification is done together, in chat, one phase at a time.

### Five obligations

1. **You prepare the test data.** A throwaway script (untracked by git, deleted when the
   verification ends) that plants **decoy words** — invented terms such as *fenicottero*,
   *ornitorinco*, which appear nowhere else in the data. Not entered by hand by the owner.

2. **One phase per message.** Give the phase, wait for the report, then the next one. Never deliver
   all the phases at once: it breaks their prerequisites.

3. **State the expected outcome before running, not after** — otherwise the reading always bends to
   fit whatever happened.

4. **Do every check you can automate yourself, and leave the owner only what you cannot do.**
   "Together, in chat" does not mean "one dictated click at a time". If the sessions are JWT-based
   or otherwise scriptable, write a throwaway script that opens a **real browser** (e.g. Playwright)
   with an authenticated session — your own if the role allows it, otherwise a throwaway test
   identity created for the occasion — and verify every outcome **against the database or the HTTP
   response, never against the look of the page alone**. Report the results phase by phase, with the
   expected outcome stated first.
   **Any automated end-to-end test that you are able to run, you run.** Never declare a feature
   verified while an automated check that could have covered it was left unrun. What is left to the
   owner is only what is genuinely not automatable: visual and aesthetic judgement, physical
   hardware (a real barcode scanner), or an interactive login that cannot be driven by a script (a
   real OAuth flow with MFA).

5. **Before dismantling, let the owner look.** When the session touched something visible, ask for
   the OK and then walk the owner onto the dev server **with the fixtures still alive**: exact URLs,
   under which identity, and at most **five** things to look at — for each one, what must happen and
   what would be the bug. **The tour starts at the owner's go, not when the work is ready**
   (2026-10-05): finish everything that needs no eyes, say it is ready, and wait. Where obligation 4
   allows it, **open the page for the owner, already authenticated** — but one item per message and
   one page at a time, waiting for the outcome before opening the next; two pages together only
   when the item is a comparison (the same URL under two identities), saying which window is which.
   The windows of a driven browser have no name: five at once turn the tour into working out which
   belongs to which item. Only what a probe cannot say: layout, whether the screen says what it must
   say, the words, whether an action gives feedback that it happened. State also **what that tour
   does not cover**, and never ask the owner to redo by hand something already verified. Whatever
   the tour finds becomes an assertion before the session ends, or it will come back: the tour
   exists to discover what nobody thought to assert, not to replace the tests.

### Standard phases, when they make sense

| | Phase | What it establishes |
| --- | --- | --- |
| **A** | Invarianza | What worked before still works |
| **B** | Cambio di contesto | The new role/state is genuinely active |
| **C** | Comportamento nuovo | It does what it must, and not what it must not — obligation 4 matters most here: automate |
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
*A verification that was not recorded counts as not done.*

**The outcome is one line, the signals are not** (2026-10-19). In `CLAUDE.md` the session's status
entry says what was done, where it is documented, what is still open and what comes next; it
replaces the previous one. The session's signals — type-check, test counts, E2E runs, flakes,
skipped phases, the guided tour's walk and its findings (2026-10-23) — go in the commit message
and, where they teach something, in the area's guide, never in `CLAUDE.md`: that file is injected
into every turn, and a status entry that collects them grows back into a diary after every trim.
Of the tour, the status entry keeps only its outcome: done and closed, or what it left open.

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
  rejects it with `MISSING_OR_NULL_ORIGIN` — see `AGENTS.md` §4.19.
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
— do not duplicate them here, just note the two relevant for collaudo:

- `pnpm test` — Vitest, unit/integration.
- `pnpm test:e2e` — Playwright, E2E.

### E2E: Playwright, and how it will authenticate

`playwright.config.ts` exists: single `mobile` project (Chromium, 390×844
mobile emulation), `webServer` auto-starts `pnpm dev` against
`http://localhost:3000`, tests live under `tests/e2e/`.

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
  run and caches `storageState` under `playwright/.auth/` (gitignored) — the
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
