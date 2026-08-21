import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getIndexSettings } from '@/lib/services/settings';
import packageJson from '../../../../../package.json';
import { SettingsScreen } from './settings-screen';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

/** Settings: account, index options, preferences, data, info. */
export default async function SettingsPage() {
  const user = await requireUser();
  const indexSettings = await getIndexSettings(db, user.id);

  return (
    <SettingsScreen
      email={user.email}
      indexSettings={indexSettings}
      appVersion={packageJson.version}
      repoUrl="https://github.com/GiuseppeDM98/segnaprezzi"
    />
  );
}
