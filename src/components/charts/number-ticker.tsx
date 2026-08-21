'use client';

/**
 * Animated rolling number (Spec 05 §6.2, §7). Receives a PRE-FORMATTED
 * string; digits roll vertically into their fixed cells with the house
 * spring and a slight per-digit stagger, non-digit characters stay put.
 * Width-stable through tabular figures. Under reduced motion the final
 * value renders instantly.
 */
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { cx } from '@/lib/cx';
import { houseSpring, useAppMotion } from '@/lib/motion';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const STAGGER_SECONDS = 0.035;

export interface NumberTickerProps {
  value: string;
  ariaLive?: 'polite' | 'off';
  className?: string;
}

export function NumberTicker({ value, ariaLive = 'polite', className }: NumberTickerProps) {
  const { isReduced } = useAppMotion();
  // Digits start at 0 on the very first paint and roll to the real value —
  // the one "printing in" moment of the hero, mount only.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  const characters = Array.from(value);
  const isAnimated = !isReduced && hasMounted;

  return (
    <span className={cx('inline-flex tabular-nums', className)} aria-live={ariaLive}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="inline-flex">
        {characters.map((character, index) => {
          const key = `${index}-${character.length}`;
          if (!/\d/.test(character)) {
            return (
              <span key={key} className="inline-block">
                {character}
              </span>
            );
          }
          const digit = Number(character);
          return (
            <span
              key={key}
              className="relative inline-block h-[1em] w-[1ch] overflow-hidden align-baseline"
            >
              <motion.span
                className="absolute inset-x-0 top-0 flex flex-col items-center"
                initial={false}
                animate={{ y: `${isAnimated || isReduced ? -digit : 0}em` }}
                transition={
                  isReduced
                    ? { duration: 0 }
                    : { ...houseSpring, delay: (characters.length - index) * STAGGER_SECONDS }
                }
              >
                {DIGITS.map((d) => (
                  <span key={d} className="block h-[1em] leading-none">
                    {d}
                  </span>
                ))}
              </motion.span>
              {/* Invisible copy keeps the cell's own height and baseline. */}
              <span className="invisible block leading-none">{character}</span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
