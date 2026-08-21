'use client';

/**
 * The entry sheet (Spec 05 §5.7, §5.8): one observation's full fields, in
 * place editing, and delete with an inline confirm. Shared by the product
 * detail and the timeline; saving and deleting are delegated through
 * callbacks so the component never imports a Server Action.
 */
import { Camera, Fuel, PencilLine, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Toggle } from '@/components/ui/toggle';
import { type EntrySource, PROMO_KINDS, type PromoKind } from '@/lib/domain/entries';
import { centsToEuros, milliToEuros, toCents, toMilli } from '@/lib/domain/money';
import type { UnitKind } from '@/lib/domain/units';
import {
  type AppLocale,
  formatDateTime,
  formatMoney,
  formatPackageSize,
  formatUnitPrice,
} from '@/lib/format';

export interface EntrySheetEntry {
  id: string;
  recordedAt: number;
  store: { id: string; name: string } | null;
  totalPriceCents: number;
  packageSize: number;
  unitPriceMilli: number;
  isPromo: boolean;
  promoKind: PromoKind | null;
  source: EntrySource;
  photoUrl: string | null;
  product: { id: string; name: string; brand: string | null; unitKind: UnitKind };
}

export interface EntrySheetSaveInput {
  recordedAt: number;
  storeId: string | null;
  totalPriceCents: number;
  packageSize: number;
  unitPriceMilli: number;
  isPromo: boolean;
  promoKind: PromoKind | null;
}

export interface EntrySheetProps {
  entry: EntrySheetEntry | null;
  onClose: () => void;
  stores: Array<{ id: string; name: string }>;
  onSave: (entryId: string, input: EntrySheetSaveInput) => Promise<boolean>;
  onDelete: (entryId: string) => Promise<boolean>;
}

export const SOURCE_ICONS: Record<EntrySource, typeof Camera> = {
  photo: Camera,
  manual: PencilLine,
  fuel: Fuel,
};

export function EntrySheet({ entry, onClose, stores, onSave, onDelete }: EntrySheetProps) {
  const t = useTranslations('productDetail');
  const tCommon = useTranslations('common');
  const tReview = useTranslations('review');
  const tUnits = useTranslations('units');
  const locale = useLocale() as AppLocale;

  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [draft, setDraft] = useState<EntrySheetSaveInput | null>(null);

  // A new entry resets the sheet to read mode with a fresh draft.
  useEffect(() => {
    setIsEditing(false);
    setIsConfirmingDelete(false);
    setDraft(
      entry
        ? {
            recordedAt: entry.recordedAt,
            storeId: entry.store?.id ?? null,
            totalPriceCents: entry.totalPriceCents,
            packageSize: entry.packageSize,
            unitPriceMilli: entry.unitPriceMilli,
            isPromo: entry.isPromo,
            promoKind: entry.promoKind,
          }
        : null,
    );
  }, [entry]);

  async function handleSave(): Promise<void> {
    if (!entry || !draft) {
      return;
    }
    setIsPending(true);
    const ok = await onSave(entry.id, draft);
    setIsPending(false);
    if (ok) {
      onClose();
    }
  }

  async function handleDelete(): Promise<void> {
    if (!entry) {
      return;
    }
    setIsPending(true);
    const ok = await onDelete(entry.id);
    setIsPending(false);
    if (ok) {
      onClose();
    }
  }

  const SourceIcon = entry ? SOURCE_ICONS[entry.source] : null;

  return (
    <Sheet
      isOpen={entry !== null}
      onClose={onClose}
      title={entry?.product.name ?? t('entry.title')}
    >
      {entry && draft && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 font-sans text-[13px] text-text-muted">
            {SourceIcon && <SourceIcon aria-hidden="true" className="size-4" />}
            <span>{t(`source.${entry.source}`)}</span>
            {entry.isPromo && (
              <Chip variant="status" tone="promo">
                {t('promo')}
              </Chip>
            )}
          </div>

          {!isEditing ? (
            <>
              <dl className="zebra -mx-2 rounded-control font-mono text-[14px] tabular-nums">
                <Row label={t('entry.date')} value={formatDateTime(entry.recordedAt, locale)} />
                <Row label={t('entry.store')} value={entry.store?.name ?? t('noStore')} />
                <Row label={t('entry.total')} value={formatMoney(entry.totalPriceCents, locale)} />
                <Row
                  label={t('entry.size')}
                  value={formatPackageSize(entry.packageSize, entry.product.unitKind, locale)}
                />
                <Row
                  label={t('entry.unitPrice')}
                  value={formatUnitPrice(entry.unitPriceMilli, entry.product.unitKind, locale)}
                />
                {entry.isPromo && entry.promoKind && (
                  <Row
                    label={t('entry.promoKind')}
                    value={tReview(`promoKinds.${entry.promoKind}`)}
                  />
                )}
              </dl>
              {entry.photoUrl && (
                // biome-ignore lint/performance/noImgElement: Vercel Blob URL outside next/image's remote patterns
                <img
                  src={entry.photoUrl}
                  alt={t('entry.photo')}
                  className="max-h-64 w-full rounded-control bg-camera object-contain"
                />
              )}
              {isConfirmingDelete ? (
                <div className="flex flex-col gap-2 rounded-control border border-negative/40 bg-negative-soft p-3">
                  <p className="font-sans text-[14px] text-text">{t('entry.deleteConfirm')}</p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setIsConfirmingDelete(false)}
                    >
                      {tCommon('cancel')}
                    </Button>
                    <Button
                      variant="danger"
                      className="flex-1"
                      isPending={isPending}
                      onClick={() => void handleDelete()}
                      data-testid="confirm-delete-entry"
                    >
                      {tCommon('delete')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    icon={<PencilLine className="size-4" />}
                    onClick={() => setIsEditing(true)}
                    data-testid="edit-entry"
                  >
                    {tCommon('edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<Trash2 className="size-4 text-negative" />}
                    onClick={() => setIsConfirmingDelete(true)}
                    data-testid="delete-entry"
                  >
                    {tCommon('delete')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <Field label={t('entry.date')}>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    type="datetime-local"
                    value={toLocalDateTimeValue(new Date(draft.recordedAt))}
                    onChange={(event) =>
                      setDraft({ ...draft, recordedAt: new Date(event.target.value).getTime() })
                    }
                  />
                )}
              </Field>
              <Field label={t('entry.store')}>
                {(controlProps) => (
                  <Select
                    {...controlProps}
                    value={draft.storeId ?? ''}
                    onChange={(event) =>
                      setDraft({ ...draft, storeId: event.target.value || null })
                    }
                    placeholderOption={t('noStore')}
                    options={stores.map((store) => ({ value: store.id, label: store.name }))}
                  />
                )}
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label={t('entry.total')}>
                  {(controlProps) => (
                    <DecimalInput
                      {...controlProps}
                      suffix="€"
                      maxDecimals={2}
                      value={draft.totalPriceCents > 0 ? centsToEuros(draft.totalPriceCents) : null}
                      onValueChange={(value) =>
                        setDraft({ ...draft, totalPriceCents: value ? toCents(value) : 0 })
                      }
                      data-testid="entry-total"
                    />
                  )}
                </Field>
                <Field label={t('entry.size')}>
                  {(controlProps) => (
                    <DecimalInput
                      {...controlProps}
                      suffix={tUnits(
                        entry.product.unitKind === 'weight'
                          ? 'kg'
                          : entry.product.unitKind === 'volume'
                            ? 'liter'
                            : 'piece',
                      )}
                      value={draft.packageSize > 0 ? draft.packageSize : null}
                      onValueChange={(value) => setDraft({ ...draft, packageSize: value ?? 0 })}
                    />
                  )}
                </Field>
                <Field label={t('entry.unitPrice')}>
                  {(controlProps) => (
                    <DecimalInput
                      {...controlProps}
                      suffix={tUnits(`perBase.${entry.product.unitKind}`)}
                      value={draft.unitPriceMilli > 0 ? milliToEuros(draft.unitPriceMilli) : null}
                      onValueChange={(value) =>
                        setDraft({ ...draft, unitPriceMilli: value ? toMilli(value) : 0 })
                      }
                    />
                  )}
                </Field>
              </div>
              <Toggle
                label={t('entry.isPromo')}
                isChecked={draft.isPromo}
                onChange={(isPromo) =>
                  setDraft({ ...draft, isPromo, promoKind: isPromo ? draft.promoKind : null })
                }
              />
              {draft.isPromo && (
                <div
                  className="flex flex-wrap gap-2"
                  role="radiogroup"
                  aria-label={t('entry.promoKind')}
                >
                  {PROMO_KINDS.map((kind) => (
                    <Chip
                      key={kind}
                      variant="filter"
                      isSelected={draft.promoKind === kind}
                      onClick={() => setDraft({ ...draft, promoKind: kind })}
                    >
                      {tReview(`promoKinds.${kind}`)}
                    </Chip>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => setIsEditing(false)}>
                  {tCommon('cancel')}
                </Button>
                <Button
                  className="flex-1"
                  isPending={isPending}
                  disabled={
                    draft.totalPriceCents <= 0 ||
                    draft.packageSize <= 0 ||
                    draft.unitPriceMilli <= 0
                  }
                  onClick={() => void handleSave()}
                  data-testid="save-entry-edit"
                >
                  {tCommon('save')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-3">
      <dt className="font-sans text-[14px] text-text-muted">{label}</dt>
      <dd className="text-right text-text">{value}</dd>
    </div>
  );
}

/** The value a `datetime-local` input expects: local wall clock, no timezone. */
function toLocalDateTimeValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
