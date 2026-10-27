'use client';

/**
 * The manual entry form's sticky bar: "done" back home, and the submit
 * button of the surrounding form.
 *
 * Design: the save button is a plain `type="submit"`, so the form's own
 * onSubmit stays the one place a save starts — pressing Enter in a field and
 * tapping the button take the same path.
 */
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { StickyActionBar } from '@/components/ui/sticky-action-bar';

export interface ManualSubmitBarProps {
  isSubmitting: boolean;
  onDone: () => void;
}

/** Render the bar; it must sit inside the form it submits. */
export function ManualSubmitBar({ isSubmitting, onDone }: ManualSubmitBarProps) {
  const t = useTranslations('addManual');
  const tCommon = useTranslations('common');

  return (
    <StickyActionBar>
      <div className="mx-auto flex w-full max-w-xl items-center gap-3">
        <Button variant="ghost" onClick={onDone}>
          {tCommon('done')}
        </Button>
        <Button
          type="submit"
          size="lg"
          isPending={isSubmitting}
          className="flex-1"
          data-testid="save-entry"
        >
          {t('submit')}
        </Button>
      </div>
    </StickyActionBar>
  );
}
