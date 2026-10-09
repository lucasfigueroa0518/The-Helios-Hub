/**
 * Run now's plan and Today's Content (offline, no model calls): only the
 * types whose quota isn't held get a run; Today's Content shows made reels
 * that hold no slot yet, and never failed, skipped or empty posts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { reelPosts } from '@/lib/social-hub/adapters/reels';
import { planFrom, seriesDue, type RunInputs } from '@/lib/social-hub/run-today';
import type { HubPost } from '@/lib/social-hub/types';
import { todaysContent } from '@/lib/social-hub/views/today';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

const base: RunInputs = {
  today: '2026-10-09',
  quota: { reels: 2, carousels: 2, explainers: 1 },
  held: { reels: 0, carousels: 0, explainers: 0, stories: 0 },
  inFlight: { reels: false, carousels: false, explainers: 0 },
  topics: ['t1', 't2', 't3'],
  series: [
    { id: 'morning_download', label: 'Morning Download', due: true, held: false },
    { id: 'guess_the_number', label: 'Guess the Number', due: false, held: false },
  ],
  cost: { reelsNight: 2.5, carouselCap: 2, explainerCap: 5, storySet: 0.45 },
};

const step = (plan: ReturnType<typeof planFrom>, v: string) => plan.steps.find((s) => s.vertical === v)!;

test('Run now runs every type whose quota is empty, with a spend ceiling', () => {
  const plan = planFrom(base);
  assert.equal(step(plan, 'reels').action, 'reels_run');
  assert.equal(step(plan, 'carousels').action, 'carousel_run');
  assert.deepEqual(step(plan, 'explainers').targets, ['t1'], 'one render for a quota of one, best topic first');
  assert.deepEqual(step(plan, 'stories').targets, ['morning_download'], 'only the series due today');
  assert.equal(plan.estimateUsd, 2.5 + 2 + 5 + 0.45);
  assert.equal(plan.anything, true);
});

test('a type whose quota is already held, or already running, is left alone', () => {
  const plan = planFrom({
    ...base,
    held: { reels: 2, carousels: 1, explainers: 0, stories: 0 },
    inFlight: { reels: false, carousels: true, explainers: 1 },
    series: base.series.map((s) => ({ ...s, held: s.due })),
  });
  assert.equal(step(plan, 'reels').action, 'none', 'two reels made for a quota of two');
  assert.equal(step(plan, 'carousels').action, 'none', 'a carousel run is already queued');
  assert.equal(step(plan, 'explainers').action, 'none', 'a render in flight holds the slot');
  assert.equal(step(plan, 'stories').action, 'none');
  assert.equal(plan.anything, false);
  assert.equal(plan.estimateUsd, 0);
});

test('a partly held quota asks only for the rest', () => {
  const plan = planFrom({ ...base, quota: { ...base.quota, explainers: 2 }, held: { ...base.held, explainers: 1 } });
  assert.deepEqual(step(plan, 'explainers').targets, ['t1']);
  assert.equal(step(plan, 'explainers').needed, 1);
});

test('series are due on their own weekdays', () => {
  // 2026-10-09 is a Friday (5).
  const due = seriesDue('2026-10-09', [
    { id: 'morning_download', label: 'MD', enabled: true, days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'guess_the_number', label: 'GtN', enabled: true, days: [1, 4] },
    { id: 'free_vs_paid', label: 'FvP', enabled: false, days: [5] },
  ], new Set(['morning_download']));
  assert.deepEqual(due.map((d) => [d.id, d.due, d.held]), [['morning_download', true, true], ['guess_the_number', false, false], ['free_vs_paid', false, false]]);
});

const MADE_ROW = { video_job_id: '11111111-1111-4111-8111-111111111111', post_idea_id: '22222222-2222-4222-8222-222222222222', ny_date: '2026-10-08', video_storage_path: 'videos/x.mp4', video_finished_at: '2026-10-08T05:20:00Z', video_slate_id: null, chosen_framework: 'curiosity', chosen_bucket: 'the_number', net: '3.1', on_screen_copy: 'BIG NEWS', headline: 'Big news' };
const madeReel = () => reelPosts({ attempts: [], schedules: [], insights: [], ideas: [], sources: [], requireApproval: true, made: [MADE_ROW] })[0]!;

test('a made reel with no slot is a ready post on its day, with Approve refs', () => {
  const post = madeReel();
  assert.equal(post.status, 'ready');
  assert.equal(post.nyDate, '2026-10-08');
  assert.equal(post.publishAt, null);
  assert.equal(post.media.kind === 'video' && Boolean(post.media.src), true);
  assert.deepEqual(post.refs, { postIdeaId: MADE_ROW.post_idea_id, videoJobId: MADE_ROW.video_job_id });
  assert.equal(post.id, `reels:${MADE_ROW.video_job_id}`, 'the video’s durable id, kept once it is scheduled');
});

test('Today’s Content: a made reel with no slot is in it; failed, skipped and empty posts never are', () => {
  const reel = madeReel();
  const failed: HubPost = { ...reel, id: 'reels:failed', status: 'failed' };
  const skipped: HubPost = { ...reel, id: 'stories:skipped', vertical: 'stories', status: 'skipped', media: { kind: 'frames', frames: [] } };
  const empty: HubPost = { ...reel, id: 'carousels:empty', vertical: 'carousels', media: { kind: 'slides', slides: [] } };
  const gallery = todaysContent([reel, failed, skipped, empty], FIXTURE_NOW);
  assert.deepEqual(gallery.map((p) => p.id), [reel.id]);
});

test('Today’s Content never shows more of a type than its windows today', () => {
  const dataset = previewDataset();
  const gallery = todaysContent(dataset.posts, FIXTURE_NOW);
  assert.ok(gallery.length > 0);
  for (const p of gallery) assert.ok(!['failed', 'skipped', 'cancelled'].includes(p.status), `${p.id} is ${p.status}`);
  assert.ok(gallery.filter((p) => p.vertical === 'reels').length <= 3);
});
