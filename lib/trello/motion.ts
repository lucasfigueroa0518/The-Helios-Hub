import type { Transition } from "framer-motion";

// The Helios ease. cubic-bezier(0.16, 1, 0.3, 1) — exponential deceleration,
// the DS's canonical --ease-out. Objects land, they don't drift.
export const heliosEase = [0.16, 1, 0.3, 1] as const;

// Entrance pattern from the DS: opacity 0→1 + y 20→0, 600ms ease-out,
// stagger `i * 0.1s`. Spread onto a motion element with the row index.
export function heliosEnter(i: number) {
  return {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.6,
      ease: heliosEase,
      delay: i * 0.1,
    } satisfies Transition,
  };
}
