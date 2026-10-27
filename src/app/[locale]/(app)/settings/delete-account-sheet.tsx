'use client';

/**
 * The confirmation sheet for deleting the account: the password field, the
 * error the server returned, cancel and the destructive confirm.
 * Controlled: the password, the error, the pending flag and the delete
 * call belong to the screen, which also decides when the password is long
 * enough to try (`canConfirm`).
 */
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';

export interface DeleteAccountSheetProps {
  isOpen: boolean;
  onClose: () => void;
  password: string;
  onPasswordChange: (password: string) => void;
  /** The translated failure of the last attempt, or null. */
  error: string | null;
  isDeleting: boolean;
  /** False keeps the confirm button disabled. */
  canConfirm: boolean;
  onConfirm: () => void;
}

/** Render the delete-account confirmation in a sheet. */
export function DeleteAccountSheet({
  isOpen,
  onClose,
  password,
  onPasswordChange,
  error,
  isDeleting,
  canConfirm,
  onConfirm,
}: DeleteAccountSheetProps) {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('account.deleteTitle')}
      description={t('account.deleteBody')}
    >
      <div className="flex flex-col gap-3">
        <Field label={t('account.deletePassword')} error={error}>
          {(controlProps) => (
            <Input
              {...controlProps}
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              autoComplete="current-password"
              data-testid="delete-password"
            />
          )}
        </Field>
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            isPending={isDeleting}
            disabled={!canConfirm}
            onClick={onConfirm}
            data-testid="confirm-delete-account"
          >
            {t('account.deleteConfirm')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
