'use client';

/**
 * "These numbers are not live" (Spec 06 §6.4).
 *
 * The dashboard is a NetworkFirst page, so offline it renders from the cache
 * — the same layout, the same confident type, numbers that may be days old.
 * This slim line is the whole defence against mistaking one for the other.
 * It links nothing and demands nothing.
 *
 * Correction to Spec 06 §6.4: the timestamp is when the *page data* was
 * computed, not `syncMeta.lastSyncAt` (which records the last successful
 * photo extraction). The generation time travels inside the cached HTML, so
 * it stays truthful for exactly the copy the user is looking at.
 */
import { useFormatter, useTranslations } from 'next-intl';

import { useOnlineStatus } from '@/lib/offline/use-online-status';

export function CachedDataBanner({ generatedAt }: { generatedAt: number }) {
  const t = useTranslations('offline');
  const format = useFormatter();
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <p
      data-testid="cached-data-banner"
      className="rounded-control border border-border border-dashed bg-band px-3 py-2 font-sans text-[13px] text-text-muted"
    >
      {t('cachedBanner', { lastSyncTime: format.relativeTime(generatedAt) })}
    </p>
  );
}
