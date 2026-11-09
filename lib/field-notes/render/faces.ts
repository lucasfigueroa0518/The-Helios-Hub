/**
 * A real `detectFaces` for the planner: the repo's MediaPipe BlazeFace detector (the same model and
 * bundle fit-check uses), run in a headless page on the prepared 1080x1350 JPEG. Location only, never
 * identity. Tests inject a stub instead; this is the default the pipeline passes in.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright';

import type { Rect } from '../types';
import { CANVAS_H, CANVAS_W, type DetectFaces } from './photo';

const ORIGIN = 'http://helios.local';
const MIN_CONFIDENCE = 0.5;

function localFile(pathname: string): string {
  const p = decodeURIComponent(pathname);
  if (p === '/__mediapipe/face.tflite') return path.join(process.cwd(), 'lib/social/render/assets/blaze_face_short_range.tflite');
  return path.join(process.cwd(), 'node_modules/@mediapipe/tasks-vision', p.slice('/__mediapipe/'.length));
}

const MIME: Record<string, string> = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream' };

export function createMediaPipeDetectFaces(browser: Browser): DetectFaces {
  return async (image: Buffer): Promise<Rect[]> => {
    const page = await browser.newPage({ viewport: { width: CANVAS_W, height: CANVAS_H } });
    try {
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
      const dataUrl = `data:image/jpeg;base64,${image.toString('base64')}`;
      const result = await page.evaluate(
        async ({ origin, src, minConfidence }) => {
          const mod = await import(/* @vite-ignore */ `${origin}/__mediapipe/vision_bundle.mjs`);
          const fileset = await mod.FilesetResolver.forVisionTasks(`${origin}/__mediapipe/wasm`);
          const detector = await mod.FaceDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${origin}/__mediapipe/face.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: minConfidence,
          });
          const img = new Image();
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
          const out = detector.detect(img).detections.flatMap((d: { boundingBox?: { originX: number; originY: number; width: number; height: number } }) => (d.boundingBox ? [{ x: d.boundingBox.originX, y: d.boundingBox.originY, w: d.boundingBox.width, h: d.boundingBox.height }] : []));
          detector.close();
          return out as Rect[];
        },
        { origin: ORIGIN, src: dataUrl, minConfidence: MIN_CONFIDENCE },
      );
      return result;
    } finally {
      await page.close();
    }
  };
}
