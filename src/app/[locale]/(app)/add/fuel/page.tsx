import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getFuelEntryContext } from '@/lib/services/capture-context';
import { FuelEntryForm } from './fuel-entry-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addFuel');
  return { title: t('title') };
}

/**
 * The pump form (Spec 03 §11). Optimized to be filled standing at the pump
 * in under ten seconds: three quick-pick fuels, any two of {€/L, litres,
 * total}, and the station the user last refuelled at preselected.
 */
export default async function AddFuelPage() {
  const user = await requireUser();
  const context = await getFuelEntryContext(db, user.id);
  return <FuelEntryForm context={context} />;
}
