'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { z } from 'zod';

import { authClient } from '@/lib/auth/client';
import { useRouter } from '@/lib/i18n/navigation';

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(t('invalidEmail'));
      return;
    }

    setIsSubmitting(true);
    const { error: signInError } = await authClient.signIn.email({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message ?? t('invalidEmail'));
      return;
    }

    router.push(redirectTo);
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <h1 className="font-semibold text-2xl">{t('login')}</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
        <label className="flex flex-col gap-1">
          {t('email')}
          <input
            type="email"
            name="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded border p-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          {t('password')}
          <input
            type="password"
            name="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded border p-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-red-600 text-sm">
            {error}
          </p>
        )}
        <button type="submit" disabled={isSubmitting} className="rounded border p-2">
          {t('submit')}
        </button>
      </form>
    </main>
  );
}
