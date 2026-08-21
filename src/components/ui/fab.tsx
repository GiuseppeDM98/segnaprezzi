'use client';

/**
 * The raised Scan button: the one persistent piece of
 * brand color in the chrome. Carries the shared `layoutId` that lets the
 * accent disc morph into the full-screen viewfinder on /scan.
 */
import { Camera } from 'lucide-react';
import { motion } from 'motion/react';

import { cx } from '@/lib/cx';
import { Link } from '@/lib/i18n/navigation';
import { useAppMotion } from '@/lib/motion';

/** Shared-element key between the FAB and the camera viewfinder. */
export const SCAN_MORPH_LAYOUT_ID = 'scan-morph';

export interface FabProps {
  label: string;
  className?: string;
  /** Rail variant: a rounded accent button with a visible label. */
  variant?: 'disc' | 'rail';
}

export function Fab({ label, className, variant = 'disc' }: FabProps) {
  const { isReduced, spring } = useAppMotion();

  if (variant === 'rail') {
    return (
      <Link
        href="/scan"
        data-testid="fab-scan"
        className={cx(
          'flex h-12 items-center gap-3 rounded-control bg-accent px-4 font-sans font-semibold text-[15px] text-accent-contrast shadow-fab transition-[filter] hover:brightness-95',
          className,
        )}
      >
        <motion.span
          layoutId={isReduced ? undefined : SCAN_MORPH_LAYOUT_ID}
          transition={spring}
          className="inline-flex"
        >
          <Camera aria-hidden="true" className="size-5" />
        </motion.span>
        {label}
      </Link>
    );
  }

  return (
    <Link
      href="/scan"
      aria-label={label}
      data-testid="fab-scan"
      className={cx('group relative -mt-7 flex flex-col items-center gap-1', className)}
    >
      <motion.span
        layoutId={isReduced ? undefined : SCAN_MORPH_LAYOUT_ID}
        transition={spring}
        className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-fab ring-4 ring-background transition-[filter,transform] group-hover:brightness-95 group-active:scale-95 motion-reduce:group-active:scale-100"
        style={{ borderRadius: 9999 }}
      >
        <Camera aria-hidden="true" className="size-7" strokeWidth={2.25} />
      </motion.span>
      <span className="font-sans font-medium text-[11px] text-accent-ink leading-none">
        {label}
      </span>
    </Link>
  );
}
