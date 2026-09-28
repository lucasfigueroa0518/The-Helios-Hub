import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test, { describe } from 'node:test';

import { renderPreview, renderPreviewFromRunDir } from '@/lib/social/editorial/v2/render-preview';
import { parseBrief, parseEditedPost } from '@/lib/social/editorial/v2/parse';
import type { CapturedRun } from '@/lib/social/editorial/v2/test-runner-support';
import type { PipelineV2Debug } from '@/lib/social/editorial/v2/log';

/**
 * Playwright + a live dev server aren't part of the test path. These tests
 * cover the pure paths: server-unreachable error, missing-Post error,
 * missing-transcript error, and (via the same code paths) confirm
 * renderPreview never throws when given empty inputs.
 */

const EDITED_RAW = `COVER: A test cover.
COVER HIGHLIGHT: test cover
COVER IMAGE: type only

SLIDE 2
BODY: A body sentence for slide 2.
HIGHLIGHT: body sentence
IMAGE: type only

FOLLOW: Follow Helios.

EDIT NOTES:
None`;

const BRIEF_RAW = `SINGLE STORY: yes
THE NEWS: A test news line.
THE STORY: A test story body.
TERMS:
IMAGES: None found
SOURCES:
- Outlet, 2026-01-01, https://x.example.com`;

function makeCaptured(): CapturedRun {
  const brief = parseBrief(BRIEF_RAW);
  const post = parseEditedPost(EDITED_RAW);
  const stageUsage = { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50, approxCostUsd: 0.02 };
  const debug: PipelineV2Debug = {
    version: 2,
    articleId: 'aaaa',
    startedAt: new Date().toISOString(),
    rounds: [],
    repairs: [],
    reporter: { brief, briefRaw: BRIEF_RAW, stopReasons: ['end_turn'], usage: stageUsage },
    edited: { post, raw: EDITED_RAW, editNotes: null, stopReasons: ['end_turn'], usage: stageUsage },
    caption: { caption: 'Test caption.\n\nSource: X, 2026', raw: 'CAPTION:\nTest caption.', stopReasons: ['end_turn'], usage: stageUsage },
    outcome: { status: 'needs_human_review', totalCostUsd: 0.02 },
  };
  return {
    result: { ok: false, status: 'needs_human_review', costUsd: 0.02, stagesRun: ['reporter'] },
    debug,
    composeStatus: 'needs_human_review',
    composeError: 'test',
    renderPostJson: null,
    renderSlug: null,
    reporterOutput: null,
    fetchedSources: [],
  };
}

describe('renderPreview — dev-server unreachable', () => {
  test('returns { ok: false, reason: "…start one…" } when the dev server is not up', async () => {
    // Point at a definitely-unreachable local port so the fetch fails
    // fast. renderPreview short-circuits before touching Playwright, so
    // this test doesn't need a mocked browser.
    const tmp = await fsp.mkdtemp(path.join(tmpdir(), 'social-v2-preview-test-'));
    try {
      const r = await renderPreview({
        post: { slides: [{ position: 0 }] } as never, // valid post shape (1 slide)
        captured: null,
        runId: 'test-run',
        outDir: path.join(tmp, 'preview'),
        server: 'http://127.0.0.1:1', // reserved port, definitely down
      });
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.match(r.reason, /Dev server not reachable at http:\/\/127\.0\.0\.1:1/);
        assert.match(r.reason, /npx next dev/);
      }
    } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  });
});

describe('renderPreview — missing Post', () => {
  test('returns { ok: false } when post is null and captured is null', async () => {
    const tmp = await fsp.mkdtemp(path.join(tmpdir(), 'social-v2-preview-test-'));
    try {
      const r = await renderPreview({
        post: null,
        captured: null,
        runId: 'test-run',
        outDir: path.join(tmp, 'preview'),
        server: 'http://127.0.0.1:1',
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.reason, /No Post JSON available/);
    } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  });

  test('returns { ok: false } when post has no slides', async () => {
    const tmp = await fsp.mkdtemp(path.join(tmpdir(), 'social-v2-preview-test-'));
    try {
      const r = await renderPreview({
        post: { slides: [] } as never,
        captured: null,
        runId: 'test-run',
        outDir: path.join(tmp, 'preview'),
        server: 'http://127.0.0.1:1',
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.reason, /Post has no slides/);
    } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  });
});

describe('renderPreview — Post reconstruction from captured debug', () => {
  test('when post is null but captured has full debug, adapter reconstructs the Post before the dev-server check', async () => {
    // Set server to unreachable so we can inspect that the pipeline got
    // past the "no Post" check and DID reconstruct one — the server-
    // unreachable error only fires after Post resolution succeeds.
    const tmp = await fsp.mkdtemp(path.join(tmpdir(), 'social-v2-preview-test-'));
    try {
      const r = await renderPreview({
        post: null,
        captured: makeCaptured(),
        runId: 'test-run',
        articlePublishedAt: '2026-09-28T00:00:00Z',
        outDir: path.join(tmp, 'preview'),
        server: 'http://127.0.0.1:1',
      });
      // Should have reconstructed the Post (has slides) and then failed on
      // the server reachability check — NOT on "No Post JSON available".
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.match(r.reason, /Dev server not reachable/);
        assert.doesNotMatch(r.reason, /No Post JSON available/);
      }
    } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  });
});

describe('renderPreviewFromRunDir — reads transcript.json', () => {
  test('returns { ok: false } when transcript.json is missing', async () => {
    const tmp = await fsp.mkdtemp(path.join(tmpdir(), 'social-v2-preview-test-'));
    try {
      const r = await renderPreviewFromRunDir(tmp);
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.reason, /transcript\.json not found/);
    } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  });

  test('reads renderPostJson from transcript.columns and passes it through', async () => {
    const tmp = await fsp.mkdtemp(path.join(tmpdir(), 'social-v2-preview-test-'));
    try {
      const transcript = {
        meta: { runId: 'test-run', articlePublishedAt: '2026-09-28T00:00:00Z' },
        columns: {
          renderPostJson: { slides: [{ position: 0 }] }, // minimal but has slides
        },
        debug: null,
      };
      await fsp.writeFile(path.join(tmp, 'transcript.json'), JSON.stringify(transcript), 'utf-8');
      // Pass unreachable server so we short-circuit after the Post loads.
      const r = await renderPreviewFromRunDir(tmp, 'http://127.0.0.1:1');
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.reason, /Dev server not reachable/);
    } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  });

  test('reconstructs Post via adapter when transcript has debug but no renderPostJson', async () => {
    const tmp = await fsp.mkdtemp(path.join(tmpdir(), 'social-v2-preview-test-'));
    try {
      const debug = makeCaptured().debug!;
      const transcript = {
        meta: { runId: 'test-run', articlePublishedAt: '2026-09-28T00:00:00Z' },
        columns: { renderPostJson: null },
        debug,
      };
      await fsp.writeFile(path.join(tmp, 'transcript.json'), JSON.stringify(transcript), 'utf-8');
      const r = await renderPreviewFromRunDir(tmp, 'http://127.0.0.1:1');
      // Should have reconstructed and then failed on server reachability.
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.match(r.reason, /Dev server not reachable/);
        assert.doesNotMatch(r.reason, /No Post JSON/);
      }
    } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  });
});
