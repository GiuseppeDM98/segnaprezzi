import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * Locale-aware 404: reached by notFound() in any page and
 * by the catch-all segment for unknown URLs. Reuses EmptyState with the
 * logo mark; no bespoke illustration.
 */
export default async function NotFoundPage() {
  const t = await getTranslations('errors.notFound');

  return (
    <main className="flex min-h-dvh items-center justify-center pt-safe">
      <EmptyState
        title={t('title')}
        body={t('body')}
        data-testid="not-found"
        action={<Button href="/">{t('cta')}</Button>}
      />
    </main>
  );
}
