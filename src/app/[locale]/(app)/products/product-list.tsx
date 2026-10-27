'use client';

/**
 * The catalog rows: name, brand and category, the last unit price with
 * how long ago it was seen and its trend badge. Outside selection mode a
 * row links to the product and carries its own delete button; in selection
 * mode the whole row is a toggle with a checkbox. Which products are
 * listed, and which are selected, is decided by the screen.
 */
import { Check, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { TrendBadge } from '@/components/charts/trend-badge';
import { Chip } from '@/components/ui/chip';
import { IconButton } from '@/components/ui/icon-button';
import { cx } from '@/lib/cx';
import { type AppLocale, formatRelativeDate, formatUnitPrice } from '@/lib/format';
import { Link } from '@/lib/i18n/navigation';
import type { CatalogProduct } from '@/lib/services/catalog';
import { lastPriceChange } from './catalog-view';

export interface ProductListProps {
  products: CatalogProduct[];
  /** Epoch ms the relative dates are measured from, fixed for the life of the screen. */
  now: number;
  isSelecting: boolean;
  selectedIds: ReadonlySet<string>;
  /** Selection mode: flip one product in or out of the selection. */
  onToggle: (productId: string) => void;
  /** Outside selection mode: ask to delete this one product. */
  onDelete: (product: CatalogProduct) => void;
}

/** Render the products as a zebra list, one row each. */
export function ProductList({
  products,
  now,
  isSelecting,
  selectedIds,
  onToggle,
  onDelete,
}: ProductListProps) {
  const locale = useLocale() as AppLocale;

  return (
    <ul className="zebra" data-testid="product-list">
      {products.map((product) => (
        <ProductRow
          key={product.id}
          product={product}
          locale={locale}
          now={now}
          isSelecting={isSelecting}
          isSelected={selectedIds.has(product.id)}
          onToggle={() => onToggle(product.id)}
          onDelete={() => onDelete(product)}
        />
      ))}
    </ul>
  );
}

function ProductRow({
  product,
  locale,
  now,
  isSelecting,
  isSelected,
  onToggle,
  onDelete,
}: {
  product: CatalogProduct;
  locale: AppLocale;
  now: number;
  isSelecting: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('products');
  const tCategories = useTranslations('categories');
  const ratio = lastPriceChange(product);

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
    <li data-testid="product-row" className="flex items-center">
      {isSelecting ? (
        <button type="button" onClick={onToggle} aria-pressed={isSelected} className={rowClasses}>
          {content}
        </button>
      ) : (
        <>
          {/* The delete button sits OUTSIDE the link on purpose: a button
              nested in an anchor is invalid markup and unreachable by
              keyboard in the order a reader expects. */}
          <Link href={`/products/${product.id}`} className={cx(rowClasses, 'min-w-0 flex-1')}>
            {content}
          </Link>
          <IconButton
            icon={<Trash2 />}
            label={t('deleteRow', { name: product.name })}
            onClick={onDelete}
            className="mr-2 shrink-0"
            data-testid="delete-product-row"
          />
        </>
      )}
    </li>
  );
}
