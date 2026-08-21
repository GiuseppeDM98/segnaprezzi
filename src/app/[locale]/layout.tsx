import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { routing } from '@/lib/i18n/routing';
import '../globals.css';

// Brand name, never translated — not a UI string.
export const metadata = { title: 'segnaprezzi' };

/*
 * Why: the `.dark` class must be on <html> before first paint or dark-mode
 * users see a white flash. This inline script runs pre-hydration and reads
 * the `theme` cookie (written by Settings, Spec 05: "dark" | "light";
 * absent = follow the OS). `suppressHydrationWarning` on <html> is required
 * because the server cannot know which class the script will add.
 */
const themeInitScript = `(() => {
  var match = document.cookie.match(/(?:^|; )theme=(dark|light)/);
  var theme = match ? match[1] : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  if (theme === "dark") document.documentElement.classList.add("dark");
})();`;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static constant above, no user input */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-background text-text antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
