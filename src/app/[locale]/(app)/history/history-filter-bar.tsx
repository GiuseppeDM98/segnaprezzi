'use client';

/**
 * The timeline's filter chips and the picker sheets behind them. It owns
 * which picker is open, and nothing else: the filters themselves belong to
 * the screen, because changing them is what re-fetches the first page. A
 * chip with a value shows that value and a remove button; promo is a plain
 * toggle with no picker, since it has only two states.
 */
import { Check, Tag as TagIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type Dispatch, type SetStateAction, useState } from 'react';

import { Chip } from '@/components/ui/chip';
import { Sheet } from '@/components/ui/sheet';
import { cx } from '@/lib/cx';
import { CATEGORY_IDS, type CategoryId } from '@/lib/domain/categories';
import { ENTRY_SOURCES, type EntrySource } from '@/lib/domain/entries';
import type { HistoryFilters } from '@/lib/services/history';

type PickerKind = 'category' | 'source' | null;

export interface HistoryFilterBarProps {
  filters: HistoryFilters;
  /** The screen's state setter: every change is applied as an updater on the current filters. */
  onFiltersChange: Dispatch<SetStateAction<HistoryFilters>>;
}

/**
 * Render the filter chips as a fieldset, plus the picker sheets the chips
 * open (the sheets portal to the body, so they can live beside the chips).
 * Picking a value, or "any", applies it and closes the sheet.
 */
export function HistoryFilterBar({ filters, onFiltersChange }: HistoryFilterBarProps) {
  const t = useTranslations('history');
  const tDetail = useTranslations('productDetail');
  const tCategories = useTranslations('categories');
  const [picker, setPicker] = useState<PickerKind>(null);

  return (
    <>
      <fieldset className="scrollbar-none -mx-4 flex min-w-0 gap-2 overflow-x-auto border-0 p-0 px-4">
        <legend className="sr-only">{t('filters.label')}</legend>
        <Chip
          variant="filter"
          isSelected={Boolean(filters.category)}
          onClick={() => setPicker('category')}
          onRemove={
            filters.category
              ? () => onFiltersChange(({ category: _c, ...rest }) => rest)
              : undefined
          }
          removeLabel={t('filters.remove', { filter: t('filters.category') })}
          icon={<TagIcon />}
          data-testid="filter-category"
        >
          {filters.category ? tCategories(filters.category) : t('filters.category')}
        </Chip>
        <Chip
          variant="filter"
          isSelected={filters.isPromo === true}
          onClick={() =>
            onFiltersChange(({ isPromo, ...rest }) => (isPromo ? rest : { ...rest, isPromo: true }))
          }
          data-testid="filter-promo"
        >
          {t('filters.promoOnly')}
        </Chip>
        <Chip
          variant="filter"
          isSelected={Boolean(filters.source)}
          onClick={() => setPicker('source')}
          onRemove={
            filters.source ? () => onFiltersChange(({ source: _s, ...rest }) => rest) : undefined
          }
          removeLabel={t('filters.remove', { filter: t('filters.source') })}
          data-testid="filter-source"
        >
          {filters.source ? tDetail(`source.${filters.source}`) : t('filters.source')}
        </Chip>
      </fieldset>

      <Sheet
        isOpen={picker === 'category'}
        onClose={() => setPicker(null)}
        title={t('filters.pickCategory')}
      >
        <PickerList
          options={[
            { value: '', label: t('filters.anyCategory') },
            ...CATEGORY_IDS.map((id) => ({ value: id, label: tCategories(id) })),
          ]}
          selected={filters.category ?? ''}
          onPick={(value) => {
            onFiltersChange(({ category: _c, ...rest }) =>
              value ? { ...rest, category: value as CategoryId } : rest,
            );
            setPicker(null);
          }}
        />
      </Sheet>
      <Sheet
        isOpen={picker === 'source'}
        onClose={() => setPicker(null)}
        title={t('filters.pickSource')}
      >
        <PickerList
          options={[
            { value: '', label: t('filters.anySource') },
            ...ENTRY_SOURCES.map((source) => ({
              value: source,
              label: tDetail(`source.${source}`),
            })),
          ]}
          selected={filters.source ?? ''}
          onPick={(value) => {
            onFiltersChange(({ source: _s, ...rest }) =>
              value ? { ...rest, source: value as EntrySource } : rest,
            );
            setPicker(null);
          }}
        />
      </Sheet>
    </>
  );
}

/** One picker's options as a pressed-state list; the empty value stands for "any". */
function PickerList({
  options,
  selected,
  onPick,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string;
  onPick: (value: string) => void;
}) {
  return (
    <ul className="zebra -mx-2 max-h-[60dvh] overflow-y-auto rounded-control">
      {options.map((option) => (
        <li key={option.value}>
          <button
            type="button"
            onClick={() => onPick(option.value)}
            aria-pressed={selected === option.value}
            className={cx(
              'flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left font-sans text-[15px] text-text hover:bg-accent-soft',
              selected === option.value && 'font-semibold',
            )}
          >
            {option.label}
            {selected === option.value && (
              <Check aria-hidden="true" className="size-4 text-accent-ink" />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
