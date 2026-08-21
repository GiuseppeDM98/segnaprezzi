'use client';

/**
 * Bottom navigation (Spec 05 §4): five fixed destinations with icons AND
 * labels, the Scan FAB raised through the bar's top edge. The top edge is a
 * tear-off perforation — the bar is the stub of the statement.
 *
 * Hide-on-scroll is driven by the shell (`isHidden`), never by the bar
 * itself, so the policy of which screens may hide it lives in one place.
 */
import { History, House, Settings2, Tag } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { cx } from '@/lib/cx';
import { Link, usePathname } from '@/lib/i18n/navigation';
import { useAppMotion } from '@/lib/motion';
import { Fab } from './fab';

export interface TabBarProps {
  isHidden?: boolean;
}

export function TabBar({ isHidden = false }: TabBarProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { isReduced, spring } = useAppMotion();

  const items = [
    { href: '/', label: t('home'), icon: House, isActive: pathname === '/' },
    {
      href: '/products',
      label: t('products'),
      icon: Tag,
      isActive: pathname.startsWith('/products'),
    },
    null,
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
    <motion.nav
      aria-label={t('main')}
      data-testid="tab-bar"
      animate={{ y: isHidden ? '110%' : 0 }}
      transition={isReduced ? { duration: 0 } : spring}
      className="fixed inset-x-0 bottom-0 z-30 border-border border-t border-dashed bg-surface pb-safe rail:hidden"
    >
      <ul className="grid h-14 grid-cols-5 items-stretch">
        {items.map((item, index) =>
          item === null ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: the center slot is structural, never reordered
            <li key={index} className="flex items-start justify-center">
              <Fab label={t('scan')} />
            </li>
          ) : (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={item.isActive ? 'page' : undefined}
                className={cx(
                  'flex flex-1 flex-col items-center justify-center gap-1 transition-colors',
                  item.isActive ? 'text-accent-ink' : 'text-text-muted hover:text-text',
                )}
              >
                <item.icon
                  aria-hidden="true"
                  className="size-[22px]"
                  strokeWidth={item.isActive ? 2.25 : 1.75}
                />
                <span className="font-sans font-medium text-[11px] leading-none">{item.label}</span>
              </Link>
            </li>
          ),
        )}
      </ul>
    </motion.nav>
  );
}
