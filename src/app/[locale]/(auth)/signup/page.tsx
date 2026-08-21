import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { env } from '@/lib/env';
import { SignupForm } from './signup-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signup') };
}

/**
 * Signup (Spec 05 §5.11). Server component so env.SIGNUP_ENABLED never has
 * to cross into client code (Spec 02 §5.7): a closed instance renders the
 * notice instead of the form.
 */
export default async function SignupPage() {
  if (!env.SIGNUP_ENABLED) {
    const t = await getTranslations('auth');
    return (
      <main className="flex min-h-dvh items-center justify-center px-6 pt-safe pb-safe">
        <EmptyState
          title={t('signupClosed')}
          body={t('signupClosedBody')}
          data-testid="signup-closed"
          action={<Button href="/login">{t('login')}</Button>}
        />
      </main>
    );
  }

  return <SignupForm />;
}
