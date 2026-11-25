/**
 * News chain, Owner A (planning/MD-LFD Revisions/WIRING-CONTRACT.md): R8 shortlist scoring, the Opus rerank
 * parse/sort, cleanup, choosePosts and fillInOrder. Offline: Jev and the Messages API are stubbed with canned
 * responses; nothing reaches a live API.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { CHECK_DEPTH, choosePosts, cleanup, fillInOrder, type MediaVerdict } from '@/lib/news-ranker/posts';
import { RERANK_MODEL, RERANK_SYSTEM, RERANK_TOOL, rerank, type Graded } from '@/lib/news-ranker/rerank';
import { R8_SPEC, r8Score, shortlist, type ChainStory, type Shortlisted } from '@/lib/news-ranker/shortlist';
import type { JevAnswer, JevAsk } from '@/lib/social/jev/client';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// Hand-computed: cool = 3.5·1 + 3·0.5 + 1·(1/3) − 1·0.5 = 4.8333…; value = 3·0.5 + 1.5·(1/3) − 3·0.5 = 0.5.
const HAND: Record<string, JevAnswer> = {
  no_fresh_news: { noul: 0 },
  wow_factor: { choice: '10', probabilities: { '10': 1 } },
  human_drama: { choice: '1', probabilities: { '1': 1 } },
  showable: { choice: '5', probabilities: { '5': 0.5, '6': 0.5 } }, // EV 5.5 → 0.5
  usable_new: { choice: '1', probabilities: { '1': 1 } },
  stakes: { choice: '1', probabilities: { '10': 0.5, '1': 0.5 } }, // EV 5.5 → 0.5
  landmark: { choice: '4', probabilities: {} }, // no probabilities → (4 − 1) / 9
  foreign_rules: { noul: 0.5 },
  insider_only: { noul: 0 },
};

test('R8 spec is the lab spec and scores a hand-computed case', () => {
  assert.equal(R8_SPEC.name, 'build-b-r8');
  assert.equal(R8_SPEC.questions.length, 9);
  const s = r8Score(HAND);
  close(s.cool, 3.5 + 1.5 + 1 / 3 - 0.5);
  close(s.value, 0.5);
  close(s.final, s.cool + s.value);
});

const story = (id: string, text = 'body'): ChainStory => ({ id, headline: `H ${id}`, text, outlets: ['o'], published: '2026-11-24', url: `https://x/${id}` });

test('shortlist sorts by final, prices Jev, drops a story after three failures without throwing', async () => {
  const calls: Record<string, number> = {};
  const low = Object.fromEntries(Object.entries(HAND).map(([k, v]) => [k, k === 'wow_factor' ? { choice: '1', probabilities: { '1': 1 } } : v])) as Record<string, JevAnswer>;
  const jev: JevAsk = async (req, meta) => {
    calls[meta.subjectId] = (calls[meta.subjectId] ?? 0) + 1;
    assert.ok(Object.keys(req.questions).length === 9);
    if (meta.subjectId === 'bad') throw new Error('boom');
    if (meta.subjectId === 'flaky' && calls.flaky === 1) throw new Error('once');
    return { answers: meta.subjectId === 'a' ? low : HAND, usage: { input_tokens: 1_000_000, output_tokens: 0 }, model: 'jev' };
  };
  const warn = console.warn; console.warn = () => {};
  try {
    const { ranked, costUsd } = await shortlist([story('a'), story('bad'), story('flaky'), story('b')], { jev, component: 'test', concurrency: 2 });
    assert.deepEqual(ranked.map((r) => r.id).sort(), ['a', 'b', 'flaky']);
    assert.equal(ranked.at(-1)!.id, 'a');
    assert.equal(calls.bad, 3);
    close(costUsd, 0.042 * 3);
  } finally { console.warn = warn; }
});

const sl = (id: string, text = 'x'.repeat(900)): Shortlisted => ({ ...story(id, text), cool: 1, value: 1, final: 2 });
const toolMsg = (grades: unknown[]): Anthropic.Message => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: RERANK_MODEL, stop_reason: 'tool_use', stop_sequence: null,
  content: [{ type: 'tool_use', id: 't1', name: 'grade_stories', input: { grades } }],
  usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
} as unknown as Anthropic.Message);
const g = (id: string, cool: number, value: number, extra: Record<string, unknown> = {}) => ({ id, cool, value, duplicate_of: null, top_tier: true, crowds: null, angle: `why ${id}`, ...extra });

test('rerank request: Opus, low effort, cached system + tool, angle required, WC8 wording, 700-char text', async () => {
  let params: Record<string, any> = {};
  const create = async (p: Record<string, unknown>) => { params = p; return toolMsg([g('a', 5, 5), g('b', 9, 2), g('c', 3, 8, { duplicate_of: 'b' }), g('d', 6, 4)]); };
  const { graded, costUsd } = await rerank([sl('a'), sl('b'), sl('c'), sl('d'), sl('e')], { create, windowLabel: 'Nov 24, 2026' });
  assert.equal(params.model, 'claude-opus-5-5');
  assert.deepEqual(params.output_config, { effort: 'low' });
  assert.equal(params.max_tokens, 8000);
  assert.equal(params.system[0].cache_control.type, 'ephemeral');
  assert.equal(params.tools[0].cache_control.type, 'ephemeral');
  assert.ok(params.tools[0].input_schema.properties.grades.items.required.includes('angle'));
  assert.ok(RERANK_SYSTEM.includes('You receive the shortlist for one post and grade'));
  assert.ok(!RERANK_SYSTEM.includes("one day's shortlist"));
  assert.equal(RERANK_TOOL.name, 'grade_stories');
  const user = params.messages[0].content as string;
  assert.ok(user.startsWith('Shortlist for Nov 24, 2026:\n<story id="a">'));
  assert.ok(user.includes(`<text>${'x'.repeat(700)}</text>`) && !user.includes('x'.repeat(701)));
  // b (11, cool 9) and a/d (10: d cool 6 over a cool 5), duplicate c after, ungraded e last.
  assert.deepEqual(graded.map((s) => s.id), ['b', 'd', 'a', 'c', 'e']);
  assert.equal(graded[0]!.grade.angle, 'why b');
  assert.deepEqual(graded[0]!.grade.crowds, []);
  assert.equal(graded[3]!.grade.duplicate_of, 'b');
  assert.equal(graded[4]!.grade.top_tier, false);
  assert.ok(costUsd > 0);
});

const gr = (id: string, o: Partial<Graded['grade']> = {}): Graded => ({ ...sl(id), grade: { cool: 5, value: 5, duplicate_of: null, top_tier: true, crowds: [], angle: '', ...o } });

test('cleanup drops duplicates into merged and keeps the top story of each crowd group', () => {
  const list = [gr('a'), gr('b', { crowds: ['a'] }), gr('c'), gr('d', { crowds: ['b'] }), gr('e'), gr('x', { duplicate_of: 'a' }), gr('y', { duplicate_of: 'x' }), gr('z', { duplicate_of: 'b' })];
  const { kept, merged } = cleanup(list);
  assert.deepEqual(kept.map((s) => s.id), ['a', 'c', 'e']);
  assert.deepEqual(merged.get('a')!.map((s) => s.id), ['x', 'y']);
  assert.deepEqual(merged.get('c'), []);
  assert.equal(merged.has('b'), false);
});

const v = (m: Record<string, MediaVerdict>) => (id: string) => m[id] ?? 'none';

test('choosePosts: walk posts top-tier good, stops at first non-top-tier and at max', () => {
  const kept = [gr('a'), gr('b'), gr('c'), gr('d', { top_tier: false }), gr('e')];
  assert.deepEqual(choosePosts(kept, v({ a: 'good', b: 'usable', c: 'good', d: 'good', e: 'good' })), ['a', 'c']);
  const many = Array.from({ length: 8 }, (_, i) => gr(`s${i}`));
  assert.deepEqual(choosePosts(many, () => 'good'), ['s0', 's1', 's2', 's3', 's4']);
  assert.deepEqual(choosePosts(many, () => 'good', { max: 3 }), ['s0', 's1', 's2']);
});

test('choosePosts: under min fills good|usable in rank order, then (WC5) none; only the check window', () => {
  const kept = [gr('a', { top_tier: false }), gr('b'), gr('c'), gr('d')];
  assert.deepEqual(choosePosts(kept, v({ a: 'usable', c: 'good' })), ['a', 'c']);
  assert.deepEqual(choosePosts(kept, v({})), ['a', 'b']);
  assert.deepEqual(choosePosts(kept, v({ d: 'none', c: 'none', b: 'usable' })), ['a', 'b']);
  const deep = [...Array.from({ length: CHECK_DEPTH }, (_, i) => gr(`s${i}`, { top_tier: false })), gr('late')];
  const seen: string[] = [];
  choosePosts(deep, (id) => { seen.push(id); return id === 'late' ? 'good' : 'none'; });
  assert.equal(seen.includes('late'), false);
  // A golden video is only `good` via the verdict: it never passes the top-tier stop.
  assert.deepEqual(choosePosts([gr('t'), gr('n', { top_tier: false }), gr('gold', { top_tier: true })], v({ t: 'good', n: 'usable', gold: 'good' }), { min: 1 }), ['t']);
});

test('fillInOrder (WC2): rank order, skip none, stop at max, no top-tier stop', () => {
  const kept = [gr('a', { top_tier: false }), gr('b'), gr('c'), gr('d'), gr('e'), gr('f'), gr('g'), gr('h')];
  const m = v({ a: 'usable', b: 'none', c: 'good', d: 'good', e: 'usable', f: 'good', g: 'good', h: 'good' });
  assert.deepEqual(fillInOrder(kept, m, { min: 5, max: 6 }), ['a', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(fillInOrder(kept.slice(0, 3), m, { min: 5, max: 6 }), ['a', 'c']);
});
