'use client';

/**
 * Confirmation for the one action in the app that destroys price history.
 *
 * Design: the weight of the decision is carried by the count, not by the
 * wording. A product with no observations says so and is a trivial delete; a
 * product with fifty says fifty, and adds that the personal index will be
 * recomputed without them — which is the consequence a user cannot see from
 * the catalog screen. The escape hatch (archive keeps the history) is named
 * here rather than left for the user to remember.
 */
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';

export interface DeletableProduct {
  id: string;
  name: string;
  entryCount: number;
}

export interface DeleteProductsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  products: DeletableProduct[];
  isPending: boolean;
  onConfirm: () => void;
}

export function DeleteProductsSheet({
  isOpen,
  onClose,
  products,
  isPending,
  onConfirm,
}: DeleteProductsSheetProps) {
  const t = useTranslations('products');
  const tCommon = useTranslations('common');

  const entryCount = products.reduce((total, product) => total + product.entryCount, 0);
  const only = products.length === 1 ? products[0] : null;

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title={
        only
          ? t('deleteTitleOne', { name: only.name })
          : t('deleteTitleMany', { count: products.length })
      }
    >
      <div className="flex flex-col gap-4">
        <p className="font-sans text-[15px] text-text" data-testid="delete-impact">
          {entryCount > 0
            ? t('deleteBodyWithEntries', { count: entryCount })
            : t('deleteBodyEmpty')}
        </p>
        <p className="font-sans text-[14px] text-text-muted">{t('deleteIrreversible')}</p>

        {/* More than one product: name them, so "3 products" is never a guess. */}
        {products.length > 1 && (
          <ul className="zebra -mx-2">
            {products.map((product) => (
              <li
                key={product.id}
                className="flex min-h-12 items-center justify-between gap-3 px-3"
              >
                <span className="truncate font-mono text-[14px] text-text">{product.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-text-muted uppercase tracking-wide">
                  {t('selectedEntryCount', { count: product.entryCount })}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2">
          <Button
            variant="danger"
            size="lg"
            isPending={isPending}
            onClick={onConfirm}
            data-testid="confirm-delete-products"
          >
            {t('deleteConfirm')}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {tCommon('cancel')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
