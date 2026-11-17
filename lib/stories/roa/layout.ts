/**
 * Text never sits on the subject (RA-28, Lucas 2026-11-17: "Text can't be placed on top of the subject of the photo …
 * it should've been moved to negative space"). Code does the geometry; the screen only says where the subject is.
 *
 *   subject   Jev's subject box from the screen (questions.ts `subject_box`), else a box read from the pixels
 *             (`subjectFromPixels`: where the detail is), for rows screened before the box existed
 *   crop      the photo fills 1080×1920 (object-fit cover); its spare width centres the subject, its spare height goes
 *             where it leaves the largest empty band above or below the subject
 *   room      a candidate is pooled only when its reveal fits beside the subject: whole in one empty band, or split
 *             with the verdict above and the rest below (intake.ts). The question line is shorter than the verdict.
 *   place     the renderer moves each text stack into the empty band, splitting the reveal when it must
 *             (lib/stories/render/avoid.ts)
 */
import sharp from 'sharp';

import { FRAME_H, FRAME_W, SAFE_BOTTOM, SAFE_TOP } from '@/lib/stories/render/types';

import type { SubjectRect, TellBox } from './types';

/** The subject in frame pixels (after the crop). */
export type FrameRect = SubjectRect;
export type RoaLayout = { focus: { x: number; y: number }; subject: FrameRect };

/** The band text may use (the slide's own band, inside the safe zones). */
export const TEXT_BAND = { top: SAFE_TOP + 12, bottom: FRAME_H - SAFE_BOTTOM - 12 } as const;
/** Clear space kept between text and the subject. */
export const SUBJECT_PAD = 24;
/** The reveal at its usual size, whole (verdict, card, proof). */
export const REVEAL_WHOLE_PX = 620;
/** The verdict alone, when the reveal splits; the question line is shorter. */
export const VERDICT_PX = 190;
/** Everything under the verdict (card or line, then proof), when the reveal splits. */
export const REVEAL_REST_PX = 420;
/** Vertical crop offsets are tried in steps of this many frame pixels. */
const CROP_STEP = 16;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The empty space above and below the subject inside the text band, padding taken off. */
export function freeBands(s: FrameRect): { above: number; below: number } {
  return { above: Math.max(0, s.top - SUBJECT_PAD - TEXT_BAND.top), below: Math.max(0, TEXT_BAND.bottom - (s.bottom + SUBJECT_PAD)) };
}

export const largestFree = (s: FrameRect) => Math.max(freeBands(s).above, freeBands(s).below);
/** Room for the reveal: whole in one band, or the verdict above and the rest below. */
export function hasRoom(l: RoaLayout): boolean {
  const { above, below } = freeBands(l.subject);
  return Math.max(above, below) >= REVEAL_WHOLE_PX || (above >= VERDICT_PX && below >= REVEAL_REST_PX);
}

/** The crop and the subject's place in the frame, for an image of `img` pixels and a subject box (fractions 0–1). */
export function layoutFor(img: { w: number; h: number }, box: TellBox): RoaLayout {
  const scale = Math.max(FRAME_W / img.w, FRAME_H / img.h);
  const W = img.w * scale;
  const H = img.h * scale;
  const slackX = Math.max(0, W - FRAME_W);
  const slackY = Math.max(0, H - FRAME_H);
  const ox = clamp((box.x + box.w / 2) * W - FRAME_W / 2, 0, slackX);
  const rectAt = (oy: number): FrameRect => ({
    top: clamp(box.y * H - oy, 0, FRAME_H),
    bottom: clamp((box.y + box.h) * H - oy, 0, FRAME_H),
    left: clamp(box.x * W - ox, 0, FRAME_W),
    right: clamp((box.x + box.w) * W - ox, 0, FRAME_W),
  });
  // The offset leaving the largest empty band; on a tie, the one nearest the centre crop.
  let best = slackY / 2;
  let bestFree = largestFree(rectAt(best));
  const steps = Math.ceil(slackY / CROP_STEP);
  for (let i = 0; i <= steps; i++) {
    const oy = Math.min(slackY, i * CROP_STEP);
    const free = largestFree(rectAt(oy));
    if (free > bestFree + 0.5 || (Math.abs(free - bestFree) <= 0.5 && Math.abs(oy - slackY / 2) < Math.abs(best - slackY / 2))) {
      best = oy;
      bestFree = free;
    }
  }
  const r = rectAt(best);
  const round = (n: number) => Math.round(n);
  return {
    focus: { x: slackX > 0 ? Number((ox / slackX).toFixed(4)) : 0.5, y: slackY > 0 ? Number((best / slackY).toFixed(4)) : 0.5 },
    subject: { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right) },
  };
}

/** Grid the pixel read works on. */
const GRID = 64;
/** Share of the detail left outside the box on each side. */
const TAIL = 0.08;

/**
 * A subject box from the pixels, for rows with no screen box: where the detail is (gradient energy on a small grey
 * copy), trimmed of the outer TAIL on each side. Flat sky, water or wall carries little detail, so it falls outside.
 */
export async function subjectFromPixels(jpeg: Buffer): Promise<TellBox> {
  const g = await sharp(jpeg).resize(GRID, GRID, { fit: 'fill' }).greyscale().raw().toBuffer();
  const col = new Array<number>(GRID).fill(0);
  const row = new Array<number>(GRID).fill(0);
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      const dx = g[y * GRID + x + 1]! - g[y * GRID + x - 1]!;
      const dy = g[(y + 1) * GRID + x]! - g[(y - 1) * GRID + x]!;
      const e = Math.hypot(dx, dy);
      col[x]! += e;
      row[y]! += e;
    }
  }
  const span = (m: number[]): [number, number] => {
    const total = m.reduce((a, b) => a + b, 0);
    if (!total) return [0, 1];
    let acc = 0;
    let lo = 0;
    let hi = GRID - 1;
    for (let i = 0; i < GRID; i++) {
      acc += m[i]!;
      if (acc >= total * TAIL) {
        lo = i;
        break;
      }
    }
    acc = 0;
    for (let i = GRID - 1; i >= 0; i--) {
      acc += m[i]!;
      if (acc >= total * TAIL) {
        hi = i;
        break;
      }
    }
    return [lo / GRID, (hi + 1) / GRID];
  };
  const [x0, x1] = span(col);
  const [y0, y1] = span(row);
  return { x: x0, y: y0, w: Math.max(0.02, x1 - x0), h: Math.max(0.02, y1 - y0) };
}

/** The layout for stored image bytes: the screen's box when there is one, else the pixel read. */
export async function layoutOfImage(jpeg: Buffer, box?: TellBox | null): Promise<RoaLayout> {
  // Stored candidates are written upright by toJpeg (generate.ts), so the raw size is the shown size.
  const { width: w, height: h } = await sharp(jpeg).metadata();
  if (!w || !h) throw new Error('roa layout: image has no size');
  return layoutFor({ w, h }, box ?? (await subjectFromPixels(jpeg)));
}
