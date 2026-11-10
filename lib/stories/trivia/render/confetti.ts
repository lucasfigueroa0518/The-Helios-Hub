/**
 * AI Trivia's reveal confetti (AT-38): a short burst off the correct row, like Instagram's own quiz
 * sticker when it is answered right. Seeded (mulberry32 from pen.ts), so the same set always throws
 * the same pieces and every render repeats exactly.
 *
 * Each piece is drawn as two nested boxes so its flight needs only standard eases (M4) and every tween
 * starts on the sting's hit (AT-31):
 *   outer  .tv-cf     flung out: x and up with power3.out (air drag), spinning, scaled in from 0
 *   inner  .tv-cf-in  gravity: falls with power2.in, and fades out near the end (power4.in)
 * The sum of "up, slowing" and "down, speeding up" is the ballistic arc. All of it is over by
 * CONFETTI_MAX_S after the hit, well before the settled end (M5).
 */
import { rng } from './pen';

export const CONFETTI_COUNT = 40;
/** Seed used when a slide gives none (tests, previews). */
export const CONFETTI_SEED = 0x7a1c;
/** No piece flies longer than this (s). */
export const CONFETTI_MAX_S = 1.15;
/** Brand orange, white, and the green of a right answer; orange leads. */
export const CONFETTI_COLORS = [
  { color: '#FF5E1A', weight: 0.45 },
  { color: '#FFFFFF', weight: 0.3 },
  { color: '#138510', weight: 0.25 },
] as const;

export type ConfettiPiece = {
  /** Launch point across the row, % of its width (vertically centred). */
  left: number;
  w: number;
  h: number;
  /** A small disc instead of a strip. */
  round: boolean;
  color: string;
  /** Sideways throw (px, signed), upward throw (px, positive is up), gravity drop (px). */
  dx: number;
  up: number;
  fall: number;
  /** Starting angle and total spin (deg). Confetti spin is the one rotation on screen (AT-37 exempts it, AT-38 asks for it). */
  rot0: number;
  spin: number;
  /** Flight time (s). */
  dur: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The burst for `seed`: `count` pieces, the same every time. */
export function confettiPieces(seed: number = CONFETTI_SEED, count: number = CONFETTI_COUNT): ConfettiPiece[] {
  const rand = rng(seed ^ 0x5bd1e995);
  const pick = (x: number) => {
    let acc = 0;
    for (const c of CONFETTI_COLORS) if ((acc += c.weight) >= x) return c.color;
    return CONFETTI_COLORS[0].color;
  };
  return Array.from({ length: count }, (_, i) => {
    // Spread the launch points evenly across the row, jittered, so the burst reads as "off the row".
    const left = 6 + ((i + rand()) / count) * 88;
    const side = (left - 50) / 44; // -1 at the left end, +1 at the right
    const round = rand() < 0.25;
    const w = round ? 13 + rand() * 4 : 11 + rand() * 6;
    const h = round ? w : 20 + rand() * 12;
    const dx = side * (90 + rand() * 280) + (rand() - 0.5) * 160;
    return {
      left: r1(left), w: r1(w), h: r1(h), round, color: pick(rand()),
      dx: r1(dx), up: r1(170 + rand() * 300), fall: r1(320 + rand() * 300),
      rot0: r1(rand() * 360), spin: r1((rand() < 0.5 ? -1 : 1) * (260 + rand() * 460)),
      dur: r2(0.95 + rand() * (CONFETTI_MAX_S - 0.95)),
    };
  });
}
