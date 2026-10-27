'use client';

/**
 * The Settings section for the options the personal index is computed
 * with: whether promo prices count, and how many months a missing price is
 * carried forward. Controlled: the settings and the optimistic save with
 * its rollback belong to the screen; each control reports the one field it
 * changes as a patch.
 */
import { useTranslations } from 'next-intl';

import { SectionHeading } from '@/components/ui/section-heading';
import { Stepper } from '@/components/ui/stepper';
import { Toggle } from '@/components/ui/toggle';
import { MAX_CARRY_FORWARD_MONTHS } from '@/lib/inflation';
import type { IndexSettings } from '@/lib/services/settings';

/** Render the index options; `onPatch` receives only the fields the user changed. */
export function IndexSettingsSection({
  settings,
  onPatch,
}: {
  settings: IndexSettings;
  onPatch: (patch: Partial<IndexSettings>) => void;
}) {
  const t = useTranslations('settings');
  const carryForwardLabel =
    settings.carryForwardMonths === 0
      ? t('index.disabled')
      : t('index.months', { count: settings.carryForwardMonths });

  return (
    <section aria-labelledby="settings-index" className="flex flex-col gap-4">
      <SectionHeading
        id="settings-index"
        trailing={
          <span className="font-sans text-[12px] text-text-muted">{t('index.recomputeNote')}</span>
        }
      >
        {t('index.title')}
      </SectionHeading>
      <Toggle
        label={t('index.includePromos')}
        description={t('index.includePromosHelp')}
        isChecked={settings.includePromosInIndex}
        onChange={(includePromosInIndex) => onPatch({ includePromosInIndex })}
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
          max={MAX_CARRY_FORWARD_MONTHS}
          onChange={(carryForwardMonths) => onPatch({ carryForwardMonths })}
          valueLabel={carryForwardLabel}
          decrementLabel={t('index.decrement')}
          incrementLabel={t('index.increment')}
        />
      </div>
    </section>
  );
}
