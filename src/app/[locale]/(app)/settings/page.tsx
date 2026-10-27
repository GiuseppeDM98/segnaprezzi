import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getIndexSettings } from '@/lib/services/settings';
import packageJson from '../../../../../package.json';
import { SettingsScreen } from './settings-screen';

/**
 * The public source repository the info section links to. Hardcoded rather
 * than read from package.json, which has no `repository` field.
 */
const REPO_URL = 'https://github.com/GiuseppeDM98/segnaprezzi';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

/** Settings. The section map lives in the client half, settings-screen.tsx. */
export default async function SettingsPage() {
  const user = await requireUser();
  const indexSettings = await getIndexSettings(db, user.id);

  return (
    <SettingsScreen
      email={user.email}
      indexSettings={indexSettings}
      appVersion={packageJson.version}
      repoUrl={REPO_URL}
    />
  );
}
