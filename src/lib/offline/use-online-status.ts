'use client';

/**
 * Connectivity as React state (Spec 06 §6.1).
 *
 * SSR-safe by construction: the server has no navigator, and rendering
 * "offline" on the server would make every first paint flash the banner, so
 * the hook starts optimistic and corrects itself on mount.
 */
import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    function handleOnline(): void {
      setIsOnline(true);
    }
    function handleOffline(): void {
      setIsOnline(false);
    }

    setIsOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
