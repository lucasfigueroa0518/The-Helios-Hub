/**
 * The look bank (AE-13/14): four visual looks for the carousel, drawn at random, never one the last
 * LOOK_HISTORY posts used. Each look has a cover, city and CTA layout (layoutVariant
 * `ae_{look}_{cover|city|cta}`, lib/social/render/ai-events). The draw is stored on the post and kept on a rebuild.
 *
 *   spotlight  the lit stage: a beam from above, the mark in its light, glow cards
 *   glass      Obsidian glass: the mark large and low with a strong halo, frosted panes beside it
 *   daylight   editorial white (the logged exception, AE-14), dark city tiles, an orange glowing CTA
 *   orb        title-slide energy: a massive headline, the mark large on the right, a meta row
 */
import type { AeLook } from '@/lib/social/render/types';

export type Look = AeLook;

export const LOOKS = Object.freeze(['spotlight', 'glass', 'daylight', 'orb'] as const satisfies readonly AeLook[]);

/** How many of the latest posts' looks the next post may not repeat (AE-13). */
export const LOOK_HISTORY = 2;

export const LOOK_NAMES: Record<Look, string> = { spotlight: 'Spotlight', glass: 'Obsidian glass', daylight: 'Daylight', orb: 'The orb' };

export const isLook = (look: unknown): look is Look => typeof look === 'string' && (LOOKS as readonly string[]).includes(look);

/**
 * The next post's look: a random one that neither of the last LOOK_HISTORY posts used (newest
 * first). If every look was used that recently, the one used longest ago (or never).
 */
export function pickLook(recent: readonly string[] | null | undefined, { rand = Math.random, history = LOOK_HISTORY }: { rand?: () => number; history?: number } = {}): Look {
  const seen = recent ?? [];
  const blocked = new Set(seen.slice(0, history));
  const free = LOOKS.filter((k) => !blocked.has(k));
  if (free.length) return free[Math.min(free.length - 1, Math.floor(rand() * free.length))]!;
  const lastUse = (k: Look) => (seen.includes(k) ? seen.indexOf(k) : Infinity);
  return LOOKS.reduce<Look>((best, k) => (lastUse(k) > lastUse(best) ? k : best), LOOKS[0]);
}
