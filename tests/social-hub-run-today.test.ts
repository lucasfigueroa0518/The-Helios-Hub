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
import { narrowStep, parseRunBody, planFrom, stepsFor, typeDay, type RunInputs } from '@/lib/social-hub/run-today';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';
import { applyMoves, dayRanking, madeMoveIds, orderCards, quotaCandidates, type IdeaAdjustment } from '@/lib/social-hub/views/day-rank';
import { todaysContent } from '@/lib/social-hub/views/today';

const NOW = new Date('2026-10-09T14:00:00Z');
const TODAY = '2026-10-09';

const idea = (n: number, score: number, over: Partial<HubIdea> = {}): HubIdea => ({
  id: `reels:idea:0000000${n}-0000-4000-8000-000000000000`, vertical: 'reels', title: `Idea ${n}`, score, scoreLabel: 'Net', state: 'idea_only',
  hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null, ...over,
});
const IDEAS = [idea(1, 4), idea(2, 3), idea(3, 2), idea(4, 1)];
const move = (n: number, kind: 'promote' | 'demote', at: string): IdeaAdjustment => ({ id: `m-${n}-${kind}-${at}`, vertical: 'reels', ideaId: IDEAS[n - 1]!.id, nyDate: TODAY, kind, createdAt: at });
const titles = (adj: IdeaAdjustment[]) => dayRanking(IDEAS, 'reels', adj).map((r) => r.idea.title);

test('Promote makes an idea #1 for the day; Demote moves it below the next one', () => {
  assert.deepEqual(titles([]), ['Idea 1', 'Idea 2', 'Idea 3', 'Idea 4']);
  assert.deepEqual(titles([move(3, 'promote', 't1')]), ['Idea 3', 'Idea 1', 'Idea 2', 'Idea 4']);
  assert.deepEqual(titles([move(1, 'demote', 't1')]), ['Idea 2', 'Idea 1', 'Idea 3', 'Idea 4']);
  assert.deepEqual(titles([move(3, 'promote', 't1'), move(3, 'demote', 't2')]), ['Idea 1', 'Idea 3', 'Idea 2', 'Idea 4'], 'a demoted promoted idea goes from #1 to #2');
  assert.deepEqual(titles([{ ...move(3, 'promote', 't1'), nyDate: '2026-10-08' }]), ['Idea 3', 'Idea 1', 'Idea 2', 'Idea 4'], 'a move from yesterday still steers until its idea is made (B8)');
  assert.deepEqual(applyMoves([{ id: 'a' }, { id: 'b' }], [{ ideaId: 'b', kind: 'demote' }]).map((x) => x.id), ['a', 'b'], 'the last idea stays last');
});

const reelPost = (n: number, over: Partial<HubPost> = {}): HubPost => {
  const [post] = reelPosts({
    attempts: [], schedules: [], insights: [], ideas: [], sources: [], requireApproval: true,
    made: [{ video_job_id: `1111111${n}-1111-4111-8111-111111111111`, post_idea_id: `0000000${n}-0000-4000-8000-000000000000`, ny_date: TODAY, video_storage_path: 'v.mp4', video_finished_at: '2026-10-09T05:20:00Z', video_slate_id: null, chosen_framework: null, chosen_bucket: null, net: '1', on_screen_copy: `REEL ${n}`, headline: `Reel ${n}` }],
  });
  return { ...post!, ...over };
};

test('a move is used up when its idea gets content made after it; content made before it, or still being made, keeps it (B8)', () => {
  const m = move(1, 'promote', '2026-10-09T06:00:00.000Z');
  const madeAfter = reelPost(1, { generatedAt: '2026-10-09T07:00:00Z' });
  assert.deepEqual(madeMoveIds([m], [madeAfter]), [m.id]);
  assert.deepEqual(madeMoveIds([m], [reelPost(1, { generatedAt: '2026-10-09T05:00:00Z' })]), [], 'Review Focus 4: content made before the move keeps it');
  assert.deepEqual(madeMoveIds([m], [reelPost(1, { status: 'generating', generatedAt: '2026-10-09T07:00:00Z' })]), [], 'still being made');
  assert.deepEqual(madeMoveIds([m], [reelPost(2, { generatedAt: '2026-10-09T07:00:00Z' })]), [], 'another idea');
  const rejected = reelPost(1, { generatedAt: '2026-10-09T07:00:00Z', tries: [{ status: 'cancelled', at: '2026-10-09T08:00:00Z', note: 'This reel was rejected, so it was not posted.' }] });
  assert.deepEqual(madeMoveIds([m], [rejected]), [m.id], 'made, then rejected: used up');
  assert.deepEqual(madeMoveIds([{ ...m, vertical: 'stories', ideaId: 'stories:pool:free_vs_paid:k' }], [madeAfter]), [], 'Stories go by their pool entry');
});

test('made content fills the day ahead of the ranking; Promote only reorders what is not made yet', () => {
  // Ideas 1 and 4 have videos made today; the quota is 2.
  const data = { posts: [reelPost(1), reelPost(4)], ideas: IDEAS, dayQuotas: { reels: 2, carousels: 2, explainers: 1 } };
  const plain = quotaCandidates(data, 'reels', NOW);
  assert.deepEqual(plain.map((c) => [c.idea?.title, Boolean(c.post)]).sort(), [['Idea 1', true], ['Idea 4', true]], 'both made reels fill the day');
  const one = { ...data, posts: [reelPost(4)], dayQuotas: { reels: 2, carousels: 2, explainers: 1 } };
  const promoted = quotaCandidates({ ...one, adjustments: [move(3, 'promote', 't1')] }, 'reels', NOW);
  assert.deepEqual(promoted.map((c) => [c.idea?.title, Boolean(c.post)]), [['Idea 4', true], ['Idea 3', false]], 'the made reel holds; the promoted idea takes the open card');
  assert.deepEqual(todaysContent(data, NOW).map((p) => p.name).sort(), ['REEL 1', 'REEL 4']);
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
  // Google News story ids are 500-character URLs.
  assert.ok(parseRankMove({ vertical: 'carousels', ideaId: `carousels:story:https://news.google.com/rss/articles/${'A'.repeat(480)}`, kind: 'promote' }));
});

// ── Explainers: what the night made today holds the day's place (2026-10-13) ──
// The nightly cycle picks its own topic, not the page's top-ranked one. On Oct 13 it rendered
// "What is a webhook?" while the page ranked "What is a database index?" first, so the Content
// page said "Not made yet" and Run now offered to render (and pay for) a second explainer.

const exIdea = (id: string, title: string, score: number, over: Partial<HubIdea> = {}): HubIdea => ({
  id: `explainers:topic:${id}`, vertical: 'explainers', title, score, scoreLabel: 'Score', state: 'idea_only',
  hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null, ...over,
});
const EX_IDEAS = [exIdea('t1', 'What is a database index?', 5), exIdea('t2', 'What is a webhook?', 4, { state: 'content_ready', hasContent: true })];
const exPost = (topic: string, over: Partial<HubPost> = {}): HubPost => ({
  ...reelPost(1),
  id: `explainers:job-${topic}`, vertical: 'explainers', format: 'reel', status: 'ready', nyDate: null, slot: null, publishAt: null,
  media: { kind: 'video', src: 'v.mp4' }, idea: { id: topic, label: topic }, generatedAt: '2026-10-09T06:14:00Z', refs: { jobId: topic },
  ...over,
});
const exQuotas = { reels: 2, carousels: 1, explainers: 1 };

test('explainers: a render the night made today, for a topic the page ranks lower, fills today\'s slot', () => {
  const c = quotaCandidates({ posts: [exPost('t2')], ideas: EX_IDEAS, dayQuotas: exQuotas }, 'explainers', NOW);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.post?.id, 'explainers:job-t2');
  assert.equal(c[0]!.idea?.title, 'What is a webhook?');
  assert.equal(c[0]!.locked, false);
});

test('explainers: Run now does not render again when the night already made today\'s explainer', () => {
  const day = typeDay(quotaCandidates({ posts: [exPost('t2')], ideas: EX_IDEAS, dayQuotas: exQuotas }, 'explainers', NOW), 1);
  assert.equal(day.held, 1);
  assert.deepEqual(day.missing, []);
});

test('explainers: yesterday\'s render, a rejected one and one with nothing to show do not hold today', () => {
  for (const post of [
    exPost('t2', { generatedAt: '2026-10-08T06:14:00Z' }),
    exPost('t2', { status: 'cancelled' }),
    exPost('t2', { media: { kind: 'none', note: 'x' } as HubPost['media'] }),
  ]) {
    const c = quotaCandidates({ posts: [post], ideas: EX_IDEAS, dayQuotas: exQuotas }, 'explainers', NOW);
    assert.equal(c[0]!.post, null);
    assert.equal(c[0]!.idea?.title, 'What is a database index?', 'the top-ranked idea fills it as before');
  }
});

test('explainers: a slot already scheduled today still comes first', () => {
  const scheduled = exPost('t1', { status: 'scheduled', publishAt: '2026-10-09T18:00:00Z', nyDate: TODAY });
  const c = quotaCandidates({ posts: [exPost('t2'), scheduled], ideas: EX_IDEAS, dayQuotas: exQuotas }, 'explainers', NOW);
  assert.deepEqual(c.map((x) => [x.post?.id, x.locked]), [['explainers:job-t1', true]], 'quota 1: the scheduled one holds it');
});

test('every type: a reel made today for a lower-ranked idea fills the day (2026-10-13)', () => {
  const data = { posts: [reelPost(4)], ideas: IDEAS, dayQuotas: { reels: 1, carousels: 1, explainers: 1 } };
  const c = quotaCandidates(data, 'reels', NOW);
  assert.deepEqual(c.map((x) => [x.idea?.title, Boolean(x.post)]), [['Idea 4', true]]);
});

test('two versions of one idea made today show once, the newest (Review Focus 1)', () => {
  const older = reelPost(4, { generatedAt: '2026-10-09T05:00:00Z' });
  const newer = reelPost(4, { id: 'reels:video:newer', generatedAt: '2026-10-09T07:00:00Z' });
  const c = quotaCandidates({ posts: [older, newer], ideas: IDEAS, dayQuotas: { reels: 2, carousels: 1, explainers: 1 } }, 'reels', NOW);
  assert.deepEqual(c.map((x) => x.post?.id ?? x.idea?.title), ['reels:video:newer', 'Idea 1']);
});

test('more made than slots: only the quota shows (Review Focus 2)', () => {
  const posts = [reelPost(1), reelPost(2), reelPost(3)];
  const c = quotaCandidates({ posts, ideas: IDEAS, dayQuotas: { reels: 2, carousels: 1, explainers: 1 } }, 'reels', NOW);
  assert.equal(c.length, 2);
  assert.ok(c.every((x) => x.post));
});

test('a rejected post never fills a card; its slot falls back to the ranking', () => {
  const rejected = reelPost(4, { tries: [{ status: 'cancelled', at: '2026-10-09T06:00:00Z', note: 'This reel was rejected, so it was not posted.' }] });
  const c = quotaCandidates({ posts: [rejected], ideas: IDEAS, dayQuotas: { reels: 1, carousels: 1, explainers: 1 } }, 'reels', NOW);
  assert.deepEqual(c.map((x) => [x.idea?.title, Boolean(x.post)]), [['Idea 1', false]]);
});

test('cards read as the day: booked by time, then made with no slot, then being made, then not made yet', () => {
  const at = (iso: string) => reelPost(1, { id: `p-${iso}`, status: 'scheduled', publishAt: iso, nyDate: TODAY });
  const cards = [
    { vertical: 'reels' as const, idea: null, post: null, locked: false, rank: 1, moved: null },
    { vertical: 'reels' as const, idea: null, post: reelPost(2, { status: 'generating' }), locked: false, rank: null, moved: null },
    { vertical: 'reels' as const, idea: null, post: reelPost(3), locked: false, rank: null, moved: null },
    { vertical: 'reels' as const, idea: null, post: at('2026-10-09T22:00:00Z'), locked: true, rank: null, moved: null },
    { vertical: 'reels' as const, idea: null, post: at('2026-10-09T13:00:00Z'), locked: true, rank: null, moved: null },
  ];
  assert.deepEqual(orderCards(cards).map((c) => c.post?.id ?? 'not made'), ['p-2026-10-09T13:00:00Z', 'p-2026-10-09T22:00:00Z', cards[2]!.post!.id, cards[1]!.post!.id, 'not made']);
});

test('Make it runs only its card: one target, its share of the estimate', () => {
  const plan = planFrom({ ...base, explainers: { quota: 2, held: 0, missing: [{ ideaId: 'explainers:topic:t1', ref: 't1', title: 'A' }, { ideaId: 'explainers:topic:t2', ref: 't2', title: 'B' }] } });
  const [one] = stepsFor(plan, 'explainers', 't2');
  assert.deepEqual([one!.action, one!.targets, one!.estimateUsd], ['explainer_renders', ['t2'], 5]);
});

test('Make it on a card made meanwhile starts nothing and spends nothing (Review Focus 4)', () => {
  const plan = planFrom(base);
  const [step] = stepsFor(plan, 'explainers', 'already-made-topic');
  assert.deepEqual([step!.action, step!.estimateUsd, step!.targets], ['none', 0, []]);
  const [stories] = stepsFor(planFrom({ ...base, series: [{ id: 'morning_download', label: 'Morning Download', held: true }] }), 'stories', 'morning_download');
  assert.equal(stories!.action, 'none');
});

test('a step that cannot be split (no reels slate yet) runs whole, and says so', () => {
  const plan = planFrom({ ...base, reels: { ...base.reels, slateToday: false } });
  const [step] = stepsFor(plan, 'reels', 'r2');
  assert.equal(step!.action, 'reels_run');
  assert.equal(step!.estimateUsd, base.cost.reelsNight);
});

test('a carousel run for one story keeps its run cap as the estimate', () => {
  const plan = planFrom({ ...base, carousels: { quota: 2, held: 0, missing: [{ ideaId: 'carousels:story:s1', ref: 's1', title: 'S1' }, { ideaId: 'carousels:story:s2', ref: 's2', title: 'S2' }] } });
  const [step] = stepsFor(plan, 'carousels', 's2');
  assert.deepEqual([step!.targets, step!.estimateUsd], [['s2'], base.cost.carouselCap]);
});

test('the run body: no body is Run now, a type is its button, a card needs a type and a usable id', () => {
  assert.deepEqual(parseRunBody(null), {});
  assert.deepEqual(parseRunBody({ only: 'carousels' }), { only: 'carousels' });
  assert.deepEqual(parseRunBody({ only: 'explainers', target: 't2' }), { only: 'explainers', target: 't2' });
  for (const bad of [{ target: 't2' }, { only: 'reels', target: '' }, { only: 'reels', target: 5 }, { only: 'reels', target: 'x'.repeat(2049) }, { only: 'nope' }, { only: 'nope', target: 't' }]) {
    assert.ok('error' in parseRunBody(bad), JSON.stringify(bad));
  }
  assert.deepEqual(parseRunBody({ only: 'reels', target: 'x'.repeat(2048) }), { only: 'reels', target: 'x'.repeat(2048) });
});
