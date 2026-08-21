'use client';

/**
 * Desktop left rail (Spec 05 §4, ≥ 1024 px): the same five destinations,
 * vertical, the logo mark on top, Scan as a prominent accent button. Drawn
 * as the sprocket margin of the sheet — the perforated strip the paper feeds
 * through — so the chrome is part of the print, not a panel beside it.
 */
import { History, House, Settings2, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fab } from '@/components/ui/fab';
import { LogoMark } from '@/components/ui/logo-mark';
import { cx } from '@/lib/cx';
import { Link, usePathname } from '@/lib/i18n/navigation';

export function NavRail() {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const pathname = usePathname();

  const items = [
    { href: '/', label: t('home'), icon: House, isActive: pathname === '/' },
    {
      href: '/products',
      label: t('products'),
      icon: Tag,
      isActive: pathname.startsWith('/products'),
    },
    {
      href: '/history',
      label: t('history'),
      icon: History,
      isActive: pathname.startsWith('/history'),
    },
    {
      href: '/settings',
      label: t('settings'),
      icon: Settings2,
      isActive: pathname.startsWith('/settings') || pathname.startsWith('/stores'),
    },
  ] as const;

  return (
    <nav
      aria-label={t('main')}
      className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-8 border-border border-r border-dashed bg-surface py-8 pr-5 pl-10 rail:flex"
    >
      {/* The punched feed strip of the continuous form runs down the rail. */}
      <span aria-hidden="true" className="sprocket-margin absolute inset-y-0 left-0 w-5" />
      <Link href="/" className="flex items-center gap-3 px-1">
        <LogoMark size={36} />
        <span className="font-mono font-semibold text-base text-text tracking-tight">
          {tCommon('appName')}
        </span>
      </Link>

      <Fab variant="rail" label={t('scan')} />

      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.isActive ? 'page' : undefined}
              className={cx(
                'flex h-11 items-center gap-3 rounded-control px-3 font-sans font-medium text-[15px] transition-colors',
                item.isActive
                  ? 'bg-accent-soft text-text'
                  : 'text-text-muted hover:bg-band hover:text-text',
              )}
            >
              <item.icon
                aria-hidden="true"
                className="size-5"
                strokeWidth={item.isActive ? 2.25 : 1.75}
              />
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
