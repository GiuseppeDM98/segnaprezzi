'use client';

/**
 * Store picker sheet shared by every entry screen that asks for a store:
 * search, the "none" row, inline create, and a link to
 * the stores screen. Creating is delegated to the screen through `onCreate`
 * so this component never imports a Server Action.
 */
import { Check, Plus, Store as StoreIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { cx } from '@/lib/cx';
import { MIN_QUERY_LENGTH } from '@/lib/domain/search';

export interface StoreOption {
  id: string;
  name: string;
  chain?: string | null;
}

/** Outcome of an inline create: the new option, or the reason to show under the row. */
export type StoreCreateResult = { ok: true; store: StoreOption } | { ok: false; message: string };

export interface StorePickerSheetProps {
  isOpen: boolean;
  onClose: () => void;
  stores: StoreOption[];
  selectedId: string | null;
  onSelect: (storeId: string | null) => void;
  /**
   * Creates a store with the typed name. A failure resolves to `ok: false`
   * with a translated message, which the sheet shows under the create row; a
   * rejection is shown as a generic "not saved".
   */
  onCreate?: (name: string) => Promise<StoreCreateResult>;
  /** Label of the "none" row; omit to hide it. */
  noneLabel?: string;
  title: string;
}

export function StorePickerSheet({
  isOpen,
  onClose,
  stores,
  selectedId,
  onSelect,
  onCreate,
  noneLabel,
  title,
}: StorePickerSheetProps) {
  const t = useTranslations('scan.storePicker');
  const tCommon = useTranslations('common');
  const [query, setQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? stores.filter(
        (store) =>
          store.name.toLowerCase().includes(normalized) ||
          store.chain?.toLowerCase().includes(normalized),
      )
    : stores;
  const canCreate =
    onCreate !== undefined &&
    normalized.length >= MIN_QUERY_LENGTH &&
    !stores.some((store) => store.name.toLowerCase() === normalized);

  function pick(storeId: string | null): void {
    onSelect(storeId);
    setQuery('');
    onClose();
  }

  function handleQueryChange(next: string): void {
    setQuery(next);
    setCreateError(null);
  }

  async function handleCreate(): Promise<void> {
    if (!onCreate) {
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    let result: StoreCreateResult;
    try {
      result = await onCreate(query.trim());
    } catch {
      result = { ok: false, message: tCommon('notSaved') };
    } finally {
      setIsCreating(false);
    }
    if (result.ok) {
      pick(result.store.id);
    } else {
      setCreateError(result.message);
    }
  }

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex flex-col gap-3">
        <Input
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          autoComplete="off"
        />
        <ul className="zebra -mx-2 max-h-[45dvh] overflow-y-auto rounded-control">
          {noneLabel && !normalized && (
            <li>
              <PickerRow
                label={noneLabel}
                isSelected={selectedId === null}
                onClick={() => pick(null)}
              />
            </li>
          )}
          {filtered.map((store) => (
            <li key={store.id}>
              <PickerRow
                label={store.name}
                caption={store.chain ?? undefined}
                isSelected={selectedId === store.id}
                onClick={() => pick(store.id)}
              />
            </li>
          ))}
          {canCreate && (
            <li>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={isCreating}
                className="flex min-h-12 w-full items-center gap-3 px-3 text-left font-sans text-[15px] text-accent-ink hover:bg-accent-soft disabled:opacity-50"
              >
                <Plus aria-hidden="true" className="size-4" />
                {t('create', { query: query.trim() })}
              </button>
            </li>
          )}
          {canCreate && createError && (
            <li role="alert" className="px-3 py-2 font-sans text-[13px] text-negative">
              {createError}
            </li>
          )}
        </ul>
        <Button href="/stores" variant="ghost" icon={<StoreIcon className="size-4" />}>
          {t('manage')}
        </Button>
      </div>
    </Sheet>
  );
}

function PickerRow({
  label,
  caption,
  isSelected,
  onClick,
}: {
  label: string;
  caption?: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={cx(
        'flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left transition-colors hover:bg-accent-soft',
        isSelected && 'font-semibold',
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-sans text-[15px] text-text">{label}</span>
        {caption && <span className="truncate text-[12px] text-text-muted">{caption}</span>}
      </span>
      {isSelected && <Check aria-hidden="true" className="size-4 shrink-0 text-accent-ink" />}
    </button>
  );
}
