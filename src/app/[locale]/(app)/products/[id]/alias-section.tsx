'use client';

/**
 * The receipt lines this product has learned, each with its chain, its hit
 * count and a button to forget it. Unlike the screen's other sections it
 * calls its own action: forgetting an alias touches nothing else on the
 * screen, so a refresh after the delete is all the screen needs to know.
 */
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { IconButton } from '@/components/ui/icon-button';
import { SectionHeading } from '@/components/ui/section-heading';
import { useToast } from '@/components/ui/toast';
import { callAction, describeActionError } from '@/lib/call-action';
import { useRouter } from '@/lib/i18n/navigation';
import type { ProductDetail } from '@/lib/services/product-detail';
import { deleteProductAlias } from './actions';

/**
 * Render the learned aliases, or nothing when there are none.
 *
 * Visible because an alias is invisible machinery until it goes wrong: when
 * a receipt keeps resolving "LATTE PS UHT" to the wrong milk, this list is
 * the only place a user can undo the lesson.
 */
export function AliasSection({ aliases }: { aliases: ProductDetail['aliases'] }) {
  const t = useTranslations('productDetail');
  const tErrors = useTranslations('errors');
  const { toast } = useToast();
  const router = useRouter();

  if (aliases.length === 0) {
    return null;
  }

  async function handleDelete(aliasId: string): Promise<void> {
    const result = await callAction('deleteProductAlias', deleteProductAlias({ aliasId }));
    if (!result.ok) {
      toast({
        kind: 'error',
        message: describeActionError(result.error, tErrors, t('aliasDeleteError')),
      });
      return;
    }
    toast({ kind: 'success', message: t('aliasDeleted') });
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>{t('aliasesTitle')}</SectionHeading>
      <ul className="zebra -mx-1" data-testid="alias-list">
        {aliases.map((alias) => (
          <li key={alias.id} className="flex min-h-12 items-center gap-3 px-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-[13px] text-text">{alias.alias}</span>
              <span className="truncate font-sans text-[12px] text-text-muted">
                {alias.storeChain ?? t('aliasAnyChain')} ·{' '}
                {t('aliasHits', { count: alias.hitCount })}
              </span>
            </span>
            <IconButton
              icon={<X />}
              label={t('aliasDelete')}
              onClick={() => void handleDelete(alias.id)}
              data-testid="alias-delete"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
