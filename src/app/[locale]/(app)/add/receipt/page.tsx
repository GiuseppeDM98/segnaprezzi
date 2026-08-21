import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getManualEntryContext } from '@/lib/services/capture-context';
import { ReceiptUploadScreen } from './receipt-upload-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('receipt');
  return { title: t('title') };
}

/**
 * Receipt upload (Spec 07 §3). Online-only by design: a PDF never
 * originates in a supermarket aisle, so there is no Dexie queue behind this
 * screen — just the stores list the picker needs.
 */
export default async function AddReceiptPage() {
  const user = await requireUser();
  const context = await getManualEntryContext(db, user.id);

  return <ReceiptUploadScreen stores={context.stores} defaultStoreId={context.defaultStoreId} />;
}
