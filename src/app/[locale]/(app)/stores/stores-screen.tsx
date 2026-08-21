'use client';

/**
 * Client half of store management (Spec 05 §5.9): zebra rows with the
 * kind icon and entry count, an add action in the header, and one sheet
 * for both create and edit (delete lives inside the edit sheet behind an
 * inline confirm that says what happens to the entries).
 */
import { Fuel, Plus, ShoppingCart, Store as StoreIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ScreenHeader } from '@/components/layout/screen-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { STORE_KINDS, type StoreKind } from '@/lib/domain/stores';
import { useRouter } from '@/lib/i18n/navigation';
import type { StoreListItem } from '@/lib/services/stores';
import { createStore, deleteStore, updateStore } from './actions';

const KIND_ICONS: Record<StoreKind, typeof StoreIcon> = {
  supermarket: ShoppingCart,
  fuel_station: Fuel,
  other: StoreIcon,
};

interface StoreDraft {
  id: string | null;
  name: string;
  chain: string;
  city: string;
  kind: StoreKind;
}

const EMPTY_DRAFT: StoreDraft = { id: null, name: '', chain: '', city: '', kind: 'supermarket' };

export interface StoresScreenProps {
  stores: StoreListItem[];
}

export function StoresScreen({ stores }: StoresScreenProps) {
  const t = useTranslations('stores');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState<StoreDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  function openEdit(store: StoreListItem): void {
    setIsConfirmingDelete(false);
    setDraft({
      id: store.id,
      name: store.name,
      chain: store.chain ?? '',
      city: store.city ?? '',
      kind: store.kind,
    });
  }

  async function handleSave(): Promise<void> {
    if (!draft) {
      return;
    }
    setIsSaving(true);
    const input = {
      name: draft.name.trim(),
      chain: draft.chain.trim() || null,
      city: draft.city.trim() || null,
      kind: draft.kind,
    };
    const result = draft.id
      ? await updateStore({ storeId: draft.id, input })
      : await createStore(input);
    setIsSaving(false);
    if (!result.ok) {
      toast({ kind: 'error', message: t('saveError') });
      return;
    }
    setDraft(null);
    toast({ kind: 'success', message: t('saved') });
    router.refresh();
  }

  async function handleDelete(): Promise<void> {
    if (!draft?.id) {
      return;
    }
    setIsSaving(true);
    const result = await deleteStore({ storeId: draft.id });
    setIsSaving(false);
    if (!result.ok) {
      toast({ kind: 'error', message: t('saveError') });
      return;
    }
    setDraft(null);
    toast({ kind: 'success', message: t('deleted') });
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        title={t('title')}
        backHref="/settings"
        actions={
          <IconButton
            icon={<Plus />}
            label={t('add')}
            onClick={() => setDraft(EMPTY_DRAFT)}
            data-testid="add-store"
          />
        }
      />

      {stores.length === 0 ? (
        <EmptyState
          icon={<StoreIcon />}
          title={t('empty.title')}
          body={t('empty.body')}
          data-testid="stores-empty"
          action={<Button onClick={() => setDraft(EMPTY_DRAFT)}>{t('empty.cta')}</Button>}
        />
      ) : (
        <ul className="zebra mx-auto w-full max-w-3xl pt-2" data-testid="store-list">
          {stores.map((store) => {
            const Icon = KIND_ICONS[store.kind];
            return (
              <li key={store.id}>
                <button
                  type="button"
                  onClick={() => openEdit(store)}
                  data-testid="store-row"
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent-soft"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-band text-text-muted">
                    <Icon aria-hidden="true" className="size-4" />
                    <span className="sr-only">{t(`kinds.${store.kind}`)}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="line-clamp-2 font-sans font-medium text-[15px] text-text leading-snug">
                      {store.name}
                    </span>
                    <span className="truncate font-sans text-[12px] text-text-muted">
                      {[store.chain, store.city].filter(Boolean).join(' · ') ||
                        t(`kinds.${store.kind}`)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-text-muted tabular-nums">
                    {t('entryCount', { count: store.entryCount })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        isOpen={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t('editTitle') : t('addTitle')}
      >
        {draft && (
          <div className="flex flex-col gap-3">
            <Field label={t('name')} isRequired>
              {(controlProps) => (
                <Input
                  {...controlProps}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder={t('namePlaceholder')}
                  data-testid="store-name"
                  autoFocus={!draft.id}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('chain')}>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={draft.chain}
                    onChange={(event) => setDraft({ ...draft, chain: event.target.value })}
                    data-testid="store-chain"
                  />
                )}
              </Field>
              <Field label={t('city')}>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={draft.city}
                    onChange={(event) => setDraft({ ...draft, city: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-sans font-medium text-[15px] text-text">{t('kind')}</span>
              <Segmented<StoreKind>
                label={t('kind')}
                value={draft.kind}
                onChange={(kind) => setDraft({ ...draft, kind })}
                options={STORE_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setDraft(null)}>
                {tCommon('cancel')}
              </Button>
              <Button
                className="flex-1"
                isPending={isSaving && !isConfirmingDelete}
                disabled={draft.name.trim().length === 0}
                onClick={() => void handleSave()}
                data-testid="save-store"
              >
                {tCommon('save')}
              </Button>
            </div>

            {draft.id &&
              (isConfirmingDelete ? (
                <div className="flex flex-col gap-2 rounded-control border border-negative/40 bg-negative-soft p-3">
                  <p className="font-sans text-[14px] text-text">{t('deleteConfirm')}</p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setIsConfirmingDelete(false)}
                    >
                      {tCommon('cancel')}
                    </Button>
                    <Button
                      variant="danger"
                      className="flex-1"
                      isPending={isSaving}
                      onClick={() => void handleDelete()}
                      data-testid="confirm-delete-store"
                    >
                      {tCommon('delete')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => setIsConfirmingDelete(true)}
                  data-testid="delete-store"
                >
                  {t('delete')}
                </Button>
              ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
