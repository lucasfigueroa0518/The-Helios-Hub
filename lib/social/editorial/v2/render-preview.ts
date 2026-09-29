/**
 * Preview-render helper for the local test runner. Turns a captured
 * v2-pipeline run into PNG slide images without touching the DB or
 * calling any LLM.
 *
 * Strategy — reuse the existing preview infrastructure:
 *   1. adaptToPost() (pure code) → Post JSON, if we don't already have one
 *      captured from the pipeline.
 *   2. Write the JSON to exports/social/generated/preview-<runId>.json so
 *      the existing /api/social/generated/[slug] route can serve it (that
 *      route falls back to disk when the DB row doesn't exist).
 *   3. Launch headless chromium, navigate to
 *      /social/render/preview?generated=preview-<runId>&slide=N&scale=1
 *      for each slide, inject a PREVIEW watermark CSS block, screenshot
 *      the .helios-slide[data-slide-ready="true"] element at native
 *      1080×1350.
 *
 * Requires a dev server running on http://localhost:3001. If it isn't up,
 * the runner prints how to start one and skips rendering (doesn't fail
 * the whole run).
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { adaptToPost } from './adapter';
import type { CapturedRun } from './test-runner-support';

const DEFAULT_SERVER = 'http://localhost:3001';
const SLIDE_WIDTH = 1080;
const SLIDE_HEIGHT = 1350;

/**
 * CSS stamped on every previewed slide. Sits at the top-right corner in a
 * red-tinted rotated badge so it's unmistakable in a downloaded PNG but
 * doesn't cover the design.
 */
const PREVIEW_WATERMARK_CSS = `
  .helios-slide::after {
    content: "PREVIEW";
    position: absolute;
    top: 24px;
    right: 28px;
    font: 800 24px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    letter-spacing: 0.24em;
    color: #E63946;
    background: rgba(255, 255, 255, 0.92);
    padding: 8px 14px;
    border: 3px solid #E63946;
    border-radius: 6px;
    transform: rotate(-6deg);
    z-index: 9999;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }

  /* Hide the Next.js dev-mode badge ("N" bottom-left) per design v1 spec.
     The badge is a portal Next injects outside the app root, so the
     selectors below cover every shape it has taken across recent versions. */
  #__next-build-watcher,
  nextjs-portal,
  [data-nextjs-toast],
  [data-nextjs-dev-tools],
  [data-nextjs-dev-tools-button],
  button[data-nextjs-dev-tools-button] {
    display: none !important;
    visibility: hidden !important;
  }
`;

/**
 * Red OVERFLOW badge stamped on any slide whose body extends past the safe
 * area. Same rotation/pop as PREVIEW but corner-swapped so both badges are
 * visible on a failing render.
 */
const OVERFLOW_BADGE_CSS = `
  .helios-slide[data-render-failed="true"]::before {
    content: "OVERFLOW — HUMAN REVIEW";
    position: absolute;
    top: 24px;
    left: 28px;
    font: 800 22px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    letter-spacing: 0.18em;
    color: #FFFFFF;
    background: #E63946;
    padding: 10px 16px;
    border: 3px solid #FFFFFF;
    border-radius: 6px;
    transform: rotate(-3deg);
    z-index: 9999;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  }
`;

export type PreviewInput = {
  /** Post JSON to render. If null, we'll try to reconstruct from `captured`. */
  post: unknown | null;
  /** Captured pipeline run — used to reconstruct a Post via adaptToPost when
   * `post` is null (i.e., pipeline bailed on soft errors and never wrote
   * renderPostJson). */
  captured: CapturedRun | null;
  /** Run identifier used to disambiguate the preview slug and output dir. */
  runId: string;
  /** ISO date the article was published — needed for adaptToPost. */
  articlePublishedAt?: string;
  /** Directory to write PNGs into (usually `runs/<runId>/preview`). */
  outDir: string;
  /** Dev server URL. Defaults to http://localhost:3001. */
  server?: string;
};

export type PreviewResult =
  | {
      ok: true;
      slideCount: number;
      outDir: string;
      slug: string;
      /**
       * Positions of slides whose body overflowed the safe area at render
       * time. Empty when no slide failed. Design v1 §Type: "If a body still
       * overflows, that is a failed render: log it and send the post to
       * human review. Do not shrink or cut it."
       */
      overflowSlides: number[];
    }
  | { ok: false; reason: string };

export async function renderPreview(input: PreviewInput): Promise<PreviewResult> {
  const server = input.server ?? DEFAULT_SERVER;

  // 1. Resolve a Post JSON. Use captured.renderPostJson if present, else
  //    reconstruct via adaptToPost from the debug transcript.
  const post = input.post ?? reconstructPost(input.captured, input.articlePublishedAt);
  if (!post) {
    return {
      ok: false,
      reason: 'No Post JSON available (renderPostJson missing and debug transcript incomplete).',
    };
  }
  const slides = (post as { slides?: unknown[] }).slides;
  if (!Array.isArray(slides) || slides.length === 0) {
    return { ok: false, reason: 'Post has no slides.' };
  }

  // 2. Check the dev server is reachable — the preview route needs it.
  const reachable = await isServerReachable(server);
  if (!reachable) {
    return {
      ok: false,
      reason: `Dev server not reachable at ${server}. Start one in another terminal with:\n  npx next dev -p 3001\nThen re-run with --render-preview or --preview-only.`,
    };
  }

  // 3. Persist the Post to the disk cache so /api/social/generated/[slug]
  //    can serve it. Slug embeds the runId so parallel runs don't collide.
  const slug = `preview-${sanitizeForSlug(input.runId)}`;
  const exportsPath = path.join(process.cwd(), 'exports', 'social', 'generated', `${slug}.json`);
  await fsp.mkdir(path.dirname(exportsPath), { recursive: true });
  await fsp.writeFile(exportsPath, JSON.stringify(post, null, 2), 'utf-8');

  // 4. Render each slide with Playwright.
  await fsp.mkdir(input.outDir, { recursive: true });
  const playwright = await loadPlaywright();
  if (!playwright) {
    return {
      ok: false,
      reason: 'Playwright not installed. Run: npm i -D playwright && npx playwright install chromium',
    };
  }
  const overflowSlides: number[] = [];
  const browser = await playwright.chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT } });
    for (let i = 0; i < slides.length; i++) {
      const page = await context.newPage();
      const url = `${server}/social/render/preview?generated=${slug}&slide=${i}&scale=1`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForSelector('.helios-slide[data-slide-ready="true"]', { timeout: 15_000 });
      await page.addStyleTag({ content: PREVIEW_WATERMARK_CSS });
      await page.addStyleTag({ content: OVERFLOW_BADGE_CSS });
      // Small settling delay for the watermark to render.
      await page.waitForTimeout(100);

      // Body-overflow post-check. Measure any body element's rendered
      // bounding box against the slide's inner content well. If body
      // extends past the well, mark the slide render_failed. Design v1
      // §Type mandates human review over silent shrink/clip.
      const overflow = await page.evaluate(() => {
        const slideEl = document.querySelector('.helios-slide[data-slide-ready="true"]');
        if (!slideEl) return false;
        const slideBox = slideEl.getBoundingClientRect();
        const bodies = slideEl.querySelectorAll<HTMLElement>(
          '.helios-text__body, .helios-stat__body, .helios-image__body',
        );
        for (const el of Array.from(bodies)) {
          const box = el.getBoundingClientRect();
          // 8px tolerance for sub-pixel rounding.
          if (box.bottom > slideBox.bottom - 8) return true;
          if (el.scrollHeight > el.clientHeight + 4) return true;
        }
        return false;
      });
      if (overflow) {
        overflowSlides.push(i);
        await page.evaluate(() => {
          const el = document.querySelector('.helios-slide[data-slide-ready="true"]');
          if (el) el.setAttribute('data-render-failed', 'true');
        });
        await page.waitForTimeout(50);
      }

      const slideEl = await page.$('.helios-slide[data-slide-ready="true"]');
      if (!slideEl) throw new Error(`slide ${i}: .helios-slide[data-slide-ready="true"] not found`);
      const outFile = path.join(input.outDir, `slide-${String(i).padStart(2, '0')}.png`);
      await slideEl.screenshot({ path: outFile });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  return {
    ok: true,
    slideCount: slides.length,
    outDir: input.outDir,
    slug,
    overflowSlides,
  };
}

/**
 * Rebuild a Post from a captured debug transcript when the run bailed
 * before writing renderPostJson (soft-error case). Runs the same adapter
 * the real pipeline would have run — deterministic, no LLM.
 */
function reconstructPost(captured: CapturedRun | null, articlePublishedAt?: string): unknown | null {
  if (!captured?.debug?.reporter || !captured.debug.edited || !captured.debug.caption) return null;
  const dayStamp = Math.floor(Date.now() / 86_400_000) - 20_000;
  return adaptToPost({
    brief: captured.debug.reporter.brief,
    post: captured.debug.edited.post,
    caption: captured.debug.caption.caption,
    articlePublishedAt: articlePublishedAt ?? new Date().toISOString(),
    issueNumber: dayStamp,
  });
}

async function isServerReachable(server: string): Promise<boolean> {
  // Next.js dev mode compiles routes on first hit — cold-start of the
  // preview page can easily take 10-20s. 30s ceiling here, and the fetch
  // also does the warm-up so the subsequent Playwright navigations are
  // fast.
  try {
    const res = await fetch(`${server}/social/render/preview?fixture=example-post&slide=0&scale=1`, {
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function loadPlaywright(): Promise<typeof import('playwright') | null> {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

function sanitizeForSlug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Standalone preview mode: read a run directory's transcript.json,
 * reconstruct the Post if needed, and render to <runDir>/preview.
 *
 * Exported so scripts/social_v2_test.ts can call it directly when
 * --preview-only is passed without needing a live pipeline run.
 */
export async function renderPreviewFromRunDir(runDir: string, server?: string): Promise<PreviewResult> {
  const transcriptPath = path.join(runDir, 'transcript.json');
  if (!fs.existsSync(transcriptPath)) {
    return { ok: false, reason: `transcript.json not found at ${transcriptPath}` };
  }
  const transcript = JSON.parse(await fsp.readFile(transcriptPath, 'utf-8')) as {
    meta?: { runId?: string; articlePublishedAt?: string };
    columns?: { renderPostJson?: unknown };
    debug?: unknown;
  };

  // Build a minimal CapturedRun shape so reconstructPost works when the
  // run bailed and renderPostJson is null.
  const captured: CapturedRun = {
    result: { ok: false, status: 'failed', costUsd: 0, stagesRun: [] },
    debug: (transcript.debug as CapturedRun['debug']) ?? null,
    composeStatus: null,
    composeError: null,
    renderPostJson: transcript.columns?.renderPostJson ?? null,
    renderSlug: null,
    reporterOutput: null,
    fetchedSources: [],
  };

  return renderPreview({
    post: transcript.columns?.renderPostJson ?? null,
    captured,
    runId: transcript.meta?.runId ?? path.basename(runDir),
    articlePublishedAt: transcript.meta?.articlePublishedAt,
    outDir: path.join(runDir, 'preview'),
    server,
  });
}
