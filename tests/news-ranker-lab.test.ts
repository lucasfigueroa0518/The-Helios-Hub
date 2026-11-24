/**
 * News Ranker lab (CONTRACT.md §Lab): metrics, cap enforcement, mix sweep,
 * variant output parsing, and a full stubbed run on in-memory PGlite.
 * Offline: Jev is the stub, Sonnet a canned `create`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { createStubJev, stubKey } from '@/lib/social/jev/stub';
import type { LabTag } from '@/lib/news-ranker/types';
import { BUILDER, MAJOR_NEWS, NEWS_GATE } from '@/lib/news-ranker/lab/adapters';
import { CapError, LAB_CAP_USD, assertWithinCap, budget } from '@/lib/news-ranker/lab/cost';
import { openLabDb, saveSet, saveTag, type SetStory } from '@/lib/news-ranker/lab/db';
import { MIX_SWEEP, metricsFor, mixOrder, mixSweep, ownOrder, meanAt, rankCorrelation, type ScoreRow } from '@/lib/news-ranker/lab/metrics';
import { labState } from '@/lib/news-ranker/lab/results';
import { planRun, runVariant } from '@/lib/news-ranker/lab/runner';
import { NEWS_COOL, NEWS_NEED, NEWS_SCALAR, VARIANTS, gateOf, parseOrder, scaleValue, weigh } from '@/lib/news-ranker/lab/variants';
import { pickSet } from '@/lib/news-ranker/lab/freeze';

const tag = (storyId: string, cool: number, needToKnow: number): [string, LabTag] => [storyId, { storyId, cool, needToKnow, taggedAt: new Date(0) }];

test('0–10 ratings: means skip unrated, rank correlation, low share', () => {
  const tags = new Map([tag('a', 9, 2), tag('b', 1, 0), tag('c', 3, 8)]);
  assert.equal(meanAt(['x', 'a', 'y', 'b', 'c'], tags, 2, (t) => t.cool), 5);
  assert.equal(meanAt(['x'], tags, 5, (t) => t.cool), 0);
  const m = metricsFor('v', 0.5, ['a', 'c', 'b'], tags);
  assert.deepEqual(m.meanCool, { at5: 4.3333, at10: 4.3333 });
  assert.equal(m.noShareTop5, 0.3333);
  assert.equal(rankCorrelation(['a', 'c', 'b'], tags, (t) => t.cool), 1);
  assert.equal(rankCorrelation(['b', 'c', 'a'], tags, (t) => t.cool), -1);
});

test('own order: final positions first, failed gate last, ties by id', () => {
  const rows: ScoreRow[] = [
    { storyId: 'b', cool: 0.9, needToKnow: 0.9, mixed: 0.9, gatePass: false, finalPosition: null },
    { storyId: 'a', cool: 0.2, needToKnow: 0.2, mixed: 0.5, gatePass: true, finalPosition: null },
    { storyId: 'c', cool: 0.2, needToKnow: 0.2, mixed: 0.5, gatePass: true, finalPosition: null },
    { storyId: 'd', cool: 0, needToKnow: 0, mixed: 0, gatePass: true, finalPosition: 1 },
  ];
  assert.deepEqual(ownOrder(rows), ['d', 'a', 'c', 'b']);
});

test('mix sweep moves the order between need and cool', () => {
  const rows: ScoreRow[] = [
    { storyId: 'cool', cool: 1, needToKnow: 0, mixed: 0, gatePass: true, finalPosition: null },
    { storyId: 'need', cool: 0, needToKnow: 1, mixed: 0, gatePass: true, finalPosition: null },
  ];
  assert.deepEqual(mixOrder(rows, 0), ['need', 'cool']);
  assert.deepEqual(mixOrder(rows, 1), ['cool', 'need']);
  const tags = new Map([tag('cool', 9, 0), tag('need', 0, 9)]);
  const sweep = mixSweep('v', rows, tags);
  assert.deepEqual(sweep.map((m) => m.mixCool), [...MIX_SWEEP]);
  assert.equal(meanAt(mixOrder(rows, 1), tags, 1, (t) => t.cool), 9);
  assert.equal(meanAt(mixOrder(rows, 0), tags, 1, (t) => t.cool), 0);
});

test('cap: refuses past $1, budget counts calls', () => {
  assert.doesNotThrow(() => assertWithinCap(0.5, 0.5));
  assert.throws(() => assertWithinCap(0.9, 0.11), CapError);
  const b = budget(0.99);
  b.check();
  b.add(0.02);
  assert.throws(() => b.check(), CapError);
  assert.equal(LAB_CAP_USD, 1);
});

test('parsing: weights, 1–10 scale, gate, final order', () => {
  const w = weigh({ a: 0.5, b: -0.5 }, { a: { noul: 1 }, b: { noul: 0.2 } });
  assert.deepEqual(w, { score: 0.4, points: { a: 0.5, b: -0.1 } });
  assert.throws(() => weigh({ a: 1 }, {}), /missing/);
  assert.equal(scaleValue({ choice: '10', probabilities: { '10': 1 } }), 1);
  assert.equal(scaleValue({ choice: '1', probabilities: { '1': 0.5, '10': 0.5 } }), 0.5);
  assert.throws(() => scaleValue({ noul: 0.4 }), /choice/);
  assert.equal(gateOf({ is_news: { noul: 0.1 } }).pass, false);
  assert.equal(gateOf({ is_news: { noul: 0.6 } }).pass, true);
  assert.deepEqual(parseOrder({ order: ['s2', 's9', 's2'] }, ['a', 'b', 'c']), ['b', 'a', 'c']);
  assert.throws(() => parseOrder({ order: [] }, ['a']), /no usable/);
  assert.throws(() => parseOrder('junk', ['a']), /no usable/);
});

test('question sets name no companies, products or models', () => {
  const text = JSON.stringify([NEWS_GATE, NEWS_COOL, NEWS_NEED, NEWS_SCALAR]);
  for (const name of ['OpenAI', 'Google', 'Anthropic', 'Meta', 'Microsoft', 'Apple', 'Nvidia', 'GPT', 'Claude', 'Gemini', 'ChatGPT', 'Tesla']) {
    assert.ok(!text.includes(name), `${name} in a lab question set`);
  }
});

test('pickSet covers every stratum, respects caps, and hides score order', () => {
  const s = (i: number, major: number, builder: number, sources: number) => ({
    id: `s${String(i).padStart(3, '0')}`, headline: `item ${i}`,
    members: Array.from({ length: sources }, (_, k) => ({ family: 'feeds', sourceId: 'feed:x', sourceName: `Src${(i + k) % 60}` })),
    scores: { 'major-news': major, 'story-builder': builder },
  }) as never;
  const stories = Array.from({ length: 300 }, (_, i) => s(i, (i % 10) / 10, ((i * 7) % 10) / 10, 1 + (i % 4)));
  const picked = pickSet(stories, 80) as unknown as { id: string; scores: Record<string, number>; members: { sourceName: string }[] }[];
  assert.equal(picked.length, 80);
  assert.equal(new Set(picked.map((p) => p.id)).size, 80);
  const best = (p: (typeof picked)[number]) => Math.max(p.scores['major-news']!, p.scores['story-builder']!);
  assert.ok(picked.filter((p) => best(p) >= 0.6).length >= 16, 'top stratum');
  assert.ok(picked.filter((p) => best(p) < 0.3).length >= 15, 'low stratum');
  assert.ok(picked.filter((p) => p.scores['story-builder']! - p.scores['major-news']! >= 0.3).length >= 12, 'builder-only stratum');
  const sorted = [...picked].sort((a, b) => best(b) - best(a));
  assert.notDeepEqual(picked.map((p) => p.id), sorted.map((p) => p.id), 'not in score order');
});

const story = (id: string): SetStory => ({
  storyId: id, key: id, memberKeys: [id], headline: `Headline ${id}`, summary: 'summary', text: 'text', eventDate: new Date('2026-11-20T12:00:00Z'),
  firstSeen: new Date('2026-11-20T12:00:00Z'), outlets: [], stored: { major: null, builder: null }, sources: ['Src'],
});

function cannedCreate(order: string[]): { create: (p: Record<string, unknown>) => Promise<Anthropic.Message>; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    create: async (p) => {
      calls.push(p);
      return {
        id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null,
        content: [{ type: 'tool_use', id: 't', name: 'submit_order', input: { order } }],
        usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message;
    },
  };
}

test('stubbed runs: current → reweighted, cool-valuable → final-interesting, cap refusal', async () => {
  const { db, pg } = await openLabDb();
  const ids = ['a', 'b', 'c'];
  await saveSet(db, { id: 'set1', createdAt: new Date(), windowFrom: new Date('2026-11-15'), windowTo: new Date('2026-11-22'), stories: ids.map(story) });
  await saveTag(db, { storyId: 'a', cool: 9, needToKnow: 1 });
  await saveTag(db, { storyId: 'b', cool: 0, needToKnow: 0 });

  const table: Record<string, Record<string, number>> = {};
  for (const [i, id] of ids.entries()) {
    const p = [0.9, 0.2, 0.5][i]!;
    for (const v of [MAJOR_NEWS.version, BUILDER.version, NEWS_GATE.version, NEWS_COOL.version, NEWS_NEED.version]) table[stubKey(v, id)] = { '*': p };
  }
  const jev = createStubJev(table);
  const sonnet = cannedCreate(['s2', 's1']);
  const deps = { jev, create: sonnet.create, concurrency: 2 };

  const pre = await planRun(db, 'set1', 'current-reweighted');
  assert.match(pre.note ?? '', /current/);

  const cur = await runVariant(db, { ...deps, newId: () => 'r-current' }, 'set1', 'current');
  assert.equal(cur.status, 'ok', cur.error);
  assert.ok(cur.costUsd > 0);
  // Prompt caching: system and tool carry cache_control.
  const call = sonnet.calls[0]!;
  assert.ok(JSON.stringify(call.system).includes('cache_control'));
  assert.ok(JSON.stringify(call.tools).includes('cache_control'));

  const rw = await runVariant(db, { ...deps, newId: () => 'r-rw' }, 'set1', 'current-reweighted');
  assert.equal(rw.status, 'ok', rw.error);
  assert.equal(rw.costUsd, 0);

  const cv = await runVariant(db, { ...deps, newId: () => 'r-cv' }, 'set1', 'cool-valuable@1');
  assert.equal(cv.status, 'ok', cv.error);
  const fi = await runVariant(db, { ...deps, newId: () => 'r-fi' }, 'set1', 'final-interesting@1');
  assert.equal(fi.status, 'ok', fi.error);

  const state = await labState(db);
  const final = state.variants.find((v) => v.variantId === 'final-interesting@1')!;
  assert.deepEqual(final.top10.map((t) => t.storyId).slice(0, 2), ['c', 'a']);
  assert.ok(Object.keys(final.top10[0]!.points).some((k) => k.startsWith('cool.')));
  assert.equal(state.variants.find((v) => v.variantId === 'cool-valuable@1')!.sweep.length, 5);
  assert.equal(state.tags.length, 2);

  // Cap: pretend $0.999 already spent.
  await db.query(`INSERT INTO lab_runs (id, set_id, variant_id, status, cost_usd) VALUES ('old', 'set1', 'current', 'ok', 0.999)`);
  await assert.rejects(runVariant(db, deps, 'set1', 'cool-valuable@1'), CapError);
  assert.equal(VARIANTS['scalar@1'].sets.length, 2);
  await pg.close();
});
