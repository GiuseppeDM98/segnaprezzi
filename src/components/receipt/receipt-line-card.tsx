'use client';

/**
 * One editable receipt line.
 *
 * Design: the same printed block as the capture review card —
 * hairline frame, status as a tinted header row rather than a thick border,
 * money fields in the print face — with the receipt's own two additions: the
 * verbatim `rawLine` under the fields, because it is the only trace of a
 * document the app deliberately does not keep, and the "remember this
 * line" toggle that turns one correction into a permanent shortcut.
 *
 * An excluded line collapses to a single muted row instead of disappearing:
 * the receipt's order is the user's mental model of the trip, and a hole in
 * it reads as data lost.
 */
import { TriangleAlert, Undo2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Chip } from '@/components/ui/chip';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Stepper } from '@/components/ui/stepper';
import { Toggle } from '@/components/ui/toggle';
import type { LineReviewReason } from '@/lib/ai/flag-receipt';
import { cx } from '@/lib/cx';
import { PROMO_KINDS, type PromoKind } from '@/lib/domain/entries';
import { centsToEuros, milliToEuros, toCents, toMilli } from '@/lib/domain/money';
import type { ReceiptLineStatus, SizeSource } from '@/lib/domain/receipt-lines';
import type { UnitKind } from '@/lib/domain/units';

/** Highest quantity a single receipt line plausibly carries. */
const MAX_QUANTITY = 99;

/** Which status chip tone each state gets — one meaning per color (DESIGN.md). */
const STATUS_TONE: Record<ReceiptLineStatus, 'neutral' | 'warning' | 'positive'> = {
  ready: 'positive',
  'needs-size': 'warning',
  'needs-product': 'warning',
  'needs-review': 'warning',
};

const STATUS_KEY: Record<ReceiptLineStatus, string> = {
  ready: 'ready',
  'needs-size': 'needsSize',
  'needs-product': 'needsProduct',
  'needs-review': 'needsReview',
};

const REASON_KEY: Record<LineReviewReason, string> = {
  'low-confidence': 'lowLineConfidence',
  'qty-price-mismatch': 'qtyPriceMismatch',
  'zero-price': 'zeroPrice',
};

const SIZE_SOURCE_KEY: Partial<Record<SizeSource, string>> = {
  receipt: 'sizeFromReceipt',
  catalog: 'sizeFromCatalog',
  weighed: 'sizeWeighed',
  'assumed-one': 'sizeAssumed',
};

export interface ReceiptLineCardFields {
  quantity: number;
  packageSize: number | null;
  sizeSource: SizeSource;
  totalPriceCents: number;
  unitPriceMilli: number | null;
  isPromo: boolean;
  promoKind: PromoKind | null;
  unitKind: UnitKind;
}

export interface ReceiptLineCardProduct {
  /** Display name of the chosen (or proposed) product. */
  label: string;
  brand: string | null;
  kind: 'existing' | 'new';
  isArchived: boolean;
}

export interface ReceiptLineCardSameDay {
  /** Pre-formatted price and source label — the card never calls Intl. */
  price: string;
  source: string;
}

export interface ReceiptLineCardProps {
  rawLine: string;
  /**
   * How many identical printed lines this card stands for. > 1 means the
   * import folded them into one observation bought that many times.
   */
  mergedLineCount?: number;
  status: ReceiptLineStatus;
  reviewReasons: LineReviewReason[];
  fields: ReceiptLineCardFields;
  product: ReceiptLineCardProduct | null;
  sameDay: ReceiptLineCardSameDay | null;
  isExcluded: boolean;
  learnAlias: boolean;
  /** Pre-formatted unit symbols ("€/kg", "kg") from the units namespace. */
  unitSymbol: string;
  sizeSymbol: string;
  onChange: (patch: Partial<ReceiptLineCardFields>) => void;
  onOpenMatch: () => void;
  onToggleExcluded: () => void;
  onToggleLearnAlias: (learnAlias: boolean) => void;
  'data-testid'?: string;
}

export function ReceiptLineCard({
  rawLine,
  mergedLineCount = 1,
  status,
  reviewReasons,
  fields,
  product,
  sameDay,
  isExcluded,
  learnAlias,
  unitSymbol,
  sizeSymbol,
  onChange,
  onOpenMatch,
  onToggleExcluded,
  onToggleLearnAlias,
  ...rest
}: ReceiptLineCardProps) {
  const t = useTranslations('receipt.review');
  const tStatus = useTranslations('receipt.status');
  const tCommon = useTranslations('common');
  const tReview = useTranslations('review');

  if (isExcluded) {
    return (
      <article
        data-testid={rest['data-testid']}
        className="flex items-center justify-between gap-3 rounded-control border border-border border-dashed bg-surface px-3 py-2"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
            {t('excluded')}
          </span>
          <span className="truncate font-mono text-[13px] text-text-muted line-through">
            {rawLine}
          </span>
        </span>
        <IconButton icon={<Undo2 />} label={t('include')} onClick={onToggleExcluded} />
      </article>
    );
  }

  const isFlagged = status !== 'ready';
  const sizeHintKey = SIZE_SOURCE_KEY[fields.sizeSource];

  return (
    <article
      data-testid={rest['data-testid']}
      data-status={status}
      className={cx(
        'flex flex-col overflow-hidden rounded-control border bg-surface',
        isFlagged ? 'border-warning/50' : 'border-border',
      )}
    >
      {isFlagged && (
        <div
          className="flex items-start gap-2 bg-warning-soft px-3 py-2 font-sans text-[13px] text-text"
          data-testid="receipt-line-flag"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="flex flex-col">
            <span className="font-semibold">{tStatus(STATUS_KEY[status])}</span>
            {status === 'needs-size' && <span className="text-text-muted">{t('needsSize')}</span>}
            {status === 'needs-product' && (
              <span className="text-text-muted">{t('needsProduct')}</span>
            )}
            {reviewReasons.map((reason) => (
              <span key={reason} className="text-text-muted">
                {t(REASON_KEY[reason])}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
            {t('fields.product')}
          </span>
          <span className="truncate font-sans font-medium text-[15px] text-text">
            {product
              ? `${product.brand ? `${product.brand} ` : ''}${product.label}`
              : t('needsProduct')}
          </span>
          <div className="flex items-center gap-2">
            {product?.kind === 'new' && (
              <Chip variant="status" tone="accent">
                {tReview('newProduct')}
              </Chip>
            )}
            {product?.isArchived && (
              <Chip variant="status" tone="neutral">
                {t('archived')}
              </Chip>
            )}
            {status === 'ready' && (
              <Chip variant="status" tone={STATUS_TONE.ready}>
                {tStatus('ready')}
              </Chip>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onOpenMatch}
            data-testid="receipt-match-row"
            className="min-h-11 shrink-0 px-2 font-sans text-[13px] text-accent-ink underline decoration-border underline-offset-4"
          >
            {tCommon('edit')}
          </button>
          <IconButton
            icon={<X />}
            label={t('exclude')}
            onClick={onToggleExcluded}
            data-testid="receipt-exclude"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-3 pt-3">
        <Field label={t('fields.totalPrice')} isRequired className="gap-1">
          {(controlProps) => (
            <DecimalInput
              {...controlProps}
              data-testid="receipt-field-total"
              suffix="€"
              maxDecimals={2}
              value={fields.totalPriceCents > 0 ? centsToEuros(fields.totalPriceCents) : null}
              onValueChange={(value) => onChange({ totalPriceCents: value ? toCents(value) : 0 })}
            />
          )}
        </Field>
        <Field
          label={t('fields.packageSize')}
          isRequired
          className="gap-1"
          trailing={
            sizeHintKey ? (
              <span className="font-mono text-[11px] text-text-muted">{t(sizeHintKey)}</span>
            ) : undefined
          }
        >
          {(controlProps) => (
            <DecimalInput
              {...controlProps}
              data-testid="receipt-field-size"
              suffix={sizeSymbol}
              value={fields.packageSize}
              onValueChange={(value) => onChange({ packageSize: value })}
            />
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 items-end gap-3 px-3 pt-3">
        <Field label={t('fields.unitPrice')} isRequired className="gap-1">
          {(controlProps) => (
            <DecimalInput
              {...controlProps}
              data-testid="receipt-field-unit-price"
              suffix={unitSymbol}
              isHighlighted={fields.unitPriceMilli !== null}
              value={fields.unitPriceMilli !== null ? milliToEuros(fields.unitPriceMilli) : null}
              onValueChange={(value) => onChange({ unitPriceMilli: value ? toMilli(value) : null })}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <span className="font-sans font-medium text-[15px] text-text leading-tight">
            {t('fields.quantity')}
          </span>
          <Stepper
            value={fields.quantity}
            min={1}
            max={MAX_QUANTITY}
            valueLabel={String(fields.quantity)}
            decrementLabel={`${t('fields.quantity')} −1`}
            incrementLabel={`${t('fields.quantity')} +1`}
            onChange={(quantity) => onChange({ quantity })}
          />
        </div>
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
                size="sm"
                isSelected={fields.promoKind === kind}
                onClick={() => onChange({ promoKind: kind })}
              >
                {tReview(`promoKinds.${kind}`)}
              </Chip>
            ))}
          </div>
        )}
        <Toggle
          label={t('learnAlias')}
          description={t('learnAliasHint')}
          isChecked={learnAlias}
          onChange={onToggleLearnAlias}
        />
      </div>

      {sameDay && (
        <p
          data-testid="receipt-same-day"
          className="mx-3 mt-3 rounded-control bg-band px-3 py-2 font-sans text-[13px] text-text-muted"
        >
          {t('sameDay', { source: sameDay.source, price: sameDay.price })}
        </p>
      )}

      <div className="mt-3 border-border border-t border-dashed px-3 py-2">
        {/* Said next to the printed text, because that is where the user is
            comparing the screen against the paper and would otherwise count
            one line too few. */}
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
            {t('rawLine')}
          </span>
          {mergedLineCount > 1 && (
            <Chip variant="status" tone="neutral" data-testid="receipt-merged-lines">
              {t('mergedLines', { count: mergedLineCount })}
            </Chip>
          )}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[13px] text-text-muted">
          {rawLine}
        </span>
      </div>
    </article>
  );
}
