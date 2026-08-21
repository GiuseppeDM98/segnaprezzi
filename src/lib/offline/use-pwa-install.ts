'use client';

/**
 * Install state and the nag budget around it (Spec 06 §7).
 *
 * Design: `beforeinstallprompt` fires once, early, and is lost unless
 * something calls preventDefault() on it at that exact moment — long before
 * any install UI is mounted. The capture therefore lives at module scope,
 * started by the PWA provider on mount, and components subscribe to the
 * stashed event instead of listening for it themselves.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** Chromium's install prompt event; absent from TypeScript's DOM lib. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Epoch ms of the last contextual sheet shown, and how many were ever shown. */
const LAST_PROMPT_KEY = 'segnaprezzi.install.lastPromptAt';
const PROMPT_COUNT_KEY = 'segnaprezzi.install.promptCount';
/** Set the first time a spesa is confirmed, so "first ever" is knowable. */
const COMPLETED_SESSION_KEY = 'segnaprezzi.install.hasCompletedSession';

const PROMPT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LIFETIME_PROMPTS = 2;

let stashedPrompt: BeforeInstallPromptEvent | null = null;
const installSubscribers = new Set<() => void>();
const sessionSubscribers = new Set<() => void>();

function notifyInstallSubscribers(): void {
  for (const notify of installSubscribers) {
    notify();
  }
}

/**
 * Begin stashing `beforeinstallprompt`. Mounted once by the PWA provider.
 *
 * @returns Disposer that detaches the listeners.
 */
export function startInstallPromptCapture(): () => void {
  function handleBeforeInstallPrompt(event: Event): void {
    // Without preventDefault() Chromium shows its own mini-infobar, which we
    // replace with the contextual sheet of §7.2.
    event.preventDefault();
    stashedPrompt = event as BeforeInstallPromptEvent;
    notifyInstallSubscribers();
  }

  function handleAppInstalled(): void {
    stashedPrompt = null;
    notifyInstallSubscribers();
  }

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.addEventListener('appinstalled', handleAppInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.removeEventListener('appinstalled', handleAppInstalled);
  };
}

export interface PwaInstallState {
  /** True when a stashed beforeinstallprompt event can be replayed. */
  canInstall: boolean;
  /** True when running installed (display-mode: standalone or iOS standalone). */
  isStandalone: boolean;
  /** True on iPhone/iPad Safari, where no install prompt API exists. */
  isIos: boolean;
  /** Replay the stashed prompt; resolves with the user's choice. */
  promptInstall(): Promise<'accepted' | 'dismissed'>;
}

export function usePwaInstall(): PwaInstallState {
  const canInstall = useSyncExternalStore(subscribeToInstallPrompt, hasStashedPrompt, () => false);
  // Platform detection reads navigator, so it can only run after mount —
  // deriving it during render would mismatch the server markup.
  const [platform, setPlatform] = useState({ isIos: false, isStandalone: false });

  useEffect(() => {
    setPlatform({ isIos: detectIos(), isStandalone: detectStandalone() });
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed'> => {
    const prompt = stashedPrompt;
    if (!prompt) {
      return 'dismissed';
    }
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    // The event is single-use: Chromium refuses a second prompt() on it.
    stashedPrompt = null;
    notifyInstallSubscribers();
    return outcome;
  }, []);

  return { canInstall, isStandalone: platform.isStandalone, isIos: platform.isIos, promptInstall };
}

function subscribeToInstallPrompt(onChange: () => void): () => void {
  installSubscribers.add(onChange);
  return () => installSubscribers.delete(onChange);
}

function hasStashedPrompt(): boolean {
  return stashedPrompt !== null;
}

function detectIos(): boolean {
  // iPadOS 13+ reports itself as macOS; the touch-point count is what still
  // separates an iPad from a Mac.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function detectStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Record that a spesa was confirmed and wake the contextual install sheet.
 *
 * Called from the review screen's confirm success: right after the first
 * completed session the user has felt the core value, which is the one
 * moment where an install pitch is honest rather than an interruption.
 */
export function notifySessionCompleted(): void {
  writeStorage(COMPLETED_SESSION_KEY, '1');
  for (const notify of sessionSubscribers) {
    notify();
  }
}

/** Subscribe to session completions — the contextual sheet's only trigger. */
export function subscribeToSessionCompleted(onCompleted: () => void): () => void {
  sessionSubscribers.add(onCompleted);
  return () => sessionSubscribers.delete(onCompleted);
}

/**
 * Whether the contextual sheet may be shown right now: at most
 * MAX_LIFETIME_PROMPTS ever, and never within 30 days of the last one.
 */
export function canShowInstallSheet(now: number = Date.now()): boolean {
  const count = Number(readStorage(PROMPT_COUNT_KEY) ?? '0');
  if (count >= MAX_LIFETIME_PROMPTS) {
    return false;
  }
  const lastPromptAt = Number(readStorage(LAST_PROMPT_KEY) ?? '0');
  return now - lastPromptAt >= PROMPT_COOLDOWN_MS;
}

/** Spend one of the two lifetime prompts and restart the 30-day cooldown. */
export function recordInstallSheetShown(now: number = Date.now()): void {
  const count = Number(readStorage(PROMPT_COUNT_KEY) ?? '0');
  writeStorage(PROMPT_COUNT_KEY, String(count + 1));
  writeStorage(LAST_PROMPT_KEY, String(now));
}

// localStorage throws in Safari private mode rather than returning null, and
// an install nag is never worth a crashed screen.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the cap degrades to "prompt again next time".
  }
}
