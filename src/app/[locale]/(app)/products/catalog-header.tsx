'use client';

/**
 * The catalog's sticky header: the title with the button that enters or
 * leaves selection mode, the search field, and the filter chips (every
 * category with data, then the archived toggle). Controlled: the search
 * text, the chosen category, the archived toggle and selection mode are the
 * screen's state; this component renders them and reports changes.
 */
import { GitMerge, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import type { CategoryId } from '@/lib/domain/categories';

export interface CatalogHeaderProps {
  isSelecting: boolean;
  onStartSelection: () => void;
  onCancelSelection: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Null for the "all" chip. */
  category: CategoryId | null;
  onCategoryChange: (category: CategoryId | null) => void;
  /** The categories that get a chip, in display order. */
  categoriesWithData: CategoryId[];
  isArchivedVisible: boolean;
  onToggleArchived: () => void;
}

/**
 * Render the header. Tapping the chip of the category already chosen
 * clears the choice, so every chip toggles.
 */
export function CatalogHeader({
  isSelecting,
  onStartSelection,
  onCancelSelection,
  query,
  onQueryChange,
  category,
  onCategoryChange,
  categoriesWithData,
  isArchivedVisible,
  onToggleArchived,
}: CatalogHeaderProps) {
  const t = useTranslations('products');
  const tCategories = useTranslations('categories');

  return (
    <header className="sticky top-0 z-20 flex flex-col gap-3 border-border border-b border-dashed bg-background/95 px-4 pt-4 pb-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-mono font-semibold text-[12px] text-text-muted uppercase tracking-[0.12em]">
          {t('title')}
        </h1>
        {isSelecting ? (
          <Button variant="ghost" onClick={onCancelSelection} data-testid="cancel-selection">
            {t('cancelSelection')}
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={onStartSelection}
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
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchLabel')}
        prefix={<Search className="size-4" />}
        autoComplete="off"
        data-testid="catalog-search"
      />
      <fieldset className="scrollbar-none -mx-4 flex min-w-0 gap-2 overflow-x-auto border-0 p-0 px-4">
        <legend className="sr-only">{t('categoryFilters')}</legend>
        <Chip
          variant="filter"
          isSelected={category === null}
          onClick={() => onCategoryChange(null)}
        >
          {t('all')}
        </Chip>
        {categoriesWithData.map((id) => (
          <Chip
            key={id}
            variant="filter"
            isSelected={category === id}
            onClick={() => onCategoryChange(category === id ? null : id)}
          >
            {tCategories(id)}
          </Chip>
        ))}
        <span aria-hidden="true" className="mx-1 w-px shrink-0 self-stretch bg-border" />
        <Chip
          variant="filter"
          isSelected={isArchivedVisible}
          onClick={onToggleArchived}
          data-testid="toggle-archived"
        >
          {t('archived')}
        </Chip>
      </fieldset>
    </header>
  );
}
