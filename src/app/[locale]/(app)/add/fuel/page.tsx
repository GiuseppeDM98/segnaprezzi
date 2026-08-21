import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getFuelEntryContext } from '@/lib/services/capture-context';
import { FuelEntryForm } from './fuel-entry-form';

/**
 * The pump form (Spec 03 §11). Optimized to be filled standing at the pump
 * in under ten seconds: three quick-pick fuels, any two of {€/L, litres,
 * total}, and the station the user last refuelled at preselected.
 */
export default async function AddFuelPage() {
  const user = await requireUser();
  const context = await getFuelEntryContext(db, user.id);
  const t = await getTranslations('addFuel');

  return (
    <main className="flex min-h-dvh flex-col gap-4 p-4">
      <h1 className="font-semibold text-xl">{t('title')}</h1>
      <FuelEntryForm context={context} />
    </main>
  );
}
