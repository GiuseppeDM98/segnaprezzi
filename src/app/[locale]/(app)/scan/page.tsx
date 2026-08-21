import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getScanContext } from '@/lib/services/capture-context';
import { ScanScreen } from './scan-screen';

/**
 * The capture screen (Spec 03 §3). The server half only resolves what the
 * device cannot know on its own — the user's stores and whether a spesa was
 * left open on another device; everything about the current spesa lives in
 * the browser so the shutter keeps working with no connectivity.
 *
 * Spec 05 restyles this screen without changing the contract.
 */
export default async function ScanPage() {
  const user = await requireUser();
  const context = await getScanContext(db, user.id);
  const t = await getTranslations('scan');

  return (
    <main className="flex min-h-dvh flex-col gap-4 p-4">
      <h1 className="font-semibold text-xl">{t('title')}</h1>
      <ScanScreen context={context} />
    </main>
  );
}
