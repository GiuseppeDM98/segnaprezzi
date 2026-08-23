'use client';

/**
 * Client half of the product detail: header with the
 * overflow menu (edit / archive / delete), the unit-price chart with promo dots and
 * a range toggle, the four stat tiles, the per-store comparison and the
 * entries list with the shared entry sheet.
 */
import { Archive, ArchiveRestore, MoreHorizontal, PencilLine, Trash2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { AreaChart } from '@/components/charts/area-chart';
import {
  EntrySheet,
  type EntrySheetEntry,
  type EntrySheetSaveInput,
  SOURCE_ICONS,
} from '@/components/entries/entry-sheet';
import { ScreenHeader } from '@/components/layout/screen-header';
import { DeleteProductsSheet } from '@/components/products/delete-products-sheet';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { SectionHeading } from '@/components/ui/section-heading';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { cx } from '@/lib/cx';
import { CATEGORY_IDS, type CategoryId } from '@/lib/domain/categories';
import {
  type AppLocale,
  formatDate,
  formatMoney,
  formatPackageSize,
  formatUnitPrice,
} from '@/lib/format';
import { useRouter } from '@/lib/i18n/navigation';
import type { ProductDetail } from '@/lib/services/product-detail';
import { deleteProducts, editProduct, setProductArchived } from '../actions';
import { deletePriceEntry, deleteProductAlias, editPriceEntry } from './actions';

type ChartRange = '12' | 'all';

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
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { toast } = useToast();

  const [range, setRange] = useState<ChartRange>('12');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editDraft, setEditDraft] = useState({
    name: detail.product.name,
    brand: detail.product.brand ?? '',
    category: detail.product.category,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [activeEntry, setActiveEntry] = useState<EntrySheetEntry | null>(null);

  const { product, stats, storeComparison, entries } = detail;
  const series = range === '12' ? detail.monthlySeries.slice(-12) : detail.monthlySeries;
  const visibleMonths = new Set(series.map((point) => point.month));
  const markers = detail.promoMarkers.filter((marker) => visibleMonths.has(marker.month));
  const unitPrice = (milli: number): string => formatUnitPrice(milli, product.unitKind, locale);

  async function handleArchiveToggle(): Promise<void> {
    setIsMenuOpen(false);
    const result = await setProductArchived({
      productId: product.id,
      isArchived: !product.isArchived,
    });
    if (!result.ok) {
      toast({ kind: 'error', message: t('saveError') });
      return;
    }
    toast({ kind: 'success', message: product.isArchived ? t('restored') : t('archived') });
    router.refresh();
  }

  async function handleDelete(): Promise<void> {
    setIsDeleting(true);
    const result = await deleteProducts({ productIds: [product.id] });
    setIsDeleting(false);
    if (!result.ok) {
      toast({ kind: 'error', message: tProducts('deleteError') });
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
    const result = await editProduct({
      productId: product.id,
      name: editDraft.name,
      brand: editDraft.brand || null,
      category: editDraft.category,
    });
    setIsSaving(false);
    if (!result.ok) {
      toast({ kind: 'error', message: t('saveError') });
      return;
    }
    setIsEditOpen(false);
    toast({ kind: 'success', message: t('saved') });
    router.refresh();
  }

  async function handleSaveEntry(entryId: string, input: EntrySheetSaveInput): Promise<boolean> {
    const result = await editPriceEntry({ entryId, ...input });
    if (!result.ok) {
      toast({ kind: 'error', message: t('saveError') });
      return false;
    }
    toast({ kind: 'success', message: t('entry.saved') });
    router.refresh();
    return true;
  }

  async function handleDeleteEntry(entryId: string): Promise<boolean> {
    const result = await deletePriceEntry({ entryId });
    if (!result.ok) {
      toast({ kind: 'error', message: t('saveError') });
      return false;
    }
    toast({ kind: 'success', message: t('entry.deleted') });
    router.refresh();
    return true;
  }

  const first = series[0];
  const last = series[series.length - 1];

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
            <section className="flex flex-col gap-3">
              <SectionHeading
                trailing={
                  detail.monthlySeries.length > 12 ? (
                    <Segmented<ChartRange>
                      label={t('rangeLabel')}
                      value={range}
                      onChange={setRange}
                      options={[
                        { value: '12', label: t('range12') },
                        { value: 'all', label: t('rangeAll') },
                      ]}
                      className="-mb-1 w-40"
                    />
                  ) : undefined
                }
              >
                {t('chartTitle')}
              </SectionHeading>
              <AreaChart
                series={series}
                markers={markers}
                formatValue={unitPrice}
                seriesLabel={t('chartSeries')}
                ariaSummary={t('chartSummary', {
                  name: product.name,
                  from: unitPrice(first?.value ?? 0),
                  to: unitPrice(last?.value ?? 0),
                  months: series.length,
                })}
                height={200}
              />
            </section>

            {stats && (
              <section
                aria-label={t('chartTitle')}
                className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-border bg-border tablet:grid-cols-4"
              >
                {(['min', 'max', 'mean', 'last'] as const).map((key) => (
                  <div key={key} className="flex flex-col gap-1 bg-surface px-3 py-3">
                    <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
                      {t(`stats.${key}`)}
                    </span>
                    <span className="font-mono font-semibold text-[17px] text-text tabular-nums">
                      {unitPrice(stats[key].unitPriceMilli)}
                    </span>
                    {stats[key].recordedAt !== undefined && (
                      <span className="font-sans text-[12px] text-text-muted">
                        {formatDate(stats[key].recordedAt as number, locale)}
                      </span>
                    )}
                  </div>
                ))}
              </section>
            )}

            {storeComparison.length > 0 && (
              <section className="flex flex-col gap-3">
                <SectionHeading>{t('storesTitle')}</SectionHeading>
                <ol className="zebra -mx-1">
                  {storeComparison.map((row, index) => (
                    <li
                      key={row.storeId}
                      className="flex min-h-12 items-center justify-between gap-3 px-3"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-sans text-[15px] text-text">
                          {row.storeName}
                        </span>
                        {index === 0 && (
                          <Chip variant="status" tone="positive">
                            {t('best')}
                          </Chip>
                        )}
                      </span>
                      <span className="flex shrink-0 flex-col items-end">
                        <span className="font-mono font-semibold text-[14px] text-text tabular-nums">
                          {unitPrice(row.latestUnitPriceMilli)}
                        </span>
                        <span className="font-sans text-[11px] text-text-muted">
                          {formatDate(row.recordedAt, locale)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="flex flex-col gap-3">
              <SectionHeading>{t('entriesTitle')}</SectionHeading>
              <ul className="zebra -mx-1" data-testid="entry-list">
                {entries.map((entry) => {
                  const SourceIcon = SOURCE_ICONS[entry.source];
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => setActiveEntry(entry)}
                        data-testid="entry-row"
                        className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent-soft"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-center gap-2 font-mono text-[13px] text-text tabular-nums">
                            {formatDate(entry.recordedAt, locale)}
                            {entry.isPromo && (
                              <Chip variant="status" tone="promo">
                                {t('promo')}
                              </Chip>
                            )}
                          </span>
                          <span className="flex items-center gap-1.5 font-sans text-[12px] text-text-muted">
                            <SourceIcon aria-hidden="true" className="size-3.5" />
                            <span className="sr-only">{t(`source.${entry.source}`)}</span>
                            <span className="truncate">{entry.store?.name ?? t('noStore')}</span>
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end font-mono tabular-nums">
                          <span className="font-semibold text-[14px] text-text">
                            {formatMoney(entry.totalPriceCents, locale)}
                          </span>
                          <span className="text-[12px] text-text-muted">
                            {formatPackageSize(entry.packageSize, product.unitKind, locale)} ·{' '}
                            {unitPrice(entry.unitPriceMilli)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            <AliasSection aliases={detail.aliases} />
          </>
        )}
      </div>

      <Sheet isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)}>
        <div className="flex flex-col">
          <MenuRow
            icon={<PencilLine />}
            label={t('edit')}
            onClick={() => {
              setIsMenuOpen(false);
              setIsEditOpen(true);
            }}
            testId="menu-edit-product"
          />
          <MenuRow
            icon={product.isArchived ? <ArchiveRestore /> : <Archive />}
            label={product.isArchived ? t('restore') : t('archive')}
            onClick={() => void handleArchiveToggle()}
            testId="menu-archive-product"
          />
          <MenuRow
            icon={<Trash2 />}
            label={tProducts('deleteRow', { name: product.name })}
            onClick={() => {
              setIsMenuOpen(false);
              setIsDeleteOpen(true);
            }}
            testId="menu-delete-product"
            tone="danger"
          />
        </div>
      </Sheet>

      <DeleteProductsSheet
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        products={[{ id: product.id, name: product.name, entryCount: entries.length }]}
        isPending={isDeleting}
        onConfirm={() => void handleDelete()}
      />

      <Sheet isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title={t('editTitle')}>
        <div className="flex flex-col gap-3">
          <Field label={t('name')} isRequired>
            {(controlProps) => (
              <Input
                {...controlProps}
                value={editDraft.name}
                onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })}
                data-testid="edit-product-name"
              />
            )}
          </Field>
          <Field label={t('brand')}>
            {(controlProps) => (
              <Input
                {...controlProps}
                value={editDraft.brand}
                onChange={(event) => setEditDraft({ ...editDraft, brand: event.target.value })}
              />
            )}
          </Field>
          <Field label={t('category')}>
            {(controlProps) => (
              <Select
                {...controlProps}
                value={editDraft.category}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, category: event.target.value as CategoryId })
                }
                options={CATEGORY_IDS.map((category) => ({
                  value: category,
                  label: tCategories(category),
                }))}
              />
            )}
          </Field>
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setIsEditOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              className="flex-1"
              isPending={isSaving}
              disabled={editDraft.name.trim().length === 0}
              onClick={() => void handleSaveProduct()}
              data-testid="save-product"
            >
              {tCommon('save')}
            </Button>
          </div>
        </div>
      </Sheet>

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

function MenuRow({
  icon,
  label,
  onClick,
  testId,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cx(
        'flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-left font-sans font-medium text-[15px] transition-colors [&>svg]:size-5',
        tone === 'danger' ? 'text-negative hover:bg-negative-soft' : 'text-text hover:bg-band',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * The receipt lines this product has learned.
 *
 * Visible because an alias is invisible machinery until it goes wrong: when
 * a receipt keeps resolving "LATTE PS UHT" to the wrong milk, this list is
 * the only place a user can undo the lesson.
 */
function AliasSection({ aliases }: { aliases: ProductDetail['aliases'] }) {
  const t = useTranslations('productDetail');
  const { toast } = useToast();
  const router = useRouter();

  if (aliases.length === 0) {
    return null;
  }

  async function handleDelete(aliasId: string): Promise<void> {
    const result = await deleteProductAlias({ aliasId });
    if (result.ok) {
      toast({ kind: 'success', message: t('aliasDeleted') });
      router.refresh();
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>{t('aliasesTitle')}</SectionHeading>
      <ul className="zebra -mx-1" data-testid="alias-list">
        {aliases.map((alias) => (
          <li key={alias.id} className="flex min-h-12 items-center gap-3 px-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-[13px] text-text">{alias.alias}</span>
              <span className="truncate font-sans text-[12px] text-text-muted">
                {alias.storeChain ?? t('aliasAnyChain')} ·{' '}
                {t('aliasHits', { count: alias.hitCount })}
              </span>
            </span>
            <IconButton
              icon={<X />}
              label={t('aliasDelete')}
              onClick={() => void handleDelete(alias.id)}
              data-testid="alias-delete"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
