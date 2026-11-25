import fs from 'node:fs';

import sharp from 'sharp';

import type { FaceBox } from './types';

/**
 * Secondary people (Lucas, 2026-11-21). A photo found for one person may show them behind, beside or smaller than
 * someone else; shown whole, it is a picture of the other person. The look says how the named person sits in the
 * picture (`named_role`) and, when someone else leads it, which third they stand in (`named_side`). Code then frames
 * the photo on them: the one detected face in that third that isn't the picture's main face becomes theirs, and the
 * photo is cropped close around it, head and shoulders, so every frame that shows it shows them. When they can't be
 * found there, the crop would be too small to show, or the look can't tell which person they are, the photo stops
 * standing for them: it names nobody and is used only for what it visibly shows. Either way it is never their anchor
 * or a cut source (anchors.ts `isSoloPhoto`).
 */

export const NAMED_ROLES = ['lead', 'secondary', 'unclear', 'none'] as const;
export type NamedRole = (typeof NAMED_ROLES)[number];
export const NAMED_SIDES = ['left', 'middle', 'right', 'none'] as const;
export type NamedSide = (typeof NAMED_SIDES)[number];

/** A crop around a secondary person is kept only when its short edge has at least this many pixels. */
export const MIN_SUBJECT_CROP_PX = 360;
/** The crop's width in face widths, and its height over its width (a head-and-shoulders portrait). */
const CROP_FACES_WIDE = 2.6;
const CROP_ASPECT = 1.25;

type Box = { x: number; y: number; w: number; h: number };
const third = (b: Box): NamedSide => {
  const cx = b.x + b.w / 2;
  return cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'middle';
};
const same = (a: Box, b: Box) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3 && Math.abs(a.w - b.w) < 1e-3;

/** The named person's face: the one detected face in `side`'s third that isn't the main face, or null. Pure. */
export function subjectFace(faces: readonly FaceBox[] | null | undefined, main: Box | null, side: NamedSide | undefined): FaceBox | null {
  if (!faces?.length || !side || side === 'none') return null;
  const there = faces.filter((f) => third(f) === side && !(main && same(f, main)));
  return there.length === 1 ? there[0]! : null;
}

/** The head-and-shoulders crop around `face` in a `width`×`height` picture, in pixels, or null when it would be too small. Pure. */
export function subjectCrop(face: Box, width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  let w = Math.min(width, face.w * width * CROP_FACES_WIDE);
  let h = Math.min(height, w * CROP_ASPECT);
  w = Math.min(w, h / CROP_ASPECT);
  const cx = (face.x + face.w / 2) * width;
  const top = face.y * height - face.h * height * 0.7;
  const left = Math.round(Math.min(Math.max(0, cx - w / 2), width - w));
  const y = Math.round(Math.min(Math.max(0, top), height - h));
  w = Math.round(w);
  h = Math.round(h);
  if (Math.min(w, h) < MIN_SUBJECT_CROP_PX) return null;
  return { left, top: y, width: w, height: h };
}

/** What `frameSubject` needs of a candidate (pipeline.ts Cand); it changes these in place. */
export type SubjectCand = {
  file: string | null;
  bytes: Buffer | null;
  phash: string | null;
  width?: number;
  height?: number;
  people: string[];
  flags: string[];
  faces: FaceBox[] | null;
  face: Box | null;
  look: { shows: string; faces: number; named_role?: NamedRole; named_side?: NamedSide } | null;
};

/**
 * Frames a picture on its named person when the look says they are secondary, or drops the claim (see the file note).
 * Runs once per picture (a `subject:` flag marks it done); fails open, leaving the picture as it was.
 */
export async function frameSubject(c: SubjectCand, deps: { out: () => string; phash: (file: string) => Promise<string> }): Promise<void> {
  const role = c.look?.named_role;
  if (!c.look || !c.file || c.people.length !== 1 || c.flags.some((f) => f.startsWith('subject:'))) return;
  const name = c.people[0]!;
  const many = (c.faces?.length ?? 0) > 1 || c.look.faces > 1;
  if (role === 'unclear' && many) {
    c.people = [];
    c.flags.push('subject:unclear');
    return;
  }
  if (role !== 'secondary') return;
  const face = subjectFace(c.faces, c.face, c.look.named_side);
  const crop = face && c.width && c.height ? subjectCrop(face, c.width, c.height) : null;
  if (!face || !crop) {
    c.people = [];
    c.flags.push('subject:secondary');
    return;
  }
  const out = deps.out();
  try {
    await sharp(c.file).extract(crop).toFile(out);
    const W = c.width!;
    const H = c.height!;
    const mine: FaceBox = {
      ...face,
      x: (face.x * W - crop.left) / crop.width,
      y: (face.y * H - crop.top) / crop.height,
      w: (face.w * W) / crop.width,
      h: (face.h * H) / crop.height,
    };
    c.file = out;
    c.bytes = fs.readFileSync(out);
    c.phash = await deps.phash(out);
    c.width = crop.width;
    c.height = crop.height;
    // only their face: nothing downstream may reframe the crop on the person who led the original
    c.faces = [mine];
    c.face = { x: mine.x, y: mine.y, w: mine.w, h: mine.h };
    c.flags.push('subject:cropped');
    c.look.shows = `${name}, cropped close from a photo another person leads. The original: ${c.look.shows}`;
  } catch {
    c.people = [];
    c.flags.push('subject:secondary');
  }
}
