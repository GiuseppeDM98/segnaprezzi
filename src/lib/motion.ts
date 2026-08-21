'use client';

/**
 * The motion system (Spec 05 §7): one spring, one fade, one hook.
 *
 * Design: components import these and never declare ad-hoc spring values —
 * the whole app moves with the same physics, which is what makes motion read
 * as one authored gesture instead of scattered effects. Reduced motion is
 * answered in exactly one place (useAppMotion) so no component re-derives
 * the policy.
 */
import { useReducedMotion } from 'motion/react';

/** House physics: stiffness 400, damping 35 (docs/DEVELOPMENT_GUIDELINES.md). */
export const houseSpring = { type: 'spring', stiffness: 400, damping: 35 } as const;

/** The only non-spring transition: a 150 ms opacity tween. */
export const quickFade = { duration: 0.15, ease: 'easeOut' } as const;

/** Stagger between review cards entering (§7 motion inventory). */
export const CARD_STAGGER_SECONDS = 0.03;

export interface AppMotion {
  /** True when the OS asks for reduced motion: every non-essential animation is off. */
  isReduced: boolean;
  /** The transition to use for movement: the house spring, or an instant cut. */
  spring: typeof houseSpring | { duration: 0 };
  /** The transition to use for opacity-only changes, always allowed (≤ 150 ms). */
  fade: typeof quickFade;
}

/**
 * The single place components ask about motion. Under reduced motion the
 * spring becomes an instant cut while 150 ms fades stay — opacity-only
 * changes that short are non-vestibular (§7).
 */
export function useAppMotion(): AppMotion {
  const isReduced = useReducedMotion() ?? false;
  return {
    isReduced,
    spring: isReduced ? { duration: 0 } : houseSpring,
    fade: quickFade,
  };
}
