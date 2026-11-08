import fs from 'node:fs';
import path from 'node:path';

import { USER_AGENT } from './fetch';
import type { Screenshot, ScreenshotResult, TextBox } from './types';

/**
 * Screenshots of real pages, posts and documents (research 04 §2.6, §5.2: captured live by us from the
 * real URL, with the capture time), plus measured boxes around the words a mark will circle or underline
 * (MD-43). Boxes are in image pixels of the saved PNG: `{ text, x, y, w, h }`, one per line the phrase
 * wraps onto. The harvest stores them in a sidecar `media/<id>.boxes.json` next to the image.
 */

/** A 9:16 viewport at DPR 2: the PNG is 1080×1920, text stays crisp (research 04 §7.3). */
export const VIEWPORT = { width: 540, height: 960 };
export const DPR = 2;

export type ViewportRect = { x: number; y: number; w: number; h: number };

/** CSS-pixel rects in the viewport → image-pixel boxes, clipped to the frame; rects fully outside are dropped. */
export function boxesToImagePixels(text: string, rects: readonly ViewportRect[], dpr: number = DPR, viewport = VIEWPORT): TextBox[] {
  const out: TextBox[] = [];
  for (const r of rects) {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(viewport.width, r.x + r.w);
    const y1 = Math.min(viewport.height, r.y + r.h);
    if (x1 <= x0 || y1 <= y0) continue;
    out.push({ text, x: Math.round(x0 * dpr), y: Math.round(y0 * dpr), w: Math.round((x1 - x0) * dpr), h: Math.round((y1 - y0) * dpr) });
  }
  return out;
}

/**
 * Runs in the page: finds each phrase in the visible text (case, quote marks and spacing ignored) and
 * returns its client rects. Kept as source text so no bundler helper leaks into the page.
 */
export const MEASURE_SRC = `(phrases) => {
  const norm = (s) => s.toLowerCase().replace(/[\\u2018\\u2019]/g, "'").replace(/[\\u201c\\u201d]/g, '"');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let text = '';
  const map = [];
  let lastSpace = true;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const t = n.nodeValue || '';
    for (let i = 0; i < t.length; i++) {
      let c = t[i];
      if (/\\s/.test(c)) { if (lastSpace) continue; c = ' '; lastSpace = true; } else lastSpace = false;
      const nc = norm(c);
      if (nc.length !== 1) continue;
      text += nc;
      map.push([n, i]);
    }
  }
  return phrases.map((phrase) => {
    const p = norm(phrase).replace(/\\s+/g, ' ').trim();
    const at = p ? text.indexOf(p) : -1;
    if (at < 0) return { text: phrase, rects: [] };
    const [sn, so] = map[at];
    const [en, eo] = map[at + p.length - 1];
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo + 1);
    return { text: phrase, rects: Array.from(r.getClientRects()).filter((x) => x.width > 0 && x.height > 0).map((x) => ({ x: x.left, y: x.top, w: x.width, h: x.height })) };
  });
}`;

type Measured = { text: string; rects: ViewportRect[] }[];

/** Words of an error page or a bot wall; only believed on a short page, since an article may be about one. */
const FAILED_PAGE = /\b(page not found|not found|404|403 forbidden|access denied|forbidden|just a moment|attention required|verify you are (a )?human|are you a robot|security check|enable javascript|site can.t be reached|service unavailable|something went wrong|unusual traffic)\b/i;
const SHORT_PAGE = 1500;

/** Why a capture isn't the page, or null: an HTTP error, or a short page saying it failed. Pure. */
export function captureProblem({ status, title, text }: { status: number | null; title: string; text: string }): string | null {
  if (status !== null && status >= 400) return `HTTP ${status}`;
  const m = text.trim().length < SHORT_PAGE ? FAILED_PAGE.exec(`${title} ${text}`) : null;
  return m ? `the page says "${m[0]}"` : null;
}

/** Runs in the page: hides fixed and sticky overlays (ad bars, cookie bars) that cover part of the view. */
export const CLEAR_OVERLAYS_SRC = `() => {
  const view = innerWidth * innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    const st = getComputedStyle(el);
    if (st.position !== 'fixed' && st.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < view * 0.7) el.style.visibility = 'hidden';
  }
}`;

/** Runs in the page: the headline and the block it sits in (its header, when that is not most of the page). */
export const HEADLINE_BLOCK_SRC = `() => {
  const h = document.querySelector('article h1, main h1, h1');
  if (!h) return null;
  const hr = h.getBoundingClientRect();
  if (hr.width < 100 || hr.height < 14) return null;
  let el = h;
  for (let p = h.parentElement, i = 0; p && i < 3; p = p.parentElement, i++) {
    if (p.matches('body, main, article')) break;
    if (p.getBoundingClientRect().height > innerHeight * 0.6) break;
    el = p;
  }
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}`;

const CROP_PAD = 16;
const CROP_MIN_H = 120;

/** The clip around a headline block, full width and padded, or null when it wouldn't help (too thin, nearly the whole view). Pure. */
export function cropRect(block: ViewportRect | null, viewport = VIEWPORT): ViewportRect | null {
  if (!block) return null;
  const y = Math.max(0, Math.floor(block.y - CROP_PAD));
  const bottom = Math.min(viewport.height, Math.ceil(block.y + block.h + CROP_PAD));
  const h = bottom - y;
  if (h < CROP_MIN_H || h > viewport.height * 0.85) return null;
  return { x: 0, y, w: viewport.width, h };
}

/** Image-pixel boxes moved into a clip's frame; boxes outside it are dropped. Pure. */
export function boxesInCrop(boxes: readonly TextBox[], clip: ViewportRect, dpr: number = DPR): TextBox[] {
  const top = clip.y * dpr;
  const bottom = (clip.y + clip.h) * dpr;
  return boxes.filter((b) => b.y >= top && b.y + b.h <= bottom).map((b) => ({ ...b, y: b.y - top }));
}

/**
 * The live capture: one headless Chromium for the whole harvest. The first phrase found is scrolled to a
 * quarter of the way down the frame, so the marked words sit in the picture. Cookie banners are not
 * dismissed (no autoconsent yet) when they cover most of the view; a banner over the words shows up as a
 * missing box. Smaller fixed overlays are hidden. `crop: 'headline'` returns just the headline's block where a
 * page has one (MD-141). A failed page comes back with `problem`.
 */
export function playwrightScreenshot(): { screenshot: Screenshot; close: () => Promise<void> } {
  let browser: import('playwright').Browser | null = null;
  const screenshot: Screenshot = async (url, { out, phrases, crop }): Promise<ScreenshotResult> => {
    if (!browser) {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: true });
    }
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR, userAgent: `${USER_AGENT} Chrome/130`, locale: 'en-US' });
    try {
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
      await page.evaluate(`(${CLEAR_OVERLAYS_SRC})()`).catch(() => undefined);
      const bodyText = await page.evaluate('document.body ? document.body.innerText : ""').catch(() => '') as string;
      const problem = captureProblem({ status: response?.status() ?? null, title: await page.title().catch(() => ''), text: bodyText });
      const measure = () => page.evaluate(`(${MEASURE_SRC})(${JSON.stringify(phrases)})`) as Promise<Measured>;
      const blockNow = () => (crop === 'headline' ? (page.evaluate(`(${HEADLINE_BLOCK_SRC})()`).catch(() => null) as Promise<ViewportRect | null>) : Promise.resolve(null));
      const headline = await blockNow();
      const first = (await measure()).find((m) => m.rects.length)?.rects[0];
      if (headline) {
        await page.evaluate(`window.scrollBy(0, ${Math.round(headline.y - CROP_PAD * 2)})`);
        await page.waitForTimeout(400);
      } else if (first) {
        await page.evaluate(`window.scrollBy(0, ${Math.round(first.y - VIEWPORT.height * 0.25)})`);
        await page.waitForTimeout(400);
      }
      const measured = await measure();
      const clip = cropRect(await blockNow());
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, type: 'png', ...(clip ? { clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h } } : {}) });
      const boxes = measured.flatMap((m) => boxesToImagePixels(m.text, m.rects));
      return {
        file: out,
        width: (clip?.w ?? VIEWPORT.width) * DPR,
        height: (clip?.h ?? VIEWPORT.height) * DPR,
        boxes: clip ? boxesInCrop(boxes, clip) : boxes,
        title: (await page.title()) || url,
        captured_at: new Date().toISOString(),
        ...(problem ? { problem } : {}),
      };
    } finally {
      await context.close();
    }
  };
  return {
    screenshot,
    close: async () => {
      await browser?.close();
      browser = null;
    },
  };
}
