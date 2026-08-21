import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyState } from '@/components/ui/empty-state';
import { routing } from '@/lib/i18n/routing';
import { ReloadButton } from './reload-button';

/*
 * The service worker's navigation fallback (Spec 06 §2.4). A technical
 * route, not part of the Spec 00 §9 route map.
 *
 * Two constraints shape it: it must be renderable at build time (the SW
 * precaches it, so it can never depend on a session or a fetch), and it is
 * listed in the middleware's PUBLIC_PATHNAMES — a fallback that bounced to
 * /login would defeat its own purpose offline.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'offline' });
  return { title: t('fallbackTitle'), robots: { index: false } };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'offline' });

  return (
    <main className="flex min-h-dvh items-center justify-center pt-safe">
      <EmptyState
        title={t('fallbackTitle')}
        body={t('fallbackBody')}
        data-testid="offline-fallback"
        action={<ReloadButton />}
      />
    </main>
  );
}
