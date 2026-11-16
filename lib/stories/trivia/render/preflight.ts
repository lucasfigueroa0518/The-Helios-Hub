/**
 * "Are you smarter than AI?" preflight, before HyperFrames records anything: the composition is opened in
 * headless Chromium (Playwright, on a private origin, nothing off it) and measured. Fit only: there is no
 * photo, so there is no contrast check.
 *
 *   1. Fonts (Bowlby One, Inter 700–900) loaded; the GSAP timeline registered as "main".
 *   2. The stack's content (sign, question, choices) at every question size (QUESTION_PX), and whether a word
 *      of the question is wider than the safe area at each, so the fit rule (layout.ts) can pick one.
 *   3. The page's own boxes at its baked size (relative to the stage): sign, question, choices, footer slot
 *      and each option pill, so the render can prove both clips put them on the same pixels and start the
 *      confetti on the correct pill.
 *   4. Problems no size step fixes: a word wider than its pill, the tap row wider than the stage, the answer
 *      line taller than the 210 px footer slot.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { FOOT_H, LINE_PX, QUESTION_PX, SAFE, type Box, type Measured } from './layout';

const ORIGIN = 'http://trivia.local';
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.otf': 'font/otf', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
export const FONTS = ['400 94px "Bowlby One"', '900 68px Inter', '800 66px Inter', '700 54px Inter', '700 76px Inter'];

export type PageBoxes = { sign: Box; question: Box; choices: Box; foot: Box; options: Box[] };
export type PreflightResult = {
  problems: string[];
  /** The stack's content at each question size, by px. */
  measures: Record<number, Measured>;
  /** The answer line's height at each LINE_PX size (empty on clip 1). */
  lineHeights?: Record<number, number>;
  /** The page's boxes at its baked question size. */
  boxes: PageBoxes;
};
/** Check one project (its index.html). */
export type Preflight = (projectDir: string) => Promise<PreflightResult>;

type PageArgs = { fonts: string[]; sizes: number[]; lineSizes: number[]; safeW: number; footH: number };

/** Runs in the page: everything above, as plain data. Self-contained (no closures). */
function measurePage(a: PageArgs): Promise<{ problems: string[]; measures: Record<number, Measured>; lineHeights: Record<number, number>; boxes: PageBoxes }> {
  return (async () => {
    await Promise.all(a.fonts.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
    const problems: string[] = [];
    for (const f of a.fonts) if (!document.fonts.check(f)) problems.push(`font did not load: ${f}`);
    if (!(window as unknown as { __timelines?: Record<string, unknown> }).__timelines?.main) problems.push('no GSAP timeline registered as "main"');
    const stage = document.getElementById('tv-stage')!;
    const el = (id: string) => document.getElementById(id) as HTMLElement;
    const base = stage.getBoundingClientRect();
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    };
    const size = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    const own = stage.style.getPropertyValue('--qpx');
    const measures: Record<number, Measured> = {};
    for (const px of a.sizes) {
      stage.style.setProperty('--qpx', `${px}px`);
      const q = el('tv-q');
      const qs = size(q);
      measures[px] = { sign: size(el('tv-sign')), question: qs, choices: size(el('tv-choices')), questionWide: qs.w > a.safeW + 1 || q.scrollWidth > q.clientWidth + 1 };
    }
    stage.style.setProperty('--qpx', own);
    const sign = el('tv-sign');
    const options = [...document.querySelectorAll('#tv-choices .ch')];
    options.forEach((o, i) => {
      if (o.scrollWidth > o.clientWidth + 1) problems.push(`option ${i + 1}: a word is wider than its pill`);
    });
    const tap = document.getElementById('tv-tap');
    if (tap && tap.scrollWidth > tap.clientWidth + 1) problems.push('the tap row is wider than the stage');
    const line = document.getElementById('tv-line');
    const lineHeights: Record<number, number> = {};
    if (line) {
      const ownL = stage.style.getPropertyValue('--lpx');
      for (const px of a.lineSizes) {
        stage.style.setProperty('--lpx', `${px}px`);
        lineHeights[px] = line.getBoundingClientRect().height;
      }
      stage.style.setProperty('--lpx', ownL);
      const h = line.getBoundingClientRect().height;
      if (h > a.footH + 1) problems.push(`the answer line is ${Math.round(h)} px tall, over the ${a.footH} px footer slot`);
      if (line.scrollWidth > line.clientWidth + 1) problems.push('a word of the answer line is wider than the stage');
    }
    return { problems, measures, lineHeights, boxes: { sign: box(sign), question: box(el('tv-q')), choices: box(el('tv-choices')), foot: box(el('tv-foot')), options: options.map(box) } };
  })();
}

export async function openPreflight(): Promise<{ check: Preflight; close: () => Promise<void> }> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();

  const check: Preflight = async (projectDir) => {
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
      const args: PageArgs = { fonts: FONTS, sizes: [...QUESTION_PX], lineSizes: [...LINE_PX], safeW: SAFE.w, footH: FOOT_H };
      return (await page.evaluate(`(${measurePage.toString()})(${JSON.stringify(args)})`)) as PreflightResult;
    } finally {
      await page.close();
    }
  };

  return { check, close: () => browser.close() };
}
