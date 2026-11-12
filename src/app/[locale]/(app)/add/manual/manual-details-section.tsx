'use client';

/**
 * The manual entry form's details section: the promo toggle and kind, and
 * the date.
 *
 * Design: presentational. The values belong to the form hook.
 */
import { useTranslations } from 'next-intl';

import { PromoFields } from '@/components/entries/promo-fields';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionHeading } from '@/components/ui/section-heading';
import type { PromoKind } from '@/lib/domain/entries';

export interface ManualDetailsSectionProps {
  isPromo: boolean;
  onIsPromoChange: (isPromo: boolean) => void;
  promoKind: PromoKind | null;
  onPromoKindChange: (kind: PromoKind) => void;
  /** The date-time input's value (local time). */
  recordedAtLocal: string;
  onRecordedAtLocalChange: (value: string) => void;
  /** The last save's error code, when it names one of these fields. */
  fieldError: string | null;
}

/** Render the promo and date fields. */
export function ManualDetailsSection({
  isPromo,
  onIsPromoChange,
  promoKind,
  onPromoKindChange,
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
