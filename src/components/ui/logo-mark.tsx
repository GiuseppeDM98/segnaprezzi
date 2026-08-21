/**
 * The segnaprezzi mark: a price tag with a rising line printed as a row of
 * dots — the dot-matrix voice of the visual world. Colors come from the
 * theme tokens so the mark sits on any surface; docs/assets/logo.svg is the
 * static twin used for icons and the README.
 */
import { cx } from '@/lib/cx';

export interface LogoMarkProps {
  /** Rendered size in CSS pixels (square). */
  size?: number;
  className?: string;
  /** Accessible name; omit for a decorative mark. */
  title?: string;
}

export function LogoMark({ size = 40, className, title }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cx('shrink-0', className)}
    >
      <defs>
        <mask id="segnaprezzi-tag-hole">
          <rect width="64" height="64" fill="#fff" />
          <circle cx="32" cy="17.5" r="3.6" fill="#000" />
        </mask>
      </defs>
      <g mask="url(#segnaprezzi-tag-hole)">
        <rect
          x="14"
          y="14"
          width="36"
          height="36"
          rx="8"
          fill="var(--color-accent)"
          transform="rotate(45 32 32)"
        />
      </g>
      {/* A rising line printed one dot at a time. */}
      <g fill="var(--color-accent-contrast)">
        <circle cx="20.5" cy="41" r="2.4" />
        <circle cx="26" cy="36" r="2.4" />
        <circle cx="31.5" cy="38.5" r="2.4" />
        <circle cx="37" cy="32" r="2.4" />
        <circle cx="42.5" cy="26.5" r="2.4" />
        <circle cx="37.5" cy="25.5" r="1.7" />
        <circle cx="43.5" cy="31.5" r="1.7" />
      </g>
    </svg>
  );
}
