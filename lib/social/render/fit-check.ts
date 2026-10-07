/**
 * Render-fit check (M7, pulled forward; M8a layout rules; M8b framing):
 * renders the real SlideTemplate + preview.css in headless Chromium
 * (Playwright) and fails the render when any rule breaks. Code only, no AI.
 *
 *   1. Text fit (text-fit.ts, the same code the preview runs): every text
 *      region fits at or above its minimum size, no mid-word breaks.
 *   2. Bounds: every element sits inside the 1080×1350 slide.
 *   3. Contrast: text over a photo has a scrim (data-scrim or the
 *      background shade).
 *   4. Faces clear: no text over a subject photo, and no text over a face
 *      the detector found in any photo.
 *   Framing (M8b): a browser face detector (MediaPipe, in this same page)
 *   finds faces, never identities, on subject and article photos only
 *   (starter and pre-screened stock photos are people-free by definition);
 *   each such photo's crop is centred on its largest face before measuring, and the crops are returned so the
 *   preview draws the same thing (SlideCopy.photoFocus).
 *
 * Local files (/social/..., fonts, the detector) are served from the repo;
 * remote photos load from their URLs. Fonts or the detector failing to
 * load fails the check: a fit measured with fallback fonts, or faces not
 * looked for, proves nothing. Also returns each slide's text (M7 C7) and
 * writes screenshots (per slide + a contact sheet) when asked.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { fitText, type TextFitFailure } from './text-fit';
import type { Post } from './types';

const ORIGIN = 'http://helios.local';
const SLIDE_W = 1080;
const SLIDE_H = 1350;
/** Sub-pixel rounding allowance. */
const TOLERANCE_PX = 1;

export type FitViolation = {
  /** 1-based, cover = slide 1. */
  slide: number;
  element: string;
  text: string;
  /** How far past each edge, in px (0 when inside). */
  over: { left: number; top: number; right: number; bottom: number };
};

/** A face box in the photo's own coordinates (0–1). Location only, never identity. */
export type FaceBox = { x: number; y: number; w: number; h: number; score: number };

/** The crop chosen for one slide's photo: object-position fractions (SlideCopy.photoFocus). */
export type SlideFocus = { slide: number; photo: string; faces: FaceBox[]; focus: { x: number; y: number; fit?: 'contain' } | null; kind: string };

export type FitResult = {
  ok: boolean;
  /** Bounds (rule 2). */
  violations: FitViolation[];
  /** Everything else that fails the render: fonts, images, text fit, contrast, faces, detector. */
  problems: string[];
  /** Each rendered slide's text, cover first (M7 C7). */
  slideText: string[];
  /** Face boxes and crops per photo slide (M8b). Absent from test stubs. */
  focus?: SlideFocus[];
};

export type FitCheck = (post: Post, opts?: { screenshotDir?: string; name?: string }) => Promise<FitResult>;

async function slideHtml(post: Post): Promise<string> {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SlideTemplate } = await import('./SlideTemplate');
  const css = await fsp.readFile(path.join(process.cwd(), 'app/social/render/preview/preview.css'), 'utf8');
  const slides = post.slides
    .map((_, i) => {
      const inner = renderToStaticMarkup(React.createElement(SlideTemplate, { post, position: i }));
      return `<div class="fit-frame" data-slide="${i + 1}" style="--slide-scale:1;width:${SLIDE_W}px;height:${SLIDE_H}px">${inner}</div>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Roboto+Mono:wght@400;500&display=block">
<style>
@font-face { font-family: 'Pragmatica Extended'; src: url('/__fonts/PragmaticaExtended-Bold.otf'); font-weight: 700; font-display: block; }
:root { --font-pragmatica: 'Pragmatica Extended'; --font-roboto: 'Roboto'; --font-roboto-mono: 'Roboto Mono'; }
html, body { margin: 0; background: #1a1a1a; }
.fit-frame { position: relative; overflow: hidden; flex: none; }
${css}
</style></head><body>${slides}</body></html>`;
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.otf': 'font/otf', '.webp': 'image/webp',
  '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream',
};

/** Local file behind an ORIGIN path. */
function localFile(pathname: string): string {
  const p = decodeURIComponent(pathname);
  if (p.startsWith('/__fonts/')) return path.join(process.cwd(), 'app/fonts', path.basename(p));
  if (p === '/__mediapipe/face.tflite') return path.join(process.cwd(), 'lib/social/render/assets/blaze_face_short_range.tflite');
  if (p.startsWith('/__mediapipe/')) return path.join(process.cwd(), 'node_modules/@mediapipe/tasks-vision', p.slice('/__mediapipe/'.length));
  return path.join(process.cwd(), 'public', p);
}

export const checkRenderFit: FitCheck = async (post, opts = {}) => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: SLIDE_W, height: SLIDE_H } });
    // tsx keeps function names with a __name helper; functions passed into the page need it defined.
    await page.addInitScript(() => {
      (window as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
    });
    const html = await slideHtml(post);
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/__slides') return route.fulfill({ body: html, contentType: 'text/html' });
      const file = localFile(url.pathname);
      try {
        await route.fulfill({ body: await fsp.readFile(file), contentType: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
      } catch {
        await route.fulfill({ status: 404, body: '' });
      }
    });
    // Remote photos: add CORS so the face detector may read their pixels.
    await page.route((u) => !u.href.startsWith(ORIGIN) && !/fonts\.(googleapis|gstatic)\.com/.test(u.hostname), async (route) => {
      if (route.request().resourceType() !== 'image') return route.continue();
      try {
        const res = await route.fetch();
        await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
      } catch {
        await route.abort();
      }
    });

    await page.goto(`${ORIGIN}/__slides`, { waitUntil: 'networkidle', timeout: 90_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
    });

    const problems: string[] = [];

    // 1. Text fit, with the preview's own routine.
    const textFit = (await page.evaluate(`(${fitText.toString()})(document)`)) as TextFitFailure[];
    for (const f of textFit) problems.push(`text fit: ${f.element} "${f.text}" (${f.reason}, min ${f.minPx}px)`);

    // M8b: faces, then a face-centred crop on every photo that has one.
    await page.addScriptTag({
      type: 'module',
      content: `import { FilesetResolver, FaceDetector } from '${ORIGIN}/__mediapipe/vision_bundle.mjs';
window.__faces = (async () => {
  const fileset = await FilesetResolver.forVisionTasks('${ORIGIN}/__mediapipe/wasm');
  return FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: '${ORIGIN}/__mediapipe/face.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 });
})();`,
    });
    const framing = await page.evaluate(async () => {
      type Box = { x: number; y: number; w: number; h: number; score: number };
      const w = window as unknown as { __faces?: Promise<{ detect(img: HTMLImageElement): { detections: Array<{ boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: Array<{ score: number }> }> } }> };
      for (let i = 0; i < 100 && !w.__faces; i++) await new Promise((r) => setTimeout(r, 50));
      if (!w.__faces) return { error: 'face detector did not load', focus: [] };
      let detector;
      try {
        detector = await w.__faces;
      } catch (err) {
        return { error: `face detector failed: ${String(err)}`, focus: [] };
      }
      const bySrc = new Map<string, Box[]>();
      const load = (src: string) => new Promise<HTMLImageElement | null>((res) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = src;
      });
      const out: Array<{ slide: number; photo: string; faces: Box[]; focus: { x: number; y: number; fit?: 'contain' } | null; kind: string }> = [];
      // Faces only on subject and article photos (Tommy, 2026-10-06): starter and pre-screened stock
      // photos are people-free by definition, and a false detection there would only move a crop.
      for (const img of [...document.querySelectorAll<HTMLImageElement>('img.helios-photo[data-photo-kind="subject"]')]) {
        const src = img.currentSrc || img.src;
        if (!bySrc.has(src)) {
          const im = await load(src);
          let boxes: Box[] = [];
          if (im && im.naturalWidth) {
            try {
              boxes = detector.detect(im).detections.flatMap((d) => (d.boundingBox ? [{
                x: d.boundingBox.originX / im.naturalWidth, y: d.boundingBox.originY / im.naturalHeight,
                w: d.boundingBox.width / im.naturalWidth, h: d.boundingBox.height / im.naturalHeight, score: d.categories[0]?.score ?? 0,
              }] : []));
            } catch {
              boxes = [];
            }
          }
          bySrc.set(src, boxes);
        }
        const faces = bySrc.get(src)!;
        const slide = Number(img.closest<HTMLElement>('.fit-frame')!.dataset.slide);
        const spread = /spread/.test(img.className);
        let focus: { x: number; y: number; fit?: 'contain' } | null = null;
        const main = [...faces].sort((a, b) => b.w * b.h - a.w * a.h)[0];
        if (main && !spread && img.naturalWidth) {
          // object-fit: cover; put the face centre at the box centre across, 40% down.
          const W = img.clientWidth, H = img.clientHeight;
          const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
          const sw = img.naturalWidth * s, sh = img.naturalHeight * s;
          const cx = main.x + main.w / 2, cy = main.y + main.h / 2;
          // Zoom cap (Tommy, 2026-10-06): the crop must hold head and shoulders, about 2.6 face
          // widths across and from half a face above to 1.7 faces below. If the cover crop's window
          // can't, show the whole photo instead (object-fit: contain on the dark canvas).
          const winW = W / sw, winH = H / sh;
          const needW = Math.min(1, main.w * 2.6), needH = Math.min(1, main.h * 3.2);
          if (winW + 1e-6 < needW || winH + 1e-6 < needH) {
            focus = { x: 0.5, y: 0.5, fit: 'contain' as const };
            img.style.objectFit = 'contain';
            img.style.objectPosition = '50% 50%';
          } else {
            const bandTop = Math.max(0, main.y - main.h * 0.5);
            const px = sw > W + 0.5 ? (W / 2 - cx * sw) / (W - sw) : 0.5;
            // Keep the band (from half a face above the head) in frame, face about 40% down.
            const pyFace = sh > H + 0.5 ? (H * 0.4 - cy * sh) / (H - sh) : 0.5;
            const pyBand = sh > H + 0.5 ? (0 - bandTop * sh) / (H - sh) : 0.5;
            const py = Math.min(pyFace, pyBand);
            focus = { x: Math.min(1, Math.max(0, px)), y: Math.min(1, Math.max(0, py)) };
            img.style.objectPosition = `${(focus.x * 100).toFixed(1)}% ${(focus.y * 100).toFixed(1)}%`;
          }
        }
        out.push({ slide, photo: src, faces, focus, kind: img.dataset.photoKind ?? 'scene' });
      }
      return { error: null as string | null, focus: out };
    });
    if (framing.error) problems.push(framing.error);
    await page.evaluate((f) => {
      (window as unknown as { __focus: unknown }).__focus = f;
    }, framing.focus);

    // 2–4. Bounds, contrast, faces clear.
    const measured = await page.evaluate((tol) => {
      const problems: string[] = [];
      if (!document.fonts.check('700 40px "Pragmatica Extended"')) problems.push('Pragmatica Extended font did not load');
      if (!document.fonts.check('400 40px "Roboto"')) problems.push('Roboto font did not load');
      document.querySelectorAll('img').forEach((img) => {
        if (!img.naturalWidth) problems.push(`image failed to load: ${img.getAttribute('src')}`);
      });
      type R = { left: number; top: number; right: number; bottom: number };
      const hit = (a: R, b: R) => a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;
      const violations: Array<{ slide: number; element: string; text: string; over: R }> = [];
      const facesData = (window as unknown as { __focus?: Array<{ slide: number; photo: string; faces: Array<{ x: number; y: number; w: number; h: number }> }> }).__focus ?? [];
      document.querySelectorAll<HTMLElement>('.fit-frame').forEach((frame) => {
        const slide = Number(frame.dataset.slide);
        const slideEl = frame.querySelector<HTMLElement>('.helios-slide');
        if (!slideEl) return;
        const b = slideEl.getBoundingClientRect();
        slideEl.querySelectorAll<HTMLElement>('*').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          const over = { left: Math.max(0, b.left - r.left), top: Math.max(0, b.top - r.top), right: Math.max(0, r.right - b.right), bottom: Math.max(0, r.bottom - b.bottom) };
          // Full-bleed photos are clipped by the slide; they may extend past it (spreads by design).
          if (el.matches('img.helios-photo, .helios-backdrop__shade, .helios-cover, .helios-image')) return;
          if (Object.values(over).some((v) => v > tol)) {
            violations.push({ slide, element: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`, text: (el.textContent ?? '').trim().slice(0, 80), over: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, Math.round(v)])) as R });
          }
        });
        const texts = [...slideEl.querySelectorAll<HTMLElement>('[data-fit-min], .helios-masthead__wordmark')];
        const photos = [...slideEl.querySelectorAll<HTMLImageElement>('img.helios-photo')];
        const shaded = Boolean(slideEl.querySelector('.helios-backdrop__shade'));
        const clip = (r: DOMRect): R => ({ left: Math.max(r.left, b.left), top: Math.max(r.top, b.top), right: Math.min(r.right, b.right), bottom: Math.min(r.bottom, b.bottom) });
        for (const t of texts) {
          const tr = t.getBoundingClientRect();
          const label = `${t.className.split(' ')[0]} "${(t.textContent ?? '').trim().slice(0, 50)}"`;
          for (const img of photos) {
            const ir = clip(img.getBoundingClientRect());
            if (!hit(tr, ir)) continue;
            if (!t.closest('[data-scrim]') && !shaded) problems.push(`slide ${slide} contrast: ${label} sits on a photo with no scrim`);
            if (img.dataset.photoKind === 'subject') problems.push(`slide ${slide} faces: ${label} covers a subject photo`);
            // Faces the detector found, in rendered coordinates.
            const f = facesData.find((x) => x.slide === slide && x.photo === (img.currentSrc || img.src));
            if (!f || !img.naturalWidth) continue;
            const r = img.getBoundingClientRect();
            const s = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
            const sw = img.naturalWidth * s, sh = img.naturalHeight * s;
            const pos = getComputedStyle(img).objectPosition.split(' ').map((v) => parseFloat(v) / 100);
            const ox = (r.width - sw) * (pos[0] ?? 0.5), oy = (r.height - sh) * (pos[1] ?? 0.5);
            for (const face of f.faces) {
              const fr = { left: r.left + ox + face.x * sw, top: r.top + oy + face.y * sh, right: r.left + ox + (face.x + face.w) * sw, bottom: r.top + oy + (face.y + face.h) * sh };
              if (hit(tr, fr) && hit(fr, ir)) problems.push(`slide ${slide} faces: ${label} covers a face`);
            }
          }
        }
      });
      const slideText = [...document.querySelectorAll<HTMLElement>('.fit-frame .helios-slide')].map((el) => el.textContent ?? '');
      return { problems, violations, slideText };
    }, TOLERANCE_PX);

    const violations = measured.violations.filter(
      (v, i, all) => !all.some((o, j) => j < i && o.slide === v.slide && o.text.includes(v.text) && v.text.length > 0 && JSON.stringify(o.over) === JSON.stringify(v.over)),
    );
    problems.push(...[...new Set(measured.problems)]);

    if (opts.screenshotDir) await screenshots(page, opts.screenshotDir, opts.name ?? 'post');

    return { ok: violations.length === 0 && problems.length === 0, violations, problems, slideText: measured.slideText, focus: framing.focus };
  } finally {
    await browser.close();
  }
};

async function screenshots(page: import('playwright').Page, dir: string, name: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const [i, frame] of (await page.$$('.fit-frame')).entries()) {
    const file = path.join(dir, `${name}-slide-${String(i + 1).padStart(2, '0')}.png`);
    await frame.screenshot({ path: file });
    files.push(file);
  }
  // Contact sheet from the same screenshots, 3 across at 30%.
  const sharp = (await import('sharp')).default;
  const tw = Math.round(SLIDE_W * 0.3), th = Math.round(SLIDE_H * 0.3), gap = 16, cols = 3;
  const rows = Math.ceil(files.length / cols);
  const tiles = await Promise.all(files.map((f) => sharp(f).resize(tw, th).toBuffer()));
  await sharp({ create: { width: cols * tw + (cols + 1) * gap, height: rows * th + (rows + 1) * gap, channels: 3, background: '#1a1a1a' } })
    .composite(tiles.map((input, i) => ({ input, left: gap + (i % cols) * (tw + gap), top: gap + Math.floor(i / cols) * (th + gap) })))
    .png()
    .toFile(path.join(dir, `${name}-contact-sheet.png`));
}
