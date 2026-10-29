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

/** The main face: the largest box. */
export function mainFace(boxes: readonly FaceBox[] | null | undefined): { x: number; y: number; w: number; h: number } | null {
  if (!boxes?.length) return null;
  const big = [...boxes].sort((a, b) => b.w * b.h - a.w * a.h)[0];
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
