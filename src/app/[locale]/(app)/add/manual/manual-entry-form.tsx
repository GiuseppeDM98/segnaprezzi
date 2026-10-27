'use client';

/**
 * The manual entry form: product picker
 * with inline create, the price group with the live-derived unit price,
 * promo/store/date details, and a save bar tuned for entering several
 * prices in a row (the form resets but keeps store and date).
 *
 * Design: the unit price is derived from total ÷ size on every keystroke,
 * but the moment the user types one it stops being derived — some tags
 * genuinely disagree with the arithmetic (deposits, weighed goods), and the
 * tag wins. The 2% cross-check then warns rather than blocks.
 *
 * This file is the orchestrator: it owns the save (the Server Action calls,
 * their error and pending state) and the store picker. The fields live in
 * useManualEntryForm, the numbers in manual-entry-derivations.ts, and each
 * section of the form in its own file beside this one.
 */
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { StorePickerSheet } from '@/components/capture/store-picker-sheet';
import { useStoreOptions } from '@/components/capture/use-store-options';
import { ScreenHeader } from '@/components/layout/screen-header';
import { useToast } from '@/components/ui/toast';
import { callAction } from '@/lib/call-action';
import { parseDateTimeLocalValue } from '@/lib/format';
import { useRouter } from '@/lib/i18n/navigation';
import type { ManualEntryContext } from '@/lib/services/capture-context';
import { createStore } from '../../stores/actions';
import { createManualEntry } from './actions';
import { ManualDetailsSection } from './manual-details-section';
import { toCreatedProduct, toProductInput } from './manual-entry-derivations';
import { ManualPriceSection } from './manual-price-section';
import { ManualProductSection } from './manual-product-section';
import { ManualSubmitBar } from './manual-submit-bar';
import { useManualEntryForm } from './use-manual-entry-form';

/** Save error codes a field shows under itself; any other code gets the generic line. */
const FIELD_ERROR_CODES = ['INVALID_PRICE', 'INVALID_SIZE', 'INVALID_DATE'];

export interface ManualEntryFormProps {
  context: ManualEntryContext;
}

export function ManualEntryForm({ context }: ManualEntryFormProps) {
  const t = useTranslations('addManual');
  const router = useRouter();
  const { toast } = useToast();

  const form = useManualEntryForm(context);
  const { stores, createStore: handleCreateStore } = useStoreOptions(
    context.stores,
    createStore,
    'supermarket',
  );
  const [isStorePickerOpen, setIsStorePickerOpen] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const { choice } = form;
    if (!choice) {
      setErrorCode('MISSING_PRODUCT');
      return;
    }
    // The input is `required`, so this holds only an emptied value the
    // browser let through; the server would answer the same code.
    const recordedAt = parseDateTimeLocalValue(form.recordedAtLocal);
    if (recordedAt === null) {
      setErrorCode('INVALID_DATE');
      return;
    }
    setErrorCode(null);
    setIsSubmitting(true);

    const result = await callAction(
      'createManualEntry',
      createManualEntry({
        product: toProductInput(choice),
        storeId: form.storeId,
        recordedAt,
        totalPriceCents: form.price.totalPriceCents,
        packageSize: form.price.packageSize,
        unitPriceMilli: form.price.unitPriceMilli,
        isPromo: form.isPromo,
        promoKind: form.isPromo ? form.promoKind : null,
      }),
    );

    setIsSubmitting(false);
    if (!result.ok) {
      setErrorCode(result.error.code);
      toast({ kind: 'error', message: t('submitError') });
      return;
    }
    toast({ kind: 'success', message: t('saved') });
    form.resetEntry();
    setErrorCode(null);
    // A freshly created product joins the local catalog for the next entry.
    if (choice.kind === 'new') {
      form.addProduct(toCreatedProduct(choice, result.data.productId));
    }
  }

  const selectedStore = stores.find((store) => store.id === form.storeId) ?? null;
  const fieldError = errorCode && errorCode !== 'MISSING_PRODUCT' ? errorCode : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col" noValidate>
      <ScreenHeader title={t('title')} />

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 pt-5 pb-6">
        <ManualProductSection
          choice={form.choice}
          query={form.query}
          onQueryChange={form.setQuery}
          normalizedQuery={form.normalizedQuery}
          hits={form.hits}
          isCatalogEmpty={form.products.length === 0}
          isMissingProduct={errorCode === 'MISSING_PRODUCT'}
          onPickExisting={form.pickExisting}
          onStartNew={form.startNew}
          onClearChoice={form.clearChoice}
          onNewProductChange={form.updateNewProduct}
          onNewProductUnitKindChange={form.setNewProductUnitKind}
        />

        <ManualPriceSection
          unitKind={form.activeUnitKind}
          totalEuros={form.totalEuros}
          onTotalChange={form.setTotalEuros}
          totalInputRef={form.totalInputRef}
          sizeValue={form.sizeValue}
          onSizeChange={form.setSizeValue}
          sizeUnitOptions={form.sizeUnitOptions}
          sizeUnitKey={form.sizeUnitKey}
          onSizeUnitChange={form.setSizeUnitKey}
          unitPriceEuros={form.unitPriceEuros}
          isUnitPriceEdited={form.isUnitPriceEdited}
          onUnitPriceChange={form.editUnitPrice}
          price={form.price}
          fieldError={fieldError}
        />

        <ManualDetailsSection
          isPromo={form.isPromo}
          onIsPromoChange={form.setIsPromo}
          promoKind={form.promoKind}
          onPromoKindChange={form.setPromoKind}
          storeName={selectedStore?.name ?? null}
          onOpenStorePicker={() => setIsStorePickerOpen(true)}
          recordedAtLocal={form.recordedAtLocal}
          onRecordedAtLocalChange={form.setRecordedAtLocal}
          fieldError={fieldError}
        />

        {fieldError && !FIELD_ERROR_CODES.includes(fieldError) && (
          <p role="alert" className="font-sans text-[14px] text-negative">
            {t('submitError')}
          </p>
        )}
      </div>

      <ManualSubmitBar isSubmitting={isSubmitting} onDone={() => router.push('/')} />

      <StorePickerSheet
        isOpen={isStorePickerOpen}
        onClose={() => setIsStorePickerOpen(false)}
        stores={stores}
        selectedId={form.storeId}
        onSelect={form.setStoreId}
        onCreate={handleCreateStore}
        noneLabel={t('noStore')}
        title={t('store')}
      />
    </form>
  );
}
