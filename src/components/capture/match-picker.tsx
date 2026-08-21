'use client';

/**
 * Product match sheet (Spec 05 §6.3): the top-3 suggestions from the
 * matcher, a catalog search, and "create new" prefilled from the
 * extraction. Search is delegated through `onSearch` so the component never
 * imports a Server Action.
 */
import { Check, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { cx } from '@/lib/cx';

export interface MatchOption {
  productId: string;
  name: string;
  brand: string | null;
  /** 0..1 similarity from the matcher; absent for search hits. */
  score?: number;
}

export interface MatchPickerProps {
  isOpen: boolean;
  onClose: () => void;
  suggestions: MatchOption[];
  /** The product currently chosen for the card, if any. */
  selectedProductId: string | null;
  isNewSelected: boolean;
  /** Name the "create new" row will use. */
  newProductName: string;
  onPick: (pick: { productId: string } | 'new') => void;
  onSearch: (query: string) => Promise<MatchOption[]>;
}

const SEARCH_DEBOUNCE_MS = 250;

export function MatchPicker({
  isOpen,
  onClose,
  suggestions,
  selectedProductId,
  isNewSelected,
  newProductName,
  onPick,
  onSearch,
}: MatchPickerProps) {
  const t = useTranslations('review');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MatchOption[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }
    setIsSearching(true);
    const handle = window.setTimeout(async () => {
      const results = await onSearch(trimmed);
      setHits(results);
      setIsSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, onSearch]);

  function pick(choice: { productId: string } | 'new'): void {
    onPick(choice);
    setQuery('');
    onClose();
  }

  const isQuerying = query.trim().length >= 2;
  const rows = isQuerying ? hits : suggestions;

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title={t('matchTitle')}>
      <div className="flex flex-col gap-3">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('matchSearch')}
          aria-label={t('matchSearch')}
          prefix={<Search className="size-4" />}
          autoComplete="off"
        />

        {!isQuerying && suggestions.length > 0 && (
          <p className="font-mono text-[11px] text-text-muted uppercase tracking-wide">
            {t('matchSuggestions')}
          </p>
        )}

        <ul
          className="zebra -mx-2 max-h-[40dvh] overflow-y-auto rounded-control"
          aria-busy={isSearching}
        >
          {rows.map((option) => {
            const isSelected = option.productId === selectedProductId;
            return (
              <li key={option.productId}>
                <button
                  type="button"
                  onClick={() => pick({ productId: option.productId })}
                  aria-pressed={isSelected}
                  data-testid="match-option"
                  className={cx(
                    'flex min-h-12 w-full items-center gap-3 px-3 text-left transition-colors hover:bg-accent-soft',
                    isSelected && 'font-semibold',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono text-[14px] text-text">{option.name}</span>
                    {option.brand && (
                      <span className="truncate font-sans text-[12px] text-text-muted">
                        {option.brand}
                      </span>
                    )}
                  </span>
                  {option.score !== undefined && (
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-band"
                    >
                      <span
                        className="block h-full bg-accent"
                        style={{ width: `${Math.round(option.score * 100)}%` }}
                      />
                    </span>
                  )}
                  {isSelected && (
                    <Check aria-hidden="true" className="size-4 shrink-0 text-accent-ink" />
                  )}
                </button>
              </li>
            );
          })}
          {isQuerying && !isSearching && hits.length === 0 && (
            <li className="px-3 py-3 font-sans text-[14px] text-text-muted">
              {t('matchNoResults', { query: query.trim() })}
            </li>
          )}
        </ul>

        <button
          type="button"
          onClick={() => pick('new')}
          aria-pressed={isNewSelected}
          data-testid="pick-new-product"
          className={cx(
            'flex min-h-14 w-full items-center gap-3 rounded-control border px-3 text-left transition-colors',
            isNewSelected ? 'border-accent bg-accent-soft' : 'border-border hover:bg-band',
          )}
        >
          <Plus aria-hidden="true" className="size-5 shrink-0 text-accent-ink" />
          <span className="flex min-w-0 flex-col">
            <span className="font-sans font-medium text-[15px] text-text">{t('newProduct')}</span>
            <span className="truncate font-mono text-[12px] text-text-muted">
              {t('matchNew', { name: newProductName })}
            </span>
          </span>
        </button>
      </div>
    </Sheet>
  );
}
