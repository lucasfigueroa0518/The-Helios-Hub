/**
 * The meme renderer (BUILD_PLAN M2): a resolved meme (fill.ts) drawn on the
 * 1080×1350 carousel canvas in headless Chromium, the Stories renderer's
 * pattern. Instagram crops every slide of a carousel to the first slide's
 * ratio, so the template is fitted whole onto the canvas instead of shown at
 * its own size.
 *
 * Text is Inter Medium (ME-23); there is no Helios branding (ME-24). A label
 * is a plate with the player's logo and exact name (ME-10).
 *
 * Checks, each naming its slot:
 *   1. Fonts and images loaded.
 *   2. Fit: text fits its box at or above MIN_TEXT_PX with no word broken; a
 *      label fits at or above MIN_CHIP_PX.
 *   3. Faces: nothing drawn touches a face (detected or hand-marked), ME-12.
 * Code only, no AI.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { TEMPLATE_FACES } from './faces.generated';
import type { RenderSpec } from './fill';
import { TEMPLATE_GEOMETRY, type Box } from './geometry';

export const CANVAS_W = 1080;
export const CANVAS_H = 1350;
/** The letterbox around a template that doesn't fill the 4:5 canvas. */
export const CANVAS_BG = '#ffffff';
export const MIN_TEXT_PX = 24;
const MAX_TEXT_PX = 96;
export const MIN_CHIP_PX = 26;
const MAX_CHIP_PX = 104;

const ORIGIN = 'http://memes.local';
const FONT = 'helios_text_engine/fonts/Inter-Medium.ttf';
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.ttf': 'font/ttf' };

export type MemeRender = { png: Buffer; problems: string[] };
export type MemeRenderer = { render(specs: RenderSpec[]): Promise<MemeRender[]>; close(): Promise<void> };

const local = (rel: string) => `${ORIGIN}/__local/${rel.split('/').map(encodeURIComponent).join('/')}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Where the template image lands on the canvas: fitted whole, centered. */
export function imageRect(width: number, height: number): Box {
  const scale = Math.min(CANVAS_W / width, CANVAS_H / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (CANVAS_W - w) / 2, y: (CANVAS_H - h) / 2, w, h };
}

/** Every face in a template, in canvas pixels. */
export function facesOnCanvas(spec: RenderSpec): Box[] {
  const r = imageRect(spec.width, spec.height);
  const all = [...(TEMPLATE_FACES[spec.templateId] ?? []), ...(TEMPLATE_GEOMETRY[spec.templateId]?.faces ?? [])];
  return all.map((f) => ({ x: r.x + f.x * r.w, y: r.y + f.y * r.h, w: f.w * r.w, h: f.h * r.h }));
}

export function memeHtml(spec: RenderSpec): string {
  const r = imageRect(spec.width, spec.height);
  const items = spec.items
    .map((it) => {
      const b = it.box;
      const style = `left:${r.x + b.x * r.w}px;top:${r.y + b.y * r.h}px;width:${b.w * r.w}px;height:${b.h * r.h}px`;
      const inner =
        it.content.type === 'text'
          ? `<span class="t ${b.style}">${esc(it.content.text)}</span>`
          : `<span class="chip ${it.content.logo?.plate ?? 'light'}" aria-label="${esc(it.content.name)}" data-logo-optional="${it.content.logoOptional}">${it.content.logo ? `<img src="${local(it.content.logo.file)}" alt="${esc(it.content.name)}">` : ''}${it.content.showName || !it.content.logo ? `<span class="n">${esc(it.content.name)}</span>` : ''}</span>`;
      return `<div class="slot${b.style === 'plate' ? ' plate' : ''}" data-slot="${esc(it.slot)}" data-kind="${it.content.type}" style="${style}">${inner}</div>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Inter'; src: url('${local(FONT)}'); font-weight: 500; font-style: normal; font-display: block; }
html, body { margin: 0; }
#canvas { position: relative; width: ${CANVAS_W}px; height: ${CANVAS_H}px; background: ${CANVAS_BG}; overflow: hidden; font-family: 'Inter', sans-serif; font-weight: 500; }
#tpl { position: absolute; left: ${r.x}px; top: ${r.y}px; width: ${r.w}px; height: ${r.h}px; }
.slot { position: absolute; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.t { display: block; max-width: 100%; text-align: center; line-height: 1.12; overflow-wrap: normal; word-break: normal; hyphens: none; }
.t.dark, .t.plate { color: #111111; }
.slot.plate { background: #ffffff; }
.t.outline { color: #ffffff; text-shadow: 0 0 0.09em #000, 0.05em 0.05em 0 #000, -0.05em 0.05em 0 #000, 0.05em -0.05em 0 #000, -0.05em -0.05em 0 #000, 0.06em 0 0 #000, -0.06em 0 0 #000, 0 0.06em 0 #000, 0 -0.06em 0 #000; }
.chip { display: inline-flex; align-items: center; gap: 0.32em; padding: 0.22em 0.5em; border-radius: 0.38em; white-space: nowrap; box-shadow: 0 0.06em 0.2em rgba(0,0,0,0.35); }
.chip.light { background: #ffffff; color: #111111; }
.chip.dark { background: #111111; color: #ffffff; }
.chip img { height: 1.15em; width: auto; object-fit: contain; display: block; }
.chip:has(.n) img { max-width: 3.6em; }
.chip:not(:has(.n)) { padding: 0.3em 0.4em; }
.chip:not(:has(.n)) img { height: 0.95em; }
.chip .n { line-height: 1; }
</style></head><body><div id="canvas"><img id="tpl" src="${local(spec.image)}" alt="">${items}</div></body></html>`;
}

function localFile(pathname: string): string | null {
  const p = decodeURIComponent(pathname);
  if (!p.startsWith('/__local/')) return null;
  const file = path.resolve(process.cwd(), p.slice('/__local/'.length));
  return file.startsWith(process.cwd() + path.sep) ? file : null;
}

export async function openMemeRenderer(): Promise<MemeRenderer> {
  // Not bundled by Next: the lab's server resolves Playwright from node_modules at run time.
  const { chromium } = await import(/* webpackIgnore: true */ 'playwright');
  const browser = await chromium.launch();

  async function renderOne(spec: RenderSpec): Promise<MemeRender> {
    const page = await browser.newPage({ viewport: { width: CANVAS_W, height: CANVAS_H } });
    try {
      await page.addInitScript(() => {
        (window as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
      });
      const html = memeHtml(spec);
      await page.route(`${ORIGIN}/**`, async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/__meme') return route.fulfill({ body: html, contentType: 'text/html' });
        const file = localFile(url.pathname);
        try {
          if (!file) throw new Error('outside');
          await route.fulfill({ body: await fsp.readFile(file), contentType: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
        } catch {
          await route.fulfill({ status: 404, body: '' });
        }
      });
      await page.goto(`${ORIGIN}/__meme`, { waitUntil: 'networkidle', timeout: 60_000 });
      const faces = facesOnCanvas(spec);
      const problems = await page.evaluate(
        async ({ minText, maxText, minChip, maxChip, faces }) => {
          await document.fonts.load('500 40px Inter');
          await document.fonts.ready;
          const out: string[] = [];
          if (!document.fonts.check('500 40px Inter')) out.push('font: Inter Medium did not load');
          for (const img of Array.from(document.images)) if (!img.complete || !img.naturalWidth) out.push(`image did not load: ${img.src}`);
          const fits = (box: HTMLElement, el: HTMLElement) => el.scrollWidth <= box.clientWidth + 1 && el.offsetHeight <= box.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
          for (const box of Array.from(document.querySelectorAll<HTMLElement>('.slot'))) {
            const slot = box.dataset.slot!;
            const el = box.firstElementChild as HTMLElement;
            const isChip = box.dataset.kind === 'chip';
            const lo = isChip ? minChip : minText;
            let size = isChip ? Math.min(maxChip, Math.floor(box.clientHeight * 0.62)) : Math.min(maxText, Math.floor(box.clientHeight * 0.9));
            for (; size >= lo; size -= 2) {
              el.style.fontSize = `${size}px`;
              if (fits(box, el)) break;
            }
            if (size < lo && isChip && el.dataset.logoOptional === 'true' && el.querySelector('img')) {
              el.querySelector('img')!.remove();
              for (size = Math.min(maxChip, Math.floor(box.clientHeight * 0.62)); size >= lo; size -= 2) {
                el.style.fontSize = `${size}px`;
                if (fits(box, el)) break;
              }
            }
            if (size < lo) {
              el.style.fontSize = `${lo}px`;
              out.push(`fit: ${slot} does not fit its box at ${lo}px`);
            }
            const r = el.getBoundingClientRect();
            for (const f of faces) {
              if (r.left < f.x + f.w && f.x < r.right && r.top < f.y + f.h && f.y < r.bottom) out.push(`face: ${slot} touches a face`);
            }
          }
          return out;
        },
        { minText: MIN_TEXT_PX, maxText: MAX_TEXT_PX, minChip: MIN_CHIP_PX, maxChip: MAX_CHIP_PX, faces },
      );
      const png = await page.locator('#canvas').screenshot({ type: 'png' });
      return { png, problems };
    } finally {
      await page.close();
    }
  }

  return {
    async render(specs) {
      const out: MemeRender[] = [];
      for (const spec of specs) out.push(await renderOne(spec));
      return out;
    },
    close: () => browser.close(),
  };
}
