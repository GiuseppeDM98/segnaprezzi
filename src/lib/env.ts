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
