'use client';

/**
 * The shared auth form: one real <form> whose fields are
 * revealed progressively — the next field slides in (house spring) once the
 * previous one is valid and focus advances — so autofill and password
 * managers keep working while the screen feels like one question at a time.
 * Errors sit under the field that caused them; never a generic banner.
 */
import { Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { LogoMark } from '@/components/ui/logo-mark';
import { useAppMotion } from '@/lib/motion';

const emailSchema = z.email();
const PASSWORD_MIN_LENGTH = 8;

export interface AuthFormProps {
  mode: 'login' | 'signup';
  title: string;
  submitLabel: string;
  /** Runs the auth call; resolves to a localized error message or null. */
  onSubmit: (values: { name: string; email: string; password: string }) => Promise<string | null>;
  /** Cross-link to the other auth screen. */
  footer: ReactNode;
}

export function AuthForm({ mode, title, submitLabel, onSubmit, footer }: AuthFormProps) {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [touched, setTouched] = useState<{ name: boolean; email: boolean; password: boolean }>({
    name: false,
    email: false,
    password: false,
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  const isNameValid = mode === 'login' || name.trim().length > 0;
  const isEmailValid = emailSchema.safeParse(email).success;
  const isPasswordValid = password.length >= PASSWORD_MIN_LENGTH;

  const isEmailRevealed = isNameValid;
  const isPasswordRevealed = isEmailRevealed && isEmailValid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setTouched({ name: true, email: true, password: true });
    setSubmitError(null);
    if (!isNameValid || !isEmailValid) {
      emailRef.current?.focus();
      return;
    }
    if (!isPasswordValid) {
      passwordRef.current?.focus();
      return;
    }
    setIsSubmitting(true);
    const error = await onSubmit({ name: name.trim(), email, password });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error);
      passwordRef.current?.focus();
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 pt-safe pb-safe">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <LogoMark size={64} title={tCommon('appName')} />
          <div className="flex flex-col gap-1">
            <h1 className="font-sans font-semibold text-2xl text-text leading-tight">{title}</h1>
            <p className="font-mono text-[13px] text-text-muted">{tCommon('appName')}</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-4"
          data-testid={`${mode}-form`}
        >
          {mode === 'signup' && (
            <Field
              label={t('name')}
              isRequired
              error={touched.name && !isNameValid ? t('nameRequired') : null}
            >
              {(controlProps) => (
                <Input
                  {...controlProps}
                  name="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => setTouched((current) => ({ ...current, name: true }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && isNameValid) {
                      event.preventDefault();
                      emailRef.current?.focus();
                    }
                  }}
                  autoFocus
                  data-testid="auth-name"
                />
              )}
            </Field>
          )}

          {/* Unrevealed fields stay in the DOM (collapsed + inert) so password
              managers can fill email and password together. */}
          <Reveal isRevealed={isEmailRevealed}>
            <Field
              label={t('email')}
              isRequired
              error={touched.email && !isEmailValid ? t('invalidEmail') : null}
            >
              {(controlProps) => (
                <Input
                  {...controlProps}
                  ref={emailRef}
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete={mode === 'login' ? 'username' : 'email'}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onBlur={() => setTouched((current) => ({ ...current, email: true }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && isEmailValid && !isPasswordValid) {
                      event.preventDefault();
                      passwordRef.current?.focus();
                    }
                  }}
                  autoFocus={mode === 'login'}
                  data-testid="auth-email"
                />
              )}
            </Field>
          </Reveal>

          <Reveal isRevealed={isPasswordRevealed}>
            <Field
              label={t('password')}
              isRequired
              error={
                submitError ?? (touched.password && !isPasswordValid ? t('passwordTooShort') : null)
              }
            >
              {(controlProps) => (
                <Input
                  {...controlProps}
                  ref={passwordRef}
                  name="password"
                  type={isPasswordVisible ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  minLength={PASSWORD_MIN_LENGTH}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setSubmitError(null);
                  }}
                  onBlur={() => setTouched((current) => ({ ...current, password: true }))}
                  data-testid="auth-password"
                  suffix={
                    <IconButton
                      icon={isPasswordVisible ? <EyeOff /> : <Eye />}
                      label={isPasswordVisible ? t('hidePassword') : t('showPassword')}
                      onClick={() => setIsPasswordVisible((value) => !value)}
                      className="-mr-2 size-9"
                      tabIndex={-1}
                    />
                  }
                />
              )}
            </Field>
          </Reveal>

          <Button
            type="submit"
            size="lg"
            isPending={isSubmitting}
            className="mt-2"
            data-testid="auth-submit"
          >
            {isPasswordRevealed ? submitLabel : t('continue')}
          </Button>
        </form>

        <p className="text-center font-sans text-[14px] text-text-muted">{footer}</p>
      </div>
    </main>
  );
}

/**
 * Collapses a field until it is revealed. The field stays mounted — only
 * its height and opacity animate — and `inert` keeps it out of the tab order
 * and the accessibility tree while hidden.
 */
function Reveal({ isRevealed, children }: { isRevealed: boolean; children: ReactNode }) {
  const { isReduced, spring, fade } = useAppMotion();
  return (
    <motion.div
      initial={false}
      animate={isRevealed ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
      transition={isReduced ? fade : spring}
      inert={!isRevealed}
      className="overflow-hidden"
    >
      <div className="pb-0.5">{children}</div>
    </motion.div>
  );
}
