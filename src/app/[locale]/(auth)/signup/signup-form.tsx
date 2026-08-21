'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { AuthForm } from '@/components/auth/auth-form';
import { authClient } from '@/lib/auth/client';
import { Link, useRouter } from '@/lib/i18n/navigation';

export function SignupForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') || '/';

  return (
    <AuthForm
      mode="signup"
      title={t('signupTitle')}
      submitLabel={t('signup')}
      onSubmit={async ({ name, email, password }) => {
        const { error } = await authClient.signUp.email({ name, email, password });
        if (error) {
          return error.status === 0 ? t('networkError') : t('signupError');
        }
        router.push(redirectTo);
        router.refresh();
        return null;
      }}
      footer={
        <>
          {t('haveAccount')}{' '}
          <Link
            href="/login"
            className="font-semibold text-accent-ink underline underline-offset-4"
          >
            {t('login')}
          </Link>
        </>
      }
    />
  );
}
