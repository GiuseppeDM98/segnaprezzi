'use client';

/**
 * The product's overflow menu, opened from the header: edit, archive or
 * restore, delete. It only offers the choices; each one is a callback, and
 * closing the menu before the next sheet opens is the screen's job.
 */
import { Archive, ArchiveRestore, PencilLine, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Sheet } from '@/components/ui/sheet';
import { cx } from '@/lib/cx';

export interface ProductMenuSheetProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  /** Decides whether the archive row archives or restores. */
  isArchived: boolean;
  onEdit: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

/** Render the menu sheet with one row per product-level action. */
export function ProductMenuSheet({
  isOpen,
  onClose,
  productName,
  isArchived,
  onEdit,
  onToggleArchive,
  onDelete,
}: ProductMenuSheetProps) {
  const t = useTranslations('productDetail');
  const tProducts = useTranslations('products');

  return (
    <Sheet isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col">
        <MenuRow
          icon={<PencilLine />}
          label={t('edit')}
          onClick={onEdit}
          testId="menu-edit-product"
        />
        <MenuRow
          icon={isArchived ? <ArchiveRestore /> : <Archive />}
          label={isArchived ? t('restore') : t('archive')}
          onClick={onToggleArchive}
          testId="menu-archive-product"
        />
        <MenuRow
          icon={<Trash2 />}
          label={tProducts('deleteRow', { name: productName })}
          onClick={onDelete}
          testId="menu-delete-product"
          tone="danger"
        />
      </div>
    </Sheet>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  testId,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cx(
        'flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-left font-sans font-medium text-[15px] transition-colors [&>svg]:size-5',
        tone === 'danger' ? 'text-negative hover:bg-negative-soft' : 'text-text hover:bg-band',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
