import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireUser } from '@/lib/auth/session';
import { FuelEntryForm } from './fuel-entry-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addFuel');
  return { title: t('title') };
}

/**
 * The pump form. Optimized to be filled standing at the pump
 * in under ten seconds: a quick-pick chip per fuel and any two of {unit
 * price, quantity, total}.
 */
export default async function AddFuelPage() {
  await requireUser();
  return <FuelEntryForm />;
}
