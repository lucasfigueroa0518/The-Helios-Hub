/**
 * Render-fit check (pulled forward from M7, Tommy 2026-10-05): every
 * element of every slide must sit inside the slide's 1080×1350 bounds, or
 * the render fails. Code, no AI.
 *
 * Renders the real SlideTemplate + preview.css to static HTML and measures
 * it in headless Chromium (Playwright), so it needs no dev server, sign-in
 * or database. Local files (/social/..., the Pragmatica font) are served
 * from the repo; Commons photos load from their URLs; Roboto comes from
 * Google Fonts. If the fonts don't load the check fails, because a fit
 * measured with fallback fonts proves nothing.
 *
 * The same harness writes the screenshots (one PNG per slide plus a
 * contact sheet) when asked.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

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

/** `slideText`: each rendered slide's text (cover first), for the dropped-text check (M7 C7). */
export type FitResult = { ok: boolean; violations: FitViolation[]; problems: string[]; slideText?: string[] };

export type FitCheck = (post: Post, opts?: { screenshotDir?: string; name?: string }) => Promise<FitResult>;

async function slideHtml(post: Post, scale: number, grid: boolean): Promise<string> {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SlideTemplate } = await import('./SlideTemplate');
  const css = await fsp.readFile(path.join(process.cwd(), 'app/social/render/preview/preview.css'), 'utf8');
  const slides = post.slides
    .map((_, i) => {
      const inner = renderToStaticMarkup(React.createElement(SlideTemplate, { post, position: i }));
      return `<div class="fit-frame" data-slide="${i + 1}" style="--slide-scale:${scale};width:${SLIDE_W * scale}px;height:${SLIDE_H * scale}px">${inner}</div>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${ORIGIN}/">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Roboto+Mono:wght@400;500&display=block">
<style>
@font-face { font-family: 'Pragmatica Extended'; src: url('${ORIGIN}/__fonts/PragmaticaExtended-Bold.otf'); font-weight: 700; font-display: block; }
:root { --font-pragmatica: 'Pragmatica Extended'; --font-roboto: 'Roboto'; --font-roboto-mono: 'Roboto Mono'; }
html, body { margin: 0; background: #1a1a1a; }
body { ${grid ? 'display: flex; flex-wrap: wrap; gap: 16px; padding: 16px; width: ' + (SLIDE_W * scale * 3 + 16 * 4) + 'px;' : ''} }
.fit-frame { position: relative; overflow: hidden; flex: none; }
${css}
</style></head><body>${slides}</body></html>`;
}

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.otf': 'font/otf', '.webp': 'image/webp' };

export const checkRenderFit: FitCheck = async (post, opts = {}) => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: SLIDE_W, height: SLIDE_H } });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      const file = url.pathname.startsWith('/__fonts/')
        ? path.join(process.cwd(), 'app/fonts', path.basename(url.pathname))
        : path.join(process.cwd(), 'public', decodeURIComponent(url.pathname));
      try {
        await route.fulfill({ body: await fsp.readFile(file), contentType: MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
      } catch {
        await route.fulfill({ status: 404, body: '' });
      }
    });

    const settle = async () => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
      });
    };

    // ── Measure at full size ──────────────────────────────────────────
    await page.setContent(await slideHtml(post, 1, false), { waitUntil: 'networkidle', timeout: 60_000 });
    await settle();
    const measured = await page.evaluate((tol) => {
      const problems: string[] = [];
      if (!document.fonts.check('700 40px "Pragmatica Extended"')) problems.push('Pragmatica Extended font did not load');
      if (!document.fonts.check('400 40px "Roboto"')) problems.push('Roboto font did not load');
      document.querySelectorAll('img').forEach((img) => {
        if (!img.naturalWidth) problems.push(`image failed to load: ${img.getAttribute('src')}`);
      });
      const violations: Array<{ slide: number; element: string; text: string; over: { left: number; top: number; right: number; bottom: number } }> = [];
      document.querySelectorAll<HTMLElement>('.fit-frame').forEach((frame) => {
        const slideEl = frame.querySelector<HTMLElement>('.helios-slide');
        if (!slideEl) return;
        const b = slideEl.getBoundingClientRect();
        slideEl.querySelectorAll<HTMLElement>('*').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          const over = {
            left: Math.max(0, b.left - r.left),
            top: Math.max(0, b.top - r.top),
            right: Math.max(0, r.right - b.right),
            bottom: Math.max(0, r.bottom - b.bottom),
          };
          if (Object.values(over).some((v) => v > tol)) {
            violations.push({
              slide: Number(frame.dataset.slide),
              element: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`,
              text: (el.textContent ?? '').trim().slice(0, 80),
              over: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, Math.round(v)])) as typeof over,
            });
          }
        });
      });
      const slideText = [...document.querySelectorAll<HTMLElement>('.fit-frame .helios-slide')].map((el) => el.textContent ?? '');
      return { problems, violations, slideText };
    }, TOLERANCE_PX);

    // Report the outermost offender only: its children overflow with it.
    const violations = measured.violations.filter(
      (v, i, all) => !all.some((o, j) => j < i && o.slide === v.slide && o.text.includes(v.text) && v.text.length > 0 && JSON.stringify(o.over) === JSON.stringify(v.over)),
    );

    // ── Screenshots ───────────────────────────────────────────────────
    if (opts.screenshotDir) {
      const name = opts.name ?? 'post';
      await fsp.mkdir(opts.screenshotDir, { recursive: true });
      const frames = await page.$$('.fit-frame');
      for (const [i, frame] of frames.entries()) {
        await frame.screenshot({ path: path.join(opts.screenshotDir, `${name}-slide-${String(i + 1).padStart(2, '0')}.png`) });
      }
      await page.setContent(await slideHtml(post, 0.3, true), { waitUntil: 'networkidle', timeout: 60_000 });
      await settle();
      await page.screenshot({ path: path.join(opts.screenshotDir, `${name}-contact-sheet.png`), fullPage: true });
    }

    return { ok: violations.length === 0 && measured.problems.length === 0, violations, problems: measured.problems, slideText: measured.slideText };
  } finally {
    await browser.close();
  }
};
