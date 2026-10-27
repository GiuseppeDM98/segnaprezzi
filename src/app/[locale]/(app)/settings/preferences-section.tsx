'use client';

/**
 * The Settings section for display preferences: the language (which
 * switches the [locale] segment) and the theme (system, light, dark).
 * Controlled: the screen holds the theme choice read from the cookie and
 * applies a new one through src/lib/theme.ts, and performs the locale
 * switch; this component renders the two toggles.
 */
import { useTranslations } from 'next-intl';

import { SectionHeading } from '@/components/ui/section-heading';
import { Segmented } from '@/components/ui/segmented';
import { type Locale, routing } from '@/lib/i18n/routing';
import type { ThemeChoice } from '@/lib/theme';

export interface PreferencesSectionProps {
  locale: Locale;
  onLocaleChange: (next: Locale) => void;
  theme: ThemeChoice;
  onThemeChange: (next: ThemeChoice) => void;
}

/** Render the language and theme toggles, one per supported locale and theme choice. */
export function PreferencesSection({
  locale,
  onLocaleChange,
  theme,
  onThemeChange,
}: PreferencesSectionProps) {
  const t = useTranslations('settings');

  return (
    <section aria-labelledby="settings-preferences" className="flex flex-col gap-4">
      <SectionHeading id="settings-preferences">{t('preferences.title')}</SectionHeading>
      <div className="flex flex-col gap-1.5">
        <span className="font-sans font-medium text-[15px] text-text">
          {t('preferences.language')}
        </span>
        <Segmented<Locale>
          label={t('preferences.language')}
          value={locale}
          onChange={onLocaleChange}
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
          onChange={onThemeChange}
          options={[
            { value: 'system', label: t('preferences.themeSystem') },
            { value: 'light', label: t('preferences.themeLight') },
            { value: 'dark', label: t('preferences.themeDark') },
          ]}
        />
      </div>
    </section>
  );
}
