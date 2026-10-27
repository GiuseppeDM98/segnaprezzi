/**
 * The store list of a screen with a StorePickerSheet, and the inline create
 * that grows it.
 *
 * Design: every capture screen used to carry its own copy of "call
 * createStore, append the new row, keep the list sorted", each resolving a
 * failure to null so that the sheet simply did nothing. This is the one copy.
 * The Server Action arrives as a parameter because components never import
 * actions (AGENTS.md §1.5).
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useToast } from '@/components/ui/toast';
import type { StoreKind } from '@/lib/domain/stores';
import type { StoreCreateResult, StoreOption } from './store-picker-sheet';

/** The part of the createStore Server Action's contract this hook relies on. */
export type CreateStoreAction = (input: {
  name: string;
  chain: null;
  city: null;
  kind: StoreKind;
}) => Promise<{ ok: true; data: { id: string } } | { ok: false; error: { code: string } }>;

/**
 * Hold a screen's store options and create new ones inline.
 *
 * A failed create (the action answering `ok: false`, or rejecting because the
 * request never arrived) shows an error toast and resolves to `ok: false`
 * with the translated reason, which StorePickerSheet shows under its create
 * row. A successful one is appended and the list re-sorted by name.
 *
 * @param initialStores - The stores the page loaded; read on the first render only
 * @param createStoreAction - The createStore Server Action
 * @param kind - The kind every store created here gets
 * @returns The current options and the `onCreate` callback for StorePickerSheet
 */
export function useStoreOptions(
  initialStores: StoreOption[],
  createStoreAction: CreateStoreAction,
  kind: StoreKind,
): { stores: StoreOption[]; createStore: (name: string) => Promise<StoreCreateResult> } {
  const t = useTranslations('scan.storePicker');
  const tErrors = useTranslations('errors');
  const tCommon = useTranslations('common');
  const { toast } = useToast();
  const [stores, setStores] = useState<StoreOption[]>(initialStores);

  function reportFailure(name: string, message: string): StoreCreateResult {
    toast({ kind: 'error', message: t('createError', { name }) });
    return { ok: false, message };
  }

  async function createStore(name: string): Promise<StoreCreateResult> {
    let result: Awaited<ReturnType<CreateStoreAction>>;
    try {
      result = await createStoreAction({ name, chain: null, city: null, kind });
    } catch (error) {
      // A rejected Server Action never reached the server (offline, or the
      // deployment changed under the page); there is no code to translate.
      console.error('Inline store create failed', { name, kind, error });
      return reportFailure(name, tCommon('notSaved'));
    }
    if (!result.ok) {
      return reportFailure(name, tErrors(result.error.code));
    }
    const created: StoreOption = { id: result.data.id, name, chain: null };
    setStores((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
    return { ok: true, store: created };
  }

  return { stores, createStore };
}
