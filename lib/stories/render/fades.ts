/**
 * Bleed fades (S-44: every photo is a bleed fade, never a card). One source
 * for the CSS mask a template draws and the opacity the renderer's
 * text-on-photo check reads back (`data-fade` on the photo element).
 *
 *   top      the photo hangs from the frame's top edge and fades down into
 *            the backdrop: a long, cinematic fade on black; a later-starting
 *            one on white, orange and green, where a long fade tints the photo (S-41).
 *   window   the photo fades in and out at both ends, between two text blocks.
 */
import type { Backdrop } from './types';

/** [position 0–1 down the photo, opacity 0–1], in order. */
export type FadeStops = Array<[number, number]>;

export function fadeStops(mode: 'top' | 'window', backdrop: Backdrop): FadeStops {
  if (mode === 'window') return [[0, 0], [0.36, 1], [0.7, 1], [1, 0]];
  return backdrop === 'black'
    ? [[0, 1], [0.52, 1], [0.74, 0.55], [0.98, 0]]
    : [[0, 1], [0.62, 1], [0.82, 0.55], [0.99, 0]];
}

export function fadeMask(stops: FadeStops): string {
  return `linear-gradient(180deg, ${stops.map(([t, a]) => `rgba(0, 0, 0, ${a}) ${Math.round(t * 1000) / 10}%`).join(', ')})`;
}

/** Opacity at position t (0–1); self-contained so the renderer can pass it into the page. */
export function fadeAlpha(stops: Array<[number, number]>, t: number): number {
  if (t <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, a1] = stops[i]!;
    const [t0, a0] = stops[i - 1]!;
    if (t <= t1) return a0 + ((t - t0) / (t1 - t0 || 1)) * (a1 - a0);
  }
  return stops[stops.length - 1]![1];
}
