/**
 * The pre-generation predictor (lib/memes/predict.ts) and the regime
 * fingerprint it is bound to (lib/memes/regime.ts). Pure; no model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { EvalMeme, EvalRun, EvalSet } from '@/lib/memes/eval';
import { auc, fitLogistic, looEvaluate, predictProb, predictRows, readiness, screen, splitSignals, storyFeatures, turnFeatures, unknownHeadlineNames, wilson, MIN_RUNS, type PredictRow } from '@/lib/memes/predict';
import { BACKFILLED_REGIMES, regimeId, regimeParts, runRegime } from '@/lib/memes/regime';

import { FIXTURE_BRIEF, FIXTURE_STORY } from './fixtures/memes';

test('regime: one id from all its parts; any part changing makes a new regime', () => {
  const parts = regimeParts();
  assert.equal(regimeId(parts), regimeId(), 'stable within a process');
  for (const k of Object.keys(parts)) assert.notEqual(regimeId({ ...parts, [k]: `${parts[k]}x` }), regimeId(parts), k);
});

test('regime: a run uses the fingerprint saved on it, else a recorded backfill, else none', () => {
  const at = (requestedAt: string, pipeline = 'v4', shape: Record<string, unknown> | null = null) => ({ requestedAt, pipeline, shape });
  assert.equal(runRegime(at('2026-10-17 10:25:00.000-05')), BACKFILLED_REGIMES[0]!.regime);
  assert.equal(runRegime(at('2026-10-17 10:40:00.000-05')), null, 'after the batch: unknown, never guessed');
  assert.equal(runRegime(at('2026-10-17 10:25:00.000-05', 'v3')), null);
  assert.equal(runRegime(at('2026-10-20 09:00:00.000-05', 'v4', { regime: 'abc123' })), 'abc123');
});

test('features: from the story and the kept turns only', () => {
  const f = storyFeatures(FIXTURE_STORY);
  assert.equal(f.facts, FIXTURE_BRIEF.facts!.length);
  assert.equal(f.incident, 0);
  assert.equal(storyFeatures({ ...FIXTURE_STORY, title: 'Engineer arrested for planting a recorder' }).incident, 1);
  const t = turnFeatures([
    { kept: true, type: 'backfire', strength: 3, touchesViewer: false, beats: [{ text: 'Cuts 5 jobs' }, { text: 'Hires them back' }] },
    { kept: false, type: 'again', strength: 1, beats: [{ text: 'x' }] },
  ]);
  assert.deepEqual(t, { turnsKept: 1, turnTypes: 1, meanStrength: 3, viewerTurn: 0, beatChars: (11 + 15) / 2, numericBeats: 0.5 });
});

const run = (id: string, regime: string | null, requestedAt = '2026-10-20 09:00:00-05'): EvalRun => ({
  id, kind: 'single', status: 'ok', requestedAt, costUsd: 0.1, storyIds: ['s1'], pipeline: 'v4', shape: regime ? { regime, turns: [] } : { turns: [] },
});
const meme = (runId: string, rating: 1 | 2 | 3 | 4): EvalMeme => ({
  id: `${runId}-${rating}-${Math.random()}`, runId, kind: 'single', pipeline: 'v4', storyIds: ['s1'], headline: 'h', templateId: 'drake', situationId: null,
  turnId: null, turnType: null, pattern: null, inSlate: true, rank: 1, relation: '', fills: [], why: {}, judges: {}, dropped: null, belowBar: null,
  imagePath: null, rating, tags: [], note: null,
});

test('dataset: only runs of the asked regime, graded, with Lucas\'s grades as the outcome', () => {
  const set: EvalSet = {
    version: 1, exportedAt: '', stories: [{ id: 's1', headline: 'A headline', briefSource: 'copy', bodyChars: 200, brief: FIXTURE_BRIEF }],
    runs: [run('a', 'R1'), run('b', 'R1'), run('c', 'R2'), run('d', null)],
    memes: [meme('a', 3), meme('a', 4), meme('a', 2), meme('b', 2), meme('b', 1), meme('c', 4), meme('d', 4)],
  };
  const rows = predictRows(set, 'R1');
  assert.deepEqual(rows.map((r) => r.runId), ['a', 'b']);
  assert.deepEqual(rows.map((r) => [r.good, r.graded, r.strong]), [[2, 3, true], [0, 2, false]]);
});

const row = (x: number, strong: boolean): PredictRow => ({
  runId: String(Math.random()), storyId: 's', extra: {}, regime: 'R', headline: '', graded: 3, good: strong ? 3 : 0, best: strong ? 4 : 2, strong,
  story: { copyBrief: 0, facts: x, quotes: 0, numbers: 0, tensions: 0, claims: 0, numericFacts: 0, players: 0, incident: 0, headlineChars: 0, headlineUnknownNames: 0, headlinePlayers: 0 },
  turns: { turnsKept: 0, turnTypes: 0, meanStrength: 0, viewerTurn: 0, beatChars: 0, numericBeats: 0 },
});

test('model: learns a real signal, scores it out of sample, and is refused until it has enough runs', () => {
  assert.equal(auc([0.9, 0.8, 0.1], [true, true, false]), 1);
  const rows = Array.from({ length: 24 }, (_, i) => row(i, i >= 12));
  const m = fitLogistic(rows, ['facts']);
  assert.ok(predictProb(m, row(23, true)) > predictProb(m, row(0, false)));
  const ev = looEvaluate(rows, ['facts']);
  assert.ok(ev.looAuc! > 0.9);
  assert.ok(ev.brier < ev.brierBaseRate);
  assert.equal(readiness(ev).ready, false, `fewer than ${MIN_RUNS} runs`);
  const many = Array.from({ length: MIN_RUNS }, (_, i) => row(i, i >= MIN_RUNS / 2));
  assert.equal(readiness(looEvaluate(many, ['facts'])).ready, true);
  const noise = Array.from({ length: MIN_RUNS }, (_, i) => row(i % 7, i % 2 === 0));
  assert.equal(readiness(looEvaluate(noise, ['facts'])).ready, false, 'no out-of-sample skill, no predictions');
});

test('headline names: title case counts only name-shaped words; sentence case counts capitalized ones', () => {
  assert.equal(unknownHeadlineNames('OpenAI Says Its Own Models Helped Trace a Hidden Office Recorder'), 0);
  assert.equal(unknownHeadlineNames('Microsoft president Brad Smith shows mirror to everyone'), 2);
  assert.equal(unknownHeadlineNames('Startup Ships Its New ZetaCore Model For Teams'), 1);
});

test('signals: exploratory features join by story; each is checked on both halves; screening rules report precision and coverage', () => {
  const r = (id: string, x: number, strong: boolean, hub: number | null): PredictRow => ({ ...row(x, strong), storyId: id, extra: { hubNet: hub } });
  const rows = [r('a', 10, true, 3), r('b', 20, true, 2.5), r('c', 80, false, null), r('d', 90, false, 1), r('e', 15, true, 3.1), r('f', 85, false, 1.2)];
  const [facts, hub] = splitSignals(rows, ['facts', 'hubNet'], (x) => ['d', 'e', 'f'].includes(x.storyId));
  assert.equal(facts!.all, 0, 'more facts, never strong here');
  assert.equal(facts!.consistent, true);
  assert.equal(hub!.n, 5, 'a missing Hub score is left out, not counted as zero');
  const s = screen(rows, 'facts ≤ 20', (x) => x.story.facts <= 20);
  assert.deepEqual([s.passes, s.of, s.strong, s.anyGood], [3, 6, 3, 3]);
  assert.equal(s.strongRate, 1);
  assert.ok(s.ci[0] > 0.4 && s.ci[1] === 1);
  const [lo, hi] = wilson(5, 10);
  assert.ok(lo < 0.5 && hi > 0.5);
});
