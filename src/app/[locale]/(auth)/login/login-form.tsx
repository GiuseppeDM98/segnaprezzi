'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { AuthForm } from '@/components/auth/auth-form';
import { authClient } from '@/lib/auth/client';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { sanitizeRedirectPath } from '@/lib/redirects';

/**
 * Email sign-in; returns to `redirectTo` (set by the middleware's auth gate)
 * when it is a same-origin path, or home.
 */
export function LoginForm({ isSignupEnabled }: { isSignupEnabled: boolean }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = sanitizeRedirectPath(searchParams.get('redirectTo'));

  return (
    <AuthForm
      mode="login"
      title={t('loginTitle')}
      submitLabel={t('login')}
      onSubmit={async ({ email, password }) => {
        const { error } = await authClient.signIn.email({ email, password });
        if (error) {
          return error.status === 0 ? t('networkError') : t('loginError');
        }
        router.push(redirectTo);
        router.refresh();
        return null;
      }}
      footer={
        isSignupEnabled ? (
          <>
            {t('noAccount')}{' '}
            <Link
              href="/signup"
              className="font-semibold text-accent-ink underline underline-offset-4"
            >
              {t('signup')}
            </Link>
          </>
        ) : null
      }
    />
  );
}
