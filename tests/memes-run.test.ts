/**
 * Meme lab (planning/Memes/BUILD_PLAN.md M4, UPGRADE_PLAN.md U4–U5): the
 * judges (meme-judges@3), the slate, and whole Generate runs on PGlite with
 * stubbed Claude, Jev and renderer. No live call (CLAUDE.md Rule 1).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { openLocalMemesDb, type MemesDb } from '@/lib/memes/db';
import { resolveMeme } from '@/lib/memes/fill';
import { brevity, chooseSlate, JUDGE_BARS, judgeCandidates, MEME_JUDGES, rankScore, verdict, type Candidate, type JudgeScores } from '@/lib/memes/judges';
import type { MemeRenderer } from '@/lib/memes/render';
import { MEME_PIPELINE, processNextRequest, recentTemplates, type RunDeps } from '@/lib/memes/run';
import type { Mapping } from '@/lib/memes/writer';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';

import { answerAll, cannedMessage, FIXTURE_STORY, GOOD_MEMES, GOOD_TURNS } from './fixtures/memes';

const mapping = (templateId: string, fill: Mapping['fill']['fills'], turnId?: string): Mapping => ({ templateId, situationId: null, relation: 'r', fill: { templateId, fills: fill }, why: {}, ...(turnId ? { turnId } : {}) });
const cand = (index: number, m: Mapping): Candidate => ({ index, mapping: m, spec: resolveMeme(m.fill) });

const ok: JudgeScores = { accurate: 0.9, off_limits: 0.05, ad_copy: 0.05, turn_visible: 0.9, legible: 0.9, format_true: 0.9, punch_last: 0.9 };

test('judges: the three hard gates drop a candidate and say which; a calibrated gate is soft', () => {
  assert.equal(verdict(ok), null);
  assert.deepEqual(verdict({ ...ok, off_limits: JUDGE_BARS.offLimitsMax }), { reason: 'off limits (0.30)', soft: false });
  assert.match(verdict({ ...ok, ad_copy: 0.7 })!.reason, /reads as an ad/);
  assert.match(verdict({ ...ok, accurate: 0.39 })!.reason, /not accurate/);
  assert.equal(verdict({ ...ok, accurate: 0.4 }), null, 'the calibrated accuracy bar is 0.4');
  assert.equal(verdict({ ...ok, turn_visible: 0.1 }), null, 'an uncalibrated question never gates');
  assert.deepEqual(verdict({ ...ok, legible: 0.3 }, { legible: 0.5 }), { reason: 'legible (0.30)', soft: true });
});

test('judges: two Jev calls per meme; the main one sees what a follower sees plus the facts, the reader only the headline and the meme', async () => {
  const fall = cand(0, { ...mapping('buff-doge-cheems', [
    { slot: 'strong', kind: 'text', text: 'The free plan, before', factIds: ['F1'] }, { slot: 'strong-caption', kind: 'text', text: 'Deep searches', factIds: ['F1'] },
    { slot: 'weak', kind: 'text', text: 'The free plan, Monday', factIds: ['F3'] }, { slot: 'weak-caption', kind: 'text', text: '5 deep searches a day', factIds: ['N1'] },
  ]), relation: 'SECRET RELATION', why: { strong: 'SECRET WHY' } });
  const asked: Array<{ keys: string[]; state: string }> = [];
  const jev: JevAsk = async (req): Promise<JevResult> => {
    asked.push({ keys: Object.keys(req.questions), state: JSON.stringify(req.state) });
    return answerAll({}, (_t, id) => (id === 'legible' ? 0.4 : undefined))(req, { version: 'v', subjectId: 's' });
  };
  const scores = (await judgeCandidates(jev, FIXTURE_STORY, [fall])).get(0)!;
  assert.equal(asked.length, 2);
  asked.sort((a, b) => b.keys.length - a.keys.length);
  assert.deepEqual(asked[0]!.keys.sort(), Object.keys(MEME_JUDGES.questions).sort());
  assert.deepEqual(asked[1]!.keys, ['gets_it']);
  assert.doesNotMatch(asked[1]!.state, /facts|F1|SECRET/, 'the reader never sees the story\'s facts');
  assert.match(asked[1]!.state, /"headline":"Perplexity limits its free plan"/);
  assert.deepEqual(asked[0]!.keys.sort(), ['accurate', 'ad_copy', 'format_true', 'legible', 'off_limits', 'punch_last', 'real_meme', 'turn_visible']);
  assert.match(asked[0]!.state, /"printed":\["The free plan, before","Deep searches","The free plan, Monday","5 deep searches a day"\]/);
  assert.match(asked[0]!.state, /"how_it_works":"[^"]*"/);
  assert.match(asked[0]!.state, /"test":"/);
  assert.doesNotMatch(asked[0]!.state, /SECRET/);
  assert.equal(scores.legible, 0.4);
  assert.ok(typeof scores.score === 'number' && scores.score > 0 && scores.score < 1);
});

test('rank: short lines and picture-carried templates score higher, all else equal', () => {
  const short = mapping('buff-doge-cheems', [{ slot: 'strong', kind: 'text', text: 'Short', factIds: ['F1'] }]);
  const long = mapping('buff-doge-cheems', [{ slot: 'strong', kind: 'text', text: 'x'.repeat(130), factIds: ['F1'] }]);
  assert.equal(brevity(short), 1);
  assert.equal(brevity(long), 0);
  assert.ok(rankScore(ok, short) > rankScore(ok, long));
  const textCarried = mapping('ancient-aliens', [{ slot: 'setup', kind: 'text', text: 'Short', factIds: ['F1'] }]);
  assert.ok(rankScore(ok, short) > rankScore(ok, textCarried));
});

test('slate: the best that pass, one per template, the best of each turn first (ME-61), best first', () => {
  const m = (i: number, t: string, turn: string) => cand(i, mapping(t, t === 'zero-days-without' ? [{ slot: 'event', kind: 'text', text: 'x', factIds: ['F1'] }] : t === 'marked-safe-from' ? [{ slot: 'dodged', kind: 'text', text: 'x', factIds: ['F1'] }] : [{ slot: 'hard-thing', kind: 'text', text: 'x', factIds: ['F1'] }], turn));
  const cs = [m(0, 'zero-days-without', 'T1'), m(1, 'marked-safe-from', 'T1'), m(2, 'one-does-not-simply', 'T1'), m(3, 'zero-days-without', 'T2')];
  const scores = new Map<number, JudgeScores>([[0, { ...ok, score: 0.9 }], [1, { ...ok, score: 0.8 }], [2, { ...ok, score: 0.7 }], [3, { ...ok, score: 0.2 }]]);
  assert.deepEqual(chooseSlate(cs, scores).map((c) => c.index), [0, 1, 2], 'T2 has only a duplicate template, so the three best of T1 fill it');
  const cs2 = [...cs, m(4, 'marked-safe-from', 'T2')];
  scores.set(4, { ...ok, score: 0.1 });
  assert.deepEqual(chooseSlate(cs2, scores).map((c) => c.index), [0, 2, 4], 'a second idea makes the slate, on a template not yet used');
  scores.set(1, { ...ok, accurate: 0.1, score: 0.99 });
  assert.ok(!chooseSlate(cs2, scores).some((c) => c.index === 1), 'a hard failure never makes it');
});

// ── Whole runs ───────────────────────────────────────────────────────────────

const stubRenderer = (failTemplate?: string): MemeRenderer => ({
  async render(specs) {
    return specs.map((s) => ({ png: Buffer.from('png'), problems: s.templateId === failTemplate ? ['fit: x does not fit its box at 24px'] : [] }));
  },
  async close() {},
});

type Scripted = { create: RunDeps['create']; calls: Anthropic.MessageCreateParamsNonStreaming[] };
function script(responses: unknown[]): Scripted {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = (async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(structuredClone(p));
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra Claude call');
    return cannedMessage(next, { cache_creation_input_tokens: 0, cache_read_input_tokens: 20000 });
  }) as unknown as RunDeps['create'];
  return { create, calls };
}

async function withRun(fn: (db: MemesDb, deps: RunDeps) => Promise<void>, over: Partial<RunDeps> = {}) {
  const { db, pg } = await openLocalMemesDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memes-run-'));
  const deps: RunDeps = {
    db, create: script([GOOD_TURNS, { memes: GOOD_MEMES }]).create, jev: answerAll(), renderer: stubRenderer(),
    loadStory: async (id) => (id === FIXTURE_STORY.postId ? FIXTURE_STORY : null), renderDir: dir, ...over,
  };
  try {
    await fn(db, deps);
  } finally {
    await pg.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const request = async (db: MemesDb, postId = FIXTURE_STORY.postId) =>
  (await db.query<{ id: string }>(`INSERT INTO memes.requests (kind, post_id, requested_by) VALUES ('single', $1, 'test') RETURNING id`, [postId])).rows[0]!.id;
const reqRow = async (db: MemesDb, id: string) =>
  (await db.query<{ status: string; error: string | null; cost_usd: string; detail: Record<string, unknown> }>(`SELECT status, error, cost_usd::text, detail FROM memes.requests WHERE id = $1`, [id])).rows[0]!;
type MemeRow = { template_id: string; in_slate: boolean; rank: number | null; image_path: string | null; mapping: Mapping; judges: { dropped: string | null; belowBar: string | null; score?: number } };
const memeRows = async (db: MemesDb) => (await db.query<MemeRow>(`SELECT template_id, in_slate, rank, image_path, mapping, judges FROM memes.memes ORDER BY rank NULLS LAST, template_id`)).rows;

test('run: turns, then memes; a slate of 3 on 3 templates from more than one turn; every candidate and turn saved', () =>
  withRun(async (db, deps) => {
    const s = script([GOOD_TURNS, { memes: GOOD_MEMES }]);
    deps.create = s.create;
    const id = await request(db);
    await processNextRequest(deps);
    const r = await reqRow(db, id);
    assert.equal(r.status, 'ok', r.error ?? '');
    assert.equal(s.calls.length, 2, 'turns and memes; no extra call needed');
    assert.equal(r.detail.extraCall, false);
    const rows = await memeRows(db);
    assert.equal(rows.length, 6);
    const slate = rows.filter((x) => x.in_slate);
    assert.deepEqual(slate.map((x) => x.rank), [1, 2, 3]);
    assert.equal(new Set(slate.map((x) => x.template_id)).size, 3);
    assert.ok(new Set(slate.map((x) => x.mapping.turnId)).size >= 2, 'a choice between ideas');
    for (const x of slate) assert.ok(x.image_path && fs.existsSync(path.resolve(x.image_path)) && typeof x.judges.score === 'number');
    const shape = (await db.query<{ shape: { pipeline: string; turns: Array<{ id: string; kept: boolean; templates?: string[] }> } }>(`SELECT shape FROM memes.slates`)).rows[0]!.shape;
    assert.equal(shape.pipeline, MEME_PIPELINE);
    assert.deepEqual(shape.turns.map((x) => [x.id, x.kept]), [['T1', true], ['T2', true], ['T3', true]]);
    assert.ok(shape.turns[1]!.templates!.includes('buff-doge-cheems'));
    assert.equal((await recentTemplates(db)).size, 3, 'the matcher sees what the lab used lately');
  }));

test('run: fewer than two pass → one more call on the same conversation, and its memes are judged too (ME-95)', () =>
  withRun(async (db, deps) => {
    const s = script([GOOD_TURNS, { memes: [GOOD_MEMES[0], GOOD_MEMES[2]] }, { memes: [GOOD_MEMES[3], GOOD_MEMES[4]] }]);
    deps.create = s.create;
    deps.jev = answerAll({}, (template, id) => (template === 'Running Away Balloon' && id === 'accurate' ? 0.2 : undefined));
    const id = await request(db);
    await processNextRequest(deps);
    const r = await reqRow(db, id);
    assert.equal(r.status, 'ok', r.error ?? '');
    assert.equal(s.calls.length, 3);
    assert.match(JSON.stringify(s.calls[2]!.messages.at(-1)), /running-away-balloon: judges: not accurate/);
    assert.equal(r.detail.extraCall, true);
    const slate = (await memeRows(db)).filter((x) => x.in_slate).map((x) => x.template_id).sort();
    assert.deepEqual(slate, ['buff-doge-cheems', 'hide-the-pain', 'types-of-headaches']);
  }));

test('run: an ad and an inaccurate meme never reach the slate, whatever their other scores', () =>
  withRun(async (db, deps) => {
    deps.jev = answerAll({}, (template, id) => {
      if (template === "This Is Where I'd Put My Trophy If I Had One" && id === 'ad_copy') return 0.8;
      if (template === 'Squidward Window' && id === 'accurate') return 0.2;
      return undefined;
    });
    await request(db);
    await processNextRequest(deps);
    const rows = await memeRows(db);
    assert.match(rows.find((x) => x.template_id === 'trophy')!.judges.dropped!, /reads as an ad/);
    assert.match(rows.find((x) => x.template_id === 'squidward-window')!.judges.dropped!, /not accurate/);
    assert.ok(rows.filter((x) => x.in_slate).every((x) => !['trophy', 'squidward-window'].includes(x.template_id)));
  }));

test('run: a render failure drops that candidate with the reason', () =>
  withRun(
    async (db, deps) => {
      await request(db);
      await processNextRequest(deps);
      assert.match((await memeRows(db)).find((x) => x.template_id === 'squidward-window')!.judges.dropped!, /^render: fit/);
    },
    { renderer: stubRenderer('squidward-window') },
  ));

test('run: a post with no brief fails the request with the reason', () =>
  withRun(async (db, deps) => {
    const id = await request(db, 'no-such-post');
    await processNextRequest(deps);
    const r = await reqRow(db, id);
    assert.equal(r.status, 'failed');
    assert.match(r.error!, /has no Reporter brief/);
  }));

test('run: no usable turn fails the request, and the turns are kept on it', () =>
  withRun(async (db, deps) => {
    const broken = { turns: [{ ...GOOD_TURNS.turns[1], type: 'nope' }] };
    deps.create = script([broken, broken]).create;
    const id = await request(db);
    await processNextRequest(deps);
    const r = await reqRow(db, id);
    assert.equal(r.status, 'failed');
    assert.match(r.error!, /writer: no-turns/);
    assert.equal((r.detail.turns as unknown[]).length, 2, 'both attempts are kept');
  }));

test('run: templates on cooldown are never offered to the writer (ME-40)', () =>
  withRun(async (db, deps) => {
    await db.query(`INSERT INTO memes.template_uses (family_key, template_id, published_at) VALUES ('Swole Doge vs. Ironic Doge', 'buff-doge-cheems', now())`);
    const s = script([GOOD_TURNS, { memes: GOOD_MEMES }]);
    deps.create = s.create;
    await request(db);
    await processNextRequest(deps);
    const step2 = JSON.stringify(s.calls[1]!.messages.at(-1));
    assert.doesNotMatch(step2, /buff-doge-cheems/);
    assert.match(step2, /hide-the-pain/);
    assert.match((await memeRows(db)).length ? 'ok' : '', /ok/);
  }));
