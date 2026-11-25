/**
 * Content look-ahead tabs (2026-11-15): Today plus the next two days, the window made-ahead types fill
 * (lib/social-hub/lead.ts). A later day shows only what is made or booked for it, never today's ranking,
 * and a made-ahead post is offered its own day's windows, never today's. Offline, no model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { aheadParam, AHEAD_DAYS } from '@/components/social-hub/content/ContentScreen';
import { nightFor } from '@/components/social-hub/content/TodayStrip';
import { reelPosts } from '@/lib/social-hub/adapters/reels';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';
import { allQuotaCandidates, quotaCandidates, type QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { slotChoices } from '@/lib/social-hub/views/offer';
import { nyDateOf } from '@/lib/social-hub/time';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

const NOW = new Date('2026-10-09T14:00:00Z');
const TODAY = '2026-10-09';
const D2 = '2026-10-11';

const idea = (n: number, score: number): HubIdea => ({
  id: `reels:idea:0000000${n}-0000-4000-8000-000000000000`, vertical: 'reels', title: `Idea ${n}`, score, scoreLabel: 'Net', state: 'idea_only',
  hasContent: false, versionCount: 0, generatedAt: null, createdAt: null, detail: null,
});
const IDEAS = [idea(1, 4), idea(2, 3), idea(3, 2)];

/** A made reel stamped for `nyDate` (a made-ahead reel carries its target date). */
const reelFor = (n: number, nyDate: string, over: Partial<HubPost> = {}): HubPost => {
  const [post] = reelPosts({
    attempts: [], schedules: [], insights: [], ideas: [], sources: [], requireApproval: true,
    made: [{ video_job_id: `1111111${n}-1111-4111-8111-111111111111`, post_idea_id: `0000000${n}-0000-4000-8000-000000000000`, ny_date: nyDate, video_storage_path: 'v.mp4', video_finished_at: '2026-10-09T05:20:00Z', video_slate_id: null, chosen_framework: null, chosen_bucket: null, net: '1', on_screen_copy: `REEL ${n}`, headline: `Reel ${n}` }],
  });
  return { ...post!, ...over };
};

const QUOTAS = { reels: 2, carousels: 1, explainers: 1 };
const shape = (cs: QuotaCandidate[]) => cs.map((c) => [c.post?.name ?? null, c.rank]);

test('today is unchanged: the ranking fills the slots, with or without the day argument', () => {
  const data = { posts: [reelFor(1, TODAY)], ideas: IDEAS, dayQuotas: QUOTAS };
  assert.deepEqual(quotaCandidates(data, 'reels', NOW, TODAY), quotaCandidates(data, 'reels', NOW));
  assert.deepEqual(quotaCandidates(data, 'reels', NOW).map((c) => c.idea?.title), ['Idea 1', 'Idea 2']);
});

test('a later day shows the posts made for it, then open slots, and never today’s ranking', () => {
  const data = { posts: [reelFor(1, TODAY), reelFor(3, D2)], ideas: IDEAS, dayQuotas: QUOTAS };
  const later = quotaCandidates(data, 'reels', NOW, D2);
  assert.deepEqual(shape(later), [['REEL 3', null], [null, null]], 'the reel made for D2, then one open slot; no ranked idea');
  assert.equal(later[0]!.idea?.title, 'Idea 3', 'a made card keeps its idea');
  assert.equal(later[1]!.idea, null, 'an open slot names no idea: its night run picks one');
  assert.ok(!later.some((c) => c.post?.nyDate === TODAY), 'today’s reel stays on today');
});

test('a day earlier than today reads as today (the tabs only go forward)', () => {
  const data = { posts: [reelFor(1, TODAY)], ideas: IDEAS, dayQuotas: QUOTAS };
  assert.deepEqual(quotaCandidates(data, 'reels', NOW, '2026-10-01'), quotaCandidates(data, 'reels', NOW));
});

test('a later day leaves out failed and rejected posts', () => {
  const rejected = reelFor(2, D2, { tries: [{ status: 'cancelled', at: '2026-10-09T08:00:00Z', note: 'This reel was rejected, so it was not posted.' }] });
  const data = { posts: [reelFor(1, D2, { status: 'failed' }), rejected], ideas: IDEAS, dayQuotas: QUOTAS };
  assert.deepEqual(quotaCandidates(data, 'reels', NOW, D2).map((c) => c.post), [null, null]);
});

test('every type takes the day: allQuotaCandidates for a later day holds only that day’s posts', () => {
  const data = { posts: [reelFor(1, TODAY), reelFor(3, D2)], ideas: IDEAS, dayQuotas: QUOTAS };
  const posts = allQuotaCandidates(data, NOW, D2).flatMap((c) => (c.post ? [c.post.nyDate] : []));
  assert.deepEqual(posts, [D2]);
});

test('an open slot names the night that makes it: the day minus the type’s lead days', () => {
  const slot = (vertical: QuotaCandidate['vertical'], seriesId?: string): QuotaCandidate => ({ vertical, idea: null, post: null, locked: false, rank: null, moved: null, ...(seriesId ? { seriesId, series: seriesId } : {}) });
  assert.equal(nightFor(slot('reels'), '2026-11-18'), '2026-11-16', 'Text on Screen: two days ahead');
  assert.equal(nightFor(slot('field_notes'), '2026-11-17'), '2026-11-15');
  assert.equal(nightFor(slot('ai_trivia', 't0510:ai_trivia'), '2026-11-16'), '2026-11-14', 'Are you smarter than AI? is made two days ahead');
  assert.equal(nightFor(slot('stories', 't0480:morning_download'), '2026-11-16'), '2026-11-16', 'Morning Download is made the day of');
  assert.equal(nightFor(slot('last_few_days'), '2026-11-17'), '2026-11-17');
});

test('?ahead= reads 0 to AHEAD_DAYS; anything else is today', () => {
  assert.equal(AHEAD_DAYS, 2);
  assert.deepEqual(['1', '2', '0', undefined, '3', '-1', 'x', '10', '1.5'].map(aheadParam), [1, 2, 0, 0, 0, 0, 0, 0, 0]);
});

test('a made-ahead post is offered its own day’s windows, never today’s (Bald-Eagle D4)', () => {
  const d = previewDataset();
  const ready = d.posts.find((p) => p.vertical === 'carousels' && p.status === 'ready')!;
  const today = nyDateOf(FIXTURE_NOW)!;
  const later = new Date(new Date(`${today}T12:00:00Z`).getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const carouselSlot = (startMinute: number) => ({ vertical: 'carousels' as const, startMinute, series: null, feedMode: null, origin: 'template' as const });
  const withCalendar = { ...d, dayQuotas: { ...d.dayQuotas, slots: { [today]: [carouselSlot(1080)], [later]: [carouselSlot(480)] } } } as typeof d;
  assert.deepEqual(slotChoices(withCalendar, ready, FIXTURE_NOW).map((s) => s.nyDate), [today], 'a post for today: today’s window');
  const ahead = { ...ready, nyDate: later };
  assert.deepEqual(slotChoices(withCalendar, ahead, FIXTURE_NOW).map((s) => [s.nyDate, s.slot]), [[later, 't0480']], 'made for later: that day’s window, even though today’s is still open');
});
