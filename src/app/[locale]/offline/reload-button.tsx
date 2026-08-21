'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

/**
 * The offline fallback's only interaction. A plain reload rather than a
 * router navigation: the page is served from the precache with no running
 * data layer behind it, so re-asking the network is the whole gesture.
 */
export function ReloadButton() {
  const t = useTranslations('offline');

  return (
    <Button onClick={() => window.location.reload()} data-testid="offline-retry">
      {t('fallbackRetry')}
    </Button>
  );
}
