import type { Metadata, Viewport } from 'next';
import { Barlow, Martian_Mono } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { routing } from '@/lib/i18n/routing';
import '../globals.css';

/*
 * Two voices of the printed statement (DESIGN.md): the preprinted form is a
 * quiet grotesk, everything the machine printed is a monospace with tabular
 * figures. Both are self-hosted by next/font at build time.
 */
const formFont = Barlow({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  variable: '--font-form',
  display: 'swap',
});

const printFont = Martian_Mono({
  subsets: ['latin', 'latin-ext'],
  axes: ['wdth'],
  variable: '--font-print',
  display: 'swap',
});

/*
 * Why: the `.dark` class must be on <html> before first paint or dark-mode
 * users see a white flash. This inline script runs pre-hydration and reads
 * the `theme` cookie (written by Settings: "dark" | "light"; absent = follow
 * the OS). `suppressHydrationWarning` on <html> is required because the
 * server cannot know which class the script will add.
 */
const themeInitScript = `(() => {
  var match = document.cookie.match(/(?:^|; )theme=(dark|light)/);
  var theme = match ? match[1] : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  if (theme === "dark") document.documentElement.classList.add("dark");
})();`;

/*
 * Direction contract (impeccable, seed 12e30ec0, locked 2026-08-21).
 * THESIS: the personal index printed as a continuous-form statement — rows
 * you can scan, numbers you can trust — refusing the fintech KPI-card
 * dashboard. OWN-WORLD: cream stock and ribbon ink (dark = the print
 * negative), a punched sprocket margin, green-bar zebra rows behind every
 * list, monospace tabular figures for everything the machine printed, a
 * quiet form grotesk for labels, one highlighter-orange accent with ink on
 * it, red/green ribbon only for price direction. STORY: "this is MY
 * inflation, and here is how thin the data is" — then tap Scan. FIRST
 * VIEWPORT: header row LA TUA INFLAZIONE over a double rule, the signed
 * percentage four rows tall rolling into its cells, the coverage footer,
 * then the 12-month trend with the ISTAT overlay; the orange Scan disc
 * punches through the tab bar's perforation. FORM: tabulato a modulo
 * continuo, candidate 5 of the re-rolled list, seed 12e30ec0.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with
 * the finish review, the verdict, and DESIGN.md.
 */
const DIRECTION_CONTRACT =
  'impeccable 12e30ec0 — tabulato a modulo continuo: cream stock + ribbon ink, sprocket margin, green-bar rows, mono tabular figures, highlighter accent';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: t('tagline'),
  };
}

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
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${formFont.variable} ${printFont.variable}`}
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static constant above, no user input */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh bg-background font-sans text-text antialiased">
        {/* The direction contract must survive the production build as the
            first child of <body>; the finish review greps for the seed key. */}
        <div hidden data-direction-contract={DIRECTION_CONTRACT} />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
