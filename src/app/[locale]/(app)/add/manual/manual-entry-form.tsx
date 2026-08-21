'use client';

/**
 * The manual entry form (Spec 03 §10.1 · Spec 05 §5.4): product picker
 * with inline create, the price group with the live-derived unit price,
 * promo/store/date details, and a save bar tuned for entering several
 * prices in a row (the form resets but keeps store and date).
 *
 * Design: the unit price is derived from total ÷ size on every keystroke,
 * but the moment the user types one it stops being derived — some tags
 * genuinely disagree with the arithmetic (deposits, weighed goods), and the
 * tag wins. The 2% cross-check then warns rather than blocks.
 */
import { ChevronDown, Plus, Search, Store as StoreIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, useRef, useState } from 'react';
import { type StoreOption, StorePickerSheet } from '@/components/capture/store-picker-sheet';
import { ScreenHeader } from '@/components/layout/screen-header';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionHeading } from '@/components/ui/section-heading';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { Toggle } from '@/components/ui/toggle';
import { cx } from '@/lib/cx';
import { CATEGORY_IDS, type CategoryId } from '@/lib/domain/categories';
import { PROMO_KINDS, type PromoKind } from '@/lib/domain/entries';
import { calculateUnitPriceMilli, toCents, toMilli } from '@/lib/domain/money';
import {
  convertToBaseUnits,
  SIZE_UNIT_OPTIONS,
  UNIT_KINDS,
  type UnitKind,
} from '@/lib/domain/units';
import { type AppLocale, formatUnitPrice } from '@/lib/format';
import { useRouter } from '@/lib/i18n/navigation';
import type { ManualEntryContext, ProductSummary } from '@/lib/services/capture-context';
import { createStore } from '../../stores/actions';
import { createManualEntry } from './actions';

/** Same tolerance as the extraction cross-check (§7.4): warn beyond 2%. */
const CROSS_CHECK_TOLERANCE = 0.02;

export interface ManualEntryFormProps {
  context: ManualEntryContext;
}

type ProductChoice =
  | { kind: 'existing'; product: ProductSummary }
  | { kind: 'new'; name: string; brand: string; category: CategoryId; unitKind: UnitKind }
  | null;

export function ManualEntryForm({ context }: ManualEntryFormProps) {
  const t = useTranslations('addManual');
  const tCommon = useTranslations('common');
  const tCategories = useTranslations('categories');
  const tUnits = useTranslations('units');
  const tErrors = useTranslations('errors');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { toast } = useToast();

  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<ProductSummary[]>(context.products);
  const [choice, setChoice] = useState<ProductChoice>(null);
  const [stores, setStores] = useState<StoreOption[]>(context.stores);
  const [storeId, setStoreId] = useState<string | null>(context.defaultStoreId);
  const [isStorePickerOpen, setIsStorePickerOpen] = useState(false);
  const [recordedAtLocal, setRecordedAtLocal] = useState(toLocalDateTimeValue(new Date()));
  const [totalEuros, setTotalEuros] = useState<number | null>(null);
  const [sizeValue, setSizeValue] = useState<number | null>(null);
  const [sizeUnitKey, setSizeUnitKey] = useState('kg');
  const [unitPriceEuros, setUnitPriceEuros] = useState<number | null>(null);
  const [isUnitPriceEdited, setIsUnitPriceEdited] = useState(false);
  const [isPromo, setIsPromo] = useState(false);
  const [promoKind, setPromoKind] = useState<PromoKind | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const totalInputRef = useRef<HTMLInputElement | null>(null);

  const activeUnitKind: UnitKind =
    choice?.kind === 'existing' ? choice.product.unitKind : (choice?.unitKind ?? 'weight');
  const sizeUnitOptions = SIZE_UNIT_OPTIONS[activeUnitKind];
  const sizeUnit =
    sizeUnitOptions.find((option) => option.key === sizeUnitKey) ?? sizeUnitOptions[0];

  const totalPriceCents = totalEuros === null ? 0 : toCents(totalEuros);
  const packageSize = sizeValue === null ? 0 : convertToBaseUnits(sizeValue, sizeUnit.toBase);
  const derivedUnitPriceMilli =
    totalPriceCents > 0 && packageSize > 0
      ? calculateUnitPriceMilli(totalPriceCents, packageSize)
      : 0;
  const unitPriceMilli = isUnitPriceEdited
    ? unitPriceEuros === null
      ? 0
      : toMilli(unitPriceEuros)
    : derivedUnitPriceMilli;

  const hasCrossCheckWarning =
    isUnitPriceEdited &&
    totalPriceCents > 0 &&
    packageSize > 0 &&
    unitPriceMilli > 0 &&
    Math.abs(unitPriceMilli * packageSize - totalPriceCents * 10) >
      CROSS_CHECK_TOLERANCE * totalPriceCents * 10;

  const normalizedQuery = query.trim().toLowerCase();
  const hits = normalizedQuery
    ? products
        .filter(
          (product) =>
            product.name.toLowerCase().includes(normalizedQuery) ||
            product.brand?.toLowerCase().includes(normalizedQuery),
        )
        .slice(0, 8)
    : [];

  function pickExisting(product: ProductSummary): void {
    setChoice({ kind: 'existing', product });
    setSizeUnitKey(SIZE_UNIT_OPTIONS[product.unitKind][0].key);
    setQuery('');
    requestAnimationFrame(() => totalInputRef.current?.focus());
  }

  function startNew(name: string): void {
    setChoice({ kind: 'new', name, brand: '', category: 'food', unitKind: 'weight' });
    setSizeUnitKey('kg');
    setQuery('');
  }

  function resetAfterSave(): void {
    setChoice(null);
    setTotalEuros(null);
    setSizeValue(null);
    setUnitPriceEuros(null);
    setIsUnitPriceEdited(false);
    setIsPromo(false);
    setPromoKind(null);
    setErrorCode(null);
  }

  async function handleCreateStore(name: string): Promise<StoreOption | null> {
    const result = await createStore({ name, chain: null, city: null, kind: 'supermarket' });
    if (!result.ok) {
      return null;
    }
    const created = { id: result.data.id, name, chain: null };
    setStores((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!choice) {
      setErrorCode('MISSING_PRODUCT');
      return;
    }
    setErrorCode(null);
    setIsSubmitting(true);

    const result = await createManualEntry({
      product:
        choice.kind === 'existing'
          ? { kind: 'existing', productId: choice.product.id }
          : {
              kind: 'new',
              name: choice.name,
              brand: choice.brand || null,
              category: choice.category,
              unitKind: choice.unitKind,
            },
      storeId,
      recordedAt: new Date(recordedAtLocal).getTime(),
      totalPriceCents,
      packageSize,
      unitPriceMilli,
      isPromo,
      promoKind: isPromo ? promoKind : null,
    });

    setIsSubmitting(false);
    if (!result.ok) {
      setErrorCode(result.error.code);
      toast({ kind: 'error', message: t('submitError') });
      return;
    }
    toast({ kind: 'success', message: t('saved') });
    resetAfterSave();
    // A freshly created product joins the local catalog for the next entry.
    if (choice.kind === 'new') {
      setProducts((current) => [
        ...current,
        {
          id: result.data.productId,
          name: choice.name,
          brand: choice.brand || null,
          category: choice.category,
          unitKind: choice.unitKind,
        },
      ]);
    }
  }

  const selectedStore = stores.find((store) => store.id === storeId) ?? null;
  const fieldError = errorCode && errorCode !== 'MISSING_PRODUCT' ? errorCode : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col" noValidate>
      <ScreenHeader title={t('title')} />

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 pt-5 pb-6">
        {/* Product */}
        <section className="flex flex-col gap-3">
          <SectionHeading>{t('product')}</SectionHeading>
          {choice === null ? (
            <>
              <Field
                label={t('productSearch')}
                isRequired
                error={errorCode === 'MISSING_PRODUCT' ? t('missingProduct') : null}
              >
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('productSearchPlaceholder')}
                    prefix={<Search className="size-4" />}
                    autoComplete="off"
                    data-testid="product-search"
                  />
                )}
              </Field>
              {products.length === 0 && !normalizedQuery && (
                <p className="font-sans text-[14px] text-text-muted">{t('noProducts')}</p>
              )}
              {(hits.length > 0 || normalizedQuery) && (
                <ul className="zebra -mx-1 rounded-control">
                  {hits.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => pickExisting(product)}
                        className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left hover:bg-accent-soft"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-[14px] text-text">
                            {product.name}
                          </span>
                          {product.brand && (
                            <span className="truncate font-sans text-[12px] text-text-muted">
                              {product.brand}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-sans text-[12px] text-text-muted">
                          {tCategories(product.category)}
                        </span>
                      </button>
                    </li>
                  ))}
                  {normalizedQuery && (
                    <li>
                      <button
                        type="button"
                        onClick={() => startNew(query.trim())}
                        data-testid="create-product"
                        className="flex min-h-12 w-full items-center gap-3 px-3 text-left font-sans font-medium text-[15px] text-accent-ink hover:bg-accent-soft"
                      >
                        <Plus aria-hidden="true" className="size-4" />
                        {t('createProduct', { query: query.trim() })}
                      </button>
                    </li>
                  )}
                </ul>
              )}
              {products.length === 0 && !normalizedQuery && (
                <Button
                  variant="secondary"
                  onClick={() => startNew('')}
                  icon={<Plus className="size-4" />}
                >
                  {t('newProduct')}
                </Button>
              )}
            </>
          ) : choice.kind === 'existing' ? (
            <div className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface px-3 py-2">
              <span className="flex min-w-0 flex-col">
                <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
                  {t('productChosen')}
                </span>
                <span className="truncate font-sans font-medium text-[15px] text-text">
                  {choice.product.brand ? `${choice.product.brand} ` : ''}
                  {choice.product.name}
                </span>
              </span>
              <Button variant="ghost" onClick={() => setChoice(null)}>
                {t('changeProduct')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-control border border-accent/40 bg-accent-soft/40 p-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
                  {t('newProduct')}
                </span>
                <Button variant="ghost" onClick={() => setChoice(null)}>
                  {t('changeProduct')}
                </Button>
              </div>
              <Field label={t('productName')} isRequired>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={choice.name}
                    onChange={(event) => setChoice({ ...choice, name: event.target.value })}
                    data-testid="new-product-name"
                    autoFocus={choice.name === ''}
                  />
                )}
              </Field>
              <Field label={t('brand')}>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={choice.brand}
                    onChange={(event) => setChoice({ ...choice, brand: event.target.value })}
                    data-testid="new-product-brand"
                  />
                )}
              </Field>
              <Field label={t('category')}>
                {(controlProps) => (
                  <Select
                    {...controlProps}
                    value={choice.category}
                    onChange={(event) =>
                      setChoice({ ...choice, category: event.target.value as CategoryId })
                    }
                    options={CATEGORY_IDS.map((category) => ({
                      value: category,
                      label: tCategories(category),
                    }))}
                  />
                )}
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="font-sans font-medium text-[15px] text-text">{t('unitKind')}</span>
                <Segmented
                  label={t('unitKind')}
                  value={choice.unitKind}
                  onChange={(unitKind: UnitKind) => {
                    setChoice({ ...choice, unitKind });
                    setSizeUnitKey(SIZE_UNIT_OPTIONS[unitKind][0].key);
                  }}
                  options={UNIT_KINDS.map((unitKind) => ({
                    value: unitKind,
                    label: tUnits(unitKind),
                  }))}
                />
              </div>
            </div>
          )}
        </section>

        {/* Price */}
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
                onValueChange={setTotalEuros}
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
                  onValueChange={setSizeValue}
                  data-testid="package-size"
                />
              )}
            </Field>
            <Field label={t('sizeUnit')}>
              {(controlProps) => (
                <Select
                  {...controlProps}
                  value={sizeUnit.key}
                  onChange={(event) => setSizeUnitKey(event.target.value)}
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
                suffix={tUnits(`perBase.${activeUnitKind}`)}
                isHighlighted={!isUnitPriceEdited && derivedUnitPriceMilli > 0}
                value={
                  isUnitPriceEdited
                    ? unitPriceEuros
                    : derivedUnitPriceMilli > 0
                      ? derivedUnitPriceMilli / 1000
                      : null
                }
                onValueChange={(value) => {
                  setIsUnitPriceEdited(true);
                  setUnitPriceEuros(value);
                }}
                data-testid="unit-price"
              />
            )}
          </Field>
          {unitPriceMilli > 0 && (
            <p className="font-mono text-[13px] text-text-muted tabular-nums">
              {formatUnitPrice(unitPriceMilli, activeUnitKind, locale)}
            </p>
          )}
        </section>

        {/* Details */}
        <section className="flex flex-col gap-4">
          <SectionHeading>{t('detailsTitle')}</SectionHeading>
          <Toggle
            label={t('isPromo')}
            isChecked={isPromo}
            onChange={(next) => {
              setIsPromo(next);
              if (!next) {
                setPromoKind(null);
              }
            }}
          />
          {isPromo && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('promoKind')}>
              {PROMO_KINDS.map((kind) => (
                <Chip
                  key={kind}
                  variant="filter"
                  isSelected={promoKind === kind}
                  onClick={() => setPromoKind(kind)}
                >
                  {t(`promoKinds.${kind}`)}
                </Chip>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="font-sans font-medium text-[15px] text-text">{t('store')}</span>
            <button
              type="button"
              onClick={() => setIsStorePickerOpen(true)}
              data-testid="store-picker"
              className="flex h-11 items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 text-left font-sans text-base text-text"
            >
              <span className="flex min-w-0 items-center gap-2">
                <StoreIcon aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
                <span className={cx('truncate', !selectedStore && 'text-text-muted')}>
                  {selectedStore?.name ?? t('noStore')}
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
                onChange={(event) => setRecordedAtLocal(event.target.value)}
                required
              />
            )}
          </Field>
        </section>

        {fieldError && !['INVALID_PRICE', 'INVALID_SIZE', 'INVALID_DATE'].includes(fieldError) && (
          <p role="alert" className="font-sans text-[14px] text-negative">
            {t('submitError')}
          </p>
        )}
      </div>

      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-20 border-border border-t border-dashed bg-surface/95 px-4 pt-3 pb-11 backdrop-blur-sm rail:bottom-0 rail:pb-3">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3">
          <Button variant="ghost" onClick={() => router.push('/')}>
            {tCommon('done')}
          </Button>
          <Button
            type="submit"
            size="lg"
            isPending={isSubmitting}
            className="flex-1"
            data-testid="save-entry"
          >
            {t('submit')}
          </Button>
        </div>
      </div>

      <StorePickerSheet
        isOpen={isStorePickerOpen}
        onClose={() => setIsStorePickerOpen(false)}
        stores={stores}
        selectedId={storeId}
        onSelect={setStoreId}
        onCreate={handleCreateStore}
        noneLabel={t('noStore')}
        title={t('store')}
      />
    </form>
  );
}

/** The value a `datetime-local` input expects: local wall clock, no timezone. */
function toLocalDateTimeValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
