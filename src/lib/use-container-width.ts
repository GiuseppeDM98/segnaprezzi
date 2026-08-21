'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * Measure an element's content width with a ResizeObserver. Charts render
 * at the real pixel width so their text never stretches; `fallback` is the
 * server-rendered width (mobile-first: a 390 px screen minus padding).
 */
export function useContainerWidth<T extends HTMLElement>(
  fallback = 358,
): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) {
        setWidth(Math.round(next));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
