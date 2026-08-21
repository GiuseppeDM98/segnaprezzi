import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Why: the request config lives under src/lib/i18n (00-overview §10), not the
// plugin's default src/i18n, so the path must be passed explicitly.
const withNextIntl = createNextIntlPlugin('./src/lib/i18n/request.ts');

const nextConfig: NextConfig = {
  // Why: `next dev` otherwise appends a generated block to AGENTS.md on
  // every run — this repo's AGENTS.md is a hand-maintained project contract
  // (docs/specs/00-overview.md), not a file for Next.js to rewrite.
  agentRules: false,
};

export default withNextIntl(nextConfig);
