# WORKFLOW.md — regole di sessione e collaborazione

Questo file contiene lo standard portabile di collaborazione per questo repo
(Parte 1) e il modo in cui si applica concretamente qui, con comandi e
strumenti reali (Parte 2). Non duplica le convenzioni già documentate altrove
(stile, commit, branch naming, test) — quando esistono, questo file le
richiama invece di riscriverle.

Se in una sessione futura viene enunciata una nuova regola di lavoro, va
aggiunta qui, nel commit di quella sessione.

---

## Parte 1 — Standard portabile

REGOLE DI SESSIONE E COLLABORAZIONE

1. Mai fare commit senza approvazione esplicita. Non eseguire `git commit` (né
   `--amend`) finché non do io l'OK per quel commit specifico. Finisci il lavoro,
   riassumi il diff, poi chiedi. Creare il branch e modificare i file non richiede
   approvazione — solo il commit.

2. Un branch per sessione. Prima di iniziare lavoro di implementazione, crea un
   nuovo branch a partire dal branch attivo all'inizio della sessione (controlla
   sempre quale sia, non dare per scontato master/main).

3. Un solo commit per sessione. Tutte le modifiche di una sessione vanno squashate
   in un unico commit, non sparse su più commit.

4. Rispondi sempre in italiano quando lavori su questo repo (vale per il canale
   conversazionale — codice, identificatori e commenti restano in inglese).

REGOLA DEL COLLAUDO GUIDATO

Quando dobbiamo verificare manualmente che una funzionalità appena implementata
funzioni, non consegnare una checklist e sparire. Il collaudo si fa insieme, in
chat, una fase alla volta. Quattro obblighi:

1. I dati di prova li prepari tu — uno script usa-e-getta (non tracciato da git,
   cancellato a fine collaudo) con "parole spia" (parole inventate tipo fenicottero,
   ornitorinco, che non compaiono da nessun'altra parte nell'archivio), non a mano
   da parte mia.
2. Una fase per messaggio — dai la fase, aspetta il mio resoconto, poi la
   successiva. Mai consegnare tutte le fasi insieme: fa saltare i prerequisiti.
3. Dichiara l'esito atteso prima di eseguire, non dopo — altrimenti la lettura si
   adatta sempre a quello che è successo.
4. Fai tu ogni controllo che riesci ad automatizzare, e lasciami solo quello che non
   puoi fare. "Insieme, in chat" non vuol dire "un click alla volta dettato a me":
   se le sessioni sono JWT o comunque scriptabili, scrivi uno script usa-e-getta che
   apre un vero browser (es. Playwright) con una sessione autenticata — la tua stessa
   se il ruolo lo permette, altrimenti un'identità di prova usa-e-getta creata per
   l'occasione — e verifica ogni esito sul database o sulla risposta HTTP, mai sul
   solo aspetto della pagina. Riportami i risultati fase per fase, con l'esito atteso
   dichiarato prima. Ogni test end-to-end automatico che sei in grado di eseguire, lo
   esegui: non dichiarare mai una funzionalità verificata se un controllo automatico
   che poteva coprirla è rimasto non eseguito. Lascia a me solo ciò che è genuinamente
   non automatizzabile: giudizio visivo/estetico, hardware fisico (es. uno scanner di
   barcode reale), o un login interattivo che non si può guidare da script (es. un
   vero flusso OAuth con MFA).

Fasi standard da seguire quando ha senso: A-Invarianza (quello che c'era prima
funziona ancora) → B-Cambio di contesto (il ruolo/stato nuovo è davvero attivo) →
C-Comportamento nuovo (fa quello che deve, non quello che non deve — qui vale di più
il punto 4: automatizza) → D-Sotto la UI (le stesse regole reggono chiamando la route
a mano) → E-Casi negativi (chi non ha diritti viene respinto, con l'errore giusto) →
F-Ripristino (configurazione ripristinata, fixture rimosse, script cancellato).

Un test negativo da solo non prova un guard di sicurezza: serve sempre la coppia
risorsa-propria (controllo positivo, deve riuscire) / risorsa-altrui (il test, deve
fallire), con lo stesso identico file/dato. Chiusura del collaudo: ripristinare
eventuali config modificate, rimuovere fixture e allegati di prova, cancellare lo
script, e annotare l'esito da qualche parte che sopravvive alla sessione (CLAUDE.md
o equivalente) — un collaudo non annotato vale come non fatto.

---

## Part 2 — How this applies in this repo

*(Written in English to match the language of the rest of this repo's
documentation — `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/`. This is
the only local, repo-specific section; Part 1 above is the portable standard
and stays in the language it was given in.)*

### Current state: automatable, and exercised

Superseded on 2026-08-21, the first time a real collaudo ran against running
code (Spec 03 — Capture & AI Extraction). This section previously said the
repository contained no application code and that obligation 4 of the Collaudo
Guidato rule could not be honored. Both are now false: Specs 01–03 are
implemented, and the Spec 03 collaudo was executed in six phases with 63
automated checks plus the full E2E suite. Evidence, with the per-phase results,
is recorded in `CLAUDE.md` → "Current status" → *Collaudo guidato (2026-08-21)*.

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
  a sanity check, not an aesthetic verdict — Spec 05 redesigns those screens.
- **What could not be verified by anyone**, and must be said rather than
  glossed over: the real `claude-haiku-4-5` call and the real Vercel Blob
  upload, which need `ANTHROPIC_API_KEY` and `BLOB_READ_WRITE_TOKEN`. In the
  collaudo `/api/extract` was intercepted; the rest of the chain was real.

### Package manager and quality-gate commands

pnpm (Node 22+). The exact commands are already documented once, in
`CONTRIBUTING.md` → "Everyday commands" and `CLAUDE.md` §5.5 — do not
duplicate them here, just note the two relevant for collaudo once Spec 01
lands:

- `pnpm test` — Vitest, unit/integration.
- `pnpm test:e2e` — Playwright, E2E.

### E2E: Playwright, and how it will authenticate

`playwright.config.ts` exists and follows `docs/specs/01-foundation.md` §10:
single `mobile` project (Chromium, 390×844 mobile emulation), `webServer`
auto-starts `pnpm dev` against `http://localhost:3000`, tests live under
`tests/e2e/`.

Auth scripting is implemented as Spec 02 §10.3 specifies (that design was
added specifically so it wouldn't be improvised session by session):

- `docs/specs/02-database-auth.md` §8.2/§8.4 define **two** deterministic seed
  users (credentials in `scripts/seed-users.ts`, the single source of truth
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
`webServer`/`globalSetup` ordering assumption noted in Spec 02 §10.3 turns
out wrong for the installed Playwright version), fix it in Spec 02 itself,
not by working around it ad hoc in a session script.

### Local isolated environment

No Docker/emulator is used or needed. Per `CONTRIBUTING.md` → "Development
setup": set `TURSO_DATABASE_URL=file:local.db` in `.env.local` (no
`TURSO_AUTH_TOKEN` needed against a local file DB), then `pnpm db:migrate` and
`pnpm db:seed`. `scripts/seed.ts` is specified to **refuse to run against
anything but a local file DB** (`docs/specs/02-database-auth.md`, seed safety
check) and to be idempotent-by-wipe, so it is safe to use as the throwaway
fixture mechanism obligation 1 asks for — prefer extending/reusing it (or a
short-lived script alongside it, deleted after the collaudo) over inventing a
separate fixture path.

### Inspecting real data state (not just page appearance)

`GET /api/export` (`docs/specs/02-database-auth.md` §9) returns a full JSON
export of the authenticated user's own data and 401s anonymously. It is the
primary tool for the "verify on the database, never on page appearance alone"
requirement — call it with the test session's cookies and assert on the JSON
body; the E2E suite does exactly this. Where the export does not yet surface a
column the collaudo needs, a direct `@libsql/client` query in the throwaway
script is the fallback (this is what the Spec 03 collaudo used, to reach
`ai_confidence`, `promo_kind` and the session statuses). Drizzle Studio
(`pnpm db:studio`, from `CONTRIBUTING.md`) stays available for eyeballing, but
it is a human tool, not scriptable, so prefer the other two.

### Branches

Default and integration branch: **`main`** (confirmed via `git branch -a` —
`origin/main` is the only remote branch; there is no separate `develop`/
`staging`). The per-session branch required by Part 1 obligation 2 should
follow the naming scheme already documented in
`docs/DEVELOPMENT_GUIDELINES.md` → "Branch Naming"
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
