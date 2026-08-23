'use client';

/**
 * The bar that sticks above the tab bar and carries a screen's one decisive
 * action: confirm the batch, save the entry, act on the selection.
 *
 * Design: five screens had grown their own copy of the same class string, and
 * none of them told the rest of the app they were there — so the toast outlet,
 * anchored 4.5 rem off the bottom edge, landed on top of the confirm button
 * and swallowed the tap. The bar now publishes its own height into a custom
 * property on the document element, which is the one place an overlay mounted
 * outside this subtree can read it: CSS variables inherit downwards, and the
 * toast is a sibling of the whole app, not a descendant of any bar.
 *
 * `pb-11` on mobile is what keeps the raised Scan disc off the controls.
 */
import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef } from 'react';

import { cx } from '@/lib/cx';

/** Read by the toast outlet in `app-shell.tsx`; absent while no bar is mounted. */
export const STICKY_ACTION_BAR_HEIGHT_VAR = '--sticky-action-bar-height';

/**
 * The bar's own look. Exported for the one screen that needs it on a
 * `motion.div` of its own (the bulk-selection bar animates in and out).
 */
export const STICKY_ACTION_BAR_CLASSES =
  'sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-20 border-border border-t border-dashed bg-surface/95 px-4 pt-3 pb-11 backdrop-blur-sm rail:bottom-0 rail:pb-3';

/**
 * Publish the referenced bar's height for as long as it is mounted.
 *
 * @returns the ref to attach to the bar element.
 */
export function useStickyActionBarHeight<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const root = document.documentElement;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight;
      root.style.setProperty(STICKY_ACTION_BAR_HEIGHT_VAR, `${Math.round(height)}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      // The bar is gone the moment the screen unmounts; leaving its height
      // behind would strand every later toast a bar's height too high.
      root.style.removeProperty(STICKY_ACTION_BAR_HEIGHT_VAR);
    };
  }, []);

  return ref;
}

export interface StickyActionBarProps {
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function StickyActionBar({ children, className, ...rest }: StickyActionBarProps) {
  const ref = useStickyActionBarHeight<HTMLDivElement>();

  return (
    <div
      ref={ref}
      data-testid={rest['data-testid']}
      className={cx(STICKY_ACTION_BAR_CLASSES, className)}
    >
      {children}
    </div>
  );
}
