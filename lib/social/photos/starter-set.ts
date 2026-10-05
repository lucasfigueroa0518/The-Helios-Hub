/**
 * The Helios starter set (spec §5.1a, order step 4): hand-picked generic
 * photos stored in the repo (public/social/stock), the last step of the
 * photo chain. Offline: no network, so no slide is ever empty even when
 * every online source fails (Tommy, 2026-10-05).
 *
 * Rules for an entry: a scene or object, never a person who could be
 * mistaken for anyone; licence allows reuse in a rendered PNG.
 *
 * Seeded from the 9 photos the old pipeline already shipped from
 * public/social/stock (old-tag photoManifest.ts, licence "Unsplash"; the
 * photographer names weren't recorded there). Must hold at least
 * MAX_PHOTOS_PER_POST entries, so the no-repeat rule can always be met.
 */
import type { Photo } from './find';

/** Cover + up to 8 story slides (spec: 5–8 story slides). */
export const MAX_PHOTOS_PER_POST = 9;

export type StarterPhoto = { file: string; shows: string; width: number; height: number; credit: string };

export const STARTER_SET: StarterPhoto[] = [
  { file: 'server-racks.jpg', shows: 'server racks in a dark data center, green LEDs', width: 1600, height: 898, credit: 'Unsplash' },
  { file: 'circuit-macro.jpg', shows: 'macro of a dark circuit board with a central chip', width: 1600, height: 1067, credit: 'Unsplash' },
  { file: 'newspapers-stack.jpg', shows: 'stack of folded newspapers', width: 1600, height: 1067, credit: 'Unsplash' },
  { file: 'dashboard.jpg', shows: 'analytics dashboard with line charts on a screen', width: 1600, height: 1152, credit: 'Unsplash' },
  { file: 'earth-from-space.jpg', shows: 'Earth at night from orbit, city lights', width: 1600, height: 1065, credit: 'Unsplash' },
  { file: 'macbook-glow.jpg', shows: 'laptop open at night, screen glowing', width: 1600, height: 1133, credit: 'Unsplash' },
  { file: 'circuit-schematic.jpg', shows: 'glowing green circuit schematic', width: 1600, height: 1068, credit: 'Unsplash' },
  { file: 'typewriter-ml.jpg', shows: 'typewriter with paper reading "MACHINE LEARNING"', width: 1600, height: 1067, credit: 'Unsplash' },
  { file: 'dell-keyboard.jpg', shows: 'hands typing on a laptop keyboard, no faces', width: 1600, height: 1067, credit: 'Unsplash' },
];

export const starterUrl = (file: string) => `/social/stock/${file}`;

/** The first starter photo not yet used in this post. */
export function pickStarter(used: Set<string>): Photo | null {
  const s = STARTER_SET.find((p) => !used.has(starterUrl(p.file)));
  return s ? { url: starterUrl(s.file), credit: s.credit, source: 'starter', width: s.width, height: s.height, qid: null } : null;
}
