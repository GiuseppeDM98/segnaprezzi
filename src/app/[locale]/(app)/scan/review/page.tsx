import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ReviewScreen } from './review-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('review');
  return { title: t('title') };
}

/**
 * The review screen. Deliberately
 * server-data-free: every draft comes from the device's Dexie queue, which
 * is the only place the extractions exist until the user confirms them.
 * That is what lets a spesa be reviewed on the way home with no signal.
 */
export default function ScanReviewPage() {
  return <ReviewScreen />;
}
