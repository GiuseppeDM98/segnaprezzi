import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as inflation from './index';

/**
 * Why a test and not a lint rule: no import-boundary linter is configured
 * yet (AGENTS.md §1.5 — "enforcement is by review until a lint rule exists"),
 * and the purity of this folder is what makes the numeric test plan
 * trustworthy. Reading the sources here is the cheapest mechanical guard.
 */
const FORBIDDEN_IMPORT = /from\s+['"](?:@\/lib\/(?:db|ai|blob|services|env|auth)|next|react|node:)/;

describe('inflation barrel', () => {
  it('should export exactly the public API', () => {
    expect(Object.keys(inflation).sort()).toEqual([
      'computePersonalCpi',
      'rebaseIstat',
      'toRomeYearMonth',
    ]);
  });

  it('should keep every engine module free of I/O and framework imports', () => {
    const folder = import.meta.dirname;
    const sources = readdirSync(folder).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );

    for (const file of sources) {
      const source = readFileSync(join(folder, file), 'utf8');
      expect(source, `${file} imports a forbidden module`).not.toMatch(FORBIDDEN_IMPORT);
    }
  });
});
