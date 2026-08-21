'use client';

/**
 * Service worker registration and the update handshake.
 *
 * Design: registration is manual (`register: false` in next.config.ts) so
 * the app owns when a new worker takes over. A worker that activated on its
 * own mid-session would swap the build's lazy chunks under a page that is
 * still asking for the old ones — hence the deliberate three-step handshake:
 * a waiting worker only becomes the controller after the user accepts, and
 * only then does the page reload, exactly once.
 *
 * The state lives at module scope rather than in React because two different
 * subtrees need it: the provider in the root layout starts it, the toast
 * inside the app shell renders it.
 */

/** Long-lived installed sessions still need to learn about new deploys. */
const UPDATE_POLL_MS = 60 * 60 * 1000;

let registration: ServiceWorkerRegistration | null = null;
let waitingWorker: ServiceWorker | null = null;
/** Set only by applyServiceWorkerUpdate — the guard against a surprise reload. */
let hasAcceptedUpdate = false;
let hasReloaded = false;
/** Dismissal is per app start: the toast returns on the next one, not sooner. */
let isDismissed = false;

const subscribers = new Set<() => void>();

function notify(): void {
  for (const subscriber of subscribers) {
    subscriber();
  }
}

function setWaitingWorker(worker: ServiceWorker): void {
  waitingWorker = worker;
  notify();
}

/**
 * Register `/sw.js` and watch for an update.
 *
 * @returns Disposer that detaches every listener and timer.
 */
export function startServiceWorker(): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  async function register(): Promise<void> {
    try {
      const swRegistration = await navigator.serviceWorker.register('/sw.js');
      registration = swRegistration;

      // Installed on a previous visit and parked ever since.
      if (swRegistration.waiting) {
        setWaitingWorker(swRegistration.waiting);
      }

      swRegistration.addEventListener('updatefound', () => {
        const installing = swRegistration.installing;
        if (!installing) {
          return;
        }
        installing.addEventListener('statechange', () => {
          // A controller already present means this is an update, not the
          // first install — only then is there something to announce.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaitingWorker(installing);
          }
        });
      });
    } catch (error) {
      // An unsupported or insecure context is not an app failure: the site
      // simply runs without offline support.
      console.warn('Service worker registration failed', error);
    }
  }

  function handleLoad(): void {
    void register();
  }

  function handleControllerChange(): void {
    if (!hasAcceptedUpdate || hasReloaded) {
      return;
    }
    hasReloaded = true;
    window.location.reload();
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      void registration?.update().catch(() => {
        // Offline, or the server is down — the next check will do.
      });
    }
  }

  // Registering competes with the page's own first paint for bandwidth, so
  // it waits for `load` — unless the document is already there.
  if (document.readyState === 'complete') {
    void register();
  } else {
    window.addEventListener('load', handleLoad);
  }
  navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  const pollTimer = window.setInterval(() => {
    void registration?.update().catch(() => {});
  }, UPDATE_POLL_MS);

  return () => {
    window.removeEventListener('load', handleLoad);
    navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.clearInterval(pollTimer);
  };
}

export function subscribeToSwUpdate(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => subscribers.delete(onChange);
}

/** True while a new worker is installed, waiting, and not yet declined. */
export function hasWaitingUpdate(): boolean {
  return waitingWorker !== null && !isDismissed;
}

/** Accept the update: the worker skips waiting, then controllerchange reloads. */
export function applyServiceWorkerUpdate(): void {
  if (!waitingWorker) {
    return;
  }
  hasAcceptedUpdate = true;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

/** Decline for now: the worker stays parked and the toast stops asking. */
export function dismissServiceWorkerUpdate(): void {
  isDismissed = true;
  notify();
}
