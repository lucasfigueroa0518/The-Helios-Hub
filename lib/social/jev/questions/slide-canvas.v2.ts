/**
 * Slide canvas v2 (Lucas, 2026-10-12): which of the four Helios canvases
 * (black, green, orange, white; preview.css data-canvas) a slide is drawn
 * on. Asked per slide, right after its layout variant (render/layout.ts).
 *
 * v1 told Jev a colour only reads as emphasis when it is rare and to keep
 * most slides black. Live posts since 2026-10-08 came out ~73% black on
 * scored slides (74 black, 20 white, 4 orange, 3 green). v2 treats the
 * four as a palette to rotate through: prefer unused and least-used
 * colours so white, green and orange show up as often as black.
 *
 * Code (render/layout.ts) keeps the follow slide black, gives a spread's
 * second slide its first slide's canvas, drops the previous slide's colour
 * from the options, and drops a colour that has pulled more than one
 * ahead of the least-used option still in play.
 *
 * Jev reads text only: the slide's copy, its layout and photo kind, and
 * the canvases chosen so far.
 */
import { choice, type Questions } from '@typesafe-ai/sdk';

import { SLIDE_CANVASES, type SlideCanvas } from '@/lib/social/render/types';

export const VERSION = 'slide-canvas@2';
export const QUESTION_ID = 'canvas';

/** How far ahead of the least-used remaining colour a colour may sit before code drops it. */
export const MAX_LEAD = 1;

export type CanvasState = {
  slide: { position: number; content: string; headline: string; body: string; layout: string; photo: string };
  previous_canvas: SlideCanvas | null;
  canvases_so_far: SlideCanvas[];
  unused_canvases: SlideCanvas[];
  canvas_counts: Record<SlideCanvas, number>;
};

export const CANVAS_LOOKS: Record<SlideCanvas, string> = {
  black: 'Black: the dark Helios canvas. A full-bleed photo, dense copy, or a beat that should sit in the usual dark look.',
  green: 'Green: a turn, a catch, a pushback, a consequence, or any beat that should carry Helios green — not only a "but".',
  orange: 'Orange: a number, a name, a reveal, a claim that should hit, or any beat that should carry Helios orange.',
  white: 'White: a voice, a quote, a clean statement, a landing, or an ordinary slide that should breathe.',
};

export function countsOf(canvases: readonly SlideCanvas[]): Record<SlideCanvas, number> {
  const counts = { black: 0, green: 0, orange: 0, white: 0 };
  for (const c of canvases) counts[c] += 1;
  return counts;
}

export function unusedOf(canvases: readonly SlideCanvas[]): SlideCanvas[] {
  const counts = countsOf(canvases);
  return SLIDE_CANVASES.filter((c) => counts[c] === 0);
}

/**
 * Colours Jev may pick for this slide: not the previous slide's, and not a
 * colour that has pulled more than `MAX_LEAD` ahead of the least-used
 * option still in play. Always at least two options when three or more
 * colours exist.
 */
export function optionsFor(previous: SlideCanvas | null, canvases: readonly SlideCanvas[]): SlideCanvas[] {
  const counts = countsOf(canvases);
  const open = SLIDE_CANVASES.filter((c) => c !== previous);
  const min = Math.min(...open.map((c) => counts[c]));
  const tight = open.filter((c) => counts[c] <= min + MAX_LEAD);
  if (tight.length >= 2) return [...tight];
  if (tight.length === 1) {
    const next = open.filter((c) => c !== tight[0]).sort((a, b) => counts[a] - counts[b] || SLIDE_CANVASES.indexOf(a) - SLIDE_CANVASES.indexOf(b))[0];
    return next ? [tight[0]!, next] : [...tight];
  }
  return [...open];
}

/** The least-used colour still in play (stable Helios order on a tie). */
export function leastUsed(canvases: readonly SlideCanvas[], exclude: SlideCanvas | null): SlideCanvas {
  const counts = countsOf(canvases);
  const options = optionsFor(exclude, canvases);
  return [...options].sort((a, b) => counts[a] - counts[b] || SLIDE_CANVASES.indexOf(a) - SLIDE_CANVASES.indexOf(b))[0] ?? 'black';
}

export function buildState(
  slide: CanvasState['slide'],
  previous: SlideCanvas | null,
  canvases: readonly SlideCanvas[],
): CanvasState {
  return {
    slide,
    previous_canvas: previous,
    canvases_so_far: [...canvases],
    unused_canvases: unusedOf(canvases),
    canvas_counts: countsOf(canvases),
  };
}

export function buildQuestions(available: readonly SlideCanvas[] = SLIDE_CANVASES): Questions {
  const looks = Object.fromEntries(available.map((c) => [c, CANVAS_LOOKS[c]]));
  return {
    [QUESTION_ID]: choice(
      'Which canvas should `slide` be drawn on? Use the four canvases evenly across the post: prefer a colour in `unused_canvases`, then the lowest count in `canvas_counts`. Black is one colour among four, not the default. Never pick `previous_canvas`.',
      looks,
    ),
  };
}
