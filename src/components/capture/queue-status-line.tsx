'use client';

/**
 * The one-line queue status under the photo tray.
 *
 * Only the non-zero parts are printed, joined with " · ", so a healthy queue
 * says nothing at all: the line exists to explain a wait, not to narrate a
 * pipeline. Failures get their own red segment and a retry-all action,
 * because that is the only queue state a user can act on. The action itself
 * belongs to the screen, as PhotoTray's per-photo retry does: a status line
 * only reports, and the screen is where a failed retry can be told.
 */
import { useTranslations } from 'next-intl';

import { cx } from '@/lib/cx';
import { useQueueStatus } from '@/lib/offline/use-queue-status';

export interface QueueStatusLineProps {
  sessionId: string | null;
  /** Re-queues the failed photos; must report its own failures, it is never awaited. */
  onRetryAll: () => void | Promise<void>;
  /** Light chrome when the line sits over the viewfinder. */
  isOnCamera?: boolean;
}

export function QueueStatusLine({
  sessionId,
  onRetryAll,
  isOnCamera = false,
}: QueueStatusLineProps) {
  const t = useTranslations('offline');
  const { queuedCount, uploadingCount, failedCount } = useQueueStatus(sessionId ?? undefined);

  const segments: string[] = [];
  if (queuedCount > 0) {
    segments.push(t('queued', { count: queuedCount }));
  }
  if (uploadingCount > 0) {
    segments.push(t('processing', { count: uploadingCount }));
  }

  if (segments.length === 0 && failedCount === 0) {
    return null;
  }

  return (
    <p
      data-testid="queue-status"
      className={cx(
        'flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] uppercase tracking-wide',
        isOnCamera ? 'text-camera-contrast/80' : 'text-text-muted',
      )}
    >
      {segments.length > 0 && <span>{segments.join(' · ')}</span>}
      {failedCount > 0 && (
        <>
          <span className="text-negative">{t('failed', { count: failedCount })}</span>
          <button
            type="button"
            onClick={() => void onRetryAll()}
            data-testid="retry-all"
            className={cx(
              'h-8 rounded-control px-2 font-sans font-semibold text-[13px] normal-case tracking-normal',
              isOnCamera ? 'text-camera-contrast underline' : 'text-accent-ink hover:bg-band',
            )}
          >
            {t('retryAll')}
          </button>
        </>
      )}
    </p>
  );
}
