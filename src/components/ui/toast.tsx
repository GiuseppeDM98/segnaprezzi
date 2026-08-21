'use client';

/**
 * Toast provider + useToast() (Spec 05 §6.1). Toasts stack above the tab
 * bar, auto-dismiss after 4 s, and may carry one action (Undo). The outlet is
 * rendered once by AppShell; anything inside the provider can toast.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cx } from '@/lib/cx';
import { useAppMotion } from '@/lib/motion';

const AUTO_DISMISS_MS = 4000;

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastInput {
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  toasts: ToastItem[];
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...input, id }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, toasts, dismiss }), [toast, toasts, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** The imperative handle: `const { toast } = useToast(); toast({ kind, message })`. */
export function useToast(): Pick<ToastContextValue, 'toast'> {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return { toast: context.toast };
}

const KIND_CLASSES: Record<ToastKind, string> = {
  success: 'border-positive/40',
  error: 'border-negative/50',
  info: 'border-border',
};

/** Where toasts render; AppShell places it above the tab bar. */
export function ToastOutlet({ className }: { className?: string }) {
  const context = useContext(ToastContext);
  const t = useTranslations('common');
  const { isReduced, spring, fade } = useAppMotion();
  if (!context) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cx(
        'pointer-events-none fixed inset-x-0 z-40 flex flex-col items-center gap-2 px-4',
        className,
      )}
    >
      <AnimatePresence>
        {context.toasts.map((item) => (
          <motion.output
            key={item.id}
            data-testid={`toast-${item.kind}`}
            initial={isReduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={isReduced ? fade : spring}
            className={cx(
              'pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-control border bg-surface-raised py-2.5 pr-2 pl-4 text-text shadow-raised',
              KIND_CLASSES[item.kind],
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                'size-2 shrink-0 rounded-full',
                item.kind === 'success' && 'bg-positive',
                item.kind === 'error' && 'bg-negative',
                item.kind === 'info' && 'bg-text-muted',
              )}
            />
            <span className="flex-1 font-sans text-[15px] leading-snug">{item.message}</span>
            {item.action && (
              <button
                type="button"
                onClick={() => {
                  item.action?.onClick();
                  context.dismiss(item.id);
                }}
                className="h-9 shrink-0 rounded-control px-3 font-semibold text-accent-ink text-sm hover:bg-band"
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label={t('close')}
              onClick={() => context.dismiss(item.id)}
              className="flex size-9 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-band"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" />
              </svg>
            </button>
          </motion.output>
        ))}
      </AnimatePresence>
    </div>
  );
}
