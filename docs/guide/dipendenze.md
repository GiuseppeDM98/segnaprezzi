# Dipendenze — audit e decisioni

Regola 8 di `WORKFLOW.md`: a inizio sessione si lancia `pnpm audit --json` e si confronta con questa
tabella. La risposta è una riga: «dipendenze: invariate dal <data>» oppure «N avvisi nuovi: …». Un avviso
nuovo entra qui con la sua decisione; nessun aggiornamento nella stessa sessione. Un aggiornamento è una
sessione a sé, sul suo branch, con versione scelta a mano e almeno qualche giorno di età.

**Ultimo audit: 2026-10-27 (seconda sessione, sul Mac)** · gestore pnpm 11.22 · Node 22.14 · next 16.4.2 · react 19.2.8

`pnpm audit` del 2026-10-26 contava 24 avvisi (1 critico, 11 alti, 10 moderati, 2 bassi). Il
proprietario ha scelto di aggiornare nella stessa sessione (2026-10-27, in deroga alla regola qui
sopra) tutto ciò che è solo dev; dopo gli aggiornamenti restano 6 avvisi (3 alti, 2 moderati, 1
basso), tutti in `zod` e `undici`, con la decisione in tabella.

Il secondo audit del 2026-10-27 ha trovato 4 avvisi nuovi, tutti su `better-auth` 1.7.1 (vedi
riga): il proprietario ha scelto di aggiornare subito, seconda deroga nello stesso giorno, perché
uno era critico e la correzione (1.7.7) era già vecchia di una settimana. Dopo l'aggiornamento
l'audit torna ai 6 avvisi di `zod` e `undici`.

| Pacchetto | Versione installata | Diretto / transitivo | Solo dev | Gravità | Prima versione corretta | Decisione | Data |
|---|---|---|---|---|---|---|---|
| zod | 4.4.3 (diretto) · 4.1.11 (transitivo via @vercel/blob → @vercel/oidc → @vercel/cli-config) | diretto | no | alta (GHSA-mrhx-c7xc-m3w5, esaurimento memoria su collezioni vincolate sovradimensionate) | 4.6.6 | accettato per ora (proprietario): gli schemi del repo non validano collezioni grandi da input esterno; si rivaluta al prossimo audit | 2026-10-27 |
| undici | 6.28.0 | transitivo (@vercel/blob 2.8.0) | no (lato server) | alta ×3, moderata ×2, bassa (DoS WebSocket/EventSource, response splitting) | 6.29.1 | in attesa (proprietario): si risolve con l'aggiornamento di @vercel/blob; verificare a ogni audit | 2026-10-27 |
| happy-dom | 21.0.4 (era 15.11.7) | diretto | sì | era critica (GHSA-37j7-fg3j-429f, VM escape) + alta ×2 | 20.8.9 | aggiornato 2026-10-27: major 15 → 21, nessun test da adattare | 2026-10-27 |
| vitest · @vitest/mocker | 4.1.12 (era 4.1.11) | diretto · transitivo | sì | era moderata ×2 (mock registration) | 4.1.12 | aggiornato 2026-10-27 (vitest 5 disponibile, non preso: major) | 2026-10-27 |
| vite | 8.3.5 (era 8.2.2) | transitivo (vitest) | sì | era alta ×1, moderata ×4, bassa ×1 | 8.2.4 | aggiornato 2026-10-27 con override `vite: ^8.3.5` in pnpm-workspace.yaml | 2026-10-27 |
| esbuild | 0.25.12 · 0.28.2 (la 0.18.20 di @esbuild-kit via drizzle-kit è sostituita) | transitivo | sì | era moderata (GHSA-67mh-4wv8-2f99, dev server) | 0.24.3 | aggiornato 2026-10-27 con override `esbuild@<0.24.3: ^0.25.12`; `drizzle-kit check` verde | 2026-10-27 |
| browserslist | 4.29.4 (era 4.28.6, pin esatto di @serwist/utils) | transitivo (build) | sì | era alta ×2 (OOM, stats non fidate) | 4.28.7 | aggiornato 2026-10-27 con override `browserslist: ^4.29.4` | 2026-10-27 |
| brace-expansion | 5.0.12 (era 5.0.9) | transitivo | sì | era alta ×2, moderata | 5.0.12 | aggiornato 2026-10-27 (`pnpm update --depth Infinity`) | 2026-10-27 |
| source-map-js | 1.2.2 (era 1.2.1) | transitivo (postcss) | sì | era alta (DoS event loop) | 1.2.2 | aggiornato 2026-10-27 (`pnpm update --depth Infinity`) | 2026-10-27 |
| drizzle-kit | 0.31.11 (era 0.31.10) | diretto | sì | — | — | patch presa insieme agli altri, 2026-10-27 | 2026-10-27 |
| better-auth | 1.7.12 (era 1.7.1) | diretto | no | era critica (GHSA-965c-763c-88jm, stato OAuth usabile come magic link) + alta (GHSA-r4xp-prcw-77qf, OAuth Proxy) + bassa ×2 (GHSA-44jh-23m7-hpcf, rate limit su PostgreSQL) | 1.7.7 | aggiornato 2026-10-27 in deroga (proprietario). L'app usa solo email+password su SQLite, quindi nessuno dei quattro era sfruttabile qui, ma il critico non si lascia in tabella. Conseguenza non annunciata dall'advisory: dalla 1.7.12 l'adapter Drizzle rifiuta di partire con la colonna `accounts.issuer` NOT NULL che la 1.7.1 esigeva — rimossa con la migrazione 0002 (AGENTS.md §4.69) | 2026-10-27 |

## Override in `pnpm-workspace.yaml`

Le tre override (`vite`, `browserslist`, `esbuild@<0.24.3`) esistono solo perché i genitori tengono
ferma una versione vulnerabile: vitest 4.1 risolve vite 8.2, @serwist/utils 9.5.12 fissa browserslist
esattamente a 4.28.6, drizzle-kit porta ancora @esbuild-kit (esbuild ~0.18). Ogni override va tolta
quando il genitore si muove da solo: a ogni audit, `pnpm why <pacchetto>` dice se serve ancora.
pnpm 11 legge le override da `pnpm-workspace.yaml`, non dal campo `pnpm` di `package.json`.
