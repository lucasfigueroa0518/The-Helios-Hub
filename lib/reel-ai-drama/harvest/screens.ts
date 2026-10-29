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

/**
 * The live capture: one headless Chromium for the whole harvest. The first phrase found is scrolled to a
 * quarter of the way down the frame, so the marked words sit in the picture. Cookie banners are not
 * dismissed (no autoconsent yet); a banner over the words shows up as a missing box.
 */
export function playwrightScreenshot(): { screenshot: Screenshot; close: () => Promise<void> } {
  let browser: import('playwright').Browser | null = null;
  const screenshot: Screenshot = async (url, { out, phrases }): Promise<ScreenshotResult> => {
    if (!browser) {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: true });
    }
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR, userAgent: `${USER_AGENT} Chrome/130`, locale: 'en-US' });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
      const measure = () => page.evaluate(`(${MEASURE_SRC})(${JSON.stringify(phrases)})`) as Promise<Measured>;
      const first = (await measure()).find((m) => m.rects.length)?.rects[0];
      if (first) {
        await page.evaluate(`window.scrollBy(0, ${Math.round(first.y - VIEWPORT.height * 0.25)})`);
        await page.waitForTimeout(400);
      }
      const measured = await measure();
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, type: 'png' });
      return {
        file: out,
        width: VIEWPORT.width * DPR,
        height: VIEWPORT.height * DPR,
        boxes: measured.flatMap((m) => boxesToImagePixels(m.text, m.rects)),
        title: (await page.title()) || url,
        captured_at: new Date().toISOString(),
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
