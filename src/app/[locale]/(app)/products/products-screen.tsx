'use client';

/**
 * Client half of the catalog: search, category chips, the archived toggle,
 * compact zebra rows with the last unit price and a trend badge, and the
 * merge flow (selection mode → survivor sheet → confirm). The screen owns
 * the state (filters, selection, survivor, the products awaiting delete)
 * and the merge and delete actions; the parts it renders live beside it:
 * the header (catalog-header), the rows (product-list), the selection bar
 * (selection-action-bar) and the merge sheet (merge-products-sheet), with
 * the filtering in catalog-view.ts. The delete confirmation is the shared
 * DeleteProductsSheet.
 */
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import {
  type DeletableProduct,
  DeleteProductsSheet,
} from '@/components/products/delete-products-sheet';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { callAction, describeActionError } from '@/lib/call-action';
import type { CategoryId } from '@/lib/domain/categories';
import { useRouter } from '@/lib/i18n/navigation';
import type { Catalog } from '@/lib/services/catalog';
import { deleteProducts, mergeProducts } from './actions';
import { CatalogHeader } from './catalog-header';
import { filterCatalogProducts, toDeletableProduct } from './catalog-view';
import { MergeProductsSheet } from './merge-products-sheet';
import { ProductList } from './product-list';
import { SelectionActionBar } from './selection-action-bar';

export interface ProductsScreenProps {
  catalog: Catalog;
}

export function ProductsScreen({ catalog }: ProductsScreenProps) {
  const t = useTranslations('products');
  const tCategories = useTranslations('categories');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const { toast } = useToast();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [isArchivedVisible, setIsArchivedVisible] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  /*
   * The products the delete sheet is currently asking about. It holds them
   * rather than a set of ids because a row delete and a bulk delete are the
   * same confirmation, and because the sheet must keep naming the products
   * while the request is in flight — after which they are gone from the
   * catalog and no lookup would find them again.
   */
  const [pendingDeletion, setPendingDeletion] = useState<DeletableProduct[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const now = useMemo(() => Date.now(), []);

  const visibleProducts = filterCatalogProducts(catalog.products, {
    query,
    category,
    isArchivedVisible,
  });
  const hasAnyProducts = catalog.products.some((product) => !product.isArchived);
  const selectedProducts = catalog.products.filter((product) => selectedIds.has(product.id));

  function toggleSelected(productId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }

  function exitSelection(): void {
    setIsSelecting(false);
    setSelectedIds(new Set());
    setSurvivorId(null);
  }

  async function handleMerge(): Promise<void> {
    if (!survivorId) {
      return;
    }
    setIsMerging(true);
    const result = await callAction(
      'mergeProducts',
      mergeProducts({
        survivorId,
        mergedIds: [...selectedIds].filter((id) => id !== survivorId),
      }),
    );
    setIsMerging(false);
    if (!result.ok) {
      toast({
        kind: 'error',
        message: describeActionError(result.error, tErrors, t('mergeError')),
      });
      return;
    }
    setIsMergeOpen(false);
    exitSelection();
    toast({ kind: 'success', message: t('merged') });
    router.refresh();
  }

  async function handleDelete(): Promise<void> {
    setIsDeleting(true);
    const result = await callAction(
      'deleteProducts',
      deleteProducts({ productIds: pendingDeletion.map((item) => item.id) }),
    );
    setIsDeleting(false);
    if (!result.ok) {
      toast({
        kind: 'error',
        message: describeActionError(result.error, tErrors, t('deleteError')),
      });
      return;
    }
    toast({ kind: 'success', message: t('deleted', { count: pendingDeletion.length }) });
    setPendingDeletion([]);
    exitSelection();
    router.refresh();
  }

  if (!hasAnyProducts && !isArchivedVisible) {
    return (
      <div className="flex flex-1 items-center justify-center pt-safe">
        <EmptyState
          title={t('empty.title')}
          body={t('empty.body')}
          data-testid="products-empty"
          action={<Button href="/scan">{t('empty.cta')}</Button>}
          secondaryAction={
            catalog.products.length > 0 ? (
              <Button variant="ghost" onClick={() => setIsArchivedVisible(true)}>
                {t('archived')}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const survivor = catalog.products.find((product) => product.id === survivorId) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col pt-safe">
      <CatalogHeader
        isSelecting={isSelecting}
        onStartSelection={() => setIsSelecting(true)}
        onCancelSelection={exitSelection}
        query={query}
        onQueryChange={setQuery}
        category={category}
        onCategoryChange={setCategory}
        categoriesWithData={catalog.categoriesWithData}
        isArchivedVisible={isArchivedVisible}
        onToggleArchived={() => setIsArchivedVisible((value) => !value)}
      />

      {visibleProducts.length === 0 ? (
        <EmptyState
          title={t('noResults', { query: query.trim() || tCategories(category ?? 'other') })}
          body={t('noResultsHint')}
          icon={<Search />}
        />
      ) : (
        <ProductList
          products={visibleProducts}
          now={now}
          isSelecting={isSelecting}
          selectedIds={selectedIds}
          onToggle={toggleSelected}
          onDelete={(product) => setPendingDeletion([toDeletableProduct(product)])}
        />
      )}

      <SelectionActionBar
        isOpen={isSelecting}
        selectedCount={selectedIds.size}
        onDelete={() => setPendingDeletion(selectedProducts.map(toDeletableProduct))}
        onMerge={() => {
          setSurvivorId(selectedProducts[0]?.id ?? null);
          setIsMergeOpen(true);
        }}
      />

      <DeleteProductsSheet
        isOpen={pendingDeletion.length > 0}
        onClose={() => setPendingDeletion([])}
        products={pendingDeletion}
        isPending={isDeleting}
        onConfirm={() => void handleDelete()}
      />

      <MergeProductsSheet
        isOpen={isMergeOpen}
        onClose={() => setIsMergeOpen(false)}
        candidates={selectedProducts}
        survivorId={survivorId}
        survivor={survivor}
        onSurvivorChange={setSurvivorId}
        isMerging={isMerging}
        onConfirm={() => void handleMerge()}
      />
    </div>
  );
}
