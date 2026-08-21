import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getManualEntryContext } from '@/lib/services/capture-context';
import { ManualEntryForm } from './manual-entry-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addManual');
  return { title: t('title') };
}

/**
 * Manual price entry. Online-only: the form is built around
 * the user's existing catalog and stores, which it needs to resolve before
 * anything can be saved.
 */
export default async function AddManualPage() {
  const user = await requireUser();
  const context = await getManualEntryContext(db, user.id);
  return <ManualEntryForm context={context} />;
}
