import assert from 'node:assert/strict';
import { test } from 'node:test';

import { leadOrder, leadScore } from '@/lib/lfd/lead';
import { LFD_LEAD } from '@/lib/lfd/questions';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';
import type { Ready } from '@/lib/lfd/types';

function ready(key: string, headline: string, o: { lane?: 'major' | 'rundown'; alsoFrom?: string[] } = {}): Ready {
  return {
    pick: { key, refs: [key], origin: 'reels', headline, sourceName: 'The Verge', url: `https://x.com/${key}`, body: 'b'.repeat(4000), publishedAt: null, net: null, blockbuster: 0, firstSeen: null, alsoFrom: o.alsoFrom ?? [], major: null, lane: o.lane ?? 'rundown' },
    copy: { key, setup: '', headline: `${headline} (written)`, highlight: '', names: [], body: `${headline} blurb`, photo: { kind: 'company', query: 'q', subjects: [], alts: [] } },
    photo: { src: `https://p/${key}.jpg`, credit: 'C', kind: 'scene' },
  } as Ready;
}

const usage = { input_tokens: 10, output_tokens: 0 };
/** Answers every lead question with the score for the story's key; `routine` from its own map. */
function jevStub(score: Record<string, number>, routine: Record<string, number> = {}, seen: Array<{ state: unknown; version: string; subjectId: string }> = []): JevAsk {
  return async (req, meta): Promise<JevResult> => {
    seen.push({ state: req.state, version: meta.version, subjectId: meta.subjectId });
    const s = score[meta.subjectId];
    if (s === undefined) throw new Error('jev down');
    return { answers: { stop_scroll: { noul: s }, talked_about: { noul: s }, human_drama: { noul: s }, routine: { noul: routine[meta.subjectId] ?? 0 } }, usage, model: 's' };
  };
}

test('leadScore: the three pulls add up, routine takes points away', () => {
  assert.ok(Math.abs(leadScore({ stop_scroll: { noul: 1 }, talked_about: { noul: 1 }, human_drama: { noul: 1 }, routine: { noul: 0 } }) - 1) < 1e-9);
  assert.ok(leadScore({ stop_scroll: { noul: 1 }, talked_about: { noul: 1 }, human_drama: { noul: 1 }, routine: { noul: 1 } }) < 0.7);
  assert.equal(leadScore({}), 0);
});

test('leadOrder: Jev decides the order, whatever the lane; a routine story sinks', async () => {
  const list = [ready('dublin', 'OpenAI adds 200 Dublin jobs', { lane: 'major' }), ready('wh', 'White House demands fix', { lane: 'major' }), ready('arrest', 'OpenAI engineer arrested'), ready('milk', 'Milk more regulated than AI')];
  const res = await leadOrder(list, jevStub({ dublin: 0.6, wh: 0.9, arrest: 0.8, milk: 0.5 }, { dublin: 0.9 }), new Map());
  assert.equal(res.by, 'jev');
  assert.deepEqual(res.order.map((r) => r.pick.key), ['wh', 'arrest', 'milk', 'dublin']);
  assert.ok(res.scores.get('dublin')! < res.scores.get('milk')!);
});

test('leadOrder: Jev sees the written headline, the blurb and every outlet, with source text under untrusted_content', async () => {
  const seen: Array<{ state: unknown; version: string; subjectId: string }> = [];
  await leadOrder([ready('a', 'Story A', { alsoFrom: ['Wired', 'CBS News'] })], jevStub({ a: 0.5 }, {}, seen), new Map());
  assert.equal(seen[0]!.version, LFD_LEAD.version);
  assert.equal(seen[0]!.subjectId, 'a');
  const state = seen[0]!.state as { headline: string; blurb: string; outlets: string[]; story: { untrusted_content: string } };
  assert.equal(state.headline, 'Story A (written)');
  assert.equal(state.blurb, 'Story A blurb');
  assert.deepEqual(state.outlets, ['The Verge', 'Wired', 'CBS News']);
  assert.ok(state.story.untrusted_content.length > 0 && state.story.untrusted_content.length <= 3000);
});

test('leadOrder: a story already judged this run is not asked again', async () => {
  const seen: Array<{ state: unknown; version: string; subjectId: string }> = [];
  const known = new Map([['a', 0.2]]);
  const res = await leadOrder([ready('a', 'A'), ready('b', 'B')], jevStub({ a: 0.9, b: 0.5 }, {}, seen), known);
  assert.deepEqual(seen.map((s) => s.subjectId), ['b']);
  assert.deepEqual(res.order.map((r) => r.pick.key), ['b', 'a']);
  assert.equal(known.get('b'), 0.5);
});

test('leadOrder: if any judgment fails, the input order stands and the failure is reported', async () => {
  const list = [ready('a', 'A'), ready('b', 'B'), ready('c', 'C')];
  const res = await leadOrder(list, jevStub({ a: 0.1, c: 0.9 }), new Map());
  assert.equal(res.by, 'fallback');
  assert.match(res.error ?? '', /jev down/);
  assert.deepEqual(res.order.map((r) => r.pick.key), ['a', 'b', 'c']);
});

test('leadOrder: ties keep the input order', async () => {
  const res = await leadOrder([ready('a', 'A'), ready('b', 'B'), ready('c', 'C')], jevStub({ a: 0.5, b: 0.5, c: 0.5 }), new Map());
  assert.deepEqual(res.order.map((r) => r.pick.key), ['a', 'b', 'c']);
});
