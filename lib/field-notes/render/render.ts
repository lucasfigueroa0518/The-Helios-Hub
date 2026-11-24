/**
 * Renders Field Notes slides to 1080x1350 PNG + JPEG in headless Chromium (Playwright, as fit-check
 * does), then runs the fit checks: the layout checks, the browser's text measurements, and white-text
 * contrast re-measured on the rendered (darkened) photo with the text hidden.
 * Offline: fonts, photo and logo are inlined. No model, no network.
 */
import type { Browser } from 'playwright';

import { renderedChecks, staticChecks, type Measure } from './checks';
import { buildSlideHtml } from './SlideView';
import { planSlide, type PlannerDeps, type SlideInput, type SlideLayout } from './layout';
import { CANVAS_H, CANVAS_W, decodeRaw } from './photo';
import type { FitProblem } from './problems';

export type RenderedSlide = {
  png: Buffer;
  jpeg: Buffer;
  /** The darkened photo alone, text hidden (what the contrast check measured). */
  backdropPng: Buffer;
  problems: FitProblem[];
  measure: Measure;
  /** The layout as drawn; absent on stubs. */
  layout?: SlideLayout;
};

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/** Runs in the page: fonts, each block's real ink box (text range, or the pen strokes of a hand block), and word overflow. */
const MEASURE_SCRIPT = `(async () => {
  await Promise.all([document.fonts.load('700 40px "Pragmatica Extended"'), document.fonts.load('400 40px Roboto')]);
  await document.fonts.ready;
  const fontsLoaded = document.fonts.check('700 40px "Pragmatica Extended"') && document.fonts.check('400 40px Roboto');
  await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
  const blocks = [...document.querySelectorAll('[data-block]')].map((el) => {
    const index = Number(el.dataset.block);
    const pen = el.querySelector('[data-ink="hand"]');
    if (pen) {
      const r = pen.getBoundingClientRect();
      return { index, box: { x: r.left, y: r.top, w: r.width, h: r.height }, overflows: false };
    }
    const t = el.firstElementChild;
    const range = document.createRange();
    range.selectNodeContents(t);
    const rects = [...range.getClientRects()].filter((q) => q.width > 0.5);
    const x0 = Math.min(...rects.map((r) => r.left)), x1 = Math.max(...rects.map((r) => r.right));
    const y0 = Math.min(...rects.map((r) => r.top)), y1 = Math.max(...rects.map((r) => r.bottom));
    return { index, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, overflows: t.scrollWidth > t.clientWidth + 1 };
  });
  return { fontsLoaded, blocks };
})()`;

export async function renderSlide(layout: SlideLayout, opts: { browser: Browser; slideNumber?: number }): Promise<RenderedSlide> {
  const page = await opts.browser.newPage({ viewport: { width: CANVAS_W, height: CANVAS_H }, deviceScaleFactor: 1 });
  try {
    // 1. Backdrop: the darkened photo only (text hidden).
    await page.setContent(await buildSlideHtml(layout, { hideInk: true }), { waitUntil: 'load' });
    const backdropPng = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H } });
    // 2. The real slide, measured and shot.
    await page.setContent(await buildSlideHtml(layout), { waitUntil: 'load' });
    const measure = (await page.evaluate(MEASURE_SCRIPT)) as Measure;
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H } });

    const sharp = (await import('sharp')).default;
    const jpeg = await sharp(png).flatten({ background: '#171717' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    const backdrop = await decodeRaw(backdropPng);
    const slide = opts.slideNumber ?? 0;
    const problems = [...layout.problems, ...staticChecks(layout), ...renderedChecks(layout, measure, backdrop)].map((p) => ({ ...p, slide }));
    return { png, jpeg, backdropPng, problems: dedupe(problems), measure, layout };
  } finally {
    await page.close();
  }
}

function dedupe(problems: FitProblem[]): FitProblem[] {
  const seen = new Set<string>();
  return problems.filter((p) => {
    const key = `${p.kind}|${p.block ?? ''}|${p.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type RenderedPost = { slides: RenderedSlide[]; layouts: SlideLayout[]; problems: FitProblem[] };

/** Plans and renders every slide of a post (cover, TIP_SLIDES_MIN to TIP_SLIDES_MAX tip slides, Follow), numbering problems from 1. */
export async function planAndRenderPost(inputs: SlideInput[], deps: PlannerDeps & { browser?: Browser } = {}): Promise<RenderedPost> {
  const run = async (browser: Browser): Promise<RenderedPost> => {
    const layouts: SlideLayout[] = [];
    const slides: RenderedSlide[] = [];
    for (const [i, input] of inputs.entries()) {
      const layout = await planSlide(input, deps);
      layouts.push(layout);
      slides.push(await renderSlide(layout, { browser, slideNumber: i + 1 }));
    }
    return { slides, layouts, problems: slides.flatMap((s) => s.problems) };
  };
  return deps.browser ? run(deps.browser) : withBrowser(run);
}

/** Mirrors storeSlideJpegs (lib/social/overnight/slides.ts): uploads each JPEG as `<prefix>/<slug>/slide-NN.jpg`; returns Storage paths in slide order. */
export async function storeFieldNotesJpegs(
  slug: string,
  jpegs: Buffer[],
  deps: { upload: (objectPath: string, body: Buffer) => Promise<void>; prefix?: string },
): Promise<string[]> {
  const { CAROUSEL_MAX_ITEMS } = await import('@/lib/social/overnight/config');
  if (jpegs.length === 0) throw new Error('The render produced no slide images.');
  if (jpegs.length > CAROUSEL_MAX_ITEMS) throw new Error(`The post has ${jpegs.length} slides; Instagram takes at most ${CAROUSEL_MAX_ITEMS}.`);
  const objects: string[] = [];
  for (const [i, jpeg] of jpegs.entries()) {
    const objectPath = `${deps.prefix ?? 'field-notes'}/${slug}/slide-${String(i + 1).padStart(2, '0')}.jpg`;
    await deps.upload(objectPath, jpeg);
    objects.push(objectPath);
  }
  return objects;
}
