/**
 * AI Trivia preflight, before HyperFrames records anything: the composition is opened in headless
 * Chromium (Playwright, as the Stories renderer does, on a private origin) and checked:
 *
 *   1. Fonts: Inter Medium (Instagram's Classic text, AT-34) loaded; the photo loaded.
 *   2. Text fit (the Stories text-fit.ts): every region fits at or above its minimum size, no
 *      mid-word breaks. The sizes found are handed back so the composition bakes them in.
 *   3. Contrast on moving frames (PLAN AT-15 note): at each of SAMPLE_TIMES the timeline is seeked,
 *      the text hidden (its highlight box stays) and the pixels behind each visible text line read; the Field Notes WCAG rule
 *      (contrast.ts: mean clears 3:1 for type ≥ 40 px, 4.5:1 below, worst percentile ≥ 3:1) must hold.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { colorPasses, sampleRegion, type RawImage } from '@/lib/field-notes/render/contrast';
import { fitText, type TextFitFailure } from '@/lib/stories/render/text-fit';

import { SAMPLE_TIMES } from './timeline';

const ORIGIN = 'http://trivia.local';
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.otf': 'font/otf', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
export const FONTS = ['500 40px Inter'];

export type ContrastReading = { t: number; text: string; px: number; ink: string; mean: number; worst: number; required: number; ok: boolean };
export type PreflightResult = { sizes: Record<string, number>; problems: string[]; contrast: ContrastReading[] };
/** Check one project (its index.html) at `times`. */
export type Preflight = (projectDir: string, times?: number[]) => Promise<PreflightResult>;

type TextBox = { text: string; px: number; ink: string; opacity: number; x: number; y: number; w: number; h: number };

/** "rgb(255, 94, 26)" / "rgba(...)" / "#ff5e1a" → "#FF5E1A" (alpha ignored: text is drawn solid). */
export function cssToHex(c: string): string {
  if (c.startsWith('#')) return c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join('')}`.toUpperCase() : c.slice(0, 7).toUpperCase();
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(c);
  if (!m) return '#FFFFFF';
  return `#${[m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Judge each visible text block on the pixels behind it (text hidden). */
export function judgeContrast(t: number, boxes: TextBox[], img: RawImage): ContrastReading[] {
  return boxes
    .filter((b) => b.opacity >= 0.5 && b.w > 2 && b.h > 2)
    .map((b) => {
      const samples = sampleRegion(img, { x: b.x, y: b.y, w: b.w, h: b.h });
      const c = colorPasses(samples, b.ink, { large: b.px >= 40 });
      return { t, text: b.text.slice(0, 40), px: b.px, ink: b.ink, mean: Math.round(c.mean * 100) / 100, worst: Math.round(c.worst * 100) / 100, required: c.required, ok: c.ok };
    });
}

export async function openPreflight(): Promise<{ check: Preflight; close: () => Promise<void> }> {
  const { chromium } = await import('playwright');
  const sharp = (await import('sharp')).default;
  const browser = await chromium.launch();

  const check: Preflight = async (projectDir, times = SAMPLE_TIMES) => {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    const root = path.resolve(projectDir);
    try {
      await page.addInitScript(() => {
        (window as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
      });
      await page.route(`${ORIGIN}/**`, async (route) => {
        const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
        const file = path.resolve(root, rel);
        try {
          if (!file.startsWith(root + path.sep)) throw new Error('outside');
          await route.fulfill({ body: await fsp.readFile(file), contentType: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
        } catch {
          await route.fulfill({ status: 404, body: '' });
        }
      });
      // Anything off the private origin (a CDN) is refused: the composition must be self-contained.
      await page.route(/^(?!http:\/\/trivia\.local\/).*/, (route) => route.abort());
      await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load', timeout: 60_000 });
      const problems = (await page.evaluate(async (fonts) => {
        await Promise.all(fonts.map((f) => document.fonts.load(f)));
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
        const out: string[] = [];
        for (const f of fonts) if (!document.fonts.check(f)) out.push(`font did not load: ${f}`);
        for (const img of document.images) if (!img.naturalWidth) out.push(`image failed to load: ${img.getAttribute('src')}`);
        if (!(window as unknown as { __timelines?: Record<string, unknown> }).__timelines?.main) out.push('no GSAP timeline registered as "main"');
        return out;
      }, FONTS)) as string[];
      const fit = (await page.evaluate(`(${fitText.toString()})(document)`)) as TextFitFailure[];
      for (const f of fit) problems.push(`text fit: ${f.element} "${f.text}" (${f.reason}, min ${f.minPx}px)`);
      const sizes = (await page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>('[data-fit-id]')].map((el) => [el.dataset.fitId!, Number(el.dataset.fitPx)])))) as Record<string, number>;

      const contrast: ContrastReading[] = [];
      for (const t of times) {
        const boxes = (await page.evaluate((at) => {
          const tl = (window as unknown as { __timelines: Record<string, { seek: (t: number, s?: boolean) => void }> }).__timelines.main;
          tl.seek(at, false);
          // A highlight is one box per line: each line is judged on its own box, not their bounding union.
          return [...document.querySelectorAll<HTMLElement>('.tv-text')].flatMap((el) => {
            let opacity = 1;
            for (let e: HTMLElement | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
            const cs = getComputedStyle(el);
            const rects = cs.display === 'inline' ? [...el.getClientRects()] : [el.getBoundingClientRect()];
            return rects.map((r) => ({ text: (el.textContent ?? '').trim(), px: parseFloat(cs.fontSize), ink: el.dataset.ink ?? cs.color, opacity, x: r.left, y: r.top, w: r.width, h: r.height }));
          });
        }, t)) as TextBox[];
        await page.evaluate(() => document.body.classList.add('tv-hide-text'));
        const png = await page.screenshot({ type: 'png' });
        await page.evaluate(() => document.body.classList.remove('tv-hide-text'));
        const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const img: RawImage = { data: new Uint8Array(data), width: info.width, height: info.height, channels: info.channels as 3 };
        contrast.push(...judgeContrast(t, boxes.map((b) => ({ ...b, ink: cssToHex(b.ink) })), img));
      }
      for (const c of contrast.filter((x) => !x.ok)) problems.push(`contrast at ${c.t}s: "${c.text}" ${c.mean}:1 (worst ${c.worst}:1, needs ${c.required}:1)`);
      return { sizes, problems, contrast };
    } finally {
      await page.close();
    }
  };

  return { check, close: () => browser.close() };
}
