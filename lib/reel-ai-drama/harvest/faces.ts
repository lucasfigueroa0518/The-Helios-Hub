import sharp from 'sharp';

import type { DetectFaces, FaceBox } from './types';

/**
 * Face boxes for person photos (MD-60; Lucas's 00:25 note: "the shot is basically of his shirt"). The
 * local MediaPipe detector the social photo checks already use (`lib/social/photos/faces.ts`): code, no
 * AI spend, faces never identities. The harvest stores the main face as `Asset.face` (normalised 0–1), so
 * a crop can keep the face in the upper third.
 */

/** Below this confidence a box is noise. */
export const MIN_FACE_SCORE = 0.5;
/**
 * At or above this the detector is sure. Below it a box may be a real head (the detector scores a plain portrait as low
 * as 0.51) or nothing of the kind (a paper cup at 0.52, a cloud at 0.53): the score can't tell them apart, so a weak box
 * must also be the best thing a picture of a named person offers, and look like a head.
 */
export const STRONG_FACE_SCORE = 0.75;
/** The detector sees a downscaled copy; normalised boxes don't depend on the size. */
const DETECT_PX = 640;

const unit = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** Valid boxes only: finite, clamped to the image, a real size, confident enough. */
export function parseFaceBoxes(raw: unknown): FaceBox[] {
  if (!Array.isArray(raw)) return [];
  const out: FaceBox[] = [];
  for (const r of raw as Partial<FaceBox>[]) {
    const [x, y, w, h] = [r?.x, r?.y, r?.w, r?.h].map(Number);
    const score = r?.score === undefined ? 1 : Number(r.score);
    if (![x, y, w, h, score].every(Number.isFinite) || score < MIN_FACE_SCORE) continue;
    const x0 = unit(x);
    const y0 = unit(y);
    const box = { x: round(x0), y: round(y0), w: round(unit(x + w) - x0), h: round(unit(y + h) - y0), score };
    if (box.w > 0.005 && box.h > 0.005) out.push(box);
  }
  return out;
}

/** A box with its verdict: only a trusted face may be a head. `name`: the one named person it is. */
export type TrustedFace = FaceBox & { trusted: boolean; name?: string };

const isStrong = (b: Pick<FaceBox, 'score'>) => b.score >= STRONG_FACE_SCORE;
/** A sure box beats a weak one whatever their sizes; then the larger, then the surer. */
const byBelief = <T extends FaceBox>(a: T, b: T) => Number(isStrong(b)) - Number(isStrong(a)) || b.w * b.h - a.w * a.h || b.score - a.score;

/**
 * Which boxes are heads. With people named, a picture holds at most that many of them: the surest and largest first, so
 * a second box beside a named person's own face is never theirs. A weak box also needs a named person (on a picture of
 * nobody a weak box is a false alarm) and `plausible` (the pixels look like a head; no check given means no evidence
 * against it). The result is ordered main face first. Pure.
 */
export function trustFaces(boxes: readonly FaceBox[], opts: { people?: readonly string[]; plausible?: (box: FaceBox) => boolean } = {}): TrustedFace[] {
  const people = (opts.people ?? []).filter(Boolean);
  const room = people.length || Infinity;
  let taken = 0;
  const judged = [...boxes].sort(byBelief).map((b): TrustedFace => {
    const believed = isStrong(b) ? opts.plausible?.(b) !== false : people.length > 0 && opts.plausible?.(b) !== false;
    const trusted = believed && taken < room;
    if (trusted) taken += 1;
    return { ...b, trusted };
  });
  const out = [...judged.filter((b) => b.trusted), ...judged.filter((b) => !b.trusted)];
  return out.map((b, i) => (people.length === 1 && i === 0 && b.trusted ? { ...b, name: people[0] } : b));
}

/**
 * The main face: the surest and largest box, and among judged boxes only a trusted one. A weak box never beats a sure one,
 * however much larger it is.
 */
export function mainFace(boxes: readonly (FaceBox & { trusted?: boolean })[] | null | undefined): { x: number; y: number; w: number; h: number } | null {
  if (!boxes?.length) return null;
  const judged = boxes.some((b) => b.trusted !== undefined);
  const big = [...boxes].filter((b) => !judged || b.trusted).sort(byBelief)[0];
  if (!big) return null;
  return { x: round(big.x), y: round(big.y), w: round(big.w), h: round(big.h) };
}

/** A small JPEG data URL of a local file, orientation applied (the detector's page cannot read local paths). */
async function dataUrl(file: string): Promise<string> {
  const jpeg = await sharp(file).rotate().flatten({ background: '#ffffff' }).resize(DETECT_PX, DETECT_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/** Wraps a URL-based detector (one headless page per call) as a detector of local files. */
export function fileFaceDetector(detectUrls: (urls: string[]) => Promise<Map<string, FaceBox[] | null>>): DetectFaces {
  return async (files) => {
    const out = new Map<string, FaceBox[] | null>();
    const urls = new Map<string, string>();
    for (const file of new Set(files)) {
      try {
        urls.set(file, await dataUrl(file));
      } catch {
        out.set(file, null);
      }
    }
    const found = await detectUrls([...urls.values()]);
    for (const [file, url] of urls) {
      const boxes = found.get(url);
      out.set(file, boxes === null || boxes === undefined ? null : parseFaceBoxes(boxes));
    }
    return out;
  };
}

/** The live detector (Playwright + MediaPipe), loaded lazily so tests never start a browser. */
export const liveDetectFaces: DetectFaces = async (files) => {
  const { detectFacesLive } = await import('@/lib/social/photos/faces');
  return fileFaceDetector(detectFacesLive)(files);
};
