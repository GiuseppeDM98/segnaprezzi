'use client';

/**
 * Service worker registration and update checks.
 *
 * Design: registration is manual (`register: false` in next.config.ts) so it
 * waits for `load` instead of competing with the first paint, and so the app
 * owns how often a new deploy is looked for. What happens once a new worker
 * is found is left to the browser: with `skipWaiting: false` in sw.ts it
 * installs, parks, and takes over the next time the app opens with no page
 * of the old worker left. Nobody is asked — the update toast that used to
 * announce the waiting worker was retired on 2026-11-06 as noise. The cost
 * is that an installed app kept alive in the background for days runs the
 * old build for as long; the pages themselves are NetworkFirst, so what the
 * user reads is fresh either way.
 */

/** Long-lived installed sessions still need to learn about new deploys. */
const UPDATE_POLL_MS = 60 * 60 * 1000;

/**
 * Register `/sw.js`, then check for a new deploy whenever the app comes back
 * into view and once an hour.
 *
 * @returns Disposer that detaches every listener and timer.
 */
export function startServiceWorker(): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  let registration: ServiceWorkerRegistration | null = null;

  async function register(): Promise<void> {
    try {
      registration = await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
      // An unsupported or insecure context is not an app failure: the site
      // simply runs without offline support.
      console.warn('Service worker registration failed', error);
    }
  }

  function handleLoad(): void {
    void register();
  }

  function checkForUpdate(): void {
    // Offline, or the server is down — the next check will do.
    void registration?.update().catch(() => {});
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      checkForUpdate();
    }
  }

  // Registering competes with the page's own first paint for bandwidth, so
  // it waits for `load` — unless the document is already there.
  if (document.readyState === 'complete') {
    void register();
  } else {
    window.addEventListener('load', handleLoad);
  }
  document.addEventListener('visibilitychange', handleVisibilityChange);
  const pollTimer = window.setInterval(checkForUpdate, UPDATE_POLL_MS);

  return () => {
    window.removeEventListener('load', handleLoad);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.clearInterval(pollTimer);
  };
}
