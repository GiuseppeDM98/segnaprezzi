import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { env } from '@/lib/env';
import { LoginForm } from './login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('login') };
}

/**
 * Login. Server component so SIGNUP_ENABLED decides the
 * signup cross-link without crossing into client code.
 */
export default function LoginPage() {
  return <LoginForm isSignupEnabled={env.SIGNUP_ENABLED} />;
}
