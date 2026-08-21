import { getTranslations } from 'next-intl/server';

import { env } from '@/lib/env';
import { SignupForm } from './signup-form';

/**
 * Server component so env.SIGNUP_ENABLED never has to cross into client
 * code (Spec 02 §5.7) — it is read here and passed down as a plain prop.
 */
export default async function SignupPage() {
  const t = await getTranslations('auth');

  if (!env.SIGNUP_ENABLED) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-semibold text-2xl">{t('signup')}</h1>
        <p>{t('signupClosed')}</p>
      </main>
    );
  }

  return <SignupForm />;
}
