'use client';

/**
 * The manual entry form's product section, in its three states: searching
 * the catalog (with "create" for a name it does not have), a catalog product
 * picked, and a new product being filled in.
 *
 * Design: presentational. The query, the hits and the choice are the form
 * hook's state, handed in with the moves between states; this section only
 * renders whichever state the form is in.
 */
import { Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionHeading } from '@/components/ui/section-heading';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { CATEGORY_IDS, type CategoryId } from '@/lib/domain/categories';
import { UNIT_KINDS, type UnitKind } from '@/lib/domain/units';
import { formatProductLabel } from '@/lib/format';
import type { ProductSummary } from '@/lib/services/capture-context';
import type { NewProductChoice, ProductChoice } from './manual-entry-derivations';

export interface ManualProductSectionProps {
  choice: ProductChoice;
  query: string;
  onQueryChange: (query: string) => void;
  /** The trimmed, lower-cased query; empty when there is none. */
  normalizedQuery: string;
  hits: ProductSummary[];
  /** The catalog is empty: offer "new product" instead of a search with nothing to find. */
  isCatalogEmpty: boolean;
  /** Save was pressed with no product chosen. */
  isMissingProduct: boolean;
  onPickExisting: (product: ProductSummary) => void;
  onStartNew: (name: string) => void;
  onClearChoice: () => void;
  onNewProductChange: (patch: Partial<Omit<NewProductChoice, 'kind' | 'unitKind'>>) => void;
  onNewProductUnitKindChange: (unitKind: UnitKind) => void;
}

/** Render the product section for whichever state the choice is in. */
export function ManualProductSection({
  choice,
  onClearChoice,
  onNewProductChange,
  onNewProductUnitKindChange,
  ...search
}: ManualProductSectionProps) {
  const t = useTranslations('addManual');

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>{t('product')}</SectionHeading>
      {choice === null ? (
        <ProductSearch {...search} />
      ) : choice.kind === 'existing' ? (
        <div className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface px-3 py-2">
          <span className="flex min-w-0 flex-col">
            <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
              {t('productChosen')}
            </span>
            <span className="truncate font-sans font-medium text-[15px] text-text">
              {formatProductLabel(choice.product.brand, choice.product.name)}
            </span>
          </span>
          <Button variant="ghost" onClick={onClearChoice}>
            {t('changeProduct')}
          </Button>
        </div>
      ) : (
        <NewProductFields
          choice={choice}
          onClearChoice={onClearChoice}
          onChange={onNewProductChange}
          onUnitKindChange={onNewProductUnitKindChange}
        />
      )}
    </section>
  );
}

type ProductSearchProps = Pick<
  ManualProductSectionProps,
  | 'query'
  | 'onQueryChange'
  | 'normalizedQuery'
  | 'hits'
  | 'isCatalogEmpty'
  | 'isMissingProduct'
  | 'onPickExisting'
  | 'onStartNew'
>;

/** The search box, its hits, and the "create" row for a name the catalog lacks. */
function ProductSearch({
  query,
  onQueryChange,
  normalizedQuery,
  hits,
  isCatalogEmpty,
  isMissingProduct,
  onPickExisting,
  onStartNew,
}: ProductSearchProps) {
  const t = useTranslations('addManual');
  const tCategories = useTranslations('categories');

  return (
    <>
      <Field
        label={t('productSearch')}
        isRequired
        error={isMissingProduct ? t('missingProduct') : null}
      >
        {(controlProps) => (
          <Input
            {...controlProps}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('productSearchPlaceholder')}
            prefix={<Search className="size-4" />}
            autoComplete="off"
            data-testid="product-search"
          />
        )}
      </Field>
      {isCatalogEmpty && !normalizedQuery && (
        <p className="font-sans text-[14px] text-text-muted">{t('noProducts')}</p>
      )}
      {(hits.length > 0 || normalizedQuery) && (
        <ul className="zebra -mx-1 rounded-control">
          {hits.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onPickExisting(product)}
                className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left hover:bg-accent-soft"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-[14px] text-text">{product.name}</span>
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
                onClick={() => onStartNew(query.trim())}
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
      {isCatalogEmpty && !normalizedQuery && (
        <Button
          variant="secondary"
          onClick={() => onStartNew('')}
          icon={<Plus className="size-4" />}
        >
          {t('newProduct')}
        </Button>
      )}
    </>
  );
}

interface NewProductFieldsProps {
  choice: NewProductChoice;
  onClearChoice: () => void;
  onChange: ManualProductSectionProps['onNewProductChange'];
  onUnitKindChange: (unitKind: UnitKind) => void;
}

/** The inline "new product" card: name, brand, category and unit kind. */
function NewProductFields({
  choice,
  onClearChoice,
  onChange,
  onUnitKindChange,
}: NewProductFieldsProps) {
  const t = useTranslations('addManual');
  const tCategories = useTranslations('categories');
  const tUnits = useTranslations('units');

  return (
    <div className="flex flex-col gap-3 rounded-control border border-accent/40 bg-accent-soft/40 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
          {t('newProduct')}
        </span>
        <Button variant="ghost" onClick={onClearChoice}>
          {t('changeProduct')}
        </Button>
      </div>
      <Field label={t('productName')} isRequired>
        {(controlProps) => (
          <Input
            {...controlProps}
            value={choice.name}
            onChange={(event) => onChange({ name: event.target.value })}
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
            onChange={(event) => onChange({ brand: event.target.value })}
            data-testid="new-product-brand"
          />
        )}
      </Field>
      <Field label={t('category')}>
        {(controlProps) => (
          <Select
            {...controlProps}
            value={choice.category}
            onChange={(event) => onChange({ category: event.target.value as CategoryId })}
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
          onChange={onUnitKindChange}
          options={UNIT_KINDS.map((unitKind) => ({
            value: unitKind,
            label: tUnits(unitKind),
          }))}
        />
      </div>
    </div>
  );
}
