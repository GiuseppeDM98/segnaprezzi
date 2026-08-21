'use client';

/**
 * One editable review card: thumbnail, the extraction
 * fields, the match row and the needsReview flag. The card is a printed
 * block on the sheet: a hairline frame, the flag as a warning-tinted header
 * row (never a thick colored border), the money fields in the print face.
 */
import { ImageOff, MoreHorizontal, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Chip } from '@/components/ui/chip';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Toggle } from '@/components/ui/toggle';
import type { ExtractionResult } from '@/lib/ai/extraction-schema';
import type { ReviewReason } from '@/lib/ai/flag-extraction';
import { cx } from '@/lib/cx';
import { CATEGORY_IDS, type CategoryId } from '@/lib/domain/categories';
import { PROMO_KINDS, type PromoKind } from '@/lib/domain/entries';
import { centsToEuros, milliToEuros, toCents, toMilli } from '@/lib/domain/money';
import { UNIT_KINDS, type UnitKind } from '@/lib/domain/units';

export interface ExtractionCardMatch {
  kind: 'existing' | 'new';
  /** Display name of the chosen product (existing) or of the new one. */
  label: string;
  brand: string | null;
}

export interface ExtractionCardProps {
  blobUrl: string;
  fields: ExtractionResult;
  match: ExtractionCardMatch | null;
  isFlagged: boolean;
  reviewReasons: ReviewReason[];
  /** True when the extraction itself failed and every field started empty. */
  isExtractionFailed?: boolean;
  isUnitPriceDerived: boolean;
  onChange: (patch: Partial<ExtractionResult>) => void;
  onOpenMatch: () => void;
  onDiscard: () => void;
  'data-testid'?: string;
}

export function ExtractionCard({
  blobUrl,
  fields,
  match,
  isFlagged,
  reviewReasons,
  isExtractionFailed = false,
  isUnitPriceDerived,
  onChange,
  onOpenMatch,
  onDiscard,
  ...rest
}: ExtractionCardProps) {
  const t = useTranslations('review');
  const tCommon = useTranslations('common');
  const tCategories = useTranslations('categories');
  const tUnits = useTranslations('units');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const unitSymbol = tUnits(`perBase.${fields.unitKind}`);
  const sizeSymbol = tUnits(
    fields.unitKind === 'weight' ? 'kg' : fields.unitKind === 'volume' ? 'liter' : 'piece',
  );

  return (
    <article
      data-testid={rest['data-testid']}
      className={cx(
        'flex flex-col overflow-hidden rounded-control border bg-surface',
        isFlagged ? 'border-warning/50' : 'border-border',
      )}
    >
      {(isFlagged || isExtractionFailed) && (
        <div
          className="flex items-start gap-2 bg-warning-soft px-3 py-2 font-sans text-[13px] text-text"
          data-testid="needs-review-badge"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="flex flex-col">
            <span className="font-semibold">
              {isExtractionFailed ? t('extractionFailed') : t('needsReview')}
            </span>
            {isExtractionFailed ? (
              <span className="text-text-muted">{t('extractionFailedBody')}</span>
            ) : (
              reviewReasons.map((reason) => (
                <span key={reason} className="text-text-muted">
                  {t(reason === 'price-mismatch' ? 'priceMismatch' : 'lowConfidence')}
                </span>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 p-3">
        <button
          type="button"
          onClick={() => setIsPreviewOpen(true)}
          aria-label={t('photoPreview')}
          className="relative size-20 shrink-0 overflow-hidden rounded-control bg-camera"
        >
          {blobUrl ? (
            // biome-ignore lint/performance/noImgElement: a Vercel Blob URL outside next/image's remote patterns
            <img src={blobUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageOff
              aria-hidden="true"
              className="absolute inset-0 m-auto size-6 text-camera-contrast/60"
            />
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Field label={t('fields.productName')} isRequired className="gap-1">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={fields.productName}
                onChange={(event) => onChange({ productName: event.target.value })}
                autoComplete="off"
              />
            )}
          </Field>
          <Field label={t('fields.brand')} className="gap-1">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={fields.brand ?? ''}
                onChange={(event) => onChange({ brand: event.target.value || null })}
                autoComplete="off"
              />
            )}
          </Field>
        </div>

        <IconButton
          icon={<MoreHorizontal />}
          label={tCommon('edit')}
          onClick={() => setIsMenuOpen(true)}
          className="-mt-1 -mr-1"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 px-3">
        <Field label={t('fields.category')} className="gap-1">
          {(controlProps) => (
            <Select
              {...controlProps}
              value={fields.category}
              onChange={(event) => onChange({ category: event.target.value as CategoryId })}
              options={CATEGORY_IDS.map((category) => ({
                value: category,
                label: tCategories(category),
              }))}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <span className="font-sans font-medium text-[15px] text-text leading-tight">
            {t('fields.unitKind')}
          </span>
          <Segmented
            label={t('fields.unitKind')}
            value={fields.unitKind}
            onChange={(unitKind: UnitKind) => onChange({ unitKind })}
            options={UNIT_KINDS.map((unitKind) => ({ value: unitKind, label: tUnits(unitKind) }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 px-3 pt-3">
        <Field label={t('fields.totalPrice')} isRequired className="gap-1">
          {(controlProps) => (
            <DecimalInput
              {...controlProps}
              data-testid="field-total-price"
              suffix="€"
              maxDecimals={2}
              value={fields.totalPriceCents > 0 ? centsToEuros(fields.totalPriceCents) : null}
              onValueChange={(value) => onChange({ totalPriceCents: value ? toCents(value) : 0 })}
            />
          )}
        </Field>
        <Field label={t('fields.packageSize')} isRequired className="gap-1">
          {(controlProps) => (
            <DecimalInput
              {...controlProps}
              suffix={sizeSymbol}
              value={fields.packageSize > 0 ? fields.packageSize : null}
              onValueChange={(value) => onChange({ packageSize: value ?? 0 })}
            />
          )}
        </Field>
        <Field
          label={t('fields.unitPrice')}
          isRequired
          className="gap-1"
          trailing={
            isUnitPriceDerived && fields.unitPriceMilli > 0 ? (
              <span className="font-mono text-[11px] text-text-muted">{tCommon('computed')}</span>
            ) : undefined
          }
        >
          {(controlProps) => (
            <DecimalInput
              {...controlProps}
              suffix={unitSymbol}
              isHighlighted={isUnitPriceDerived && fields.unitPriceMilli > 0}
              value={fields.unitPriceMilli > 0 ? milliToEuros(fields.unitPriceMilli) : null}
              onValueChange={(value) => onChange({ unitPriceMilli: value ? toMilli(value) : 0 })}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-col gap-2 px-3 pt-3">
        <Toggle
          label={t('fields.isPromo')}
          isChecked={fields.isPromo}
          onChange={(isPromo) =>
            onChange({ isPromo, promoKind: isPromo ? fields.promoKind : null })
          }
        />
        {fields.isPromo && (
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label={t('fields.promoKind')}
          >
            {PROMO_KINDS.map((kind) => (
              <Chip
                key={kind}
                variant="filter"
                isSelected={fields.promoKind === kind}
                onClick={() => onChange({ promoKind: kind as PromoKind })}
              >
                {t(`promoKinds.${kind}`)}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onOpenMatch}
        data-testid="match-row"
        className={cx(
          'mx-3 mt-3 mb-3 flex min-h-12 items-center justify-between gap-3 rounded-control border px-3 text-left transition-colors hover:bg-band',
          match ? 'border-border' : 'border-accent bg-accent-soft',
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
            {match ? t('matchChosen') : t('matchPicker')}
          </span>
          <span className="truncate font-sans font-medium text-[15px] text-text">
            {match
              ? match.kind === 'new'
                ? t('matchNew', { name: match.label })
                : `${match.brand ? `${match.brand} ` : ''}${match.label}`
              : t('matchPick')}
          </span>
        </span>
        <span className="shrink-0 font-sans text-[13px] text-accent-ink">{tCommon('edit')}</span>
      </button>

      <Sheet
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title={t('photoPreview')}
      >
        {blobUrl ? (
          // biome-ignore lint/performance/noImgElement: Vercel Blob URL, see above
          <img
            src={blobUrl}
            alt={t('photoAlt')}
            className="max-h-[70dvh] w-full rounded-control bg-camera object-contain"
          />
        ) : (
          <p className="text-text-muted">{t('extractionFailedBody')}</p>
        )}
      </Sheet>

      <Sheet isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)}>
        <button
          type="button"
          onClick={() => {
            setIsMenuOpen(false);
            onDiscard();
          }}
          className="flex min-h-12 w-full items-center gap-3 rounded-control px-3 font-sans font-medium text-[15px] text-negative hover:bg-negative-soft"
        >
          <Trash2 aria-hidden="true" className="size-5" />
          {t('discard')}
        </button>
      </Sheet>
    </article>
  );
}
