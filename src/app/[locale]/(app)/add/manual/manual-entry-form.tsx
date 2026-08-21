'use client';

/**
 * The manual entry form (Spec 03 §10.1).
 *
 * Design: the unit price is derived from total ÷ size on every keystroke, but
 * the moment the user types one it stops being derived — some tags genuinely
 * disagree with the arithmetic (deposits, weighed goods), and overriding must
 * be possible. The 2% cross-check then warns rather than blocks, for the same
 * reason.
 */
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

import { CATEGORY_IDS, type CategoryId } from '@/lib/domain/categories';
import { PROMO_KINDS, type PromoKind } from '@/lib/domain/entries';
import {
  calculateUnitPriceMilli,
  milliToEuros,
  parseDecimalInput,
  toCents,
  toMilli,
} from '@/lib/domain/money';
import {
  convertToBaseUnits,
  SIZE_UNIT_OPTIONS,
  UNIT_KINDS,
  type UnitKind,
} from '@/lib/domain/units';
import { useRouter } from '@/lib/i18n/navigation';
import type { ManualEntryContext } from '@/lib/services/capture-context';
import { createManualEntry } from './actions';

/** Same tolerance as the extraction cross-check (§7.4): warn beyond 2%. */
const CROSS_CHECK_TOLERANCE = 0.02;

export interface ManualEntryFormProps {
  context: ManualEntryContext;
}

export function ManualEntryForm({ context }: ManualEntryFormProps) {
  const t = useTranslations('addManual');
  const tCategories = useTranslations('categories');
  const tUnits = useTranslations('units');
  const router = useRouter();

  const [productId, setProductId] = useState<string>(context.products[0]?.id ?? '');
  const [isCreatingProduct, setIsCreatingProduct] = useState(context.products.length === 0);
  const [newProductName, setNewProductName] = useState('');
  const [newProductBrand, setNewProductBrand] = useState('');
  const [newProductCategory, setNewProductCategory] = useState<CategoryId>('food');
  const [newProductUnitKind, setNewProductUnitKind] = useState<UnitKind>('weight');

  const [storeId, setStoreId] = useState(context.defaultStoreId ?? '');
  const [recordedAtLocal, setRecordedAtLocal] = useState(toLocalDateTimeValue(new Date()));
  const [totalPriceInput, setTotalPriceInput] = useState('');
  const [packageSizeInput, setPackageSizeInput] = useState('');
  const [sizeUnitKey, setSizeUnitKey] = useState('kg');
  const [unitPriceInput, setUnitPriceInput] = useState('');
  const [isUnitPriceEdited, setIsUnitPriceEdited] = useState(false);
  const [isPromo, setIsPromo] = useState(false);
  const [promoKind, setPromoKind] = useState<PromoKind | ''>('');

  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedProduct = context.products.find((product) => product.id === productId);
  const activeUnitKind = isCreatingProduct
    ? newProductUnitKind
    : (selectedProduct?.unitKind ?? 'weight');
  const sizeUnitOptions = SIZE_UNIT_OPTIONS[activeUnitKind];
  const sizeUnit =
    sizeUnitOptions.find((option) => option.key === sizeUnitKey) ?? sizeUnitOptions[0];

  const totalPriceCents = toIntegerOrZero(totalPriceInput, toCents);
  const packageSize = toBaseUnits(packageSizeInput, sizeUnit.toBase);
  const derivedUnitPriceMilli =
    totalPriceCents > 0 && packageSize > 0
      ? calculateUnitPriceMilli(totalPriceCents, packageSize)
      : 0;
  const unitPriceMilli = isUnitPriceEdited
    ? toIntegerOrZero(unitPriceInput, toMilli)
    : derivedUnitPriceMilli;

  const hasCrossCheckWarning =
    isUnitPriceEdited &&
    totalPriceCents > 0 &&
    packageSize > 0 &&
    unitPriceMilli > 0 &&
    Math.abs(unitPriceMilli * packageSize - totalPriceCents * 10) >
      CROSS_CHECK_TOLERANCE * totalPriceCents * 10;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorCode(null);
    setIsSubmitting(true);

    const result = await createManualEntry({
      product: isCreatingProduct
        ? {
            kind: 'new',
            name: newProductName,
            brand: newProductBrand || null,
            category: newProductCategory,
            unitKind: newProductUnitKind,
          }
        : { kind: 'existing', productId },
      storeId: storeId || null,
      recordedAt: new Date(recordedAtLocal).getTime(),
      totalPriceCents,
      packageSize,
      unitPriceMilli,
      isPromo,
      promoKind: isPromo && promoKind ? promoKind : null,
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
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium text-sm">{t('product')}</legend>
        {context.products.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="product-mode"
              checked={!isCreatingProduct}
              onChange={() => setIsCreatingProduct(false)}
            />
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              disabled={isCreatingProduct}
              className="flex-1 rounded-lg border border-border bg-surface p-2"
            >
              {context.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.brand ? `${product.brand} ` : ''}
                  {product.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="product-mode"
            checked={isCreatingProduct}
            onChange={() => setIsCreatingProduct(true)}
          />
          {t('newProduct')}
        </label>

        {isCreatingProduct && (
          <div className="flex flex-col gap-2 pl-6">
            <input
              value={newProductName}
              onChange={(event) => setNewProductName(event.target.value)}
              placeholder={t('productName')}
              required
              className="rounded-lg border border-border p-2"
            />
            <input
              value={newProductBrand}
              onChange={(event) => setNewProductBrand(event.target.value)}
              placeholder={t('brand')}
              className="rounded-lg border border-border p-2"
            />
            <select
              value={newProductCategory}
              onChange={(event) => setNewProductCategory(event.target.value as CategoryId)}
              className="rounded-lg border border-border bg-surface p-2"
            >
              {CATEGORY_IDS.map((category) => (
                <option key={category} value={category}>
                  {tCategories(category)}
                </option>
              ))}
            </select>
            <select
              value={newProductUnitKind}
              onChange={(event) => {
                const unitKind = event.target.value as UnitKind;
                setNewProductUnitKind(unitKind);
                setSizeUnitKey(SIZE_UNIT_OPTIONS[unitKind][0].key);
              }}
              className="rounded-lg border border-border bg-surface p-2"
            >
              {UNIT_KINDS.map((unitKind) => (
                <option key={unitKind} value={unitKind}>
                  {tUnits(unitKind)}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        {t('store')}
        <select
          value={storeId}
          onChange={(event) => setStoreId(event.target.value)}
          className="rounded-lg border border-border bg-surface p-2"
        >
          <option value="">{t('noStore')}</option>
          {context.stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
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

      <label className="flex flex-col gap-1 text-sm">
        {t('totalPrice')}
        <input
          type="text"
          inputMode="decimal"
          value={totalPriceInput}
          onChange={(event) => setTotalPriceInput(event.target.value)}
          required
          className="rounded-lg border border-border p-2"
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          {t('packageSize')}
          <input
            type="text"
            inputMode="decimal"
            value={packageSizeInput}
            onChange={(event) => setPackageSizeInput(event.target.value)}
            required
            className="rounded-lg border border-border p-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('sizeUnit')}
          <select
            value={sizeUnit.key}
            onChange={(event) => setSizeUnitKey(event.target.value)}
            className="rounded-lg border border-border bg-surface p-2"
          >
            {sizeUnitOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {tUnits(option.key)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        {t('unitPrice')}
        <input
          type="text"
          inputMode="decimal"
          value={isUnitPriceEdited ? unitPriceInput : formatDerivedUnitPrice(unitPriceMilli)}
          onChange={(event) => {
            setIsUnitPriceEdited(true);
            setUnitPriceInput(event.target.value);
          }}
          className="rounded-lg border border-border p-2"
        />
      </label>

      {hasCrossCheckWarning && <p className="text-sm text-warning">{t('crossCheckWarning')}</p>}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isPromo}
          onChange={(event) => {
            setIsPromo(event.target.checked);
            if (!event.target.checked) {
              setPromoKind('');
            }
          }}
        />
        {t('isPromo')}
      </label>

      {isPromo && (
        <div className="flex flex-wrap gap-2">
          {PROMO_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setPromoKind(kind)}
              className={`rounded-full border px-3 py-1 text-sm ${
                promoKind === kind
                  ? 'border-accent bg-accent text-accent-contrast'
                  : 'border-border'
              }`}
            >
              {t(`promoKinds.${kind}`)}
            </button>
          ))}
        </div>
      )}

      {errorCode && (
        <p role="alert" className="text-negative text-sm">
          {t('submitError')}
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

/** The value a `datetime-local` input expects: local wall clock, no timezone. */
function toLocalDateTimeValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** Parse a typed amount into its integer money representation, 0 when empty. */
function toIntegerOrZero(raw: string, convert: (value: number) => number): number {
  const parsed = parseDecimalInput(raw);
  return Number.isFinite(parsed) ? convert(parsed) : 0;
}

/** Convert a typed size into base units (kg / L / pieces), 0 when empty. */
function toBaseUnits(raw: string, toBase: number): number {
  const parsed = parseDecimalInput(raw);
  return Number.isFinite(parsed) ? convertToBaseUnits(parsed, toBase) : 0;
}

/** The derived unit price as an editable field value, blank while unknown. */
function formatDerivedUnitPrice(unitPriceMilli: number): string {
  return unitPriceMilli > 0 ? String(milliToEuros(unitPriceMilli)) : '';
}
