'use client';

/**
 * Client half of the product detail. The screen owns the state (chart
 * range, which sheet is open, the edit draft, the pending flags) and every
 * product and entry action; the parts it renders live beside it: the chart
 * and stat tiles (price-overview), the per-store comparison
 * (store-comparison-section), the entries list (price-history-list), the
 * overflow menu (product-menu-sheet) and the edit form (edit-product-sheet).
 * The delete
 * confirmation and the entry sheet are shared components.
 */
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  EntrySheet,
  type EntrySheetEntry,
  type EntrySheetSaveInput,
} from '@/components/entries/entry-sheet';
import { ScreenHeader } from '@/components/layout/screen-header';
import { DeleteProductsSheet } from '@/components/products/delete-products-sheet';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { useToast } from '@/components/ui/toast';
import { callAction, describeActionError } from '@/lib/call-action';
import { useRouter } from '@/lib/i18n/navigation';
import type { ProductDetail } from '@/lib/services/product-detail';
import { deleteProducts, setProductArchived, updateProduct } from '../actions';
import { deletePriceEntry, updatePriceEntry } from './actions';
import type { ChartRange } from './chart-window';
import { EditProductSheet, type ProductDraft } from './edit-product-sheet';
import { PriceHistoryList } from './price-history-list';
import { PriceOverview } from './price-overview';
import { ProductMenuSheet } from './product-menu-sheet';
import { StoreComparisonSection } from './store-comparison-section';

export interface ProductDetailScreenProps {
  detail: ProductDetail;
  stores: Array<{ id: string; name: string }>;
}

export function ProductDetailScreen({ detail, stores }: ProductDetailScreenProps) {
  const t = useTranslations('productDetail');
  const tCommon = useTranslations('common');
  const tProducts = useTranslations('products');
  const tCategories = useTranslations('categories');
  const tUnits = useTranslations('units');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const { toast } = useToast();

  const [range, setRange] = useState<ChartRange>('12');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editDraft, setEditDraft] = useState<ProductDraft>({
    name: detail.product.name,
    brand: detail.product.brand ?? '',
    category: detail.product.category,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [activeEntry, setActiveEntry] = useState<EntrySheetEntry | null>(null);

  const { product, stats, storeComparison, entries } = detail;

  async function handleArchiveToggle(): Promise<void> {
    setIsMenuOpen(false);
    const result = await callAction(
      'setProductArchived',
      setProductArchived({ productId: product.id, isArchived: !product.isArchived }),
    );
    if (!result.ok) {
      toast({ kind: 'error', message: describeActionError(result.error, tErrors, t('saveError')) });
      return;
    }
    toast({ kind: 'success', message: product.isArchived ? t('restored') : t('archived') });
    router.refresh();
  }

  async function handleDelete(): Promise<void> {
    setIsDeleting(true);
    const result = await callAction('deleteProducts', deleteProducts({ productIds: [product.id] }));
    setIsDeleting(false);
    if (!result.ok) {
      toast({
        kind: 'error',
        message: describeActionError(result.error, tErrors, tProducts('deleteError')),
      });
      return;
    }
    setIsDeleteOpen(false);
    toast({ kind: 'success', message: tProducts('deleted', { count: 1 }) });
    // The product this screen is about no longer exists, so there is nothing
    // to refresh into — go back to the catalog it was deleted from.
    router.push('/products');
  }

  async function handleSaveProduct(): Promise<void> {
    setIsSaving(true);
    const result = await callAction(
      'updateProduct',
      updateProduct({
        productId: product.id,
        name: editDraft.name,
        brand: editDraft.brand || null,
        category: editDraft.category,
      }),
    );
    setIsSaving(false);
    if (!result.ok) {
      toast({ kind: 'error', message: describeActionError(result.error, tErrors, t('saveError')) });
      return;
    }
    setIsEditOpen(false);
    toast({ kind: 'success', message: t('saved') });
    router.refresh();
  }

  async function handleSaveEntry(entryId: string, input: EntrySheetSaveInput): Promise<boolean> {
    const result = await callAction('updatePriceEntry', updatePriceEntry({ entryId, ...input }));
    if (!result.ok) {
      toast({ kind: 'error', message: describeActionError(result.error, tErrors, t('saveError')) });
      return false;
    }
    toast({ kind: 'success', message: t('entry.saved') });
    router.refresh();
    return true;
  }

  async function handleDeleteEntry(entryId: string): Promise<boolean> {
    const result = await callAction('deletePriceEntry', deletePriceEntry({ entryId }));
    if (!result.ok) {
      toast({ kind: 'error', message: describeActionError(result.error, tErrors, t('saveError')) });
      return false;
    }
    toast({ kind: 'success', message: t('entry.deleted') });
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        title={product.name}
        backHref="/products"
        caption={
          <span className="flex items-center gap-2">
            {product.brand && <span>{product.brand}</span>}
            <span>{tCategories(product.category)}</span>
            <span>·</span>
            <span>{tUnits(product.unitKind)}</span>
          </span>
        }
        actions={
          <IconButton
            icon={<MoreHorizontal />}
            label={tCommon('edit')}
            onClick={() => setIsMenuOpen(true)}
            data-testid="product-menu"
          />
        }
      />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 pt-4 pb-6">
        {product.isArchived && (
          <p className="rounded-control border border-border bg-band px-3 py-2 font-sans text-[13px] text-text-muted">
            {t('archivedNotice')}
          </p>
        )}

        {entries.length === 0 ? (
          <EmptyState
            title={t('empty.title')}
            body={t('empty.body')}
            data-testid="product-empty"
            action={<Button href="/scan">{t('empty.cta')}</Button>}
          />
        ) : (
          <>
            <PriceOverview
              productName={product.name}
              unitKind={product.unitKind}
              monthlySeries={detail.monthlySeries}
              promoMarkers={detail.promoMarkers}
              stats={stats}
              range={range}
              onRangeChange={setRange}
            />
            <StoreComparisonSection rows={storeComparison} unitKind={product.unitKind} />
            <PriceHistoryList
              entries={entries}
              unitKind={product.unitKind}
              onOpenEntry={setActiveEntry}
            />
          </>
        )}
      </div>

      <ProductMenuSheet
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        productName={product.name}
        isArchived={product.isArchived}
        onEdit={() => {
          setIsMenuOpen(false);
          setIsEditOpen(true);
        }}
        onToggleArchive={() => void handleArchiveToggle()}
        onDelete={() => {
          setIsMenuOpen(false);
          setIsDeleteOpen(true);
        }}
      />

      <DeleteProductsSheet
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        products={[{ id: product.id, name: product.name, entryCount: entries.length }]}
        isPending={isDeleting}
        onConfirm={() => void handleDelete()}
      />

      <EditProductSheet
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        draft={editDraft}
        onDraftChange={setEditDraft}
        isSaving={isSaving}
        onSave={() => void handleSaveProduct()}
      />

      <EntrySheet
        entry={activeEntry}
        onClose={() => setActiveEntry(null)}
        stores={stores}
        onSave={handleSaveEntry}
        onDelete={handleDeleteEntry}
      />
    </div>
  );
}
