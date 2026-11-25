/**
 * Automatic Faces tagging of new uploads (Tommy, 2026-11-06): does this photo clearly show a person's face, good enough
 * for the cover? It needs headless Chromium, so it runs on the helios-social worker (./faces-worker.ts), not on Vercel. Precision first: a photo tagged Faces must truly be a face photo; missing some is acceptable.
 *
 * No model call and no per-photo spend. It runs the repo's MediaPipe BlazeFace short-range model (the same model
 * and wasm the renderer's `cover_no_face` check uses, lib/field-notes/render/faces.ts) in a headless Playwright page.
 *
 * A photo is a face photo only when one face passes every gate below (`decideFacePhoto`, pure):
 *   1. score      the full-photo pass scores it >= FACE_RULES.minScore;
 *   2. size       the face box is >= FACE_RULES.minFaceFrac of the photo's short side (a portrait or group photo,
 *                 never a distant speaker or a crowd);
 *   3. landmarks  both eyes, nose and mouth sit where a face facing the camera has them (eyes inside the box, a
 *                 plausible eye distance, a level-ish eye line, the nose between the eyes, the mouth below them);
 *   4. agreement  two more detector passes on a square crop around the face, one straight and one mirrored, each
 *                 find the same face (IoU >= FACE_RULES.minConfirmIoU, score >= FACE_RULES.minConfirmScore). A face
 *                 seen at a different scale and mirrored is far less likely to be texture the model misread.
 * Any failure (no browser, timeout, unreadable image) is "not a face photo": the photo keeps the uploader's kind.
 * Location only, never identity.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright';

export const FACE_RULES = {
  /** Best BlazeFace score for the face across the whole-photo and tile passes. */
  minScore: 0.85,
  /** A face under `bigFaceFrac` of the short side (a standing, full-body shot) needs this score instead. */
  minScoreSmall: 0.9,
  bigFaceFrac: 0.1,
  /** Face box width (and height) over the photo's short side. */
  minFaceFrac: 0.06,
  /** Eye distance over face box width: a frontal or three-quarter face. */
  eyeSpanMin: 0.25,
  eyeSpanMax: 0.7,
  /** Eye line tilt from horizontal, degrees. */
  maxRollDeg: 30,
  /** Nose offset from the eyes' midpoint over the eye distance: above this the face is turned away. */
  maxYaw: 0.3,
  /** Proposal tiles: square, this fraction of the short side, half overlapping (plus the whole photo). */
  tileFracs: [1, 0.5] as readonly number[],
  /** The crop around a face is this many face-sizes wide. */
  cropScale: 2.2,
  minConfirmScore: 0.85,
  minConfirmIoU: 0.5,
} as const;

/** Longest side the photo is shrunk to before detection: BlazeFace looks at 128 px, so more is only cost. */
export const DETECT_MAX_SIDE = 1024;
/** The whole detection, browser start included, gives up after this and answers "not a face photo". */
export const DETECT_TIMEOUT_MS = 20_000;

type Point = { x: number; y: number };
/** A detection in coordinates 0-1 of the image it was found in. Keypoints: right eye, left eye, nose, mouth, ears. */
export type FaceHit = { score: number; x: number; y: number; w: number; h: number; keypoints: Point[] };
/** The two confirmation passes for one full-photo face, on a square crop (`crop` in 0-1 of the photo). */
export type FaceCheck = { face: number; crop: { x: number; y: number; w: number; h: number }; direct: FaceHit[]; mirrored: FaceHit[] };
export type FaceAnalysis = { width: number; height: number; faces: FaceHit[]; checks: FaceCheck[] };

export type FaceVerdict = {
  face: boolean;
  /** Why: the passing face, or the gate the best candidate failed on. */
  reason: string;
  /** The face box (0-1 of the photo) that made it a face photo. */
  box?: { x: number; y: number; w: number; h: number };
  score?: number;
  /** The detector could not run (no browser, timeout): the photo was not really checked. */
  unavailable?: boolean;
};

/** Detects whether a JPEG is a face photo. Injected into ingest; tests pass a stub. */
export type DetectFacePhoto = (jpeg: Buffer) => Promise<FaceVerdict>;

type Box = { x: number; y: number; w: number; h: number };

export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Landmark sanity for an upright face facing the camera. Null when it passes, else the reason. */
export function landmarkProblem(f: FaceHit, width: number, height: number, rules = FACE_RULES): string | null {
  if (f.keypoints.length < 4) return 'landmarks missing';
  const px = (p: Point) => ({ x: p.x * width, y: p.y * height });
  const [re, le, nose, mouth] = f.keypoints.slice(0, 4).map(px) as [Point, Point, Point, Point];
  const box = { x: f.x * width, y: f.y * height, w: f.w * width, h: f.h * height };
  const inside = (p: Point) => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
  if (![re, le, nose, mouth].every(inside)) return 'landmarks outside the face box';
  const span = Math.hypot(le.x - re.x, le.y - re.y) / box.w;
  if (span < rules.eyeSpanMin || span > rules.eyeSpanMax) return `eye distance ${span.toFixed(2)} of the face width`;
  const roll = Math.abs((Math.atan2(le.y - re.y, le.x - re.x) * 180) / Math.PI);
  const tilt = Math.min(roll, 180 - roll);
  if (tilt > rules.maxRollDeg) return `eye line tilted ${tilt.toFixed(0)} degrees`;
  const yaw = Math.abs(nose.x - (re.x + le.x) / 2) / Math.max(1e-6, Math.abs(le.x - re.x));
  if (yaw > rules.maxYaw) return `face turned away (nose ${yaw.toFixed(2)} eye-widths off centre)`;
  const eyeY = (re.y + le.y) / 2;
  if (!(mouth.y > eyeY && nose.y > eyeY - 0.05 * box.h)) return 'mouth not below the eyes';
  return null;
}

/** The face as it should appear inside its confirmation crop (0-1 of the crop), straight or mirrored. */
export function expectedInCrop(f: FaceHit, crop: Box, mirrored: boolean): Box {
  const x = (f.x - crop.x) / crop.w;
  const b = { x, y: (f.y - crop.y) / crop.h, w: f.w / crop.w, h: f.h / crop.h };
  return mirrored ? { ...b, x: 1 - b.x - b.w } : b;
}

function confirmed(f: FaceHit, check: FaceCheck | undefined, rules = FACE_RULES): string | null {
  if (!check) return 'no confirmation pass';
  for (const [hits, mirrored] of [[check.direct, false], [check.mirrored, true]] as const) {
    const want = expectedInCrop(f, check.crop, mirrored);
    const ok = hits.some((h) => h.score >= rules.minConfirmScore && iou(h, want) >= rules.minConfirmIoU);
    if (!ok) return mirrored ? 'not confirmed on the mirrored crop' : 'not confirmed on the crop';
  }
  return null;
}

/** The decision, pure: a face photo only when one face passes every gate. */
export function decideFacePhoto(a: FaceAnalysis, rules = FACE_RULES): FaceVerdict {
  if (a.faces.length === 0) return { face: false, reason: 'no face found' };
  const short = Math.min(a.width, a.height);
  let best: { reason: string; rank: number } = { reason: 'no face found', rank: -1 };
  const fail = (rank: number, reason: string) => {
    if (rank > best.rank) best = { reason, rank };
  };
  for (let i = 0; i < a.faces.length; i++) {
    const f = a.faces[i]!;
    if (f.score < rules.minScore) { fail(0, `face score ${f.score.toFixed(2)} below ${rules.minScore}`); continue; }
    const frac = Math.min((f.w * a.width) / short, (f.h * a.height) / short);
    if (frac < rules.minFaceFrac) { fail(1, `face is ${(frac * 100).toFixed(1)}% of the photo, below ${rules.minFaceFrac * 100}%`); continue; }
    if (frac < rules.bigFaceFrac && f.score < rules.minScoreSmall) { fail(1, `small face (${(frac * 100).toFixed(1)}%) scores ${f.score.toFixed(2)}, below ${rules.minScoreSmall}`); continue; }
    const lm = landmarkProblem(f, a.width, a.height, rules);
    if (lm) { fail(2, lm); continue; }
    const c = confirmed(f, a.checks.find((k) => k.face === i), rules);
    if (c) { fail(3, c); continue; }
    return { face: true, reason: `face ${(frac * 100).toFixed(0)}% of the photo, score ${f.score.toFixed(2)}, confirmed twice`, box: { x: f.x, y: f.y, w: f.w, h: f.h }, score: f.score };
  }
  return { face: false, reason: best.reason };
}

// ── the detector in a headless page ─────────────────────────────────────────

const ORIGIN = 'http://helios.local';
const MIME: Record<string, string> = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream' };

function localFile(pathname: string): string {
  const p = decodeURIComponent(pathname);
  if (p === '/__mediapipe/face.tflite') return path.join(process.cwd(), 'lib/social/render/assets/blaze_face_short_range.tflite');
  return path.join(process.cwd(), 'node_modules/@mediapipe/tasks-vision', p.slice('/__mediapipe/'.length));
}

/** Runs in the page (a string, so the bundler never rewrites it). Loads the detector once; `__analyze` does all three passes. */
const PAGE_SCRIPT = `import { FilesetResolver, FaceDetector } from '${ORIGIN}/__mediapipe/vision_bundle.mjs';
window.__detector = (async () => {
  const fileset = await FilesetResolver.forVisionTasks('${ORIGIN}/__mediapipe/wasm');
  return FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: '${ORIGIN}/__mediapipe/face.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.3 });
})();
const hits = (res, W, H) => res.detections.filter((d) => d.boundingBox).map((d) => ({
  score: d.categories[0] ? d.categories[0].score : 0,
  x: d.boundingBox.originX / W, y: d.boundingBox.originY / H, w: d.boundingBox.width / W, h: d.boundingBox.height / H,
  keypoints: (d.keypoints || []).map((k) => ({ x: k.x, y: k.y })),
}));
const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const u = a.w * a.h + b.w * b.h - ix * iy;
  return u > 0 ? (ix * iy) / u : 0;
};
window.__analyze = async (src, o) => {
  const detector = await window.__detector;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('image did not load')); img.src = src; });
  const W = img.naturalWidth, H = img.naturalHeight;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  // Draw region (sx, sy, side x side, in photo pixels) onto an S x S canvas, optionally mirrored, and detect.
  const view = (sx, sy, side, S, mirror) => {
    if (canvas.width !== S) { canvas.width = S; canvas.height = S; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, S, S);
    if (mirror) ctx.setTransform(-1, 0, 0, 1, S, 0);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
    return hits(detector.detect(canvas), S, S);
  };
  // Proposals: the whole photo, then overlapping square tiles of the short side and of half of it, so a face
  // down to about o.minFaceFrac of the short side fills enough of BlazeFace's 128 px input to be seen.
  const short = Math.min(W, H);
  const found = hits(detector.detect(img), W, H);
  for (const frac of o.tileFracs) {
    const side = short * frac, stride = side / 2;
    for (let ty = 0; ty + side <= H + 1; ty += stride) {
      for (let tx = 0; tx + side <= W + 1; tx += stride) {
        for (const h of view(tx, ty, side, 256, false)) {
          found.push({ score: h.score, x: (tx + h.x * side) / W, y: (ty + h.y * side) / H, w: (h.w * side) / W, h: (h.h * side) / H,
            keypoints: h.keypoints.map((k) => ({ x: (tx + k.x * side) / W, y: (ty + k.y * side) / H })) });
        }
      }
    }
  }
  // Non-maximum suppression: keep the best-scoring detection of each face.
  found.sort((p, q) => q.score - p.score);
  const faces = [];
  for (const f of found) if (!faces.some((g) => iou({ x: f.x * W, y: f.y * H, w: f.w * W, h: f.h * H }, { x: g.x * W, y: g.y * H, w: g.w * W, h: g.h * H }) > 0.3)) faces.push(f);
  const checks = [];
  faces.forEach((f, i) => {
    if (f.score < o.minScore || Math.min(f.w * W, f.h * H) < o.minFaceFrac * short) return;
    const side = o.cropScale * Math.max(f.w * W, f.h * H);
    const sx = (f.x + f.w / 2) * W - side / 2, sy = (f.y + f.h / 2) * H - side / 2;
    checks.push({ face: i, crop: { x: sx / W, y: sy / H, w: side / W, h: side / H }, direct: view(sx, sy, side, 256, false), mirrored: view(sx, sy, side, 256, true) });
  });
  return { width: W, height: H, faces, checks };
};`;

async function openPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__faces') return route.fulfill({ body: '<!doctype html><html><body></body></html>', contentType: 'text/html' });
    const file = localFile(url.pathname);
    try {
      await route.fulfill({ body: await fsp.readFile(file), contentType: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  await page.goto(`${ORIGIN}/__faces`);
  await page.addScriptTag({ type: 'module', content: PAGE_SCRIPT });
  await page.waitForFunction(() => typeof (window as unknown as { __analyze?: unknown }).__analyze === 'function');
  return page;
}

/** The photo upright and at most DETECT_MAX_SIDE on its long side, as JPEG. */
export async function prepareForDetection(jpeg: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(jpeg).rotate().resize(DETECT_MAX_SIDE, DETECT_MAX_SIDE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

/** Raw detections plus the confirmation passes for one photo, on an already open page. */
export async function analyzeOnPage(page: Page, jpeg: Buffer, rules = FACE_RULES): Promise<FaceAnalysis> {
  const small = await prepareForDetection(jpeg);
  const src = `data:image/jpeg;base64,${small.toString('base64')}`;
  return page.evaluate(
    ([s, o]) => (window as unknown as { __analyze: (src: string, o: unknown) => Promise<FaceAnalysis> }).__analyze(s, o),
    [src, { minScore: rules.minScore, minFaceFrac: rules.minFaceFrac, cropScale: rules.cropScale, tileFracs: rules.tileFracs }] as const,
  );
}

export type FacePhotoDetector = DetectFacePhoto & { analyze: (jpeg: Buffer) => Promise<FaceAnalysis>; close: () => Promise<void> };

/** A detector bound to an open browser (one page, reused across photos). The caller owns the browser. */
export function createFacePhotoDetector(browser: Browser, rules = FACE_RULES): FacePhotoDetector {
  let page: Promise<Page> | null = null;
  const analyze = async (jpeg: Buffer) => {
    page ??= openPage(browser);
    return analyzeOnPage(await page, jpeg, rules);
  };
  const detect = (async (jpeg: Buffer) => decideFacePhoto(await analyze(jpeg), rules)) as FacePhotoDetector;
  detect.analyze = analyze;
  detect.close = async () => {
    const p = page;
    page = null;
    if (p) await (await p).close().catch(() => undefined);
  };
  return detect;
}

// One shared browser for the upload route: photos arrive one at a time, so keep it warm for a minute, then close.
const IDLE_CLOSE_MS = 60_000;
let shared: { browser: Promise<Browser>; detect: Promise<FacePhotoDetector> } | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

async function closeShared(): Promise<void> {
  const s = shared;
  shared = null;
  if (!s) return;
  await (await s.browser.catch(() => null))?.close().catch(() => undefined);
}

/** `p`, or a rejection once `ms` pass. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`face detection took over ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * The live detector the finalize route passes to ingest. Never throws: any failure is "not a face photo", so a
 * photo is never tagged Faces unless the detector really ran and every gate passed.
 */
export const detectFacePhotoLive: DetectFacePhoto = async (jpeg) => {
  if (idle) clearTimeout(idle);
  try {
    if (!shared) {
      const browser = import(/* webpackIgnore: true */ 'playwright').then(({ chromium }) => chromium.launch());
      shared = { browser, detect: browser.then((b) => createFacePhotoDetector(b)) };
    }
    const detect = await withTimeout(shared.detect, DETECT_TIMEOUT_MS);
    return await withTimeout(detect(jpeg), DETECT_TIMEOUT_MS);
  } catch (error) {
    await closeShared();
    return { face: false, unavailable: true, reason: `face detector unavailable: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    idle = setTimeout(() => void closeShared(), IDLE_CLOSE_MS);
    idle.unref?.();
  }
};
