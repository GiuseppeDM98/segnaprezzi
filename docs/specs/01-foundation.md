# Spec 01 — Foundation & Scaffold

> **Status**: Approved · **Last updated**: 2026-08-20
> **Depends on**: — (first implementation spec)
> **Contract**: [`docs/specs/00-overview.md`](./00-overview.md). This spec elaborates; it never contradicts.

---

## 1. Goal & Scope

Scaffold the segnaprezzi app so that Specs 02–06 have rails to run on: a Next.js 16
App Router project with pnpm, Biome, TypeScript strict mode, the canonical folder
layout, environment validation, next-intl routing (`it` + `en`), the theming
foundation, error primitives, the testing rig (Vitest + Playwright), CI, and a
deployable Vercel target.

**In scope**: everything above, plus a single placeholder page proving the i18n and
theming pipelines work end to end.

**Out of scope** (explicitly): database, auth, any schema (Spec 02); camera, AI
extraction (Spec 03); inflation math (Spec 04); real UI, design system, navigation
(Spec 05); PWA/offline (Spec 06). No feature code lands here — only rails.

---

## 2. Scaffolding

### Prerequisites

- **Node 22+** (required — the codebase uses `import.meta.dirname`, available since Node 20.11/22).
- **pnpm 10** (`corepack enable` or standalone install).

### create-next-app invocation

`create-next-app` refuses to scaffold into a directory containing unknown files, and
this repo already contains `docs/` and `.gitignore`. Scaffold into a **temporary
sibling directory**, then merge into the repo root.

From the repo's **parent** directory:

```bash
pnpm dlx create-next-app@latest segnaprezzi-scaffold \
  --typescript \
  --app \
  --src-dir \
  --tailwind \
  --turbopack \
  --import-alias "@/*" \
  --use-pnpm
```

Answer any remaining interactive prompts exactly like this:

| Prompt | Answer |
|---|---|
| TypeScript? | **Yes** |
| Linter (ESLint / Biome / None)? | **Biome** if offered; otherwise **No ESLint** |
| Tailwind CSS? | **Yes** |
| `src/` directory? | **Yes** |
| App Router? | **Yes** |
| Turbopack? | **Yes** (default bundler in Next 16 anyway) |
| Import alias? | **Yes**, `@/*` |

ESLint is never installed: Biome replaces both ESLint and Prettier. If the scaffold
generates a `biome.json`, it is **overwritten** by the canonical config in §3.

### Cleanup & merge steps

1. Delete `segnaprezzi-scaffold/.git` (the real repo already has one) and
   `segnaprezzi-scaffold/README.md` (the project README is authored separately).
2. Move everything else from `segnaprezzi-scaffold/` into the repo root
   (`package.json`, `pnpm-lock.yaml`, `next.config.ts`, `tsconfig.json`,
   `postcss.config.mjs`, `src/`, `public/`, `.gitignore`, dotfiles). Delete the
   empty temp directory.
3. Merge `.gitignore`: keep the scaffold's Next.js entries and ensure these lines
   are present:

   ```gitignore
   # Environment — never commit secrets (see DEVELOPMENT_GUIDELINES.md, Security Baseline)
   .env*
   !.env.example

   # Local SQLite database (Spec 02)
   local.db*

   # Test artifacts
   /coverage/
   /test-results/
   /playwright-report/
   ```

4. Delete the demo assets: `public/next.svg`, `public/vercel.svg`, `public/file.svg`,
   `public/globe.svg`, `public/window.svg`, and the scaffold's `src/app/favicon.ico`
   demo icon may stay until Spec 06 replaces it.
5. Remove the Geist font wiring from the scaffold layout. Until Spec 05 defines
   typography in `DESIGN.md`, the app uses the system font stack (Tailwind default).
6. Restructure `src/app/` for i18n (§7): the scaffold's `layout.tsx`/`page.tsx`
   move under `src/app/[locale]/`, with `globals.css` staying at `src/app/globals.css`.
7. Pin the toolchain in `package.json` and add a `.node-version` file:

   ```jsonc
   // package.json (additions)
   {
     "engines": { "node": ">=22" },
     "packageManager": "pnpm@10.x.y" // exact current pnpm 10 version at implementation time
   }
   ```

   ```
   # .node-version
   22
   ```

8. Run `pnpm install` from the repo root and verify `pnpm dev` boots.

### Dependencies installed by this spec

| Kind | Packages |
|---|---|
| dependencies | `next`, `react`, `react-dom` (scaffold) · `next-intl` · `zod` |
| devDependencies | `typescript`, `@types/*`, `tailwindcss`, `@tailwindcss/postcss` (scaffold) · `@biomejs/biome` · `vitest` · `happy-dom` · `@playwright/test` · `tsx` |

`tsx` is a devDependency from day one so the `db:seed`, `icons`, and `istat:update`
scripts (later specs) run without further setup. Nothing else is installed now —
Drizzle/Turso/Better Auth arrive in Spec 02, the Anthropic SDK, `@vercel/blob`,
and `dexie` in Spec 03, `motion` and `lucide-react` in Spec 05, Serwist and
`dexie-react-hooks` in Spec 06.

---

## 3. Biome

Single tool for linting, formatting, and import organization. Canonical
`biome.json` at the repo root (replace any scaffold-generated one):

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.0/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    },
    "domains": {
      "next": "recommended",
      "react": "recommended",
      "test": "recommended"
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always"
    }
  }
}
```

Notes:

- `vcs.useIgnoreFile: true` makes Biome respect `.gitignore` (`.next/`,
  `node_modules/`, `coverage/`, etc.) — no duplicate ignore lists.
- The `next`, `react`, and `test` domains enable framework-aware recommended rules.
- Style decisions (project-wide, fixed): 2-space indent, 100-column lines, single
  quotes, always semicolons. Do not relitigate these in later specs.
- Update the `$schema` version to match the installed `@biomejs/biome`.

Scripts wiring: `lint` runs `biome check .` (lint + format check + import order);
`lint:fix` runs `biome check --write .`. CI uses `biome ci .` (§11), which is the
same check in CI-optimized mode.

---

## 4. Canonical `package.json` Scripts

This exact list is the **project contract**. Scripts marked with a later spec are
*not* stubbed now — each spec adds its own rows when it lands. Never rename these.

| Script | Command | Introduced by |
|---|---|---|
| `dev` | `next dev` | 01 |
| `build` | `next build` | 01 |
| `start` | `next start` | 01 |
| `lint` | `biome check .` | 01 |
| `lint:fix` | `biome check --write .` | 01 |
| `typecheck` | `tsc --noEmit` | 01 |
| `test` | `vitest run` | 01 |
| `test:watch` | `vitest` | 01 |
| `test:e2e` | `playwright test` | 01 |
| `db:generate` | `drizzle-kit generate` | 02 |
| `db:migrate` | `drizzle-kit migrate` | 02 |
| `db:studio` | `drizzle-kit studio` | 02 |
| `db:seed` | `tsx --env-file=.env.local scripts/seed.ts` | 02 |
| `auth:generate` | `pnpm dlx @better-auth/cli@^1.7.0 generate --yes` | 02 |
| `istat:update` | `tsx scripts/update-istat.ts` | 04 |
| `icons` | `tsx scripts/generate-icons.ts` | 06 |

Turbopack is the default bundler in Next 16, so `dev`/`build` need no extra flags;
if the scaffold emits `--turbopack` flags, keep them — they are equivalent.

---

## 5. Folder Structure

Planned layout from 00-overview §10, annotated with what Spec 01 creates:

```
segnaprezzi/
├── docs/                          # exists (specs, guidelines, assets)
├── data/                          # 01: empty + .gitkeep   (istat-nic.json → Spec 04)
├── scripts/                       # 01: empty + .gitkeep   (seed/istat/icons → 02/04/06)
├── messages/
│   ├── it.json                    # 01: seed namespaces (§7)
│   └── en.json                    # 01: seed namespaces (§7)
├── public/                        # 01: cleaned of demo assets (PWA icons → Spec 06)
├── src/
│   ├── app/
│   │   ├── globals.css            # 01: Tailwind 4 + theme tokens (§8)
│   │   └── [locale]/
│   │       ├── layout.tsx         # 01: root layout, theme script, intl provider (§7–8)
│   │       └── page.tsx           # 01: placeholder dashboard shell (real one → Spec 05)
│   ├── components/
│   │   ├── ui/                    # 01: empty + .gitkeep   (primitives → Spec 05)
│   │   ├── charts/                # 01: empty + .gitkeep   (→ Spec 05)
│   │   ├── capture/               # 01: empty + .gitkeep   (→ Spec 03)
│   │   └── layout/                # 01: empty + .gitkeep   (→ Spec 05)
│   ├── lib/
│   │   ├── domain/                # 01: empty + .gitkeep   (categories/units/money → Spec 02)
│   │   ├── inflation/             # 01: empty + .gitkeep   (→ Spec 04)
│   │   ├── db/                    # 01: empty + .gitkeep   (→ Spec 02)
│   │   ├── services/              # 01: empty + .gitkeep   (→ Spec 02+)
│   │   ├── ai/                    # 01: empty + .gitkeep   (→ Spec 03)
│   │   ├── blob/                  # 01: empty + .gitkeep   (→ Spec 03)
│   │   ├── offline/               # 01: empty + .gitkeep   (→ Spec 06)
│   │   ├── auth/                  # 01: empty + .gitkeep   (→ Spec 02)
│   │   ├── i18n/
│   │   │   ├── routing.ts         # 01 (§7)
│   │   │   ├── request.ts         # 01 (§7)
│   │   │   └── navigation.ts      # 01 (§7)
│   │   ├── env.ts                 # 01 (§6)
│   │   ├── errors.ts              # 01 (§9)
│   │   └── errors.test.ts         # 01 (§10)
│   └── middleware.ts              # 01 (§7)
├── tests/
│   └── e2e/
│       └── smoke.spec.ts          # 01 (§10)
├── .github/workflows/ci.yml       # 01 (§11)
├── .env.example                   # 01 (§6)
├── .node-version                  # 01 (§2)
├── biome.json                     # 01 (§3)
├── next.config.ts                 # 01 (§7)
├── vitest.config.ts               # 01 (§10)
├── playwright.config.ts           # 01 (§10)
├── tsconfig.json                  # scaffold (strict mode on, paths @/* → ./src/*)
└── package.json                   # 01 (§4 scripts, engines, packageManager)
```

Empty directories get a `.gitkeep` so the canonical layout is visible in the repo
from the first commit — later specs fill them and remove the placeholder. Do not
create files inside them "to have something there".

Naming conventions inside `src/` (from `docs/DEVELOPMENT_GUIDELINES.md`):
kebab-case filenames (`sync-manager.ts`), verb+noun function names, `is`/`has`/
`can`/`should` boolean prefixes, plural collections, colocated unit tests
(`foo.ts` + `foo.test.ts`).

---

## 6. Environment Validation

Modules never read `process.env` directly. Everything goes through the typed,
validated `env` object. Covers exactly the table in 00-overview §11.

### `src/lib/env.ts`

```ts
import { z } from 'zod';

/*
 * Environment validation (docs/specs/00-overview.md §11).
 *
 * Design: every environment variable the app reads is declared here and
 * nowhere else. Modules import the typed `env` object instead of touching
 * `process.env`, so a missing or malformed variable crashes at startup
 * with a readable report instead of failing later at request time.
 *
 * This module is imported by server code AND by CLI tooling
 * (drizzle.config.ts and scripts/* in later specs). Do not add the
 * `server-only` package here — it throws outside the Next.js runtime and
 * would break drizzle-kit and tsx. The safeguard against client-side
 * imports is that `process.env` secrets are simply undefined in the
 * browser bundle, which makes parsing fail loudly during development.
 */

const envSchema = z
  .object({
    // libSQL URL: `file:local.db` in development, `libsql://…` on Turso.
    TURSO_DATABASE_URL: z.string().min(1),
    TURSO_AUTH_TOKEN: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32, 'Generate with: openssl rand -base64 32'),
    BETTER_AUTH_URL: z.url(),
    BLOB_READ_WRITE_TOKEN: z.string().min(1),
    SIGNUP_ENABLED: z.enum(['true', 'false']).default('true'),
  })
  .superRefine((vars, ctx) => {
    // Why: the auth token is optional only because local file databases
    // don't need one. A remote Turso URL without a token fails with an
    // opaque libSQL error at first query, so we catch it here instead.
    if (vars.TURSO_DATABASE_URL.startsWith('libsql://') && !vars.TURSO_AUTH_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['TURSO_AUTH_TOKEN'],
        message: 'Required when TURSO_DATABASE_URL points to a remote Turso database',
      });
    }
  })
  .transform((vars) => ({
    ...vars,
    // Booleans cross the env boundary as strings; convert exactly once, here.
    SIGNUP_ENABLED: vars.SIGNUP_ENABLED === 'true',
  }));

/**
 * Parse and validate `process.env` against the schema above.
 *
 * Returns the typed, transformed environment object.
 * Throws an Error listing every invalid or missing variable — the process
 * must not start with a broken environment (fail fast).
 */
function parseEnv(): z.infer<typeof envSchema> {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}

export const env = parseEnv();

export type Env = typeof env;
```

Validation runs at module import. In Spec 01 nothing imports `env.ts` yet, so a
missing `.env.local` does not block `pnpm dev`; from Spec 02 on (db client, auth config)
the fail-fast guarantee is active on every boot. The module still lands now, fully
tested by `pnpm typecheck`, so later specs only import it.

### `.env.example`

```bash
# Copy to .env.local and fill in. Never commit .env.local (enforced via .gitignore).

# Turso — use a local SQLite file in development
TURSO_DATABASE_URL="file:local.db"
# Required only for remote libsql:// URLs
TURSO_AUTH_TOKEN=""

# Anthropic — Claude Haiku 4.5 price-tag extraction (Spec 03)
ANTHROPIC_API_KEY=""

# Better Auth — generate the secret with: openssl rand -base64 32
BETTER_AUTH_SECRET=""
BETTER_AUTH_URL="http://localhost:3000"

# Vercel Blob — auto-set when a Blob store is connected on Vercel;
# create a store and copy a token for local development
BLOB_READ_WRITE_TOKEN=""

# Set to "false" to close registration (default: open)
SIGNUP_ENABLED="true"
```

---

## 7. next-intl Setup

Locales `['it', 'en']`, default `it`, `localePrefix: 'as-needed'` — Italian is
served at `/` with no prefix, English under `/en`. All app routes live under the
`[locale]` segment per 00-overview §9.

**Rule (project-wide, non-negotiable): NO hardcoded UI strings, ever.** Every
user-visible string goes through next-intl messages in **both** `messages/it.json`
and `messages/en.json`, from the very first placeholder page. The only exception
is the brand name "segnaprezzi" itself, which is never translated (it still lives
in `common.appName` so components have one source for it). Reviewers reject any PR
with literal UI text in JSX.

### `src/lib/i18n/routing.ts`

```ts
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['it', 'en'],
  defaultLocale: 'it',
  // Why: 'as-needed' keeps Italian URLs clean (`/products`, not `/it/products`)
  // while English remains fully addressable under `/en/*`.
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
```

### `src/lib/i18n/request.ts`

```ts
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../../messages/${locale}.json`)).default,
  };
});
```

### `src/lib/i18n/navigation.ts`

```ts
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Guide: always import Link, redirect, usePathname, useRouter, getPathname
// from this module — never from next/link or next/navigation directly —
// so every navigation is locale-aware.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
```

### `src/middleware.ts`

```ts
import createMiddleware from 'next-intl/middleware';
import { routing } from '@/lib/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals, and static files (any path with a dot).
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
```

Next 16 note: Next 16 renames `middleware.ts` to `proxy.ts`; the old name still
works. The contract (00-overview §10) names `src/middleware.ts`, so this project
keeps `middleware.ts`. If a future Next release drops support, update 00-overview
first, then rename.

### `next.config.ts`

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Why: the request config lives under src/lib/i18n (00-overview §10), not the
// plugin's default src/i18n, so the path must be passed explicitly.
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
```

### `src/app/[locale]/layout.tsx`

Acts as the root layout (there is no `src/app/layout.tsx`). Includes the theme
no-flash script from §8.

```tsx
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { routing } from '@/lib/i18n/routing';
import '../globals.css';

// Brand name, never translated — not a UI string.
export const metadata = { title: 'segnaprezzi' };

/*
 * Why: the `.dark` class must be on <html> before first paint or dark-mode
 * users see a white flash. This inline script runs pre-hydration and reads
 * the `theme` cookie (written by Settings, Spec 05: "dark" | "light";
 * absent = follow the OS). `suppressHydrationWarning` on <html> is required
 * because the server cannot know which class the script will add.
 */
const themeInitScript = `(() => {
  var match = document.cookie.match(/(?:^|; )theme=(dark|light)/);
  var theme = match ? match[1] : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  if (theme === "dark") document.documentElement.classList.add("dark");
})();`;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static constant above, no user input */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-background text-text antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

### `src/app/[locale]/page.tsx` (placeholder)

Proves i18n + tokens end to end; replaced by the real dashboard in Spec 05.

```tsx
import { useTranslations } from 'next-intl';

export default function DashboardPage() {
  const t = useTranslations('dashboard');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="font-semibold text-2xl">{t('title')}</h1>
      <p className="text-text-muted">{t('emptyState')}</p>
    </main>
  );
}
```

### Message files — seed namespace skeleton

One namespace per route/domain area. All eighteen namespaces exist from day one
— several as empty placeholders (`productDetail`, `offline`, `categories`,
`units`, `pwa`) — so later specs add keys instead of inventing structure.
Keys inside `errors` are the `DomainErrorCode` values from §9 — the UI translates
an error by its code.

`messages/it.json`:

```json
{
  "common": {
    "appName": "segnaprezzi",
    "loading": "Caricamento…",
    "save": "Salva",
    "cancel": "Annulla",
    "confirm": "Conferma",
    "delete": "Elimina",
    "retry": "Riprova"
  },
  "nav": {
    "home": "Home",
    "products": "Prodotti",
    "scan": "Scansiona",
    "history": "Cronologia",
    "settings": "Impostazioni"
  },
  "dashboard": {
    "title": "La tua inflazione",
    "emptyState": "Fotografa il tuo primo segnaprezzi per iniziare"
  },
  "scan": {
    "title": "Spesa in corso"
  },
  "review": {
    "title": "Rivedi le rilevazioni"
  },
  "addManual": {
    "title": "Aggiungi prezzo"
  },
  "addFuel": {
    "title": "Rifornimento"
  },
  "products": {
    "title": "Prodotti",
    "searchPlaceholder": "Cerca un prodotto"
  },
  "productDetail": {},
  "history": {
    "title": "Cronologia"
  },
  "stores": {
    "title": "Punti vendita"
  },
  "settings": {
    "title": "Impostazioni",
    "language": "Lingua",
    "theme": "Tema"
  },
  "auth": {
    "login": "Accedi",
    "signup": "Registrati",
    "email": "Email",
    "password": "Password",
    "logout": "Esci"
  },
  "errors": {
    "NOT_FOUND": "Elemento non trovato",
    "VALIDATION_FAILED": "Controlla i dati inseriti",
    "UNAUTHORIZED": "Accedi per continuare",
    "EXTRACTION_FAILED": "Non sono riuscito a leggere il cartellino",
    "INTERNAL": "Qualcosa è andato storto, riprova"
  },
  "offline": {},
  "categories": {},
  "units": {},
  "pwa": {}
}
```

`messages/en.json`:

```json
{
  "common": {
    "appName": "segnaprezzi",
    "loading": "Loading…",
    "save": "Save",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "delete": "Delete",
    "retry": "Retry"
  },
  "nav": {
    "home": "Home",
    "products": "Products",
    "scan": "Scan",
    "history": "History",
    "settings": "Settings"
  },
  "dashboard": {
    "title": "Your inflation",
    "emptyState": "Photograph your first price tag to get started"
  },
  "scan": {
    "title": "Shopping in progress"
  },
  "review": {
    "title": "Review entries"
  },
  "addManual": {
    "title": "Add price"
  },
  "addFuel": {
    "title": "Fuel stop"
  },
  "products": {
    "title": "Products",
    "searchPlaceholder": "Search for a product"
  },
  "productDetail": {},
  "history": {
    "title": "History"
  },
  "stores": {
    "title": "Stores"
  },
  "settings": {
    "title": "Settings",
    "language": "Language",
    "theme": "Theme"
  },
  "auth": {
    "login": "Log in",
    "signup": "Sign up",
    "email": "Email",
    "password": "Password",
    "logout": "Log out"
  },
  "errors": {
    "NOT_FOUND": "Item not found",
    "VALIDATION_FAILED": "Please check what you entered",
    "UNAUTHORIZED": "Log in to continue",
    "EXTRACTION_FAILED": "Could not read the price tag",
    "INTERNAL": "Something went wrong, please try again"
  },
  "offline": {},
  "categories": {},
  "units": {},
  "pwa": {}
}
```

---

## 8. Theming Foundation

Tailwind 4, CSS-first configuration — no `tailwind.config.ts`. Semantic tokens are
CSS custom properties, remapped by a `.dark` class on `<html>`.

> **Placeholder palette.** The values below exist only so Specs 02–04 can build
> against the token *names*. The final palette, typography, and full design
> language are owned by **Spec 05 / `DESIGN.md`**. Spec 05 may change values and
> **add** new tokens (e.g. `--color-promo`, `--color-focus`), but it never
> renames any of these eleven. The one fixed point is the brand accent seed
> **`#EA580C`** (from `docs/assets/logo.svg`), expressed here in OKLCH.

### `src/app/globals.css`

```css
@import 'tailwindcss';

/*
 * Design: theme tokens (docs/specs/01-foundation.md §8).
 *
 * Two layers:
 *  1. Raw custom properties on :root / .dark hold the actual colors and
 *     flip with the theme.
 *  2. @theme inline maps them to Tailwind color tokens, generating the
 *     utilities the app uses (bg-background, text-text-muted, border-border,
 *     bg-accent, …).
 *
 * Components use ONLY semantic utilities — never raw hex/oklch values, never
 * Tailwind palette colors (bg-orange-600 is a review rejection).
 *
 * PLACEHOLDER VALUES — final palette owned by Spec 05 / DESIGN.md.
 * `positive` = favorable movement (e.g. a price drop), `negative` =
 * unfavorable (a price rise); the exact perceptual mapping is Spec 05's call.
 */

/* Dark theme applies when .dark is on <html> — set pre-paint by the theme
 * script in src/app/[locale]/layout.tsx (cookie, OS-preference fallback). */
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: oklch(98.4% 0.003 75);
  --surface: oklch(100% 0 0);
  --surface-raised: oklch(96.2% 0.004 75);
  --text: oklch(21% 0.01 75);
  --text-muted: oklch(50% 0.01 75);
  --accent: oklch(64.6% 0.222 41.116); /* #EA580C — brand seed, logo.svg */
  --accent-contrast: oklch(98.5% 0.01 41);
  --positive: oklch(62.7% 0.194 149.214);
  --negative: oklch(57.7% 0.245 27.325);
  --warning: oklch(66.6% 0.179 58.318);
  --border: oklch(90% 0.005 75);
}

.dark {
  --background: oklch(17% 0.005 75);
  --surface: oklch(21% 0.006 75);
  --surface-raised: oklch(25% 0.008 75);
  --text: oklch(95% 0.005 75);
  --text-muted: oklch(65% 0.01 75);
  --accent: oklch(70% 0.19 45);
  --accent-contrast: oklch(20% 0.05 45);
  --positive: oklch(72.3% 0.219 149.579);
  --negative: oklch(63.7% 0.237 25.331);
  --warning: oklch(76.9% 0.188 70.08);
  --border: oklch(30% 0.008 75);
}

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-accent: var(--accent);
  --color-accent-contrast: var(--accent-contrast);
  --color-positive: var(--positive);
  --color-negative: var(--negative);
  --color-warning: var(--warning);
  --color-border: var(--border);
}

body {
  background-color: var(--color-background);
  color: var(--color-text);
}
```

### Dark-mode mechanics

- **Source of truth**: `theme` cookie — `"dark"` | `"light"`; absent means "follow
  the OS". Written by the Settings page (Spec 05); Spec 01 ships only the reader.
- **No-flash**: the inline `<script>` in `[locale]/layout.tsx` (§7) runs before
  first paint, so the correct class is present before any pixel renders.
- **No CSS-only fallback**: a `prefers-color-scheme` media block is intentionally
  omitted — the script already covers the OS preference, and duplicating the
  palette invites drift. The app is a PWA and requires JavaScript regardless.

---

## 9. Error Primitives

### The layer-translation rule

Errors are translated at layer boundaries, never leaked across them
(`docs/DEVELOPMENT_GUIDELINES.md`, "Errors at the Right Level"):

| Layer | Responsibility |
|---|---|
| Repositories / gateways | Translate infrastructure failures (libSQL errors, Anthropic API errors, fetch failures) into `DomainError` subclasses — e.g. a missing row becomes `NotFoundError`, a failed Claude call becomes `ExtractionError`. |
| Services | Throw `DomainError` subclasses for business-rule violations. Never throw raw `Error` for expected failures. |
| Server Actions / route handlers | Catch, pass through `toActionError()`, return the serializable result. Route handlers additionally map codes to HTTP status (`NOT_FOUND` → 404, `VALIDATION_FAILED` → 400, `UNAUTHORIZED` → 401, `EXTRACTION_FAILED` → 422, `INTERNAL` → 500). |
| UI | Renders `t(\`errors.${code}\`)` — the localized message for the code (§7). The `message` field is developer-facing (logs, dev tools), never shown to users. |

### `src/lib/errors.ts`

```ts
/*
 * Domain error primitives (docs/specs/01-foundation.md §9).
 *
 * Design: expected failures travel through the layers as DomainError
 * subclasses carrying a stable machine-readable `code`. The code is the
 * contract: Server Actions serialize it, route handlers map it to HTTP
 * status, and the UI translates it (messages/<locale>.json, `errors`
 * namespace). The `message` is developer-facing context for logs — it is
 * never shown to users, so it can be specific without being localized.
 */

// WARNING: adding a code here requires updating:
// - the `errors` namespace in messages/it.json and messages/en.json
// - the code→HTTP-status mapping in route handlers (Spec 03)
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'EXTRACTION_FAILED'
  | 'INTERNAL';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    // Why: `new.target.name` keeps subclass names in stack traces and logs
    // without each subclass having to set `this.name` itself.
    this.name = new.target.name;
    this.code = code;
  }
}

/** A referenced resource does not exist or belongs to another user. */
export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} ${id} not found`);
  }
}

/** Input failed business validation beyond what Zod schemas express. */
export class ValidationError extends DomainError {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super('VALIDATION_FAILED', message);
    this.issues = issues;
  }
}

/** The caller has no authenticated session, or the session is invalid. */
export class UnauthorizedError extends DomainError {
  constructor(message = 'Not authenticated') {
    super('UNAUTHORIZED', message);
  }
}

/** The AI could not produce a usable extraction from the photo (Spec 03). */
export class ExtractionError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('EXTRACTION_FAILED', message, options);
  }
}

/** Serializable error shape returned by Server Actions. */
export type ActionError = {
  code: DomainErrorCode;
  message: string;
  issues?: string[];
};

/**
 * Map any thrown value to the serializable ActionError shape.
 *
 * DomainError instances keep their code and message; ValidationError also
 * carries its issues. Anything else collapses to a generic INTERNAL error —
 * unknown errors may contain connection strings, SQL, or stack details that
 * must never reach the client.
 */
export function toActionError(error: unknown): ActionError {
  if (error instanceof ValidationError) {
    return { code: error.code, message: error.message, issues: error.issues };
  }
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'INTERNAL', message: 'Unexpected error' };
}
```

Server Action usage pattern (established here, used from Spec 02 on):

```ts
// Guide: every Server Action returns this discriminated shape — the client
// narrows on `ok` and translates `error.code` on failure.
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
```

`ActionResult<T>` lives in `src/lib/errors.ts` alongside `ActionError`.

---

## 10. Testing Rig

Conventions (fixed project-wide):

- **Unit/integration**: colocated next to the source — `*.test.ts` runs in the
  `node` environment, `*.test.tsx` (components) runs in `happy-dom`.
- **E2E**: `tests/e2e/*.spec.ts` — the `.spec` suffix keeps Playwright files out
  of Vitest's globs and vice versa.
- Test names read as sentences: `should <behavior> when <condition>`. AAA
  structure (Arrange → Act → Assert).

### `vitest.config.ts`

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    // Why: the components project matches nothing until Spec 05 lands its
    // first .test.tsx — an empty project must not fail the run.
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'happy-dom',
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
  },
});
```

### Vitest smoke test — `src/lib/errors.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { NotFoundError, toActionError } from './errors';

describe('toActionError', () => {
  it('should map a DomainError to its code and message', () => {
    // Arrange
    const error = new NotFoundError('product', 'abc123');

    // Act
    const result = toActionError(error);

    // Assert
    expect(result).toEqual({ code: 'NOT_FOUND', message: 'product abc123 not found' });
  });

  it('should hide details when the error is not a DomainError', () => {
    // Arrange
    const error = new Error('libsql://user:secret@host connection refused');

    // Act
    const result = toActionError(error);

    // Assert
    expect(result.code).toBe('INTERNAL');
    expect(result.message).not.toContain('secret');
  });
});
```

### `playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test';

/*
 * Design: the primary (and for now only) project is a 390×844 mobile
 * viewport — the app's real target is a phone held one-handed in a
 * supermarket aisle. Chromium mobile emulation keeps CI to a single
 * browser download; Spec 05 adds a desktop project and Spec 06 adds
 * WebKit for iOS PWA verification.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

### Playwright smoke test — `tests/e2e/smoke.spec.ts`

```ts
import { expect, test } from '@playwright/test';

test('should serve the Italian dashboard shell at the root path', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'La tua inflazione' })).toBeVisible();
});

test('should serve the English dashboard shell under the /en prefix', async ({ page }) => {
  await page.goto('/en');

  await expect(page.getByRole('heading', { name: 'Your inflation' })).toBeVisible();
});
```

---

## 11. CI

`.github/workflows/ci.yml` — two jobs. `checks` is the required status for branch
protection; `e2e` runs on every push/PR but is **not** marked required (Playwright
flakes must never block a merge — fix them, don't gate on them).

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

# Why: placeholder values keep `next build` and the Playwright web server
# working once later specs import src/lib/env.ts at boot (it fails fast on
# missing variables). None of these is a real secret.
env:
  TURSO_DATABASE_URL: file:local.db
  ANTHROPIC_API_KEY: ci-placeholder
  BETTER_AUTH_SECRET: ci-placeholder-secret-0123456789abcdef
  BETTER_AUTH_URL: http://localhost:3000
  BLOB_READ_WRITE_TOKEN: ci-placeholder
  SIGNUP_ENABLED: 'true'

jobs:
  checks:
    name: Lint, typecheck, unit tests, build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Biome (lint + format + import order)
        run: pnpm exec biome ci .

      - name: Typecheck
        run: pnpm typecheck

      - name: Unit tests
        run: pnpm test

      - name: Build
        run: pnpm build

  e2e:
    name: E2E (Playwright, non-required)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright browser
        run: pnpm exec playwright install --with-deps chromium

      - name: E2E tests
        run: pnpm test:e2e

      - name: Upload report on failure
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

Notes:

- `pnpm/action-setup@v4` reads the pnpm version from the `packageManager` field —
  no version duplicated in the workflow.
- Branch protection on `main` (GitHub repo settings, owner `GiuseppeDM98`):
  require the **checks** job only.

---

## 12. Vercel Deployment

| Setting | Value |
|---|---|
| Framework preset | **Next.js** (auto-detected) |
| Install command | `pnpm install` (auto via `packageManager`) |
| Build command | `pnpm build` (auto) |
| Node version | 22.x (Project Settings → Node.js Version) |
| Function region | **`fra1` (Frankfurt)** |

**Region rationale**: the primary user base is in Italy and Vercel has no Milan
compute region, so pin functions to `fra1`. When creating the Turso database
(Spec 02), place its primary in **Frankfurt** too — server functions sit next to
the database, keeping query round-trips ~1 ms instead of crossing the Atlantic.
If these ever diverge, move the Turso primary, not the function region.

**Environment variables** (Project Settings → Environment Variables; see §6 and
00-overview §11): set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`ANTHROPIC_API_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (the production
URL), and optionally `SIGNUP_ENABLED`. `BLOB_READ_WRITE_TOKEN` is added
automatically when the Blob store is connected (Storage → Blob → Connect,
needed from Spec 03). Real values for Turso/Anthropic/Blob are only required
once Specs 02–03 land; connecting the project and deploying the Spec 01 shell
early validates the pipeline.

Preview deploys: every PR gets a preview URL with the same env vars (Preview
scope) — use a separate Turso database for previews when Spec 02 lands, never
the production one.

---

## 13. Definition of Done

- [ ] `pnpm install` completes cleanly on Node 22+; `engines`, `packageManager`,
      and `.node-version` are set.
- [ ] `pnpm dev` serves the placeholder dashboard: `/` in Italian,
      `/en` in English; no hardcoded UI strings anywhere.
- [ ] Dark mode: setting the `theme=dark` cookie — or OS dark preference with no
      cookie — renders the dark palette with no flash of light theme on load.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and
      `pnpm test:e2e` all pass locally.
- [ ] Folder skeleton matches §5, including `.gitkeep` placeholders; all Spec 01
      scripts from §4 exist in `package.json` with the exact names/commands.
- [ ] `src/lib/env.ts`, `src/lib/errors.ts` (+ test), i18n files, `globals.css`,
      configs, and `.env.example` match this spec; `.env.local` is git-ignored
      and no secret appears in any committed file.
- [ ] `.github/workflows/ci.yml` present; both jobs green on GitHub.
- [ ] Vercel project connected, `fra1` region set, Spec 01 shell deployed.
- [ ] `CLAUDE.md` "Current status" updated; all commits follow Conventional
      Commits.

---

## Implementation Prompt

```text
You are implementing Spec 01 — Foundation & Scaffold of the segnaprezzi project
(repo: GiuseppeDM98/segnaprezzi, working directory is the repo root).

Before writing ANY code, read these files in full, in this order:
1. AGENTS.md
2. CLAUDE.md
3. WORKFLOW.md                      (session/collaboration rules — branch, commit, guided-collaudo discipline)
4. docs/specs/00-overview.md        (canonical contract — exact names, never deviate)
5. docs/specs/01-foundation.md      (the spec you are implementing)
6. docs/DEVELOPMENT_GUIDELINES.md   (layers, naming, errors, testing, security)
7. docs/COMMENTS.md                 (comment discipline — applies to every file you write)

Then implement docs/specs/01-foundation.md COMPLETELY, in the order of its
sections: scaffold (via temp directory merge), Biome, package.json scripts,
folder skeleton with .gitkeep, src/lib/env.ts, .env.example, next-intl setup
with messages/it.json and messages/en.json, globals.css theming + no-flash
script, src/lib/errors.ts with its test, vitest.config.ts, playwright.config.ts,
smoke tests, and .github/workflows/ci.yml.

Rules:
- Use the exact file paths, names, and code given in the spec. Where the spec
  provides full code, use it verbatim (adjusting only library API details if the
  installed versions differ — and note any such change in your summary).
- No hardcoded UI strings: every user-visible string goes through next-intl in
  BOTH locales.
- No features: no database, no auth, no camera, no inflation math.
- Follow docs/COMMENTS.md in every file (design/why/guide/function comments
  only; no trivial or TODO comments).

Verification before you finish — all must pass:
  pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e

Commit as you go with Conventional Commits (one logical change per commit,
e.g. "chore: scaffold next.js app with pnpm and biome", "feat: add env
validation with zod", "feat: add next-intl routing for it and en").

When everything passes, update the "Current status" section of CLAUDE.md to
record that Spec 01 is implemented, and stop.
```

**Recommended model:** Claude Sonnet 5
**Recommended effort:** medium

**Prerequisites:** none — this is the first implementation spec. Only the docs
(`00-overview.md`, `DEVELOPMENT_GUIDELINES.md`, `COMMENTS.md`, `AGENTS.md`,
`CLAUDE.md`) must exist in the repo.
