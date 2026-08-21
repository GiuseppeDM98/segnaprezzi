'use client';

/**
 * Client half of the receipt upload screen.
 *
 * Design: a single indeterminate "Leggo lo scontrino…" state rather than a
 * fake progress bar. A 40-line receipt takes 6–12 s on Haiku 4.5 and the
 * response is not streamed in v1, so a bar would be decoration pretending to
 * be information — which DESIGN.md rules out explicitly.
 *
 * Offline the upload is disabled outright: there is no queue behind this
 * screen (§1 "out of scope"), and a PDF from an e-mail is never captured in
 * an aisle with no signal.
 */
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { type StoreOption, StorePickerSheet } from '@/components/capture/store-picker-sheet';
import { ScreenHeader } from '@/components/layout/screen-header';
import { ReceiptDropzone } from '@/components/receipt/receipt-dropzone';
import { Button } from '@/components/ui/button';
import { type AppLocale, formatCount } from '@/lib/format';
import { useRouter } from '@/lib/i18n/navigation';
import { compressPhoto } from '@/lib/offline/compress';
import { useOnlineStatus } from '@/lib/offline/use-online-status';
import type { StoreSummary } from '@/lib/services/capture-context';
import { createStore } from '../../stores/actions';

/** Mirrors the route handler's cap so the client fails fast. */
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

const BYTES_PER_KB = 1024;

export interface ReceiptUploadScreenProps {
  stores: StoreSummary[];
  defaultStoreId: string | null;
}

export function ReceiptUploadScreen({ stores, defaultStoreId }: ReceiptUploadScreenProps) {
  const t = useTranslations('receipt');
  const tErrors = useTranslations('errors');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const isOnline = useOnlineStatus();

  const [storeOptions, setStoreOptions] = useState<StoreOption[]>(
    stores.map((store) => ({ id: store.id, name: store.name, chain: store.chain })),
  );
  const [storeId, setStoreId] = useState<string | null>(defaultStoreId);
  const [isStorePickerOpen, setIsStorePickerOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  function handleSelect(selected: File | null): void {
    setErrorCode(null);
    if (selected && selected.size > MAX_RECEIPT_BYTES) {
      setFile(null);
      setErrorCode('RECEIPT_TOO_LARGE');
      return;
    }
    setFile(selected);
  }

  async function handleCreateStore(name: string): Promise<StoreOption | null> {
    const result = await createStore({ name, chain: null, city: null, kind: 'supermarket' });
    if (!result.ok) {
      return null;
    }
    const created = { id: result.data.id, name, chain: null };
    setStoreOptions((current) =>
      [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
    );
    return created;
  }

  async function handleSubmit(): Promise<void> {
    if (!file) {
      return;
    }
    setIsReading(true);
    setErrorCode(null);
    try {
      const body = new FormData();
      body.set('file', await toUploadFile(file));
      if (storeId) {
        body.set('storeId', storeId);
      }

      const response = await fetch('/api/extract-receipt', { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) {
        setErrorCode(payload?.error?.code ?? 'INTERNAL');
        return;
      }
      router.push(`/add/receipt/review?receiptId=${encodeURIComponent(payload.receiptId)}`);
    } catch {
      // A network failure here is indistinguishable from being offline; the
      // banner above already says so, and this keeps the button usable.
      setErrorCode('EXTRACTION_UNAVAILABLE');
    } finally {
      setIsReading(false);
    }
  }

  const selectedStore = storeOptions.find((store) => store.id === storeId) ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title={t('title')} backHref="/" />

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pt-4 pb-8">
        <p className="text-pretty font-sans text-[15px] text-text-muted">{t('intro')}</p>

        {!isOnline && (
          <p
            data-testid="receipt-offline"
            className="rounded-control border border-warning/40 bg-warning-soft px-3 py-2 font-sans text-[14px] text-text"
          >
            {t('offline')}
          </p>
        )}

        <ReceiptDropzone
          file={file}
          onSelect={handleSelect}
          disabled={!isOnline || isReading}
          sizeLabel={
            file
              ? t('fileSize', { size: formatCount(Math.round(file.size / BYTES_PER_KB), locale) })
              : null
          }
        />

        <div className="flex items-center justify-between gap-3 border-border border-t border-dashed pt-3">
          <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
            {t('store')}
          </span>
          <button
            type="button"
            onClick={() => setIsStorePickerOpen(true)}
            data-testid="receipt-store"
            className="min-h-11 truncate px-2 text-right font-sans text-[15px] text-accent-ink"
          >
            {selectedStore?.name ?? t('detectStore')}
          </button>
        </div>

        {errorCode && (
          <p
            data-testid="receipt-error"
            className="rounded-control border border-negative/40 bg-negative-soft px-3 py-2 font-sans text-[14px] text-text"
          >
            {tErrors(errorCode)}
          </p>
        )}

        <Button
          size="lg"
          onClick={() => void handleSubmit()}
          isPending={isReading}
          disabled={!file || !isOnline || isReading}
          data-testid="receipt-submit"
        >
          {isReading ? t('reading') : t('submit')}
        </Button>
      </div>

      <StorePickerSheet
        isOpen={isStorePickerOpen}
        onClose={() => setIsStorePickerOpen(false)}
        stores={storeOptions}
        selectedId={storeId}
        onSelect={setStoreId}
        onCreate={handleCreateStore}
        noneLabel={t('detectStore')}
        title={t('store')}
      />
    </div>
  );
}

/**
 * PDFs go up untouched; photos go through the capture pipeline's compressor first.
 *
 * A paper receipt is tall and narrow, and 1600 px on the long edge is what
 * keeps 8-pt thermal print legible while capping the image-token cost — the
 * same tradeoff the capture pipeline already made, so the same function.
 */
async function toUploadFile(file: File): Promise<File> {
  if (file.type === 'application/pdf') {
    return file;
  }
  const compressed = await compressPhoto(file);
  return new File([compressed.blob], 'receipt', { type: compressed.mimeType });
}
