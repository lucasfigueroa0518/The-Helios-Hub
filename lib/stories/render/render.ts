/**
 * Stories renderer (plan §6, S-32): fills the React templates with each
 * frame's data, loads them in headless Chromium (Playwright), runs the code
 * checks, screenshots each frame and writes an sRGB JPEG under 8 MB.
 * Modeled on lib/social/render/fit-check.ts, copied, not imported, so Tommy
 * can change his. Code only, no AI.
 *
 * Checks (a failure names its frame):
 *   1. Fonts: Pragmatica Extended and Roboto loaded (a fit measured with
 *      fallback fonts proves nothing). Every image loaded.
 *   2. Text fit (text-fit.ts, copied): every text region fits at or above its
 *      minimum size, no mid-word breaks.
 *   3. Bounds: nothing but photos and backdrop finishes leaves the frame.
 *   4. Safe zones: every `data-safe` element sits between y=250 and y=1580.
 *   5. Contrast: text sits on a bleed photo only where it has faded below
 *      30% (S-44: every photo is a bleed fade; the stops come from fades.ts
 *      through `data-fade`). The masthead over a photo has its own shade.
 *      Homemade style (S-53): text over a full-screen photo must sit in a
 *      highlight box (`data-boxed`), and never on a photo sticker.
 *
 * Local files are served from the repo on a private origin; remote photos
 * load from their URLs.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { fadeAlpha } from './fades';
import { fitText, type TextFitFailure } from './text-fit';
import { FRAME_H, FRAME_W, MAX_JPEG_BYTES, SAFE_BOTTOM, SAFE_TOP, type Frame, type Photo } from './types';

const ORIGIN = 'http://stories.local';
const ASSETS = path.join(process.cwd(), 'lib/stories/render/assets');
const TOLERANCE_PX = 1;
/** Text may sit on a bleed photo only where the photo's mask has faded below this. */
const BLEED_TEXT_MAX_ALPHA = 0.3;

export type FrameReport = { index: number; role: string; problems: string[]; file?: string; bytes?: number };
export type RenderResult = { ok: boolean; frames: FrameReport[]; problems: string[] };
export type Renderer = {
  render(frames: Frame[], opts?: { outDir?: string; name?: string }): Promise<RenderResult>;
  close(): Promise<void>;
};

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.otf': 'font/otf', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

/** A photo path inside the repo becomes a URL on the private origin; URLs pass through. */
function photoUrl(src: string): string {
  if (/^(https?:|data:)/.test(src)) return src;
  const rel = path.relative(process.cwd(), path.resolve(process.cwd(), src));
  return `${ORIGIN}/__local/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
}

function withUrls(frame: Frame): Frame {
  const fix = (p?: Photo) => (p ? { ...p, src: photoUrl(p.src) } : p);
  const d = frame.data;
  if (d.role === 'paid' || d.role === 'free') return { ...frame, data: { ...d, logo: fix(d.logo) } };
  if (d.role === 'closer' || d.role === 'intro') return frame;
  return { ...frame, data: { ...d, photo: fix(d.photo) } } as Frame;
}

export async function framesHtml(frames: Frame[]): Promise<string> {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { StoryFrame } = await import('./StoryFrame');
  const { HomemadeFrame } = await import('./HomemadeFrame');
  const css = await fsp.readFile(path.join(process.cwd(), 'lib/stories/render/stories.css'), 'utf8');
  const homemadeCss = await fsp.readFile(path.join(process.cwd(), 'lib/stories/render/homemade.css'), 'utf8');
  const body = frames
    .map((f, i) => {
      const inner =
        f.style === 'homemade'
          ? renderToStaticMarkup(React.createElement(HomemadeFrame, { frame: withUrls(f) }))
          : renderToStaticMarkup(React.createElement(StoryFrame, { frame: withUrls(f), logoSrc: `${ORIGIN}/__assets/helios-logo.png` }));
      return `<div class="st-host" data-frame="${i + 1}" style="width:${FRAME_W}px;height:${FRAME_H}px">${inner}</div>`;
    })
    .join('\n');
  const face = (file: string, family: string, weight: number) =>
    `@font-face { font-family: '${family}'; src: url('${ORIGIN}/__assets/${file}'); font-weight: ${weight}; font-style: normal; font-display: block; }`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${face('PragmaticaExtended-Bold.otf', 'Pragmatica Extended', 700)}
${[300, 400, 500, 700].map((w) => face(`Roboto-${w}.woff2`, 'Roboto', w)).join('\n')}
${face('Inter-Medium.ttf', 'Inter', 500)}
html, body { margin: 0; background: #111; }
.st-host { position: relative; overflow: hidden; }
${css}
${homemadeCss}
</style></head><body>${body}</body></html>`;
}

function localFile(pathname: string): string | null {
  const p = decodeURIComponent(pathname);
  if (p.startsWith('/__assets/')) return path.join(ASSETS, path.basename(p));
  if (p.startsWith('/__local/')) {
    const file = path.resolve(process.cwd(), p.slice('/__local/'.length));
    return file.startsWith(process.cwd() + path.sep) ? file : null;
  }
  return null;
}

/** sRGB JPEG under Instagram's 8 MB cap: step quality down until it fits. */
export async function toStoryJpeg(png: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  for (const quality of [92, 86, 80, 72, 64]) {
    const out = await sharp(png).flatten({ background: '#000000' }).toColorspace('srgb').withIccProfile('srgb').jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
    if (out.length <= MAX_JPEG_BYTES) return out;
  }
  throw new Error('frame JPEG stays over 8 MB at quality 64');
}

export async function openRenderer(): Promise<Renderer> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();

  async function render(frames: Frame[], opts: { outDir?: string; name?: string } = {}): Promise<RenderResult> {
    const page = await browser.newPage({ viewport: { width: FRAME_W, height: FRAME_H } });
    try {
      // tsx keeps function names with a __name helper; functions passed into the page need it defined.
      await page.addInitScript(() => {
        (window as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
      });
      const html = await framesHtml(frames);
      await page.route(`${ORIGIN}/**`, async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/__frames') return route.fulfill({ body: html, contentType: 'text/html' });
        const file = localFile(url.pathname);
        try {
          if (!file) throw new Error('outside');
          await route.fulfill({ body: await fsp.readFile(file), contentType: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
        } catch {
          await route.fulfill({ status: 404, body: '' });
        }
      });
      await page.goto(`${ORIGIN}/__frames`, { waitUntil: 'networkidle', timeout: 90_000 });
      await page.evaluate(async () => {
        await Promise.all(['700 40px "Pragmatica Extended"', '300 40px Roboto', '400 40px Roboto', '500 40px Roboto', '700 40px Roboto', '500 40px Inter'].map((f) => document.fonts.load(f)));
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
      });

      await page.evaluate(`window.__fadeAlpha = (${fadeAlpha.toString()})`);
      const fit = (await page.evaluate(`[...document.querySelectorAll('.st-host')].map((h) => (${fitText.toString()})(h))`)) as TextFitFailure[][];

      const measured = await page.evaluate(
        ({ tol, safeTop, safeBottom, frameH, maxAlpha }) => {
          const global: string[] = [];
          for (const f of ['700 40px "Pragmatica Extended"', '300 40px Roboto', '400 40px Roboto', '500 40px Roboto', '700 40px Roboto', '500 40px Inter']) {
            if (!document.fonts.check(f)) global.push(`font did not load: ${f}`);
          }
          type R = { left: number; top: number; right: number; bottom: number };
          const overlap = (a: R, b: R) => a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;
          const label = (el: Element) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent ?? '').trim().slice(0, 50)}"`;
          const alphaAt = (window as unknown as { __fadeAlpha: (stops: Array<[number, number]>, t: number) => number }).__fadeAlpha;
          return [...document.querySelectorAll<HTMLElement>('.st-host')].map((host) => {
            const problems: string[] = [];
            const b = host.getBoundingClientRect();
            host.querySelectorAll('img').forEach((img) => {
              if (!img.naturalWidth) problems.push(`image failed to load: ${img.getAttribute('src')}`);
            });
            // 3. Bounds.
            host.querySelectorAll<HTMLElement>('.st-frame *, .hm-frame *').forEach((el) => {
              if (el.closest('[data-decor], .st-bg')) return;
              const r = el.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) return;
              const over = { left: b.left - r.left, top: b.top - r.top, right: r.right - b.right, bottom: r.bottom - b.bottom };
              if (Object.values(over).some((v) => v > tol)) problems.push(`out of frame: ${label(el)}`);
            });
            // 4. Safe zones.
            const top = b.top + safeTop;
            const bottom = b.top + frameH - safeBottom;
            const safe = [...host.querySelectorAll<HTMLElement>('[data-safe]')];
            for (const el of safe) {
              const r = el.getBoundingClientRect();
              if (r.top < top - tol) problems.push(`in the top ${safeTop}px: ${label(el)} (y=${Math.round(r.top - b.top)})`);
              if (r.bottom > bottom + tol) problems.push(`in the bottom ${safeBottom}px: ${label(el)} (bottom=${Math.round(r.bottom - b.top)})`);
            }
            // 5. Text on photos.
            const bleeds = [...host.querySelectorAll<HTMLElement>('[data-fade]')];
            const fullPhotos = [...host.querySelectorAll<HTMLElement>('[data-boxed-only]')];
            const stickers = [...host.querySelectorAll<HTMLElement>('[data-sticker]')];
            for (const el of safe) {
              if (el.closest('.st-masthead--on-photo') || el.classList.contains('st-credit')) continue;
              if (el.querySelector('[data-safe]')) continue; // judge the innermost text blocks
              const r = el.getBoundingClientRect();
              for (const c of fullPhotos) {
                if (overlap(r, c.getBoundingClientRect()) && !el.closest('[data-boxed]')) problems.push(`text on a photo without a box: ${label(el)}`);
              }
              // Judge the highlight itself, not the whole line's box.
              const ink = (el.querySelector('.hm-hl') ?? el).getBoundingClientRect();
              for (const c of stickers) {
                if (overlap(ink, c.getBoundingClientRect())) problems.push(`text on a photo sticker: ${label(el)}`);
              }
              for (const c of bleeds) {
                const cr = c.getBoundingClientRect();
                if (!overlap(r, cr)) continue;
                const stops = JSON.parse(c.dataset.fade!) as Array<[number, number]>;
                // The most visible point of the photo under the text block.
                const from = (Math.max(r.top, cr.top) - cr.top) / cr.height;
                const to = (Math.min(r.bottom, cr.bottom) - cr.top) / cr.height;
                let alpha = 0;
                for (let i = 0; i <= 24; i++) alpha = Math.max(alpha, alphaAt(stops, from + ((to - from) * i) / 24));
                if (alpha > maxAlpha) problems.push(`text on a photo (${Math.round(alpha * 100)}% visible): ${label(el)}`);
              }
            }
            return problems;
          }).concat([global]);
        },
        { tol: TOLERANCE_PX, safeTop: SAFE_TOP, safeBottom: SAFE_BOTTOM, frameH: FRAME_H, maxAlpha: BLEED_TEXT_MAX_ALPHA },
      );
      const globalProblems = measured.pop() ?? [];

      const reports: FrameReport[] = frames.map((f, i) => ({
        index: i + 1,
        role: f.data.role,
        problems: [...(fit[i] ?? []).map((x) => `text fit: ${x.element} "${x.text}" (${x.reason}, min ${x.minPx}px)`), ...(measured[i] ?? [])],
      }));

      if (opts.outDir) {
        await fsp.mkdir(opts.outDir, { recursive: true });
        const hosts = await page.$$('.st-host');
        for (const [i, host] of hosts.entries()) {
          const jpeg = await toStoryJpeg(await host.screenshot({ type: 'png' }));
          const file = path.join(opts.outDir, `${opts.name ?? 'frame'}-${String(i + 1).padStart(2, '0')}-${frames[i]!.data.role}.jpg`);
          await fsp.writeFile(file, jpeg);
          reports[i]!.file = file;
          reports[i]!.bytes = jpeg.length;
        }
      }
      return { ok: globalProblems.length === 0 && reports.every((r) => r.problems.length === 0), frames: reports, problems: globalProblems };
    } finally {
      await page.close();
    }
  }

  return { render, close: () => browser.close() };
}

/**
 * Contact sheet (S-33: the render review looks at the set as one image; M1:
 * Lucas reviews the templates). Rows of `cols` frames at `scale`, an optional
 * label under each.
 */
export async function contactSheet(files: string[], out: string, opts: { cols: number; scale?: number; labels?: string[]; title?: string }): Promise<string> {
  const sharp = (await import('sharp')).default;
  const scale = opts.scale ?? 0.25;
  const tw = Math.round(FRAME_W * scale), th = Math.round(FRAME_H * scale);
  const gap = 24, labelH = opts.labels ? 44 : 0, titleH = opts.title ? 72 : 0;
  const rows = Math.ceil(files.length / opts.cols);
  const width = opts.cols * tw + (opts.cols + 1) * gap;
  const height = titleH + rows * (th + labelH) + (rows + 1) * gap;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  if (opts.title) {
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${titleH}"><text x="${gap}" y="48" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="#f5f5f5">${esc(opts.title)}</text></svg>`), left: 0, top: gap / 2 });
  }
  for (const [i, f] of files.entries()) {
    const left = gap + (i % opts.cols) * (tw + gap);
    const top = titleH + gap + Math.floor(i / opts.cols) * (th + labelH + gap);
    layers.push({ input: await sharp(f).resize(tw, th).toBuffer(), left, top });
    const text = opts.labels?.[i];
    if (text) layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${labelH}"><text x="2" y="30" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#bdbdbd">${esc(text)}</text></svg>`), left, top: top + th });
  }
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#1a1a1a' } }).composite(layers).jpeg({ quality: 88 }).toFile(out);
  return out;
}
