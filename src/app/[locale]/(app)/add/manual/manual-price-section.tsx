'use client';

/**
 * The manual entry form's price section: the total, the size with its unit,
 * and the unit price — shown as derived from total ÷ size until the user
 * types one, then cross-checked against them.
 *
 * Design: presentational. The raw field values and every derived number
 * (computeManualPrice) come from the form hook; this section decides how the
 * derived-or-typed state reads: the "computed" tag, the highlight, the hint
 * and the 2% warning.
 */
import { useLocale, useTranslations } from 'next-intl';
import type { RefObject } from 'react';

import { DecimalInput } from '@/components/ui/decimal-input';
import { Field } from '@/components/ui/field';
import { SectionHeading } from '@/components/ui/section-heading';
import { Select } from '@/components/ui/select';
import { milliToEuros } from '@/lib/domain/money';
import type { SizeUnitOption, UnitKind } from '@/lib/domain/units';
import { type AppLocale, formatUnitPrice } from '@/lib/format';
import type { ManualPrice } from './manual-entry-derivations';

export interface ManualPriceSectionProps {
  unitKind: UnitKind;
  totalEuros: number | null;
  onTotalChange: (value: number | null) => void;
  /** Focused by the form after a catalog pick. */
  totalInputRef: RefObject<HTMLInputElement | null>;
  sizeValue: number | null;
  onSizeChange: (value: number | null) => void;
  sizeUnitOptions: SizeUnitOption[];
  sizeUnitKey: string;
  onSizeUnitChange: (key: string) => void;
  unitPriceEuros: number | null;
  isUnitPriceEdited: boolean;
  onUnitPriceChange: (value: number | null) => void;
  price: ManualPrice;
  /** The last save's error code, when it names one of these fields. */
  fieldError: string | null;
}

/** Render the total, size and unit price fields. */
export function ManualPriceSection({
  unitKind,
  totalEuros,
  onTotalChange,
  totalInputRef,
  sizeValue,
  onSizeChange,
  sizeUnitOptions,
  sizeUnitKey,
  onSizeUnitChange,
  unitPriceEuros,
  isUnitPriceEdited,
  onUnitPriceChange,
  price,
  fieldError,
}: ManualPriceSectionProps) {
  const t = useTranslations('addManual');
  const tCommon = useTranslations('common');
  const tUnits = useTranslations('units');
  const tErrors = useTranslations('errors');
  const locale = useLocale() as AppLocale;
  const { derivedUnitPriceMilli, unitPriceMilli, hasCrossCheckWarning } = price;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>{t('priceTitle')}</SectionHeading>
      <Field
        label={t('totalPrice')}
        isRequired
        error={fieldError === 'INVALID_PRICE' ? tErrors('INVALID_PRICE') : null}
      >
        {(controlProps) => (
          <DecimalInput
            {...controlProps}
            ref={totalInputRef}
            suffix="€"
            size="lg"
            maxDecimals={2}
            value={totalEuros}
            onValueChange={onTotalChange}
            data-testid="total-price"
          />
        )}
      </Field>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field
          label={t('packageSize')}
          isRequired
          error={fieldError === 'INVALID_SIZE' ? tErrors('INVALID_SIZE') : null}
        >
          {(controlProps) => (
            <DecimalInput
              {...controlProps}
              value={sizeValue}
              onValueChange={onSizeChange}
              data-testid="package-size"
            />
          )}
        </Field>
        <Field label={t('sizeUnit')}>
          {(controlProps) => (
            <Select
              {...controlProps}
              value={sizeUnitKey}
              onChange={(event) => onSizeUnitChange(event.target.value)}
              options={sizeUnitOptions.map((option) => ({
                value: option.key,
                label: tUnits(option.key),
              }))}
              className="w-24"
              data-testid="size-unit"
            />
          )}
        </Field>
      </div>
      <Field
        label={t('unitPrice')}
        hint={isUnitPriceEdited ? undefined : t('unitPriceHint')}
        error={hasCrossCheckWarning ? t('crossCheckWarning') : null}
        trailing={
          !isUnitPriceEdited && derivedUnitPriceMilli > 0 ? (
            <span className="font-mono text-[11px] text-text-muted">{tCommon('computed')}</span>
          ) : undefined
        }
      >
        {(controlProps) => (
          <DecimalInput
            {...controlProps}
            suffix={tUnits(`perBase.${unitKind}`)}
            isHighlighted={!isUnitPriceEdited && derivedUnitPriceMilli > 0}
            value={
              isUnitPriceEdited
                ? unitPriceEuros
                : derivedUnitPriceMilli > 0
                  ? milliToEuros(derivedUnitPriceMilli)
                  : null
            }
            onValueChange={onUnitPriceChange}
            data-testid="unit-price"
          />
        )}
      </Field>
      {unitPriceMilli > 0 && (
        <p className="font-mono text-[13px] text-text-muted tabular-nums">
          {formatUnitPrice(unitPriceMilli, unitKind, locale)}
        </p>
      )}
    </section>
  );
}
