/**
 * Join class names, skipping falsy values. A three-line stand-in for clsx so
 * components can compose variants without a dependency; Tailwind 4 has no
 * conflicting-utility problem here because every component owns its own
 * class set.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
