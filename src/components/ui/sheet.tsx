'use client';

/**
 * Bottom sheet: drag handle, scrim, drag-to-dismiss on
 * mobile; a centered dialog from the tablet breakpoint up. Traps focus,
 * closes on Esc and on the scrim, and restores focus to the opener.
 *
 * Why a hand-rolled trap rather than <dialog>: the native element fights
 * Motion's exit animation (it unmounts on close before the spring finishes)
 * and its ::backdrop cannot follow a drag gesture.
 */
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { cx } from '@/lib/cx';
import { useAppMotion } from '@/lib/motion';
import { TABLET_QUERY, useMediaQuery } from '@/lib/use-media-query';

/** Drag distance (px) or velocity (px/s) past which a swipe closes the sheet. */
const DISMISS_OFFSET_PX = 96;
const DISMISS_VELOCITY = 600;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** Free-form description announced with the dialog. */
  description?: string;
  children: ReactNode;
  /** Extra classes on the panel (e.g. a wider desktop dialog). */
  className?: string;
}

export function Sheet({ isOpen, onClose, title, description, children, className }: SheetProps) {
  const t = useTranslations('common');
  const { isReduced, spring, fade } = useAppMotion();
  const isTablet = useMediaQuery(TABLET_QUERY);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Focus management + body scroll lock for the lifetime of an open sheet.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    openerRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Defer so Motion has mounted the panel before we look for focusables.
    const frame = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panelRef.current)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) {
        return;
      }
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (openerRef.current instanceof HTMLElement) {
        openerRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  function handleDragEnd(_event: unknown, info: PanInfo): void {
    if (info.offset.y > DISMISS_OFFSET_PX || info.velocity.y > DISMISS_VELOCITY) {
      onClose();
    }
  }

  if (typeof document === 'undefined') {
    return null;
  }

  const panelMotion = isReduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: fade }
    : isTablet
      ? {
          initial: { opacity: 0, scale: 0.96, y: 8 },
          animate: { opacity: 1, scale: 1, y: 0 },
          exit: { opacity: 0, scale: 0.96, y: 8 },
          transition: spring,
        }
      : {
          initial: { y: '100%' },
          animate: { y: 0 },
          exit: { y: '100%' },
          transition: spring,
        };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className={cx(
            'fixed inset-0 z-50 flex flex-col justify-end',
            'tablet:items-center tablet:justify-center tablet:p-6',
          )}
        >
          <motion.button
            type="button"
            aria-label={t('close')}
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            drag={isTablet || isReduced ? false : 'y'}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
            {...panelMotion}
            className={cx(
              'relative flex max-h-[90dvh] w-full flex-col rounded-t-sheet bg-surface-raised text-text shadow-sheet outline-none',
              'pb-safe tablet:max-h-[85dvh] tablet:max-w-md tablet:rounded-sheet tablet:shadow-raised',
              className,
            )}
          >
            {/* Drag handle — decorative on tablet, where the sheet is a dialog. */}
            <div aria-hidden="true" className="flex justify-center pt-2.5 pb-1 tablet:hidden">
              <span className="h-1 w-10 rounded-full bg-border" />
            </div>
            {(title || description) && (
              <header className="px-5 pt-2 pb-3">
                {title && (
                  <h2 id={titleId} className="font-sans font-semibold text-lg leading-tight">
                    {title}
                  </h2>
                )}
                {description && (
                  <p id={descriptionId} className="mt-1 text-sm text-text-muted">
                    {description}
                  </p>
                )}
              </header>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
