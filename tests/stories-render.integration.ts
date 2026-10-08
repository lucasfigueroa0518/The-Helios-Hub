/**
 * Stories M2 acceptance: a fixture set of each series renders to JPEGs under
 * 8 MB through the real renderer (headless Chromium), is reviewed by a
 * stubbed Haiku, uploaded to stubbed storage and saved on PGlite.
 * No live model, no network beyond the local renderer.
 *
 *   npm run test:stories:render
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { openLocalStoriesDb } from '@/lib/stories/local-db';
import { runRenderStage, wordsOf } from '@/lib/stories/render-stage';
import { FREE_VS_PAID, GUESS_THE_NUMBER, MORNING_DOWNLOAD } from '@/lib/stories/render/fixtures/m1';
import { openRenderer, type Renderer } from '@/lib/stories/render/render';
import type { FrameFlag, ReviewCall } from '@/lib/stories/render/review';
import { MAX_JPEG_BYTES, SERIES_STYLE, type FrameData, type Series } from '@/lib/stories/render/types';
import { claimNextRequested, getSet, requestSet, saveBuild } from '@/lib/stories/repository';
import type { StoriesStorage } from '@/lib/stories/storage';

let renderer: Renderer;
before(async () => {
  renderer = await openRenderer();
});
after(async () => {
  await renderer?.close();
});

const usage = { model: 'claude-haiku-5-5', inputTokens: 1800, outputTokens: 220, cacheReadTokens: 0, cacheWriteTokens: 1100, usd: 0.0004 };

function storage() {
  const uploads = new Map<string, Buffer>();
  const s: StoriesStorage = { upload: async (p, b) => { uploads.set(p, b); }, sign: async (p) => `https://signed/${p}`, download: async (p) => uploads.get(p)!, remove: async () => {} };
  return { s, uploads };
}

async function stage(series: Series, data: FrameData[], answers: FrameFlag[][]) {
  const { db } = await openLocalStoriesDb();
  const { set } = await requestSet(db, { series, nyDate: '2026-10-10', trigger: 'click', style: SERIES_STYLE[series] });
  await claimNextRequested(db);
  await saveBuild(db, set.id, { payload: { fixture: series }, frames: data.map((copy, i) => ({ seq: i + 1, role: copy.role, backdrop: 'black' as const, copy })), candidates: [] });
  let n = 0;
  const review: ReviewCall = async () => ({ flags: answers[n++] ?? [], usage });
  const { s, uploads } = storage();
  const result = await runRenderStage({ db, storage: s, renderer, review, setId: set.id });
  return { db, setId: set.id, result, uploads, calls: () => n };
}

async function assertJpegs(uploads: Map<string, Buffer>, count: number) {
  const sharp = (await import('sharp')).default;
  assert.equal(uploads.size, count);
  for (const [p, buf] of uploads) {
    assert.ok(buf.length < MAX_JPEG_BYTES, `${p} under 8 MB`);
    const meta = await sharp(buf).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1920);
    assert.equal(meta.space, 'srgb');
  }
}

test('Morning Download (polished): renders, passes review, saved ready', async () => {
  const { db, setId, result, uploads, calls } = await stage('morning_download', MORNING_DOWNLOAD, [[]]);
  await assertJpegs(uploads, 5);
  assert.equal(calls(), 1);
  assert.equal(result.flagged, false);
  const got = await getSet(db, setId);
  assert.equal(got!.set.status, 'ready');
  assert.equal(got!.set.spend_usd, 0.0004);
  for (const f of got!.frames) {
    assert.match(f.storage_path!, new RegExp(`^sets/${setId}/0\\d-${f.role}\\.jpg$`));
    assert.deepEqual(f.review!.problems, []);
  }
});

test('Guess the Number (homemade): a review change re-renders; the words never move', async () => {
  const flag: FrameFlag = { frame: 2, hard_to_read: true, clipped: false, bad_photo: false, logo_broken: false, out_of_place: false, broken: false, change: 'backdrop', backdrop: 'green', family: null, crop_x: null, crop_y: null, reason: 'stub' };
  const { db, setId, result, uploads, calls } = await stage('guess_the_number', GUESS_THE_NUMBER.photo, [[flag], []]);
  await assertJpegs(uploads, 3);
  assert.equal(calls(), 2);
  assert.equal(result.flagged, false);
  const got = await getSet(db, setId);
  assert.equal(got!.frames[1]!.backdrop, 'green');
  assert.equal(got!.frames[1]!.review!.change, 'backdrop → green');
  got!.frames.forEach((f, i) => assert.equal(wordsOf(f.copy), wordsOf(GUESS_THE_NUMBER.photo[i]!)));
  assert.equal(got!.set.spend_usd, 0.0008);
});

test('Free vs. Paid (homemade): a frame still failing after its fix goes to Lucas flagged', async () => {
  const f2 = (patch: Partial<FrameFlag>): FrameFlag => ({ frame: 2, hard_to_read: false, clipped: true, bad_photo: false, logo_broken: false, out_of_place: false, broken: false, change: 'backdrop', backdrop: 'white', family: null, crop_x: null, crop_y: null, reason: 'stub', ...patch });
  const { db, setId, result, uploads } = await stage('free_vs_paid', FREE_VS_PAID, [[f2({})], [f2({ change: 'none', backdrop: null })]]);
  await assertJpegs(uploads, 3);
  assert.equal(result.flagged, true);
  const got = await getSet(db, setId);
  assert.equal(got!.set.status, 'ready');
  assert.equal(got!.set.flagged, true);
  assert.equal(got!.frames[1]!.flagged, true);
  assert.equal(got!.frames[0]!.flagged, false);
});
