'use client';

/**
 * Client half of Settings (Spec 05 §5.10). Five printed sections: account,
 * index (optimistic toggles that roll back on failure), preferences
 * (language switches the [locale] segment, theme writes the cookie the
 * root layout reads pre-paint), data (export / import / stores) and info.
 */
import { Download, ExternalLink, LogOut, Store as StoreIcon, Trash2, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionHeading } from '@/components/ui/section-heading';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { Stepper } from '@/components/ui/stepper';
import { useToast } from '@/components/ui/toast';
import { Toggle } from '@/components/ui/toggle';
import { authClient } from '@/lib/auth/client';
import type { AppLocale } from '@/lib/format';
import { usePathname, useRouter } from '@/lib/i18n/navigation';
import { type Locale, routing } from '@/lib/i18n/routing';
import type { IndexSettings } from '@/lib/services/settings';
import { importBackup, updateIndexSettings } from './actions';

type ThemeChoice = 'system' | 'light' | 'dark';

/** Cookie the root layout's pre-paint script reads ("dark" | "light"; absent = system). */
const THEME_COOKIE = 'theme';
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface SettingsScreenProps {
  email: string;
  indexSettings: IndexSettings;
  appVersion: string;
  repoUrl: string;
}

export function SettingsScreen({ email, indexSettings, appVersion, repoUrl }: SettingsScreenProps) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Optimistic update with rollback: the toggle flips now, the row reverts on failure. */
  async function patchSettings(patch: Partial<IndexSettings>): Promise<void> {
    const previous = settings;
    setSettings({ ...settings, ...patch });
    const result = await updateIndexSettings(patch);
    if (!result.ok) {
      setSettings(previous);
      toast({ kind: 'error', message: t('saveError') });
      return;
    }
    setSettings(result.data);
  }

  function applyTheme(next: ThemeChoice): void {
    setTheme(next);
    if (next === 'system') {
      // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not available in Safari; the pre-paint script reads this plain cookie
      document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', prefersDark);
      return;
    }
    // biome-ignore lint/suspicious/noDocumentCookie: same as above — one plain cookie, read pre-paint
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
    document.documentElement.classList.toggle('dark', next === 'dark');
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
    const json = await file.text();
    const result = await importBackup({ json });
    setIsImporting(false);
    if (!result.ok) {
      toast({ kind: 'error', message: t('data.importInvalid') });
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

  const carryForwardLabel =
    settings.carryForwardMonths === 0
      ? t('index.disabled')
      : t('index.months', { count: settings.carryForwardMonths });

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

      {/* Index */}
      <section aria-labelledby="settings-index" className="flex flex-col gap-4">
        <SectionHeading
          id="settings-index"
          trailing={
            <span className="font-sans text-[12px] text-text-muted">
              {t('index.recomputeNote')}
            </span>
          }
        >
          {t('index.title')}
        </SectionHeading>
        <Toggle
          label={t('index.includePromos')}
          description={t('index.includePromosHelp')}
          isChecked={settings.includePromosInIndex}
          onChange={(includePromosInIndex) => void patchSettings({ includePromosInIndex })}
        />
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-sans font-medium text-[15px] text-text">
              {t('index.carryForward')}
            </span>
            <span className="font-sans text-[14px] text-text-muted leading-snug">
              {t('index.carryForwardHelp', { months: settings.carryForwardMonths })}
            </span>
          </div>
          <Stepper
            value={settings.carryForwardMonths}
            min={0}
            max={6}
            onChange={(carryForwardMonths) => void patchSettings({ carryForwardMonths })}
            valueLabel={carryForwardLabel}
            decrementLabel={t('index.decrement')}
            incrementLabel={t('index.increment')}
          />
        </div>
      </section>

      {/* Preferences */}
      <section aria-labelledby="settings-preferences" className="flex flex-col gap-4">
        <SectionHeading id="settings-preferences">{t('preferences.title')}</SectionHeading>
        <div className="flex flex-col gap-1.5">
          <span className="font-sans font-medium text-[15px] text-text">
            {t('preferences.language')}
          </span>
          <Segmented<Locale>
            label={t('preferences.language')}
            value={locale}
            onChange={switchLocale}
            options={routing.locales.map((code) => ({ value: code, label: code.toUpperCase() }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-sans font-medium text-[15px] text-text">
            {t('preferences.theme')}
          </span>
          <Segmented<ThemeChoice>
            label={t('preferences.theme')}
            value={theme}
            onChange={applyTheme}
            options={[
              { value: 'system', label: t('preferences.themeSystem') },
              { value: 'light', label: t('preferences.themeLight') },
              { value: 'dark', label: t('preferences.themeDark') },
            ]}
          />
        </div>
      </section>

      {/* Data */}
      <section aria-labelledby="settings-data" className="flex flex-col gap-3">
        <SectionHeading id="settings-data">{t('data.title')}</SectionHeading>
        <DataRow
          title={t('data.export')}
          body={t('data.exportHelp')}
          action={
            <Button
              variant="secondary"
              icon={<Download className="size-4" />}
              isPending={isExporting}
              onClick={() => void handleExport()}
              data-testid="export-data"
            >
              {t('data.export')}
            </Button>
          }
        />
        <DataRow
          title={t('data.import')}
          body={t('data.importHelp')}
          action={
            <>
              <Button
                variant="secondary"
                icon={<Upload className="size-4" />}
                isPending={isImporting}
                onClick={() => fileInputRef.current?.click()}
                data-testid="import-data"
              >
                {isImporting ? t('data.importing') : t('data.import')}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={(event) => void handleImportFile(event)}
                aria-label={t('data.import')}
                className="sr-only"
                data-testid="import-file-input"
              />
            </>
          }
        />
        <DataRow
          title={t('data.stores')}
          body={t('data.storesHelp')}
          action={
            <Button href="/stores" variant="secondary" icon={<StoreIcon className="size-4" />}>
              {t('data.stores')}
            </Button>
          }
        />
      </section>

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

      <Sheet
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        title={t('account.deleteTitle')}
        description={t('account.deleteBody')}
      >
        <div className="flex flex-col gap-3">
          <Field label={t('account.deletePassword')} error={deleteError}>
            {(controlProps) => (
              <Input
                {...controlProps}
                type="password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                autoComplete="current-password"
                data-testid="delete-password"
              />
            )}
          </Field>
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => setIsDeleteOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              isPending={isDeleting}
              disabled={deletePassword.length < 8}
              onClick={() => void handleDeleteAccount()}
              data-testid="confirm-delete-account"
            >
              {t('account.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function DataRow({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-control border border-border bg-surface p-3 tablet:flex-row tablet:items-center tablet:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-sans font-medium text-[15px] text-text">{title}</span>
        <span className="font-sans text-[13px] text-text-muted leading-snug">{body}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">{action}</div>
    </div>
  );
}

function readThemeCookie(): ThemeChoice {
  const match = document.cookie.match(/(?:^|; )theme=(dark|light)/);
  return (match?.[1] as ThemeChoice | undefined) ?? 'system';
}
