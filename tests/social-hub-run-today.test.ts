/**
 * The day's ranking, quota candidates, Run now's plan and Today's Content
 * (offline, no model calls). Promote makes an idea #1 for the day; Demote
 * moves it below the next idea; the quota goes to the top of that ranking;
 * Run now makes only the candidates with no content; only candidates show.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRankMove } from '@/lib/content-type/idea-rank';
import { reelPosts } from '@/lib/social-hub/adapters/reels';
import { planFrom, typeDay, type RunInputs } from '@/lib/social-hub/run-today';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';
import { applyMoves, dayRanking, quotaCandidates, type IdeaAdjustment } from '@/lib/social-hub/views/day-rank';
import { todaysContent } from '@/lib/social-hub/views/today';

const NOW = new Date('2026-10-09T14:00:00Z');
const TODAY = '2026-10-09';

const idea = (n: number, score: number, over: Partial<HubIdea> = {}): HubIdea => ({
  id: `reels:idea:0000000${n}-0000-4000-8000-000000000000`, vertical: 'reels', title: `Idea ${n}`, score, scoreLabel: 'Net', state: 'idea_only',
  hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null, ...over,
});
const IDEAS = [idea(1, 4), idea(2, 3), idea(3, 2), idea(4, 1)];
const move = (n: number, kind: 'promote' | 'demote', at: string): IdeaAdjustment => ({ vertical: 'reels', ideaId: IDEAS[n - 1]!.id, nyDate: TODAY, kind, createdAt: at });
const titles = (adj: IdeaAdjustment[]) => dayRanking(IDEAS, 'reels', adj, TODAY).map((r) => r.idea.title);

test('Promote makes an idea #1 for the day; Demote moves it below the next one', () => {
  assert.deepEqual(titles([]), ['Idea 1', 'Idea 2', 'Idea 3', 'Idea 4']);
  assert.deepEqual(titles([move(3, 'promote', 't1')]), ['Idea 3', 'Idea 1', 'Idea 2', 'Idea 4']);
  assert.deepEqual(titles([move(1, 'demote', 't1')]), ['Idea 2', 'Idea 1', 'Idea 3', 'Idea 4']);
  assert.deepEqual(titles([move(3, 'promote', 't1'), move(3, 'demote', 't2')]), ['Idea 1', 'Idea 3', 'Idea 2', 'Idea 4'], 'a demoted promoted idea goes from #1 to #2');
  assert.deepEqual(titles([{ ...move(3, 'promote', 't1'), nyDate: '2026-10-08' }]), ['Idea 1', 'Idea 2', 'Idea 3', 'Idea 4'], 'yesterday’s moves are gone');
  assert.deepEqual(applyMoves([{ id: 'a' }, { id: 'b' }], [{ ideaId: 'b', kind: 'demote' }]).map((x) => x.id), ['a', 'b'], 'the last idea stays last');
});

const reelPost = (n: number, over: Partial<HubPost> = {}): HubPost => {
  const [post] = reelPosts({
    attempts: [], schedules: [], insights: [], ideas: [], sources: [], requireApproval: true,
    made: [{ video_job_id: `1111111${n}-1111-4111-8111-111111111111`, post_idea_id: `0000000${n}-0000-4000-8000-000000000000`, ny_date: TODAY, video_storage_path: 'v.mp4', video_finished_at: '2026-10-09T05:20:00Z', video_slate_id: null, chosen_framework: null, chosen_bucket: null, net: '1', on_screen_copy: `REEL ${n}`, headline: `Reel ${n}` }],
  });
  return { ...post!, ...over };
};

test('the quota goes to the top of the day’s ranking, made or not; promoting changes what fills it', () => {
  // Ideas 1 and 4 have videos; the quota is 2.
  const data = { posts: [reelPost(1), reelPost(4)], ideas: IDEAS, dayQuotas: { reels: 2, carousels: 2, explainers: 1 } };
  const plain = quotaCandidates(data, 'reels', NOW);
  assert.deepEqual(plain.map((c) => [c.idea?.title, Boolean(c.post)]), [['Idea 1', true], ['Idea 2', false]], 'Idea 4’s video is not a candidate');
  const promoted = quotaCandidates({ ...data, adjustments: [move(4, 'promote', 't1')] }, 'reels', NOW);
  assert.deepEqual(promoted.map((c) => [c.idea?.title, Boolean(c.post), c.moved]), [['Idea 4', true, 'promoted'], ['Idea 1', true, null]]);
  assert.deepEqual(todaysContent({ ...data, adjustments: [move(4, 'promote', 't1')] }, NOW).map((p) => p.name), ['REEL 4', 'REEL 1'], 'only candidates show in the gallery');
});

test('a slot already scheduled today holds its place ahead of the ranking', () => {
  const scheduled = reelPost(3, { status: 'scheduled', publishAt: '2026-10-09T13:00:00Z' });
  const c = quotaCandidates({ posts: [scheduled, reelPost(1)], ideas: IDEAS, dayQuotas: { reels: 2, carousels: 2, explainers: 1 } }, 'reels', NOW);
  assert.deepEqual(c.map((x) => [x.post?.name ?? x.idea?.title, x.locked]), [['REEL 3', true], ['REEL 1', false]]);
});

test('failed, skipped and empty posts are never content for a candidate', () => {
  const data = { posts: [reelPost(1, { status: 'failed' }), reelPost(2, { media: { kind: 'video', src: null } })], ideas: IDEAS, dayQuotas: { reels: 2, carousels: 2, explainers: 1 } };
  assert.deepEqual(quotaCandidates(data, 'reels', NOW).map((c) => c.post), [null, null]);
  assert.deepEqual(todaysContent(data, NOW), []);
});

const base: RunInputs = {
  today: TODAY,
  reels: { quota: 2, held: 1, missing: [{ ideaId: 'reels:idea:r2', ref: 'r2', title: 'Idea 2' }], slateToday: true },
  carousels: { quota: 2, held: 0, missing: [] },
  explainers: { quota: 1, held: 0, missing: [{ ideaId: 'explainers:topic:t1', ref: 't1', title: 'What is a server?' }] },
  series: [{ id: 'morning_download', label: 'Morning Download', held: false }],
  inFlight: { reelsRun: false, reelsBuilding: [], carouselRun: false, explainerTopics: [] },
  cost: { reelsNight: 2.5, reelBuild: 1, carouselCap: 2, explainerCap: 5, storySet: 0.45 },
};
const step = (plan: ReturnType<typeof planFrom>, v: string) => plan.steps.find((s) => s.vertical === v)!;

test('Run now makes exactly the candidates with no content, each the way its type can', () => {
  const plan = planFrom(base);
  assert.deepEqual([step(plan, 'reels').action, step(plan, 'reels').targets], ['reels_build', ['r2']], 'the missing reel idea is built on today’s slate');
  assert.equal(step(plan, 'carousels').action, 'carousel_run');
  assert.deepEqual(step(plan, 'explainers').targets, ['t1']);
  assert.deepEqual(step(plan, 'stories').targets, ['morning_download']);
  assert.equal(plan.estimateUsd, 1 + 2 + 5 + 0.45);
});

test('Run now leaves a full, already-running or slate-less type to the right path', () => {
  const plan = planFrom({
    ...base,
    reels: { ...base.reels, slateToday: false },
    carousels: { quota: 2, held: 2, missing: [] },
    explainers: { ...base.explainers },
    inFlight: { ...base.inFlight, explainerTopics: ['t1'] },
    series: [{ id: 'morning_download', label: 'Morning Download', held: true }],
  });
  assert.equal(step(plan, 'reels').action, 'reels_run', 'no slate today: the night runs');
  assert.equal(step(plan, 'carousels').action, 'none');
  assert.equal(step(plan, 'explainers').action, 'none', 'its render is already queued');
  assert.equal(step(plan, 'stories').action, 'none');
});

test('a type’s day counts what holds it and names what is missing', () => {
  const data = { posts: [reelPost(1)], ideas: IDEAS, dayQuotas: { reels: 2, carousels: 2, explainers: 1 } };
  const d = typeDay(quotaCandidates(data, 'reels', NOW), 2);
  assert.equal(d.held, 1);
  assert.deepEqual(d.missing.map((m) => m.ref), ['00000002-0000-4000-8000-000000000000']);
});

test('a rank move must name a known type, a kind, and an idea of that type', () => {
  assert.deepEqual(parseRankMove({ vertical: 'reels', ideaId: IDEAS[0]!.id, kind: 'promote' }), { vertical: 'reels', ideaId: IDEAS[0]!.id, kind: 'promote' });
  assert.throws(() => parseRankMove({ vertical: 'reels', ideaId: 'explainers:topic:x', kind: 'promote' }), /Unknown idea/);
  assert.throws(() => parseRankMove({ vertical: 'reels', ideaId: IDEAS[0]!.id, kind: 'boost' }), /promote or demote/);
  assert.ok(parseRankMove({ vertical: 'carousels', ideaId: 'carousels:story:https://www.theverge.com/x', kind: 'demote' }));
});
