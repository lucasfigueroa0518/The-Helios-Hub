/**
 * Pre-render cover-fit check. Loads the cover slide alone in the local
 * dev preview via Playwright and measures whether:
 *   - the headline overflows the safe text area (vertical or horizontal), or
 *   - any headline character rect collides with the orange arrow chevron.
 *
 * Runs at the code-check gate before final ship / bail — so the Editor
 * can be sent a HARD `cover_fit` error with a concrete "shorten or use
 * shorter words" instruction. The post-render detector in
 * render-preview.ts stays as the safety net.
 *
 * Zero LLM cost. Requires the local Next dev server and Playwright.
 * Skips (returns ok) when either is missing so unit tests + CI stay
 * offline. 2026-09-29 late.
 */

import fs from 'node:fs';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import type { Post } from '@/lib/social/render/types';
import type { CheckError, CheckReport } from './code-checks';
import { REFLOW_COVER_JS } from './cover-reflow';

const SLIDE_WIDTH = 1080;
const SLIDE_HEIGHT = 1350;

/**
 * Server the check hits. Same default as `render-preview.ts` so a single
 * dev server serves both paths.
 */
function defaultServer(): string {
  return process.env.HELIOS_V2_PREVIEW_SERVER ?? 'http://127.0.0.1:3000';
}

async function loadPlaywright(): Promise<typeof import('playwright') | null> {
  try { return await import('playwright'); } catch { return null; }
}

async function isServerReachable(server: string): Promise<boolean> {
  try {
    const res = await fetch(`${server}/social/render/preview?fixture=example-post&slide=0&scale=1`, {
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch { return false; }
}

export type CoverFitOptions = {
  server?: string;
  /** Set true in unit tests to force skip without touching Playwright. */
  skip?: boolean;
};

/**
 * Render the cover alone into the dev-server preview and measure its
 * bounds. Returns a HARD `cover_fit` error if the headline overflows
 * the safe area or collides with the chevron.
 *
 * 2026-09-29 late (second pass): `opts.skip = true` is the only silent
 * bypass — unit tests use it so they don't need a browser. Every other
 * caller (i.e., live runs) FAILS loudly when the dev server or
 * Playwright isn't reachable — a live pipeline without cover-fit is a
 * regression from the check's whole purpose, not a graceful degrade.
 */
export async function checkCoverFit(post: Post, opts: CoverFitOptions = {}): Promise<CheckReport> {
  if (opts.skip) return { ok: true, errors: [] };
  const server = opts.server ?? defaultServer();

  const reachable = await isServerReachable(server);
  if (!reachable) {
    return {
      ok: false,
      errors: [{
        kind: 'cover_fit',
        target: 'cover',
        field: 'TEXT',
        message: `cover-fit check could not reach the dev preview server at ${server}. This check is required on live runs. Start the server (npx next dev -p 3000) or set opts.skip=true only if you know this run doesn't need the check.`,
      }],
    };
  }
  const playwright = await loadPlaywright();
  if (!playwright) {
    return {
      ok: false,
      errors: [{
        kind: 'cover_fit',
        target: 'cover',
        field: 'TEXT',
        message: 'cover-fit check requires Playwright but the module could not be loaded. Install it: npm i -D playwright && npx playwright install chromium.',
      }],
    };
  }

  // Write the Post JSON to the same exports dir the preview route serves.
  const slug = `cover-fit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const exportsPath = path.join(process.cwd(), 'exports', 'social', 'generated', `${slug}.json`);
  await fsp.mkdir(path.dirname(exportsPath), { recursive: true });
  await fsp.writeFile(exportsPath, JSON.stringify(post, null, 2), 'utf-8');

  const browser = await playwright.chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT } });
    const page = await context.newPage();
    const url = `${server}/social/render/preview?generated=${slug}&slide=0&scale=1`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.helios-slide[data-slide-ready="true"]', { timeout: 15_000 });
    // 1. Reflow: insert <br> before any word that overlaps the chevron.
    //    Determinstic layout adjustment; the Editor can't fix line breaks.
    //    Returns { inserted, stillOverlaps, tooTall, singleWordOverflow }.
    const reflow = await page.evaluate(REFLOW_COVER_JS) as {
      inserted: number;
      stillOverlaps: boolean;
      tooTall: boolean;
      singleWordOverflow: boolean;
      textOverFace: boolean;
      reason?: string;
    };
    // 2. Only fail if reflow couldn't resolve the fit.
    let ok = true;
    let reason = '';
    if (reflow.singleWordOverflow) {
      ok = false;
      reason = 'a single word in the headline is wider than the cover safe area (no line break can help — shorten the word or rewrite the cover)';
    } else if (reflow.tooTall) {
      ok = false;
      reason = `after inserting ${reflow.inserted} line break(s), the headline still extends past the slide bottom — the cover has too many lines to fit. Shorten the cover.`;
    } else if (reflow.stillOverlaps) {
      ok = false;
      reason = `after inserting ${reflow.inserted} line break(s), a line still collides with the arrow. Shorten the cover.`;
    } else if (reflow.textOverFace) {
      ok = false;
      reason = `after inserting ${reflow.inserted} line break(s), the headline enters the face zone of the cover photo (top ~40% of image, with a 40px margin). Shorten the cover so the text sits below the face. If that's not possible, drop the cover photo and go type-only.`;
    }
    const measurement = { ok, reason };
    await page.close();
    if (measurement.ok) return { ok: true, errors: [] };
    const err: CheckError = {
      kind: 'cover_fit',
      target: 'cover',
      field: 'TEXT',
      message: `COVER doesn't fit: ${measurement.reason}. Shorten the cover, use shorter words, or split the headline into two clauses. The cover template is fixed; the text must fit inside the safe area without crossing the arrow.`,
    };
    return { ok: false, errors: [err] };
  } finally {
    await browser.close();
    // Best-effort cleanup of the tmp export.
    try { fs.unlinkSync(exportsPath); } catch { /* ignore */ }
  }
}
