'use client';

/**
 * Route error boundary for every (app) screen: plain
 * language, a retry that re-renders the segment, and a way home. The error
 * itself goes to the console for developers; users never see internals.
 */
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function AppRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors.routeError');

  useEffect(() => {
    console.error('Route error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center pt-safe">
      <EmptyState
        tone="error"
        icon={<TriangleAlert />}
        title={t('title')}
        body={t('body')}
        data-testid="route-error"
        action={<Button onClick={reset}>{t('retry')}</Button>}
        secondaryAction={
          <Button href="/" variant="ghost">
            {t('cta')}
          </Button>
        }
      />
    </div>
  );
}
