'use client';

/**
 * The merge confirmation: the selected products as radio options for the
 * one that survives, a sentence naming it, and the destructive confirm.
 * Controlled: the candidates, the survivor and the merge call belong to
 * the screen; this component renders the choice and reports it.
 */
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { cx } from '@/lib/cx';
import type { CatalogProduct } from '@/lib/services/catalog';

export interface MergeProductsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** The selected products, each one a possible survivor. */
  candidates: CatalogProduct[];
  survivorId: string | null;
  /** The product `survivorId` names, or null; resolved by the screen. */
  survivor: CatalogProduct | null;
  onSurvivorChange: (productId: string) => void;
  isMerging: boolean;
  onConfirm: () => void;
}

/** Render the survivor picker and the merge button, disabled until a survivor is chosen. */
export function MergeProductsSheet({
  isOpen,
  onClose,
  candidates,
  survivorId,
  survivor,
  onSurvivorChange,
  isMerging,
  onConfirm,
}: MergeProductsSheetProps) {
  const t = useTranslations('products');

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('mergeTitle')}
      description={t('mergeSurvivor')}
    >
      <div className="flex flex-col gap-4">
        <fieldset className="zebra -mx-2 rounded-control border-0 p-0">
          <legend className="sr-only">{t('mergeSurvivor')}</legend>
          {candidates.map((product) => (
            <label
              key={product.id}
              data-testid="survivor-option"
              className={cx(
                'flex min-h-12 cursor-pointer items-center justify-between gap-3 px-3 hover:bg-accent-soft',
                survivorId === product.id && 'font-semibold',
              )}
            >
              <input
                type="radio"
                name="survivor"
                value={product.id}
                checked={survivorId === product.id}
                onChange={() => onSurvivorChange(product.id)}
                className="sr-only"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-[14px] text-text">{product.name}</span>
                {product.brand && (
                  <span className="truncate font-sans text-[12px] text-text-muted">
                    {product.brand}
                  </span>
                )}
              </span>
              {survivorId === product.id && (
                <Check aria-hidden="true" className="size-4 text-accent-ink" />
              )}
            </label>
          ))}
        </fieldset>
        {survivor && (
          <p className="font-sans text-[14px] text-text-muted">
            {t('mergeBody', { survivor: survivor.name })}
          </p>
        )}
        <Button
          variant="danger"
          size="lg"
          isPending={isMerging}
          disabled={!survivorId}
          onClick={onConfirm}
          data-testid="confirm-merge"
        >
          {t('mergeConfirm')}
        </Button>
      </div>
    </Sheet>
  );
}
