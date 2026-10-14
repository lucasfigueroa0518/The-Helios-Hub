'use client';

import { useLayoutEffect, useRef } from 'react';

import { money } from '@/components/social-hub/cost/format';

/**
 * Counts a dollar figure up from zero once, on mount. The server renders the final value,
 * so it reads right without JavaScript and with reduced motion (which skips the count).
 */
export function CountUp({ micros, ms = 1000 }: { micros: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || micros <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let t0: number | null = null;
    const step = (ts: number) => {
      t0 ??= ts;
      const p = Math.min(1, (ts - t0) / ms);
      el.textContent = money(Math.round(micros * (1 - Math.pow(1 - p, 3))), micros);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    el.textContent = money(0, micros);
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      el.textContent = money(micros);
    };
  }, [micros, ms]);
  return <span ref={ref}>{money(micros)}</span>;
}
