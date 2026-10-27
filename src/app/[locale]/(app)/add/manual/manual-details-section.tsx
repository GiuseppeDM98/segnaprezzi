'use client';

/**
 * The manual entry form's details section: the promo toggle and kind, the
 * store row that opens the store picker, and the date.
 *
 * Design: presentational. The values belong to the form hook and the store
 * picker sheet stays with the form (it is rendered outside the scrolling
 * content); this section only shows the current store and asks to open it.
 */
import { ChevronDown, Store as StoreIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { PromoFields } from '@/components/entries/promo-fields';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionHeading } from '@/components/ui/section-heading';
import { cx } from '@/lib/cx';
import type { PromoKind } from '@/lib/domain/entries';

export interface ManualDetailsSectionProps {
  isPromo: boolean;
  onIsPromoChange: (isPromo: boolean) => void;
  promoKind: PromoKind | null;
  onPromoKindChange: (kind: PromoKind) => void;
  /** The chosen store's name; null for "no store". */
  storeName: string | null;
  onOpenStorePicker: () => void;
  /** The date-time input's value (local time). */
  recordedAtLocal: string;
  onRecordedAtLocalChange: (value: string) => void;
  /** The last save's error code, when it names one of these fields. */
  fieldError: string | null;
}

/** Render the promo, store and date fields. */
export function ManualDetailsSection({
  isPromo,
  onIsPromoChange,
  promoKind,
  onPromoKindChange,
  storeName,
  onOpenStorePicker,
  recordedAtLocal,
  onRecordedAtLocalChange,
  fieldError,
}: ManualDetailsSectionProps) {
  const t = useTranslations('addManual');
  const tErrors = useTranslations('errors');

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading>{t('detailsTitle')}</SectionHeading>
      <PromoFields
        isPromo={isPromo}
        promoKind={promoKind}
        // The toggle's patch carries the kind too, but the form's setter
        // already clears it when the toggle goes off.
        onChange={(patch) =>
          'isPromo' in patch ? onIsPromoChange(patch.isPromo) : onPromoKindChange(patch.promoKind)
        }
        toggleLabel={t('isPromo')}
        kindLabel={t('promoKind')}
      />
      <div className="flex flex-col gap-1.5">
        <span className="font-sans font-medium text-[15px] text-text">{t('store')}</span>
        <button
          type="button"
          onClick={onOpenStorePicker}
          data-testid="store-picker"
          className="flex h-11 items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 text-left font-sans text-base text-text"
        >
          <span className="flex min-w-0 items-center gap-2">
            <StoreIcon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
            <span className={cx('truncate', storeName === null && 'text-text-muted')}>
              {storeName ?? t('noStore')}
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
        </button>
      </div>
      <Field
        label={t('date')}
        error={fieldError === 'INVALID_DATE' ? tErrors('INVALID_DATE') : null}
      >
        {(controlProps) => (
          <Input
            {...controlProps}
            type="datetime-local"
            value={recordedAtLocal}
            onChange={(event) => onRecordedAtLocalChange(event.target.value)}
            required
          />
        )}
      </Field>
    </section>
  );
}
