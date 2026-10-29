import fs from 'node:fs';

import type { VisualKind } from '@/lib/reel-ai-drama/types';

import { namesIn, type Look } from './filters';
import type { CastPerson } from './plan';
import type { FaceBox, SourceName } from './types';

/**
 * Cast coverage (MD-60, MD-41, MD-14): every person shown has an image; each main character has one
 * anchor portrait that recurs (it is their character image), and several other looks for variety. When
 * no confirmed solo photo exists, a line sketch traced from the best reference photo becomes the anchor.
 * Pure choices over screened candidates; harvest.ts does the I/O.
 */

/** Kinds that can show a person's face. */
export const PORTRAIT_KINDS: ReadonlySet<VisualKind> = new Set<VisualKind>(['person_photo', 'event_photo', 'archival', 'video_frame']);

export type CastCand = {
  source: SourceName;
  kind: VisualKind;
  people: string[];
  qids: string[];
  caption: string;
  embedded_caption?: string;
  flags: string[];
  made: boolean;
  made_kind?: string | null;
  character_image: boolean;
  width?: number;
  height?: number;
  file: string | null;
  look: Look | null;
  /** Detector boxes; null when the detector did not run or could not read the file. */
  faces: FaceBox[] | null;
  face: { x: number; y: number; w: number; h: number } | null;
  recency: number;
  order: number;
  reject: string | null;
};

const isCutout = (c: CastCand) => c.source === 'bank' && c.flags.includes('cutout');
export const isVerified = (c: CastCand) => isCutout(c) || c.flags.includes('identity:verified') || c.made_kind === 'sketch';

/** Faces in the picture: the detector when it found any, else the look, else one for a banked cutout. */
export function faceCount(c: CastCand): number | null {
  if (c.faces?.length) return c.faces.length;
  if (c.look) return c.look.faces;
  if (c.faces) return 0;
  return isCutout(c) ? 1 : null;
}

/** A usable picture of `name` (screened, identity at least probable). */
export function showsPerson(c: CastCand, name: string): boolean {
  return !c.reject && PORTRAIT_KINDS.has(c.kind) && c.people.includes(name);
}

/**
 * How good an anchor this picture is for `name`, or null when it can't be one. An anchor is a confirmed
 * solo picture of them: identity verified, one person, one face, not a page of text. A banked cutout is
 * their approved character image and always wins (MD-41). Otherwise: a clean portrait, a face of a
 * useful size near the middle, resolution, a person shot over an event shot, recency.
 */
export function anchorScore(c: CastCand, name: string): number | null {
  if (!showsPerson(c, name) || !isVerified(c) || c.people.length !== 1 || c.look?.text_heavy) return null;
  if (c.made_kind === 'sketch') return 0;
  if (isCutout(c)) return 100;
  if (faceCount(c) !== 1) return null;
  let score = 0;
  if (c.look?.portrait) score += 3;
  if (c.face) {
    score += 2;
    if (c.face.h >= 0.12 && c.face.h <= 0.6) score += 1;
    if (Math.abs(c.face.x + c.face.w / 2 - 0.5) <= 0.3) score += 0.5;
  }
  score += Math.min(Math.min(c.width ?? 0, c.height ?? 0), 1600) / 800;
  if (c.kind === 'person_photo') score += 1;
  return score + c.recency * 0.5;
}

/** The anchor for `name` among usable candidates, or null. */
export function pickAnchor<T extends CastCand>(cands: readonly T[], name: string): T | null {
  let best: { c: T; s: number } | null = null;
  for (const c of cands) {
    const s = anchorScore(c, name);
    if (s === null) continue;
    if (!best || s > best.s || (s === best.s && c.order < best.c.order)) best = { c, s };
  }
  return best?.c ?? null;
}

/** Rejections that say nothing against who is in the picture: it can still be traced from. */
const TRACEABLE = /^(watermark|tv_channel_logo|too_small|used_within_|duplicate_of|not_checked|ai_generated:caption)/;

/** The candidate names `name` from evidence (QID, caption, embedded caption, a screened identity). */
function namesPerson(c: CastCand, name: string): boolean {
  if (c.reject === null) return c.people.includes(name);
  if (c.qids.length && (c.source === 'wikidata' || c.source === 'bank') && c.people.includes(name)) return true;
  return namesIn(`${c.caption} ${c.embedded_caption ?? ''}`, [name]).length > 0;
}

/**
 * The best photo to trace a sketch of `name` from: any picture that names them and shows a face, usable
 * or rejected for a reason unrelated to identity (a watermark doesn't change who is in it). Solo pictures
 * only; a counted face first, then usable over rejected, then size. Never an AI-made picture.
 */
export function sketchReference<T extends CastCand>(cands: readonly T[], name: string): T | null {
  let best: { c: T; s: number } | null = null;
  for (const c of cands) {
    if (c.made || !c.file || !PORTRAIT_KINDS.has(c.kind)) continue;
    if (c.reject && !TRACEABLE.test(c.reject)) continue;
    if (!namesPerson(c, name)) continue;
    const faces = faceCount(c);
    // A group photo can't say which face is theirs: trace solo pictures only.
    if (faces !== null && faces !== 1) continue;
    if (!fs.existsSync(c.file)) continue;
    const s = (faces === 1 ? 4 : 0) + (c.people.length === 1 ? 1 : 0) + (c.reject ? 0 : 2) + (c.flags.includes('identity:verified') ? 1 : 0) + Math.min(Math.min(c.width ?? 0, c.height ?? 0), 1200) / 1200;
    if (!best || s > best.s) best = { c, s };
  }
  return best?.c ?? null;
}

export type CastCoverage = { name: string; main: boolean; portraits: number; verified: number; anchor: string | null; sketch: boolean };

/** Per-person counts of usable portraits (distinct after the near-duplicate screen) and confirmed ones. */
export function coverageOf(cands: readonly CastCand[], person: Pick<CastPerson, 'name' | 'main'>): Omit<CastCoverage, 'anchor' | 'sketch'> {
  const mine = cands.filter((c) => showsPerson(c, person.name));
  return { name: person.name, main: person.main, portraits: mine.length, verified: mine.filter(isVerified).length };
}

/**
 * Looks a person still needs from the second pass: main characters want several, and one of them confirmed;
 * supporting people want one usable picture.
 */
export function lookCount(cov: Pick<CastCoverage, 'main' | 'portraits' | 'verified'>): number {
  return cov.main && cov.verified === 0 ? 0 : cov.portraits;
}

/** A sketch is needed when a main character has no confirmed picture, or anyone has none at all. */
export function needsSketch(cov: Pick<CastCoverage, 'main' | 'portraits' | 'verified'>, hasAnchor: boolean): boolean {
  return cov.portraits === 0 || (cov.main && !hasAnchor);
}
