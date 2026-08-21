import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getScanContext } from '@/lib/services/capture-context';
import { ScanScreen } from './scan-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('scan');
  return { title: t('title') };
}

/**
 * The capture screen. The server half only
 * resolves what the device cannot know on its own — the user's stores and
 * whether a spesa was left open on another device; everything about the
 * current spesa lives in the browser so the shutter keeps working with no
 * connectivity. Immersive: the app shell renders no tab bar here.
 */
export default async function ScanPage() {
  const user = await requireUser();
  const context = await getScanContext(db, user.id);

  return <ScanScreen context={context} />;
}
