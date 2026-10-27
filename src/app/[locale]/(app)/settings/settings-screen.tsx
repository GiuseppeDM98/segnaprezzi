'use client';

/**
 * Client half of Settings, one printed section per concern: account,
 * index (optimistic toggles that roll back on failure), preferences
 * (language switches the [locale] segment, theme writes the cookie the
 * root layout reads pre-paint), data (install, export / import, stores) and
 * info. The screen owns the state and every action call; the index,
 * preferences and data sections and the delete-account sheet render
 * beside it, in files of their own.
 */
import { ExternalLink, LogOut, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ChangeEvent, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/section-heading';
import { useToast } from '@/components/ui/toast';
import { authClient } from '@/lib/auth/client';
import { callAction, describeActionError } from '@/lib/call-action';
import { MIN_PASSWORD_LENGTH } from '@/lib/domain/auth';
import type { AppLocale } from '@/lib/format';
import { usePathname, useRouter } from '@/lib/i18n/navigation';
import type { Locale } from '@/lib/i18n/routing';
import type { IndexSettings } from '@/lib/services/settings';
import { applyTheme, readThemeCookie, type ThemeChoice } from '@/lib/theme';
import { importBackup, updateIndexSettings } from './actions';
import { DataSection } from './data-section';
import { DeleteAccountSheet } from './delete-account-sheet';
import { IndexSettingsSection } from './index-settings-section';
import { PreferencesSection } from './preferences-section';

export interface SettingsScreenProps {
  email: string;
  indexSettings: IndexSettings;
  appVersion: string;
  repoUrl: string;
}

export function SettingsScreen({ email, indexSettings, appVersion, repoUrl }: SettingsScreenProps) {
  const t = useTranslations('settings');
  const tErrors = useTranslations('errors');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  const [settings, setSettings] = useState(indexSettings);
  const [theme, setTheme] = useState<ThemeChoice>('system');

  // Why an effect: the cookie is only readable in the browser; reading it
  // during render would mismatch the server markup.
  useEffect(() => {
    setTheme(readThemeCookie());
  }, []);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** Optimistic update with rollback: the toggle flips now, the row reverts on failure. */
  async function patchSettings(patch: Partial<IndexSettings>): Promise<void> {
    const previous = settings;
    setSettings({ ...settings, ...patch });
    const result = await callAction('updateIndexSettings', updateIndexSettings(patch));
    if (!result.ok) {
      setSettings(previous);
      toast({ kind: 'error', message: describeActionError(result.error, tErrors, t('saveError')) });
      return;
    }
    setSettings(result.data);
  }

  function handleThemeChange(next: ThemeChoice): void {
    setTheme(next);
    applyTheme(next);
  }

  function switchLocale(next: Locale): void {
    router.replace(pathname, { locale: next });
  }

  async function handleLogout(): Promise<void> {
    await authClient.signOut();
    router.push('/login');
    router.refresh();
  }

  async function handleExport(): Promise<void> {
    setIsExporting(true);
    try {
      const response = await fetch('/api/export');
      if (!response.ok) {
        throw new Error(`export ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `segnaprezzi-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ kind: 'error', message: t('data.exportError') });
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setIsImporting(true);
    let json: string;
    try {
      json = await file.text();
    } catch (cause) {
      console.error('Import file read failed', { cause });
      setIsImporting(false);
      toast({ kind: 'error', message: t('data.importError') });
      return;
    }
    const result = await callAction('importBackup', importBackup({ json }));
    setIsImporting(false);
    if (!result.ok) {
      // Only a file the server could not read is the file's fault: a lost
      // session or an outage says so instead of blaming the file.
      const isInvalidFile =
        result.error.code === 'VALIDATION_FAILED' || result.error.code === 'INVALID_INPUT';
      toast({
        kind: 'error',
        message: isInvalidFile
          ? t('data.importInvalid')
          : describeActionError(result.error, tErrors, t('data.importError')),
      });
      return;
    }
    toast({
      kind: 'success',
      message: t('data.imported', {
        entries: result.data.entries,
        products: result.data.products,
        stores: result.data.stores,
      }),
    });
    router.refresh();
  }

  async function handleDeleteAccount(): Promise<void> {
    setIsDeleting(true);
    setDeleteError(null);
    const { error } = await authClient.deleteUser({ password: deletePassword });
    setIsDeleting(false);
    if (error) {
      setDeleteError(t('account.deleteError'));
      return;
    }
    router.push('/signup');
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 pt-safe pb-6">
      <div className="pt-4">
        <SectionHeading as="h1">{t('title')}</SectionHeading>
      </div>

      {/* Account */}
      <section aria-labelledby="settings-account" className="flex flex-col gap-3">
        <SectionHeading id="settings-account">{t('account.title')}</SectionHeading>
        <dl className="zebra -mx-1">
          <div className="flex min-h-12 items-center justify-between gap-3 px-3">
            <dt className="font-sans text-[15px] text-text-muted">{t('account.email')}</dt>
            <dd className="truncate font-mono text-[14px] text-text">{email}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<LogOut className="size-4" />}
            onClick={() => void handleLogout()}
            data-testid="logout"
          >
            {t('account.logout')}
          </Button>
          <Button
            variant="ghost"
            icon={<Trash2 className="size-4 text-negative" />}
            onClick={() => setIsDeleteOpen(true)}
            data-testid="delete-account"
          >
            {t('account.deleteAccount')}
          </Button>
        </div>
      </section>

      <IndexSettingsSection settings={settings} onPatch={(patch) => void patchSettings(patch)} />

      <PreferencesSection
        locale={locale}
        onLocaleChange={switchLocale}
        theme={theme}
        onThemeChange={handleThemeChange}
      />

      <DataSection
        isExporting={isExporting}
        onExport={() => void handleExport()}
        isImporting={isImporting}
        onImportFile={(event) => void handleImportFile(event)}
      />

      {/* Info */}
      <section aria-labelledby="settings-info" className="flex flex-col gap-3">
        <SectionHeading id="settings-info">{t('info.title')}</SectionHeading>
        <dl className="zebra -mx-1">
          <div className="flex min-h-12 items-center justify-between gap-3 px-3">
            <dt className="font-sans text-[15px] text-text-muted">{t('info.version')}</dt>
            <dd className="font-mono text-[14px] text-text tabular-nums">{appVersion}</dd>
          </div>
          <div className="flex min-h-12 flex-col justify-center gap-0.5 px-3 py-2">
            <dt className="font-sans font-medium text-[15px] text-text">{t('info.license')}</dt>
            <dd className="font-sans text-[13px] text-text-muted">{t('info.licenseBody')}</dd>
          </div>
        </dl>
        <a
          href={repoUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 w-fit items-center gap-2 font-sans font-semibold text-[15px] text-accent-ink underline decoration-border underline-offset-4"
        >
          {t('info.repo')}
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
        <p className="font-sans text-[13px] text-text-muted">{t('info.credits')}</p>
      </section>

      <DeleteAccountSheet
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        password={deletePassword}
        onPasswordChange={setDeletePassword}
        error={deleteError}
        isDeleting={isDeleting}
        canConfirm={deletePassword.length >= MIN_PASSWORD_LENGTH}
        onConfirm={() => void handleDeleteAccount()}
      />
    </div>
  );
}
