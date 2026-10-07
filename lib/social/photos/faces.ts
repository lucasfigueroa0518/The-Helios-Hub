/**
 * Face counts for candidate photos (photo spec §3–§4; Link 4): the same
 * MediaPipe face detector the render check uses, in its own headless page,
 * run before a photo is placed. Code, no AI; faces, never identities.
 *
 *   second photo of a person   exactly one face
 *   a person's photo           the face box decides full bleed or split (Link 5)
 *
 * One browser per call; pass every URL of a post at once.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { FaceBox } from '@/lib/social/render/fit-check';

export type DetectFaces = (urls: string[]) => Promise<Map<string, FaceBox[] | null>>;

const ORIGIN = 'http://helios.local';

const MIME: Record<string, string> = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream' };

function localFile(pathname: string): string {
  const p = decodeURIComponent(pathname);
  if (p === '/__mediapipe/face.tflite') return path.join(process.cwd(), 'lib/social/render/assets/blaze_face_short_range.tflite');
  return path.join(process.cwd(), 'node_modules/@mediapipe/tasks-vision', p.slice('/__mediapipe/'.length));
}

/** Face boxes per URL (0–1 of the photo), or null when the photo didn't load. */
export const detectFacesLive: DetectFaces = async (urls) => {
  const out = new Map<string, FaceBox[] | null>();
  const unique = [...new Set(urls)];
  if (!unique.length) return out;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      (window as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
    });
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
    // Remote photos: add CORS so the detector may read their pixels.
    await page.route((u) => !u.href.startsWith(ORIGIN), async (route) => {
      try {
        const res = await route.fetch();
        await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
      } catch {
        await route.abort();
      }
    });
    await page.goto(`${ORIGIN}/__faces`);
    await page.addScriptTag({
      type: 'module',
      content: `import { FilesetResolver, FaceDetector } from '${ORIGIN}/__mediapipe/vision_bundle.mjs';
window.__faces = (async () => {
  const fileset = await FilesetResolver.forVisionTasks('${ORIGIN}/__mediapipe/wasm');
  return FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: '${ORIGIN}/__mediapipe/face.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
})();`,
    });
    const result = await page.evaluate(async (list) => {
      type Box = { x: number; y: number; w: number; h: number; score: number };
      const w = window as unknown as { __faces?: Promise<{ detect(img: HTMLImageElement): { detections: Array<{ boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: Array<{ score: number }> }> } }> };
      for (let i = 0; i < 100 && !w.__faces; i++) await new Promise((r) => setTimeout(r, 50));
      if (!w.__faces) throw new Error('face detector did not load');
      const detector = await w.__faces;
      const load = (src: string) => new Promise<HTMLImageElement | null>((res) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = src;
      });
      const found: Array<[string, Box[] | null]> = [];
      for (const src of list) {
        const im = await load(src);
        if (!im || !im.naturalWidth) {
          found.push([src, null]);
          continue;
        }
        const boxes = detector.detect(im).detections.flatMap((d) => (d.boundingBox ? [{
          x: d.boundingBox.originX / im.naturalWidth, y: d.boundingBox.originY / im.naturalHeight,
          w: d.boundingBox.width / im.naturalWidth, h: d.boundingBox.height / im.naturalHeight, score: d.categories[0]?.score ?? 0,
        }] : []));
        found.push([src, boxes]);
      }
      return found;
    }, unique);
    for (const [src, boxes] of result) out.set(src, boxes);
    return out;
  } finally {
    await browser.close();
  }
};
