import { useTranslations } from 'next-intl';

export default function DashboardPage() {
  const t = useTranslations('dashboard');

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="font-semibold text-2xl">{t('title')}</h1>
      <p className="text-text-muted">{t('emptyState')}</p>
    </main>
  );
}
