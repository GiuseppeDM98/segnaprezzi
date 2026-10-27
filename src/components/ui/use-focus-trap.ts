'use client';

/**
 * Modal focus handling for a container that is open on top of the page: on
 * activation, remember the element that had focus and move focus into the
 * container (its first focusable, or the container itself); while active,
 * keep Tab and Shift+Tab cycling inside it and call `onEscape` on Esc; on
 * deactivation or unmount, hand focus back to the remembered element.
 *
 * The container needs `tabIndex={-1}` so it can take focus when it holds
 * nothing focusable.
 */
import { type RefObject, useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  isActive: boolean,
  onEscape: () => void,
): void {
  const openerRef = useRef<Element | null>(null);

  // Why a ref: the Esc handler must call the latest onEscape, but the trap
  // must not re-run when its identity changes. Re-running it hands focus
  // back to the opener and then grabs it again, so a parent passing an
  // inline onClose would snap focus to the first field on every re-render.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    openerRef.current = document.activeElement;

    // Defer so Motion has mounted the container before we look for focusables.
    const frame = requestAnimationFrame(() => {
      const first = containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? containerRef.current)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !containerRef.current) {
        return;
      }
      const focusables = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
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
      if (openerRef.current instanceof HTMLElement) {
        openerRef.current.focus();
      }
    };
  }, [containerRef, isActive]);
}
