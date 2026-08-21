'use client';

/**
 * The app shell: safe-area padding, tab bar / desktop rail,
 * offline banner, toast outlet, and the scroll-direction policy behind
 * hide-on-scroll. Every route in the (app) group renders inside it; /scan is
 * immersive and gets neither bar nor rail.
 */
import { motion } from 'motion/react';
import { type ReactNode, useEffect, useState } from 'react';

import { SwUpdateToast } from '@/components/pwa/sw-update-toast';
import { TabBar } from '@/components/ui/tab-bar';
import { ToastOutlet, ToastProvider } from '@/components/ui/toast';
import { cx } from '@/lib/cx';
import { usePathname } from '@/lib/i18n/navigation';
import { useAppMotion } from '@/lib/motion';
import { NavRail } from './nav-rail';
import { OfflineBanner } from './offline-banner';

/** Screens whose long lists may hide the tab bar while scrolling down. */
const HIDE_ON_SCROLL_PREFIXES = ['/products', '/history'];
/** Scroll travel (px) before the direction counts — filters rubber-banding. */
const SCROLL_THRESHOLD_PX = 12;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isImmersive = pathname === '/scan';
  const canHideBar = HIDE_ON_SCROLL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isBarHidden = useScrollDirectionHidden(canHideBar);
  const { fade } = useAppMotion();

  return (
    <ToastProvider>
      <div className={cx('flex min-h-dvh', !isImmersive && 'rail:gap-0')}>
        {!isImmersive && <NavRail />}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Tab cross-fade: 150 ms opacity, keyed by route, no slide. */}
          <motion.main
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={fade}
            className={cx(
              'flex min-w-0 flex-1 flex-col',
              !isImmersive && 'pb-[calc(3.5rem+env(safe-area-inset-bottom,0px)+1rem)] rail:pb-8',
            )}
          >
            {children}
          </motion.main>
        </div>
      </div>
      {!isImmersive && <TabBar isHidden={isBarHidden} />}
      <OfflineBanner />
      <SwUpdateToast />
      <ToastOutlet className="bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] rail:bottom-6" />
    </ToastProvider>
  );
}

/**
 * True while the user scrolls down past the threshold on a screen that may
 * hide its bar; flips back on the first upward scroll or near the top.
 */
function useScrollDirectionHidden(isEnabled: boolean): boolean {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    if (!isEnabled) {
      setIsHidden(false);
      return;
    }
    let lastY = window.scrollY;
    let frame = 0;

    function handleScroll(): void {
      if (frame) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - lastY;
        if (y < 64) {
          setIsHidden(false);
        } else if (delta > SCROLL_THRESHOLD_PX) {
          setIsHidden(true);
        } else if (delta < -SCROLL_THRESHOLD_PX) {
          setIsHidden(false);
        }
        if (Math.abs(delta) > SCROLL_THRESHOLD_PX) {
          lastY = y;
        }
      });
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(frame);
    };
  }, [isEnabled]);

  return isHidden;
}
