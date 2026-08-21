'use client';

/**
 * Client half of the catalog (Spec 05 §5.6): search, category chips, the
 * archived toggle, compact zebra rows with the last unit price and a trend
 * badge, and the merge flow (selection mode → survivor sheet → confirm).
 */
import { Check, GitMerge, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { TrendBadge } from '@/components/charts/trend-badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { cx } from '@/lib/cx';
import type { CategoryId } from '@/lib/domain/categories';
import { type AppLocale, formatRelativeDate, formatUnitPrice } from '@/lib/format';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { useAppMotion } from '@/lib/motion';
import type { Catalog, CatalogProduct } from '@/lib/services/catalog';
import { mergeProducts } from './actions';

export interface ProductsScreenProps {
  catalog: Catalog;
}

export function ProductsScreen({ catalog }: ProductsScreenProps) {
  const t = useTranslations('products');
  const tCategories = useTranslations('categories');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { toast } = useToast();
  const { isReduced, spring, fade } = useAppMotion();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMergeOpen, setIsMergeOpen] = useState(false);
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const now = useMemo(() => Date.now(), []);

  const normalizedQuery = query.trim().toLowerCase();
  const visible = catalog.products.filter((product) => {
    if (!showArchived && product.isArchived) {
      return false;
    }
    if (category && product.category !== category) {
      return false;
    }
    if (
      normalizedQuery &&
      !product.name.toLowerCase().includes(normalizedQuery) &&
      !product.brand?.toLowerCase().includes(normalizedQuery)
    ) {
      return false;
    }
    return true;
  });

  const hasAnyProducts = catalog.products.some((product) => !product.isArchived);
  const selected = catalog.products.filter((product) => selectedIds.has(product.id));

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
    const result = await mergeProducts({
      survivorId,
      mergedIds: [...selectedIds].filter((id) => id !== survivorId),
    });
    setIsMerging(false);
    if (!result.ok) {
      toast({ kind: 'error', message: t('mergeError') });
      return;
    }
    setIsMergeOpen(false);
    exitSelection();
    toast({ kind: 'success', message: t('merged') });
    router.refresh();
  }

  if (!hasAnyProducts && !showArchived) {
    return (
      <div className="flex flex-1 items-center justify-center pt-safe">
        <EmptyState
          title={t('empty.title')}
          body={t('empty.body')}
          data-testid="products-empty"
          action={<Button href="/scan">{t('empty.cta')}</Button>}
          secondaryAction={
            catalog.products.length > 0 ? (
              <Button variant="ghost" onClick={() => setShowArchived(true)}>
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
      <header className="sticky top-0 z-20 flex flex-col gap-3 border-border border-b border-dashed bg-background/95 px-4 pt-4 pb-3 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-mono font-semibold text-[12px] text-text-muted uppercase tracking-[0.12em]">
            {t('title')}
          </h1>
          {isSelecting ? (
            <Button variant="ghost" onClick={exitSelection} data-testid="cancel-selection">
              {t('cancelSelection')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setIsSelecting(true)}
              icon={<GitMerge className="size-4" />}
              data-testid="start-selection"
            >
              {t('select')}
            </Button>
          )}
        </div>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          prefix={<Search className="size-4" />}
          autoComplete="off"
          data-testid="catalog-search"
        />
        <fieldset className="scrollbar-none -mx-4 flex min-w-0 gap-2 overflow-x-auto border-0 p-0 px-4">
          <legend className="sr-only">{t('categoryFilters')}</legend>
          <Chip variant="filter" isSelected={category === null} onClick={() => setCategory(null)}>
            {t('all')}
          </Chip>
          {catalog.categoriesWithData.map((id) => (
            <Chip
              key={id}
              variant="filter"
              isSelected={category === id}
              onClick={() => setCategory(category === id ? null : id)}
            >
              {tCategories(id)}
            </Chip>
          ))}
          <span aria-hidden="true" className="mx-1 w-px shrink-0 self-stretch bg-border" />
          <Chip
            variant="filter"
            isSelected={showArchived}
            onClick={() => setShowArchived((value) => !value)}
            data-testid="toggle-archived"
          >
            {t('archived')}
          </Chip>
        </fieldset>
      </header>

      {visible.length === 0 ? (
        <EmptyState
          title={t('noResults', { query: query.trim() || tCategories(category ?? 'other') })}
          body={t('noResultsHint')}
          icon={<Search />}
        />
      ) : (
        <ul className="zebra" data-testid="product-list">
          {visible.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              locale={locale}
              now={now}
              isSelecting={isSelecting}
              isSelected={selectedIds.has(product.id)}
              onToggle={() => toggleSelected(product.id)}
            />
          ))}
        </ul>
      )}

      <AnimatePresence>
        {isSelecting && (
          <motion.div
            initial={isReduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={isReduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
            transition={isReduced ? fade : spring}
            className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-20 border-border border-t border-dashed bg-surface/95 px-4 pt-3 pb-11 backdrop-blur-sm rail:bottom-0 rail:pb-3"
          >
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
              <span className="font-mono text-[13px] text-text-muted tabular-nums">
                {t('selected', { count: selectedIds.size })}
              </span>
              <Button
                disabled={selectedIds.size < 2}
                onClick={() => {
                  setSurvivorId(selected[0]?.id ?? null);
                  setIsMergeOpen(true);
                }}
                data-testid="open-merge"
              >
                {t('merge', { count: selectedIds.size })}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Sheet
        isOpen={isMergeOpen}
        onClose={() => setIsMergeOpen(false)}
        title={t('mergeTitle')}
        description={t('mergeSurvivor')}
      >
        <div className="flex flex-col gap-4">
          <fieldset className="zebra -mx-2 rounded-control border-0 p-0">
            <legend className="sr-only">{t('mergeSurvivor')}</legend>
            {selected.map((product) => (
              <label
                key={product.id}
                data-testid="survivor-option"
                className={cx(
                  'flex min-h-12 cursor-pointer items-center justify-between gap-3 px-3 hover:bg-accent-soft',
                  survivorId === product.id && 'font-semibold',
                )}
              >
                <input
                  type="radio"
                  name="survivor"
                  value={product.id}
                  checked={survivorId === product.id}
                  onChange={() => setSurvivorId(product.id)}
                  className="sr-only"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-[14px] text-text">{product.name}</span>
                  {product.brand && (
                    <span className="truncate font-sans text-[12px] text-text-muted">
                      {product.brand}
                    </span>
                  )}
                </span>
                {survivorId === product.id && (
                  <Check aria-hidden="true" className="size-4 text-accent-ink" />
                )}
              </label>
            ))}
          </fieldset>
          {survivor && (
            <p className="font-sans text-[14px] text-text-muted">
              {t('mergeBody', { survivor: survivor.name })}
            </p>
          )}
          <Button
            variant="danger"
            size="lg"
            isPending={isMerging}
            disabled={!survivorId}
            onClick={() => void handleMerge()}
            data-testid="confirm-merge"
          >
            {t('mergeConfirm')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function ProductRow({
  product,
  locale,
  now,
  isSelecting,
  isSelected,
  onToggle,
}: {
  product: CatalogProduct;
  locale: AppLocale;
  now: number;
  isSelecting: boolean;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('products');
  const tCategories = useTranslations('categories');
  const ratio =
    product.last && product.previousUnitPriceMilli
      ? product.last.unitPriceMilli / product.previousUnitPriceMilli - 1
      : null;

  const content = (
    <>
      {isSelecting && (
        <span
          aria-hidden="true"
          className={cx(
            'flex size-6 shrink-0 items-center justify-center rounded-[0.25rem] border',
            isSelected
              ? 'border-accent bg-accent text-accent-contrast'
              : 'border-border bg-surface',
          )}
        >
          {isSelected && <Check className="size-4" strokeWidth={3} />}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="line-clamp-2 font-mono text-[14px] text-text leading-snug">
            {product.name}
          </span>
          {product.isArchived && (
            <Chip variant="status" tone="neutral">
              {t('archivedChip')}
            </Chip>
          )}
        </span>
        <span className="flex items-center gap-2 font-sans text-[12px] text-text-muted">
          {product.brand && <span className="truncate">{product.brand}</span>}
          <span className="shrink-0">{tCategories(product.category)}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {product.last ? (
          <>
            <span className="font-mono font-semibold text-[14px] text-text tabular-nums">
              {formatUnitPrice(product.last.unitPriceMilli, product.unitKind, locale)}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-sans text-[11px] text-text-muted">
                {formatRelativeDate(product.last.recordedAt, now, locale)}
              </span>
              {ratio !== null && <TrendBadge ratio={ratio} size="sm" />}
            </span>
          </>
        ) : (
          <span className="font-sans text-[12px] text-text-muted">{t('noPrice')}</span>
        )}
      </span>
    </>
  );

  const rowClasses =
    'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent-soft';

  return (
    <li data-testid="product-row">
      {isSelecting ? (
        <button type="button" onClick={onToggle} aria-pressed={isSelected} className={rowClasses}>
          {content}
        </button>
      ) : (
        <Link href={`/products/${product.id}`} className={rowClasses}>
          {content}
        </Link>
      )}
    </li>
  );
}
