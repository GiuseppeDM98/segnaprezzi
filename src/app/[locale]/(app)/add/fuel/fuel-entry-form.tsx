'use client';

/**
 * The pump form, built to be filled one-handed standing at the pump.
 *
 * Design: the user knows any two of {unit price, quantity, total} — which two
 * depends on whether they filled the tank, paid a round amount, or just read
 * the board. So all three fields are editable and the two touched most
 * recently win; the third follows on every keystroke, marked "calcolato" and
 * briefly highlighted. The server re-derives the same relation, because a
 * stale computed field is exactly what a corrected typo leaves behind.
 *
 * The quantity's unit follows the selected fuel: litres for petrol, diesel
 * and LPG, kilograms for methane (§11.1).
 */
import { ChevronDown, Fuel as FuelIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import { type StoreOption, StorePickerSheet } from '@/components/capture/store-picker-sheet';
import { ScreenHeader } from '@/components/layout/screen-header';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionHeading } from '@/components/ui/section-heading';
import { StickyActionBar } from '@/components/ui/sticky-action-bar';
import { useToast } from '@/components/ui/toast';
import { cx } from '@/lib/cx';
import { FUEL_QUICK_PICKS, type FuelQuickPickKey } from '@/lib/domain/fuel-products';
import {
  calculateFuelQuantity,
  calculateFuelTotalCents,
  calculateUnitPriceMilli,
  centsToEuros,
  milliToEuros,
  toCents,
  toMilli,
} from '@/lib/domain/money';
import { useRouter } from '@/lib/i18n/navigation';
import type { FuelEntryContext } from '@/lib/services/capture-context';
import { createStore } from '../../stores/actions';
import { createFuelEntry } from './actions';

type FuelField = 'unitPrice' | 'quantity' | 'total';

export interface FuelEntryFormProps {
  context: FuelEntryContext;
}

export function FuelEntryForm({ context }: FuelEntryFormProps) {
  const t = useTranslations('addFuel');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const { toast } = useToast();

  const [fuel, setFuel] = useState<FuelQuickPickKey>(FUEL_QUICK_PICKS[0].key);
  const [stations, setStations] = useState<StoreOption[]>(context.stations);
  const [storeId, setStoreId] = useState<string | null>(context.defaultStationId);
  const [isStationPickerOpen, setIsStationPickerOpen] = useState(false);
  const [recordedAtLocal, setRecordedAtLocal] = useState(toLocalDateTimeValue(new Date()));
  const [inputs, setInputs] = useState<Record<FuelField, number | null>>({
    unitPrice: null,
    quantity: null,
    total: null,
  });
  // Most recently edited first; the first two entries are authoritative.
  const [editOrder, setEditOrder] = useState<FuelField[]>(['unitPrice', 'quantity', 'total']);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const derivedField = editOrder[2];
  const triple = deriveTriple(inputs, derivedField);
  const selectedPick = FUEL_QUICK_PICKS.find((pick) => pick.key === fuel) ?? FUEL_QUICK_PICKS[0];
  const selectedStation = stations.find((station) => station.id === storeId) ?? null;

  function handleFieldChange(field: FuelField, value: number | null): void {
    setInputs((current) => ({ ...current, [field]: value }));
    setEditOrder((current) => [field, ...current.filter((item) => item !== field)]);
  }

  /** The typed value for authoritative fields, the computed one otherwise. */
  function fieldValue(field: FuelField): number | null {
    if (field !== derivedField) {
      return inputs[field];
    }
    switch (field) {
      case 'unitPrice':
        return triple.unitPriceMilli > 0 ? milliToEuros(triple.unitPriceMilli) : null;
      case 'quantity':
        return triple.quantity > 0 ? triple.quantity : null;
      default:
        return triple.totalPriceCents > 0 ? centsToEuros(triple.totalPriceCents) : null;
    }
  }

  async function handleCreateStation(name: string): Promise<StoreOption | null> {
    const result = await createStore({ name, chain: null, city: null, kind: 'fuel_station' });
    if (!result.ok) {
      return null;
    }
    const created = { id: result.data.id, name, chain: null };
    setStations((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorCode(null);
    setIsSubmitting(true);

    const result = await createFuelEntry({
      fuel,
      storeId,
      recordedAt: new Date(recordedAtLocal).getTime(),
      unitPriceMilli: triple.unitPriceMilli,
      quantity: triple.quantity,
      totalPriceCents: triple.totalPriceCents,
    });

    setIsSubmitting(false);
    if (!result.ok) {
      setErrorCode(result.error.code);
      toast({ kind: 'error', message: t('submitError') });
      return;
    }
    toast({ kind: 'success', message: t('saved') });
    router.push('/');
  }

  const isDerivedVisible = (field: FuelField): boolean =>
    field === derivedField && fieldValue(field) !== null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col" noValidate>
      <ScreenHeader title={t('title')} />

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 pt-5 pb-6">
        <section className="flex flex-col gap-3">
          <SectionHeading>{t('fuel')}</SectionHeading>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('fuel')}>
            {FUEL_QUICK_PICKS.map((pick) => (
              <Chip
                key={pick.key}
                variant="filter"
                isSelected={fuel === pick.key}
                onClick={() => setFuel(pick.key)}
                data-testid={`fuel-${pick.key}`}
              >
                {t(`products.${pick.key}`)}
              </Chip>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <SectionHeading>{t('amounts')}</SectionHeading>
          <p className="font-sans text-[14px] text-text-muted">{t('twoOfThree')}</p>
          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-3">
            <FuelInput
              label={t(`unitPriceByUnit.${selectedPick.unitKind}`)}
              suffix={t(`unitPriceByUnit.${selectedPick.unitKind}`)}
              testId="fuel-unit-price"
              value={fieldValue('unitPrice')}
              isDerived={isDerivedVisible('unitPrice')}
              computedLabel={tCommon('computed')}
              maxDecimals={3}
              onValueChange={(value) => handleFieldChange('unitPrice', value)}
              error={errorCode === 'INVALID_PRICE' ? tErrors('INVALID_PRICE') : null}
            />
            <FuelInput
              label={t(`quantityByUnit.${selectedPick.unitKind}`)}
              suffix={selectedPick.unitKind === 'weight' ? 'kg' : 'L'}
              testId="fuel-quantity"
              value={fieldValue('quantity')}
              isDerived={isDerivedVisible('quantity')}
              computedLabel={tCommon('computed')}
              maxDecimals={3}
              onValueChange={(value) => handleFieldChange('quantity', value)}
              error={errorCode === 'INVALID_SIZE' ? tErrors('INVALID_SIZE') : null}
            />
            <FuelInput
              label={t('total')}
              suffix="€"
              testId="fuel-total"
              value={fieldValue('total')}
              isDerived={isDerivedVisible('total')}
              computedLabel={tCommon('computed')}
              maxDecimals={2}
              onValueChange={(value) => handleFieldChange('total', value)}
              error={errorCode === 'INCONSISTENT_FUEL_PRICES' ? t('errors.inconsistent') : null}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <SectionHeading>{t('station')}</SectionHeading>
          <button
            type="button"
            onClick={() => setIsStationPickerOpen(true)}
            data-testid="station-picker"
            className="flex h-11 items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 text-left font-sans text-base text-text"
          >
            <span className="flex min-w-0 items-center gap-2">
              <FuelIcon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
              <span className={cx('truncate', !selectedStation && 'text-text-muted')}>
                {selectedStation?.name ?? t('noStation')}
              </span>
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
          </button>
          <Field
            label={t('date')}
            error={errorCode === 'INVALID_DATE' ? tErrors('INVALID_DATE') : null}
          >
            {(controlProps) => (
              <Input
                {...controlProps}
                type="datetime-local"
                value={recordedAtLocal}
                onChange={(event) => setRecordedAtLocal(event.target.value)}
                required
              />
            )}
          </Field>
        </section>

        {errorCode &&
          !['INVALID_PRICE', 'INVALID_SIZE', 'INVALID_DATE', 'INCONSISTENT_FUEL_PRICES'].includes(
            errorCode,
          ) && (
            <p
              role="alert"
              data-testid="fuel-error"
              className="font-sans text-[14px] text-negative"
            >
              {t('submitError')}
            </p>
          )}
      </div>

      <StickyActionBar>
        <div className="mx-auto flex w-full max-w-xl items-center gap-3">
          <Button variant="ghost" onClick={() => router.push('/')}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            size="lg"
            isPending={isSubmitting}
            className="flex-1"
            data-testid="save-fuel"
          >
            {t('submit')}
          </Button>
        </div>
      </StickyActionBar>

      <StorePickerSheet
        isOpen={isStationPickerOpen}
        onClose={() => setIsStationPickerOpen(false)}
        stores={stations}
        selectedId={storeId}
        onSelect={setStoreId}
        onCreate={handleCreateStation}
        noneLabel={t('noStation')}
        title={t('station')}
      />
    </form>
  );
}

function FuelInput({
  label,
  suffix,
  testId,
  value,
  isDerived,
  computedLabel,
  maxDecimals,
  onValueChange,
  error,
}: {
  label: string;
  suffix: string;
  testId: string;
  value: number | null;
  isDerived: boolean;
  computedLabel: string;
  maxDecimals: number;
  onValueChange: (value: number | null) => void;
  error: string | null;
}) {
  return (
    <Field
      label={label}
      error={error}
      trailing={
        isDerived ? (
          <span className="font-mono text-[11px] text-text-muted">{computedLabel}</span>
        ) : undefined
      }
    >
      {(controlProps) => (
        <DecimalInput
          {...controlProps}
          data-testid={testId}
          suffix={suffix}
          size="lg"
          maxDecimals={maxDecimals}
          isHighlighted={isDerived}
          value={value}
          onValueChange={onValueChange}
        />
      )}
    </Field>
  );
}

interface FuelTriple {
  unitPriceMilli: number;
  /** Litres, or kilograms for methane. */
  quantity: number;
  totalPriceCents: number;
}

/**
 * Complete the triple from the two authoritative inputs.
 *
 * Everything is integer money: the unit price is milli-euros (pumps print
 * three decimals), the total is cents, and only the quantity is a real
 * physical amount.
 */
function deriveTriple(
  inputs: Record<FuelField, number | null>,
  derivedField: FuelField,
): FuelTriple {
  const typedUnitPriceMilli = inputs.unitPrice === null ? 0 : toMilli(inputs.unitPrice);
  const typedQuantity = inputs.quantity ?? 0;
  const typedTotalPriceCents = inputs.total === null ? 0 : toCents(inputs.total);

  if (derivedField === 'total') {
    return {
      unitPriceMilli: typedUnitPriceMilli,
      quantity: typedQuantity,
      totalPriceCents:
        typedUnitPriceMilli > 0 && typedQuantity > 0
          ? calculateFuelTotalCents(typedUnitPriceMilli, typedQuantity)
          : 0,
    };
  }

  if (derivedField === 'quantity') {
    return {
      unitPriceMilli: typedUnitPriceMilli,
      quantity:
        typedUnitPriceMilli > 0 && typedTotalPriceCents > 0
          ? calculateFuelQuantity(typedTotalPriceCents, typedUnitPriceMilli)
          : 0,
      totalPriceCents: typedTotalPriceCents,
    };
  }

  return {
    unitPriceMilli:
      typedQuantity > 0 && typedTotalPriceCents > 0
        ? calculateUnitPriceMilli(typedTotalPriceCents, typedQuantity)
        : 0,
    quantity: typedQuantity,
    totalPriceCents: typedTotalPriceCents,
  };
}

/** The value a `datetime-local` input expects: local wall clock, no timezone. */
function toLocalDateTimeValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
