/**
 * Slide canvas v1 (Lucas, 2026-10-08): which of the four Helios canvases
 * (black, green, orange, white; preview.css data-canvas) a slide is drawn
 * on. Asked per slide, right after its layout variant (render/layout.ts), the
 * same way Jev picks layouts. Code keeps the follow slide black, gives a
 * spread's second slide its first slide's canvas, and never lets one colour
 * sit on two neighbouring slides (a repeat becomes black, logged).
 *
 * Jev reads text only: the slide's copy, its layout and photo kind, and the
 * canvases chosen so far.
 */
import { choice, type Questions } from '@typesafe-ai/sdk';

import type { SlideCanvas } from '@/lib/social/render/types';

export const VERSION = 'slide-canvas@1';
export const QUESTION_ID = 'canvas';

export type CanvasState = {
  slide: { position: number; content: string; headline: string; body: string; layout: string; photo: string };
  previous_canvas: SlideCanvas | null;
  canvases_so_far: SlideCanvas[];
};

export const CANVAS_LOOKS: Record<SlideCanvas, string> = {
  black: 'Black, the house canvas: most slides, and slides where a full-bleed photo fills the frame.',
  green: 'Green: a beat that turns the story (a catch, a pushback, a "but").',
  orange: 'Orange: the loudest beat (the number that hits hardest, the reveal).',
  white: 'White: a clean, quiet break (a voice, a plain statement that should land on its own).',
};

export function buildQuestions(): Questions {
  return {
    [QUESTION_ID]: choice(
      'Which canvas should `slide` be drawn on? A colour marks a beat that should stand out, and it only reads as emphasis when it is rare: look at `canvases_so_far` and keep most slides black. Never pick the same colour as `previous_canvas`.',
      CANVAS_LOOKS,
    ),
  };
}
