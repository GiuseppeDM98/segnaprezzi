'use client';

/**
 * The sheet that edits a product's name, brand and category. Controlled:
 * the draft lives in the screen, which also saves it, so this component
 * renders the fields and reports changes. Save stays disabled while the
 * name is blank: the name is the one required field.
 */
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { CATEGORY_IDS, type CategoryId } from '@/lib/domain/categories';

/** The editable fields of a product, as the form holds them (an empty brand means none). */
export interface ProductDraft {
  name: string;
  brand: string;
  category: CategoryId;
}

export interface EditProductSheetProps {
  isOpen: boolean;
  onClose: () => void;
  draft: ProductDraft;
  onDraftChange: (draft: ProductDraft) => void;
  isSaving: boolean;
  onSave: () => void;
}

/** Render the edit form in a sheet, with cancel and save buttons. */
export function EditProductSheet({
  isOpen,
  onClose,
  draft,
  onDraftChange,
  isSaving,
  onSave,
}: EditProductSheetProps) {
  const t = useTranslations('productDetail');
  const tCommon = useTranslations('common');
  const tCategories = useTranslations('categories');

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title={t('editTitle')}>
      <div className="flex flex-col gap-3">
        <Field label={t('name')} isRequired>
          {(controlProps) => (
            <Input
              {...controlProps}
              value={draft.name}
              onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
              data-testid="edit-product-name"
            />
          )}
        </Field>
        <Field label={t('brand')}>
          {(controlProps) => (
            <Input
              {...controlProps}
              value={draft.brand}
              onChange={(event) => onDraftChange({ ...draft, brand: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('category')}>
          {(controlProps) => (
            <Select
              {...controlProps}
              value={draft.category}
              onChange={(event) =>
                onDraftChange({ ...draft, category: event.target.value as CategoryId })
              }
              options={CATEGORY_IDS.map((category) => ({
                value: category,
                label: tCategories(category),
              }))}
            />
          )}
        </Field>
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            className="flex-1"
            isPending={isSaving}
            disabled={draft.name.trim().length === 0}
            onClick={onSave}
            data-testid="save-product"
          >
            {tCommon('save')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
