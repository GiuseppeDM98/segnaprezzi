'use client';

/**
 * The pump form (Spec 03 §11.2).
 *
 * Design: the user knows any two of {unit price, quantity, total} — which two
 * depends on whether they filled the tank, paid a round amount, or just read
 * the board. So all three fields are editable and the two touched most
 * recently win; the third follows on every keystroke. The server re-derives
 * the same relation, because a stale computed field is exactly what a
 * corrected typo leaves behind.
 *
 * The quantity's unit follows the selected fuel: litres for petrol, diesel
 * and LPG, kilograms for methane (§11.1).
 */
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import { FUEL_QUICK_PICKS, type FuelQuickPickKey } from '@/lib/domain/fuel-products';
import {
  calculateFuelQuantity,
  calculateFuelTotalCents,
  calculateUnitPriceMilli,
  centsToEuros,
  milliToEuros,
  parseDecimalInput,
  toCents,
  toMilli,
} from '@/lib/domain/money';
import { useRouter } from '@/lib/i18n/navigation';
import type { FuelEntryContext } from '@/lib/services/capture-context';
import { createFuelEntry } from './actions';

type FuelField = 'unitPrice' | 'quantity' | 'total';

export interface FuelEntryFormProps {
  context: FuelEntryContext;
}

export function FuelEntryForm({ context }: FuelEntryFormProps) {
  const t = useTranslations('addFuel');
  const router = useRouter();

  const [fuel, setFuel] = useState<FuelQuickPickKey>(FUEL_QUICK_PICKS[0].key);
  const [storeId, setStoreId] = useState(context.defaultStationId ?? '');
  const [recordedAtLocal, setRecordedAtLocal] = useState(toLocalDateTimeValue(new Date()));
  const [inputs, setInputs] = useState<Record<FuelField, string>>({
    unitPrice: '',
    quantity: '',
    total: '',
  });
  // Most recently edited first; the first two entries are authoritative.
  const [editOrder, setEditOrder] = useState<FuelField[]>(['unitPrice', 'quantity', 'total']);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const derivedField = editOrder[2];
  const triple = deriveTriple(inputs, derivedField);
  const selectedPick = FUEL_QUICK_PICKS.find((pick) => pick.key === fuel) ?? FUEL_QUICK_PICKS[0];

  function handleFieldChange(field: FuelField, value: string): void {
    setInputs((current) => ({ ...current, [field]: value }));
    setEditOrder((current) => [field, ...current.filter((item) => item !== field)]);
  }

  /** The typed value for authoritative fields, the computed one otherwise. */
  function fieldValue(field: FuelField): string {
    if (field !== derivedField) {
      return inputs[field];
    }
    switch (field) {
      case 'unitPrice':
        return triple.unitPriceMilli > 0 ? String(milliToEuros(triple.unitPriceMilli)) : '';
      case 'quantity':
        return triple.quantity > 0 ? String(triple.quantity) : '';
      default:
        return triple.totalPriceCents > 0 ? String(centsToEuros(triple.totalPriceCents)) : '';
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorCode(null);
    setIsSubmitting(true);

    const result = await createFuelEntry({
      fuel,
      storeId: storeId || null,
      recordedAt: new Date(recordedAtLocal).getTime(),
      unitPriceMilli: triple.unitPriceMilli,
      quantity: triple.quantity,
      totalPriceCents: triple.totalPriceCents,
    });

    setIsSubmitting(false);
    if (!result.ok) {
      setErrorCode(result.error.code);
      return;
    }
    // Back to the dashboard: /history is Spec 05's screen and does not exist yet.
    router.push('/');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="font-medium text-sm">{t('fuel')}</legend>
        {FUEL_QUICK_PICKS.map((pick) => (
          <button
            key={pick.key}
            type="button"
            onClick={() => setFuel(pick.key)}
            className={`rounded-full border px-4 py-2 text-sm ${
              fuel === pick.key ? 'border-accent bg-accent text-accent-contrast' : 'border-border'
            }`}
          >
            {t(`products.${pick.key}`)}
          </button>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        {t('station')}
        <select
          value={storeId}
          onChange={(event) => setStoreId(event.target.value)}
          className="rounded-lg border border-border bg-surface p-2"
        >
          <option value="">{t('noStation')}</option>
          {context.stations.map((station) => (
            <option key={station.id} value={station.id}>
              {station.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t('date')}
        <input
          type="datetime-local"
          value={recordedAtLocal}
          onChange={(event) => setRecordedAtLocal(event.target.value)}
          required
          className="rounded-lg border border-border p-2"
        />
      </label>

      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t(`unitPriceByUnit.${selectedPick.unitKind}`)}
          <input
            type="text"
            inputMode="decimal"
            data-testid="fuel-unit-price"
            value={fieldValue('unitPrice')}
            onChange={(event) => handleFieldChange('unitPrice', event.target.value)}
            className="rounded-lg border border-border p-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t(`quantityByUnit.${selectedPick.unitKind}`)}
          <input
            type="text"
            inputMode="decimal"
            data-testid="fuel-quantity"
            value={fieldValue('quantity')}
            onChange={(event) => handleFieldChange('quantity', event.target.value)}
            className="rounded-lg border border-border p-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('total')}
          <input
            type="text"
            inputMode="decimal"
            data-testid="fuel-total"
            value={fieldValue('total')}
            onChange={(event) => handleFieldChange('total', event.target.value)}
            className="rounded-lg border border-border p-2"
          />
        </label>
      </div>

      {errorCode && (
        <p role="alert" data-testid="fuel-error" className="text-negative text-sm">
          {errorCode === 'INCONSISTENT_FUEL_PRICES' ? t('errors.inconsistent') : t('submitError')}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-full bg-accent px-6 py-3 font-medium text-accent-contrast disabled:opacity-40"
      >
        {t('submit')}
      </button>
    </form>
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
function deriveTriple(inputs: Record<FuelField, string>, derivedField: FuelField): FuelTriple {
  const typedUnitPriceMilli = toIntegerOrZero(inputs.unitPrice, toMilli);
  const typedQuantity = toNumberOrZero(inputs.quantity);
  const typedTotalPriceCents = toIntegerOrZero(inputs.total, toCents);

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

function toIntegerOrZero(raw: string, convert: (value: number) => number): number {
  const parsed = parseDecimalInput(raw);
  return Number.isFinite(parsed) ? convert(parsed) : 0;
}

function toNumberOrZero(raw: string): number {
  const parsed = parseDecimalInput(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
