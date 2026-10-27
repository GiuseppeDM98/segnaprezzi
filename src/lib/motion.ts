'use client';

/**
 * The motion system: every spring, duration and easing the app uses, plus the
 * one hook that answers reduced motion.
 *
 * Design: components import these and never declare ad-hoc spring values —
 * the whole app moves with the same physics, which is what makes motion read
 * as one authored gesture instead of scattered effects. Reduced motion is
 * answered in exactly one place (useAppMotion) so no component re-derives
 * the policy.
 */
import { useReducedMotion } from 'motion/react';

/** House physics: stiffness 400, damping 35 (DESIGN.md, Motion). */
export const houseSpring = { type: 'spring', stiffness: 400, damping: 35 } as const;

/** The opacity tween: 150 ms, ease-out. Every fade in the app uses it. */
export const quickFade = { duration: 0.15, ease: 'easeOut' } as const;

/** Stagger between review cards entering (DESIGN.md, Motion inventory). */
export const CARD_STAGGER_SECONDS = 0.03;

/**
 * The area chart's draw-in, played once on mount (DESIGN.md, Motion
 * inventory: chart draw-in). Seconds throughout.
 *
 * The line is a timed tween on `pathLength`; the area keeps the house spring
 * and only waits `areaFadeDelay`, so it rises under a line that has already
 * started drawing instead of ahead of it. Under reduced motion the chart
 * skips both (useAppMotion().isReduced).
 */
export const chartDraw = {
  /** Delay before the area under the line fades up. */
  areaFadeDelay: 0.15,
  /** How long the line takes to draw from the first month to the last. */
  lineDrawDuration: 0.7,
  /** Cubic bézier for the line: fast start, long gentle landing. */
  lineDrawEase: [0.2, 0.8, 0.2, 1],
} as const;

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
 * changes that short are non-vestibular (DESIGN.md, Motion).
 */
export function useAppMotion(): AppMotion {
  const isReduced = useReducedMotion() ?? false;
  return {
    isReduced,
    spring: isReduced ? { duration: 0 } : houseSpring,
    fade: quickFade,
  };
}
