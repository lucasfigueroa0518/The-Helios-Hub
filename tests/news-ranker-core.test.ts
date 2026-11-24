/**
 * News Ranker core (planning/MD-LFD Revisions/CONTRACT.md): gate parsing, the
 * repeat rule, the mix, and CURRENT_VARIANT parity with Morning Download's lead
 * queue. Offline: stub Jev (lib/social/jev/stub.ts), no DB, no live calls.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NEWS_GATE, NEWS_MASSIVE_DEVELOPMENT } from '@/lib/news-ranker/questions';
import { askGate, CURRENT_VARIANT, currentDeps, mixScore, parseGate, rank } from '@/lib/news-ranker/rank';
import { repeatVerdict } from '@/lib/news-ranker/memory';
import { MASSIVE_BAR } from '@/lib/news-ranker/scores';
import type { RankerStory, SaidRecord } from '@/lib/news-ranker/types';
import { createStubJev, stubKey } from '@/lib/social/jev/stub';
import { leadQueue } from '@/lib/stories/build/morning-download';

const now = new Date('2026-11-22T12:00:00Z');
const story = (id: string, major: number | null, builder: number | null, eventDate: Date | null = now): RankerStory => ({
  storyId: id, key: `k-${id}`, memberKeys: [`k-${id}`, `m-${id}`], headline: `Headline ${id}`, summary: '', text: 'body',
  eventDate, firstSeen: now, outlets: [], stored: { major, builder },
});

test('parseGate: fails only below the bar; a missing answer passes', () => {
  assert.equal(parseGate({ is_news: { noul: 0.1 } }).pass, false);
  assert.equal(parseGate({ is_news: { noul: 0.3 } }).pass, true);
  assert.equal(parseGate({ is_news: { noul: 0.9 } }).pass, true);
  assert.equal(parseGate({}).pass, true);
  assert.equal(parseGate(undefined).pass, true);
});

test('askGate asks news-gate@1 and parses it', async () => {
  const jev = createStubJev({ [stubKey(NEWS_GATE.version, 'a')]: { is_news: 0.05 } });
  const r = await askGate(jev, story('a', null, null));
  assert.equal(r.gate.pass, false);
});

test('mixScore: w·cool + (1−w)·need, nulls count 0', () => {
  assert.equal(mixScore({ cool: 1, needToKnow: 0 }, 0.25), 0.25);
  assert.equal(mixScore({ cool: 0.4, needToKnow: 0.8 }, 0.5), 0.6000000000000001);
  assert.equal(mixScore({ cool: null, needToKnow: 0.5 }, 1), 0);
});

test('rank drops gate failures and orders by mix', async () => {
  const scores: Record<string, [number, number, boolean]> = { a: [0.9, 0.1, true], b: [0.2, 0.9, true], c: [1, 1, false] };
  const out = await rank([story('a', 0, 0), story('b', 0, 0), story('c', 0, 0)], { id: 'v', label: 'v', mix: { cool: 0.75 }, finalOrder: null }, {
    now,
    score: async (s) => ({ cool: scores[s.storyId]![0], needToKnow: scores[s.storyId]![1], gate: { pass: scores[s.storyId]![2], reason: '' }, detail: {}, costUsd: 0 }),
  });
  assert.deepEqual(out.map((s) => [s.storyId, s.position]), [['a', 1], ['b', 2]]);
});

const said = (over: Partial<SaidRecord> = {}): SaidRecord[] => [{ format: 'md', storyId: 'a', key: 'k-a', headline: 'We said this', postedAt: new Date('2026-11-20T12:00:00Z'), ...over }];
const article = { headline: 'h', source: 's', body: 'b', firstSeenAt: now };

test('repeatVerdict: not run → allowed with no call', async () => {
  const v = await repeatVerdict(story('z', 0, 0), said(), { jev: createStubJev({}), readArticles: async () => { throw new Error('no read'); } });
  assert.deepEqual(v, { allowed: true, massive: null, reason: 'not run before' });
});

test('repeatVerdict: run before, no headline or no new articles → blocked, no call', async () => {
  const jev = createStubJev({});
  assert.equal((await repeatVerdict(story('a', 0, 0), said({ headline: '' }), { jev, readArticles: async () => [article] })).allowed, false);
  assert.equal((await repeatVerdict(story('a', 0, 0), said(), { jev, readArticles: async () => [] })).allowed, false);
});

test('repeatVerdict: matched by member key; massive ≥ MASSIVE_BAR comes back, below stays out', async () => {
  const byKey = said({ storyId: null, key: 'm-a' });
  const ask = (p: number) => createStubJev({ [stubKey(NEWS_MASSIVE_DEVELOPMENT.version, 'a')]: { massive: p } });
  const yes = await repeatVerdict(story('a', 0, 0), byKey, { jev: ask(MASSIVE_BAR), readArticles: async () => [article] });
  assert.equal(yes.allowed, true);
  assert.equal(yes.massive, MASSIVE_BAR);
  const no = await repeatVerdict(story('a', 0, 0), byKey, { jev: ask(0.79), readArticles: async () => [article] });
  assert.equal(no.allowed, false);
});

test('CURRENT_VARIANT parity: lead order equals Morning Download leadQueue; non-leads after by major', async () => {
  const old = new Date('2026-11-01T00:00:00Z');
  const stories = [story('a', 0.6, 0.1), story('b', 0.9, 0.7), story('c', 0.2, 0.95), story('d', 0.4, null), story('e', 0.1, 0.99, old), story('f', 0.5, null)];
  const out = await rank(stories, { ...CURRENT_VARIANT, finalOrder: null }, currentDeps({ now, jev: null }));
  const md = leadQueue(stories.map((s) => ({ key: s.key, score: s.stored.major!, intake: { builder: s.stored.builder, eventDate: s.eventDate?.toISOString() ?? null } as never })), now).map((x) => x.c.key);
  assert.deepEqual(out.slice(0, md.length).map((s) => s.key), md);
  assert.deepEqual(out.slice(md.length).map((s) => s.storyId), ['f', 'd', 'e']);
});

test('CURRENT_VARIANT: the final order reorders the top, a failure keeps mixed order', async () => {
  const stories = [story('a', 0.6, null), story('b', 0.9, null), story('c', 0.7, null)];
  const flipped = await rank(stories, CURRENT_VARIANT, currentDeps({ now, jev: null, finalOrder: async () => ({ order: ['c', 'zz', 'c'] }) }));
  assert.deepEqual(flipped.map((s) => s.storyId), ['c', 'b', 'a']);
  let logged = false;
  const failed = await rank(stories, CURRENT_VARIANT, currentDeps({ now, jev: null, finalOrder: async () => { throw new Error('x'); }, onFinalOrderError: () => { logged = true; } }));
  assert.deepEqual(failed.map((s) => s.storyId), ['b', 'c', 'a']);
  assert.ok(logged);
});

test('CURRENT_VARIANT asks major-news@3 only when no stored major', async () => {
  const jev = createStubJev({ [stubKey('major-news@3', 'k-a')]: { '*': 1, speculative: 0 } });
  const out = await rank([story('a', null, null)], { ...CURRENT_VARIANT, finalOrder: null }, currentDeps({ now, jev }));
  assert.equal(out[0]!.scores.needToKnow, 1);
});
