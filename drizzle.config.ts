import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Why: drizzle-kit runs outside Next.js, which is what normally loads
// .env.local — so we load it ourselves. Missing file is fine (CI/prod
// pass real env vars).
config({ path: '.env.local' });

export default defineConfig({
  // SQLite dialect via the Turso/libSQL driver: works for both the local
  // file database and remote Turso.
  dialect: 'turso',
  // Why: explicit file list instead of a glob — the schema barrel
  // (index.ts) re-exports both files and a glob would pick it up too.
  schema: ['./src/lib/db/schema/auth.ts', './src/lib/db/schema/app.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? 'file:local.db',
    // Why: @libsql/client rejects an empty-string token; normalize to undefined.
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },
});
