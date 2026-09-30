import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test, { describe } from 'node:test';

import { reconstructPost, renderPreview, renderPreviewFromRunDir } from '@/lib/social/editorial/v2/render-preview';
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

  test('reconstructPost rebuilds selectedImages Map from debug.imageStep.selected', () => {
    const brief = parseBrief(BRIEF_RAW);
    const post = parseEditedPost(EDITED_RAW);
    const stageUsage = { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, approxCostUsd: 0 };
    const captured: CapturedRun = {
      result: { ok: false, status: 'needs_human_review', costUsd: 0, stagesRun: [] },
      debug: {
        version: 2, articleId: 'x', startedAt: '', rounds: [], repairs: [],
        reporter: { brief, briefRaw: BRIEF_RAW, stopReasons: [], usage: stageUsage },
        edited: { post, raw: EDITED_RAW, editNotes: null, stopReasons: [], usage: stageUsage },
        caption: { caption: 'x', raw: 'CAPTION:\nx', stopReasons: [], usage: stageUsage },
        outcome: { status: 'needs_human_review', totalCostUsd: 0 },
        imageStep: {
          selected: [{
            slide: 'cover',
            wikidataId: 'Q16847797',
            subject: 'Mustafa Suleyman',
            label: 'Mustafa Suleyman',
            commonsFile: 'File:Mustafa Suleyman.jpg',
            storageUrl: 'https://commons.example/Mustafa.jpg',
            license: 'CC BY 2.0',
            licenseUrl: null,
            author: 'Joi Ito',
            credit: 'Joi Ito. Via Wikimedia Commons.',
            isPortrait: true,
            source: 'wikimedia',
          }],
        },
      },
      composeStatus: 'needs_human_review', composeError: null, renderPostJson: null, renderSlug: null, reporterOutput: null, fetchedSources: [],
    };
    const p = reconstructPost(captured) as { slides?: Array<{ photoUrl?: string; photoCredit?: string }> };
    assert.ok(p?.slides && p.slides.length > 0, 'expected reconstructed Post with slides');
    // Cover is slides[0]. The Suleyman photo must be attached.
    assert.equal(p!.slides![0]!.photoUrl, 'https://commons.example/Mustafa.jpg');
    assert.match(p!.slides![0]!.photoCredit ?? '', /Joi Ito/);
  });

  test('renderPreview refuses when image step placed photos but reconstructed Post has none', async () => {
    const brief = parseBrief(BRIEF_RAW);
    const post = parseEditedPost(EDITED_RAW);
    const stageUsage = { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, approxCostUsd: 0 };
    // Simulate a run with the OLD debug shape (no storageUrl/credit) — the
    // photo cannot be rehydrated, so no slide gets photoUrl, and the guard
    // must fire.
    const captured: CapturedRun = {
      result: { ok: false, status: 'needs_human_review', costUsd: 0, stagesRun: [] },
      debug: {
        version: 2, articleId: 'x', startedAt: '', rounds: [], repairs: [],
        reporter: { brief, briefRaw: BRIEF_RAW, stopReasons: [], usage: stageUsage },
        edited: { post, raw: EDITED_RAW, editNotes: null, stopReasons: [], usage: stageUsage },
        caption: { caption: 'x', raw: 'CAPTION:\nx', stopReasons: [], usage: stageUsage },
        outcome: { status: 'needs_human_review', totalCostUsd: 0 },
        // Old-shape entry: no storageUrl / credit. Simulates a
        // pre-2026-09-29 transcript.
        imageStep: { selected: [{ slide: 'cover' } as never] },
      },
      composeStatus: 'needs_human_review', composeError: null, renderPostJson: null, renderSlug: null, reporterOutput: null, fetchedSources: [],
    };
    const tmp = await fsp.mkdtemp(path.join(tmpdir(), 'social-v2-preview-test-'));
    try {
      const r = await renderPreview({
        post: null,
        captured,
        runId: 'test-run',
        outDir: path.join(tmp, 'preview'),
        server: 'http://127.0.0.1:1',
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.reason, /Image step placed 1 photo\(s\)/);
    } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  });

  test('reconstructPost prefers debug.finalPost over rounds[last].post over edited.post', () => {
    // A captured run whose initial editor pass, last round, and finalPost
    // all carry a different cover TEXT so we can tell which one won.
    const editedRaw = `COVER: EDITED PASS COVER
COVER HIGHLIGHT: EDITED
COVER IMAGE: type only

SLIDE 2
BODY: Edited body.
HIGHLIGHT: Edited
IMAGE: type only

FOLLOW: Follow Helios.

EDIT NOTES:
None`;
    const roundRaw = `COVER: ROUND LAST COVER
COVER HIGHLIGHT: ROUND
COVER IMAGE: type only

SLIDE 2
BODY: Round body.
HIGHLIGHT: Round
IMAGE: type only

FOLLOW: Follow Helios.

EDIT NOTES:
None`;
    const finalRaw = `COVER: FINAL POST COVER
COVER HIGHLIGHT: FINAL
COVER IMAGE: type only

SLIDE 2
BODY: Final body.
HIGHLIGHT: Final
IMAGE: type only

FOLLOW: Follow Helios.

EDIT NOTES:
None`;
    const brief = parseBrief(BRIEF_RAW);
    const editedPost = parseEditedPost(editedRaw);
    const roundPost = parseEditedPost(roundRaw);
    const finalPost = parseEditedPost(finalRaw);
    const stageUsage = { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, approxCostUsd: 0 };

    const captured = (finalPostOverride: typeof finalPost | undefined, roundPostOverride: typeof roundPost | undefined): CapturedRun => ({
      result: { ok: false, status: 'needs_human_review', costUsd: 0, stagesRun: [] },
      debug: {
        version: 2, articleId: 'x', startedAt: '', rounds: roundPostOverride ? [{ round: 1, post: roundPostOverride, caption: 'r', factCheck: { verdict: 'PASS', flags: [] }, factCheckRaw: '', stopReasons: [], usage: stageUsage }] : [],
        repairs: [], reporter: { brief, briefRaw: BRIEF_RAW, stopReasons: [], usage: stageUsage },
        edited: { post: editedPost, raw: editedRaw, editNotes: null, stopReasons: [], usage: stageUsage },
        caption: { caption: 'x', raw: 'CAPTION:\nx', stopReasons: [], usage: stageUsage },
        outcome: { status: 'needs_human_review', totalCostUsd: 0 },
        finalPost: finalPostOverride,
      },
      composeStatus: 'needs_human_review', composeError: null, renderPostJson: null, renderSlug: null, reporterOutput: null, fetchedSources: [],
    });

    // 1. finalPost present → wins over roundPost and editedPost.
    const p1 = reconstructPost(captured(finalPost, roundPost)) as { cover?: { headline?: unknown } };
    // adaptToPost places cover in slides[0]; look at the returned shape's slides[0].headline runs
    const slides1 = (p1 as { slides?: Array<{ headline?: Array<{ text: string }> }> }).slides ?? [];
    const cover1Text = (slides1[0]?.headline ?? []).map((s) => s.text).join('');
    assert.match(cover1Text, /FINAL POST COVER/);

    // 2. no finalPost, rounds present → rounds[last].post wins.
    const p2 = reconstructPost(captured(undefined, roundPost));
    const slides2 = (p2 as { slides?: Array<{ headline?: Array<{ text: string }> }> }).slides ?? [];
    const cover2Text = (slides2[0]?.headline ?? []).map((s) => s.text).join('');
    assert.match(cover2Text, /ROUND LAST COVER/);

    // 3. neither finalPost nor rounds → falls back to edited.post.
    const p3 = reconstructPost(captured(undefined, undefined));
    const slides3 = (p3 as { slides?: Array<{ headline?: Array<{ text: string }> }> }).slides ?? [];
    const cover3Text = (slides3[0]?.headline ?? []).map((s) => s.text).join('');
    assert.match(cover3Text, /EDITED PASS COVER/);
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
