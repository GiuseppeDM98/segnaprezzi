'use client';

/**
 * The manual entry form's field state: the product search and choice, the
 * local catalog, the price fields, promo, store and date — and the moves the
 * form makes between them (picking a product resets the size unit, a reset
 * after save keeps the store and date).
 *
 * Design: state only. The numbers derived from it come from
 * manual-entry-derivations.ts, and the save itself — the Server Action call,
 * its error and pending state — stays in ManualEntryForm, so this hook never
 * talks to the server.
 */
import { type RefObject, useRef, useState } from 'react';

import type { PromoKind } from '@/lib/domain/entries';
import { SIZE_UNIT_OPTIONS, type UnitKind } from '@/lib/domain/units';
import { formatDateTimeLocalValue } from '@/lib/format';
import type { ManualEntryContext, ProductSummary } from '@/lib/services/capture-context';
import {
  activeUnitKindOf,
  computeManualPrice,
  filterProductHits,
  type ManualPrice,
  type NewProductChoice,
  type ProductChoice,
  resolveSizeUnit,
} from './manual-entry-derivations';

export interface ManualEntryFormState {
  query: string;
  setQuery: (query: string) => void;
  /** The catalog as this form knows it: the page's, plus products created here. */
  products: ProductSummary[];
  /** The trimmed, lower-cased query; empty when there is none. */
  normalizedQuery: string;
  hits: ProductSummary[];
  choice: ProductChoice;
  /** Pick a catalog product and move the focus to the total. */
  pickExisting: (product: ProductSummary) => void;
  /** Start creating a product, prefilled with `name`. */
  startNew: (name: string) => void;
  clearChoice: () => void;
  /** Edit the product being created (name, brand, category). */
  updateNewProduct: (patch: Partial<Omit<NewProductChoice, 'kind' | 'unitKind'>>) => void;
  /** Change the new product's unit kind; the size unit follows it. */
  setNewProductUnitKind: (unitKind: UnitKind) => void;
  /** Add a product created by a save to the local catalog. */
  addProduct: (product: ProductSummary) => void;

  activeUnitKind: UnitKind;
  totalEuros: number | null;
  setTotalEuros: (value: number | null) => void;
  sizeValue: number | null;
  setSizeValue: (value: number | null) => void;
  sizeUnitOptions: ReturnType<typeof resolveSizeUnit>['options'];
  sizeUnitKey: string;
  setSizeUnitKey: (key: string) => void;
  unitPriceEuros: number | null;
  isUnitPriceEdited: boolean;
  /** The user typed a unit price: from now on it is theirs, not derived. */
  editUnitPrice: (value: number | null) => void;
  price: ManualPrice;
  /** The total's input, focused after a catalog pick. */
  totalInputRef: RefObject<HTMLInputElement | null>;

  isPromo: boolean;
  /** Turning promo off clears the kind. */
  setIsPromo: (isPromo: boolean) => void;
  promoKind: PromoKind | null;
  setPromoKind: (kind: PromoKind) => void;

  storeId: string | null;
  setStoreId: (storeId: string | null) => void;
  /** The date-time input's value (local time, `YYYY-MM-DDTHH:mm`). */
  recordedAtLocal: string;
  setRecordedAtLocal: (value: string) => void;

  /** Clear the entry for the next one; keeps the store and the date. */
  resetEntry: () => void;
}

/**
 * Hold the manual entry form's fields.
 *
 * @param context the catalog, stores and default store the page loaded; read
 *   on the first render only.
 */
export function useManualEntryForm(context: ManualEntryContext): ManualEntryFormState {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<ProductSummary[]>(context.products);
  const [choice, setChoice] = useState<ProductChoice>(null);
  const [storeId, setStoreId] = useState<string | null>(context.defaultStoreId);
  const [recordedAtLocal, setRecordedAtLocal] = useState(() =>
    formatDateTimeLocalValue(Date.now()),
  );
  const [totalEuros, setTotalEuros] = useState<number | null>(null);
  const [sizeValue, setSizeValue] = useState<number | null>(null);
  const [sizeUnitKey, setSizeUnitKey] = useState('kg');
  const [unitPriceEuros, setUnitPriceEuros] = useState<number | null>(null);
  const [isUnitPriceEdited, setIsUnitPriceEdited] = useState(false);
  const [isPromo, setIsPromoState] = useState(false);
  const [promoKind, setPromoKind] = useState<PromoKind | null>(null);
  const totalInputRef = useRef<HTMLInputElement | null>(null);

  const activeUnitKind = activeUnitKindOf(choice);
  const sizeUnit = resolveSizeUnit(activeUnitKind, sizeUnitKey);
  const price = computeManualPrice({
    totalEuros,
    sizeValue,
    sizeUnit: sizeUnit.unit,
    unitPriceEuros,
    isUnitPriceEdited,
  });
  const { normalizedQuery, hits } = filterProductHits(products, query);

  function pickExisting(product: ProductSummary): void {
    setChoice({ kind: 'existing', product });
    setSizeUnitKey(SIZE_UNIT_OPTIONS[product.unitKind][0].key);
    setQuery('');
    requestAnimationFrame(() => totalInputRef.current?.focus());
  }

  function startNew(name: string): void {
    setChoice({ kind: 'new', name, brand: '', category: 'food', unitKind: 'weight' });
    setSizeUnitKey('kg');
    setQuery('');
  }

  function updateNewProduct(patch: Partial<Omit<NewProductChoice, 'kind' | 'unitKind'>>): void {
    if (choice?.kind === 'new') {
      setChoice({ ...choice, ...patch });
    }
  }

  function setNewProductUnitKind(unitKind: UnitKind): void {
    if (choice?.kind === 'new') {
      setChoice({ ...choice, unitKind });
      setSizeUnitKey(SIZE_UNIT_OPTIONS[unitKind][0].key);
    }
  }

  function editUnitPrice(value: number | null): void {
    setIsUnitPriceEdited(true);
    setUnitPriceEuros(value);
  }

  function setIsPromo(next: boolean): void {
    setIsPromoState(next);
    if (!next) {
      setPromoKind(null);
    }
  }

  function resetEntry(): void {
    setChoice(null);
    setTotalEuros(null);
    setSizeValue(null);
    setUnitPriceEuros(null);
    setIsUnitPriceEdited(false);
    setIsPromoState(false);
    setPromoKind(null);
  }

  return {
    query,
    setQuery,
    products,
    normalizedQuery,
    hits,
    choice,
    pickExisting,
    startNew,
    clearChoice: () => setChoice(null),
    updateNewProduct,
    setNewProductUnitKind,
    addProduct: (product) => setProducts((current) => [...current, product]),
    activeUnitKind,
    totalEuros,
    setTotalEuros,
    sizeValue,
    setSizeValue,
    sizeUnitOptions: sizeUnit.options,
    sizeUnitKey: sizeUnit.unit.key,
    setSizeUnitKey,
    unitPriceEuros,
    isUnitPriceEdited,
    editUnitPrice,
    price,
    totalInputRef,
    isPromo,
    setIsPromo,
    promoKind,
    setPromoKind,
    storeId,
    setStoreId,
    recordedAtLocal,
    setRecordedAtLocal,
    resetEntry,
  };
}
