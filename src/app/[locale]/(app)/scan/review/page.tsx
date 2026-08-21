import { getTranslations } from 'next-intl/server';

import { ReviewScreen } from './review-screen';

/**
 * The review screen (Spec 03 §9). Deliberately server-data-free: every draft
 * comes from the device's Dexie queue, which is the only place the
 * extractions exist until the user confirms them. That is what lets a spesa
 * be reviewed on the way home with no signal.
 *
 * Spec 05 restyles the cards without changing the data or action contract.
 */
export default async function ScanReviewPage() {
  const t = await getTranslations('review');

  return (
    <main className="flex min-h-dvh flex-col gap-4 p-4">
      <h1 className="font-semibold text-xl">{t('title')}</h1>
      <ReviewScreen />
    </main>
  );
}
