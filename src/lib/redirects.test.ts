import { describe, expect, test } from 'vitest';

import { sanitizeRedirectPath } from './redirects';

describe('sanitizeRedirectPath', () => {
  test.each([
    ['/', '/'],
    ['/history', '/history'],
    ['/products/abc?tab=all#top', '/products/abc?tab=all#top'],
  ])('should keep the same-origin path %s', (raw, expected) => {
    expect(sanitizeRedirectPath(raw)).toBe(expected);
  });

  test.each([
    ['a missing parameter', null],
    ['an empty parameter', ''],
    ['an absolute URL', 'https://evil.example/login'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a relative path', 'history'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash host', '/\\evil.example'],
    ['a tab that browsers strip', '/\t/evil.example'],
    ['a newline that browsers strip', '/\n/evil.example'],
  ])('should fall back to home for %s', (_case, raw) => {
    expect(sanitizeRedirectPath(raw)).toBe('/');
  });
});
