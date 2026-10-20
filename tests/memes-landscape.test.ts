/**
 * Meme lab M6 (planning/Memes/BUILD_PLAN.md): landscape memes
 * (meme-stackup@2), with stubbed Claude and Jev on PGlite. The stories are
 * test fixtures, not reporting.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { getRun } from '@/lib/memes/api';
import { openLocalMemesDb } from '@/lib/memes/db';
import { mainCompany, mergeStories, stackUp, storiesUsed, type StackUp } from '@/lib/memes/landscape';
import type { MemeRenderer } from '@/lib/memes/render';
import { processNextRequest, type RunDeps } from '@/lib/memes/run';
import { factIndex, type MemeStory } from '@/lib/memes/story';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';
import type { Brief } from '@/lib/social/reporter/brief';

import { answerAll, asksForTurns, cannedMessage } from './fixtures/memes';

const story = (postId: string, title: string, facts: string[], createdAt: string): MemeStory => ({
  postId, title, status: 'review', createdAt,
  brief: {
    the_news: { text: facts[0], ids: ['F1'] }, why_it_matters: [], plot: [], tensions: [],
    facts: facts.map((text, i) => ({ id: `F${i + 1}`, text, sources: ['Fixture'], claim_by: null, notes: [] })),
    background: [], quotes: [], numbers: [], subjects: [], sources: [],
  } as unknown as Brief,
});

const POOL = [
  story('p-openai', 'OpenAI launches an agent', ['OpenAI launched an agent.'], '2026-10-13T10:00:00Z'),
  story('p-anthropic', 'Anthropic launches an agent', ['Anthropic launched an agent.'], '2026-10-12T10:00:00Z'),
  story('p-google', 'Google launches an agent', ['Google launched an agent.'], '2026-10-11T10:00:00Z'),
  story('p-openai-2', 'OpenAI raises money', ['OpenAI raised money.'], '2026-10-10T10:00:00Z'),
];

/** Agents relate as a same move, plainly visible; anything else is unrelated. */
const stackJev = (asked: string[] = []): JevAsk => async (req, meta): Promise<JevResult> => {
  if (!('relation' in req.questions)) return answerAll()(req, meta);
  asked.push(meta.subjectId);
  const st = req.state as { a: { headline: string }; b: { headline: string } };
  const agents = /agent/.test(st.a.headline) && /agent/.test(st.b.headline);
  const p = agents
    ? { overtakes: 0.05, contradicts: 0.02, same_move: 0.85, answers: 0.03, same_event: 0, unrelated: 0.05 }
    : { overtakes: 0.05, contradicts: 0.05, same_move: 0.05, answers: 0.05, same_event: 0, unrelated: 0.8 };
  return { answers: { relation: { choice: agents ? 'same_move' : 'unrelated', probabilities: p }, at_a_glance: { noul: agents ? 0.9 : 0.3 } }, usage: { input_tokens: 400, output_tokens: 0 }, model: 'stub' };
};

test('main company: from the headline first, so a passing mention never makes two stories "different companies"', () => {
  const a = story('a', 'Anthropic cuts live internet from its AI tests', ['Anthropic cut live internet.', 'Google and OpenAI were not involved.'], '2026-10-13T00:00:00Z');
  const b = story('b', 'Anthropic model filed a false tip', ['An Anthropic model filed a false tip.'], '2026-10-12T00:00:00Z');
  assert.equal(mainCompany(a), 'anthropic');
  assert.equal(mainCompany(b), 'anthropic');
});

test('stack-up: only pairs with different main companies are asked, the best wins, and a same move grows the group', async () => {
  const asked: string[] = [];
  const up = await stackUp(stackJev(asked), POOL);
  assert.ok(up);
  assert.equal(up.relation, 'same_move');
  assert.deepEqual(up.stories.map((s) => s.postId).sort(), ['p-anthropic', 'p-google', 'p-openai']);
  assert.ok(!asked.includes('p-openai~p-openai-2'));
  assert.equal(asked.length, 5);
});

test('stack-up: one event told twice is never a stack-up; a weak week still gives its best pair (ME-90)', async () => {
  const pool = [
    story('x1', 'OpenAI ships a feature', ['OpenAI shipped a feature.'], '2026-10-13T00:00:00Z'),
    story('x2', 'Google responds to the OpenAI feature', ['Google responded.'], '2026-10-12T00:00:00Z'),
    story('x3', 'Nvidia posts earnings', ['Nvidia posted earnings.'], '2026-10-11T00:00:00Z'),
  ];
  const jev: JevAsk = async (req): Promise<JevResult> => {
    const st = req.state as { a: { headline: string }; b: { headline: string } };
    const sameEvent = /OpenAI/.test(st.a.headline) && /OpenAI/.test(st.b.headline);
    const p: Record<string, number> = sameEvent ? { same_event: 0.9, answers: 0.08, unrelated: 0.02 } : { contradicts: 0.3, unrelated: 0.7 };
    return { answers: { relation: { choice: sameEvent ? 'same_event' : 'unrelated', probabilities: p }, at_a_glance: { noul: 0.6 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: 'stub' };
  };
  const up = await stackUp(jev, pool);
  assert.ok(up, 'there is always a pair when two companies exist');
  assert.ok(!(up.stories.some((s) => s.postId === 'x1') && up.stories.some((s) => s.postId === 'x2')), 'the same event is never paired');
  assert.equal(up.relation, 'contradicts');
});

test('merge: every fact keeps its story letter, so each line still cites its source (ME-74)', () => {
  const up: StackUp = { stories: POOL.slice(0, 2), relation: 'same_move', strength: 0.9 };
  const merged = mergeStories(up);
  assert.deepEqual([...factIndex(merged.brief).keys()], ['A.F1', 'B.F1']);
  const one = { templateId: 'drake', situationId: null, relation: 'r', why: {}, fill: { templateId: 'drake', fills: [{ slot: 'rejected', kind: 'text' as const, text: 'x', factIds: ['A.F1'] }, { slot: 'preferred', kind: 'text' as const, text: 'y', factIds: ['A.F1'] }] } };
  assert.deepEqual([...storiesUsed(one, up)], ['A']);
  const two = { ...one, fill: { templateId: 'drake', fills: [one.fill.fills[0]!, { slot: 'preferred', kind: 'entity' as const, playerId: 'anthropic' }] } };
  assert.deepEqual([...storiesUsed(two, up)].sort(), ['A', 'B']);
});

const lineT = (slot: string, text: string, ids: string[]) => ({ slot, kind: 'text', player_id: null, text, fact_ids: ids, situation_id: null, why: `${slot} from ${ids.join(', ')}` });
const lineE = (slot: string, id: string) => ({ slot, kind: 'entity', player_id: id, text: null, fact_ids: [], situation_id: null, why: `${id} plays ${slot}` });
const lineV = (slot: string, text: string, sid: string) => ({ slot, kind: 'viewer', player_id: null, text, fact_ids: [], situation_id: sid, why: 'the viewer' });

const beat = (role: string, text: string, ids: string[], player: string | null = null) => ({ role, text, fact_ids: ids, player_id: player });

/** Step 1 for the stack-up: two turns, each drawing on at least two stories. */
const LANDSCAPE_TURNS = {
  turns: [
    { id: 'T1', type: 'unlikely-agreement', summary: 'Rival labs all shipped agents.', beats: [beat('party-a', 'OpenAI', ['A.F1'], 'openai'), beat('party-b', 'Google', ['C.F1'], 'google'), beat('shared', 'An agent', ['A.F1', 'C.F1'])], butt: 'none', touches_viewer: false, strength: 3 },
    { id: 'T2', type: 'again', summary: 'Another lab, another agent.', beats: [beat('before', 'An agent from OpenAI', ['A.F1'], 'openai'), beat('event', 'An agent from Anthropic', ['B.F1'], 'anthropic')], butt: 'none', touches_viewer: false, strength: 2 },
    { id: 'T3', type: 'again', summary: 'One story only.', beats: [beat('event', 'An agent', ['A.F1'])], butt: 'none', touches_viewer: false, strength: 3 },
  ],
};

const LANDSCAPE_MEMES = [
  { turn_id: 'T2', template_id: 'x-everywhere', situation_id: null, relation: 'Everyone launched an agent.', fills: [lineT('thing', 'Agents', ['A.F1', 'B.F1', 'C.F1'])] },
  { turn_id: 'T1', template_id: 'same-picture', situation_id: null, relation: 'The agents look alike.', fills: [lineE('left-picture', 'openai'), lineE('right-picture', 'anthropic')] },
  { turn_id: 'T1', template_id: 'epic-handshake', situation_id: null, relation: 'Rivals agree on agents.', fills: [lineE('left-arm', 'google'), lineE('right-arm', 'openai'), lineT('clasp', 'Agents', ['A.F1', 'C.F1'])] },
  { turn_id: 'T2', template_id: 'zero-days-without', situation_id: null, relation: 'One story only.', fills: [lineT('event', 'A lab launching an agent', ['A.F1'])] },
];

const landscapeClaude = (seen: Anthropic.MessageCreateParamsNonStreaming[] = []) =>
  (async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    seen.push(p);
    return cannedMessage(asksForTurns(p) ? LANDSCAPE_TURNS : { memes: LANDSCAPE_MEMES }, { cache_creation_input_tokens: 0, cache_read_input_tokens: 20000 });
  }) as unknown as RunDeps['create'];

const renderer: MemeRenderer = { render: async (specs) => specs.map(() => ({ png: Buffer.from('png'), problems: [] })), close: async () => {} };

test('run: a landscape click becomes a stack-up slate, landscape templates only, with a home carousel (ME-70, ME-73)', async () => {
  const { db, pg } = await openLocalMemesDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memes-land-'));
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const deps: RunDeps = {
    db, renderer, renderDir: dir, jev: stackJev(), loadStory: async () => null, loadPool: async () => POOL,
    create: landscapeClaude(seen),
  };
  try {
    const { rows } = await db.query<{ id: string }>(`INSERT INTO memes.requests (kind, requested_by) VALUES ('landscape', 'test') RETURNING id`);
    await processNextRequest(deps);
    const run = await getRun(db, rows[0]!.id);
    assert.equal(run.status, 'ok', run.error ?? '');
    const user = JSON.stringify(seen[0]!.messages[0]!.content);
    assert.match(user, /LANDSCAPE MEME/);
    assert.match(user, /A\.F1/);
    const step2 = JSON.stringify(seen[1]!.messages.at(-1));
    assert.match(step2, /epic-handshake/);
    assert.doesNotMatch(step2, /uno-draw-25|grus-plan/, 'landscape templates only');
    assert.doesNotMatch(step2, /TURN T3 /, 'a turn on one story is not kept');
    assert.equal(run.memes.filter((m) => m.inSlate).length, 3);
    assert.equal(run.memes.find((m) => m.templateId === 'zero-days-without')!.dropped, 'landscape: draws on only one story');
    const slate = (await db.query<{ stories: Array<{ postId: string; home: boolean }>; shape: { relation: string } }>(`SELECT stories, shape FROM memes.slates`)).rows[0]!;
    assert.equal(slate.shape.relation, 'same_move');
    assert.equal(slate.stories.find((s) => s.home)!.postId, 'p-openai');
  } finally {
    await pg.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run: selected stories are the landscape set; the 7-day pool is not used', async () => {
  const { db, pg } = await openLocalMemesDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memes-land-pick-'));
  const picked = [POOL[0]!, POOL[1]!];
  let poolCalls = 0;
  const deps: RunDeps = {
    db, renderer, renderDir: dir, jev: stackJev(), loadStory: async () => null,
    loadPool: async () => {
      poolCalls += 1;
      return POOL;
    },
    loadStories: async (ids) => picked.filter((s) => ids.includes(s.postId)),
    create: landscapeClaude(),
  };
  try {
    await db.query(`INSERT INTO memes.requests (kind, requested_by, detail) VALUES ('landscape', 'test', $1::jsonb)`, [JSON.stringify({ storyIds: picked.map((s) => s.postId) })]);
    await processNextRequest(deps);
    const run = await getRun(db, (await db.query<{ id: string }>(`SELECT id::text FROM memes.requests`)).rows[0]!.id);
    assert.equal(run.status, 'ok', run.error ?? '');
    assert.equal(poolCalls, 0);
    const slate = (await db.query<{ stories: Array<{ postId: string }>; shape: { picked?: boolean } }>(`SELECT stories, shape FROM memes.slates`)).rows[0]!;
    assert.equal(slate.shape.picked, true);
    assert.deepEqual(slate.stories.map((s) => s.postId).sort(), ['p-anthropic', 'p-openai']);
  } finally {
    await pg.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run: a week with one company looks back 14 days instead of giving up (ME-90)', async () => {
  const { db, pg } = await openLocalMemesDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memes-land-'));
  const windows: number[] = [];
  const now = new Date('2026-10-13T12:00:00Z');
  try {
    const deps: RunDeps = {
      db, renderer, renderDir: dir, jev: stackJev(), loadStory: async () => null, now: () => now,
      loadPool: async (since) => {
        const days = Math.round((now.getTime() - since.getTime()) / 86_400_000);
        windows.push(days);
        return days > 7 ? POOL : POOL.filter((s) => s.title.startsWith('OpenAI'));
      },
      create: landscapeClaude(),
    };
    const { rows } = await db.query<{ id: string }>(`INSERT INTO memes.requests (kind, requested_by) VALUES ('landscape', 'test') RETURNING id`);
    await processNextRequest(deps);
    assert.deepEqual(windows, [7, 14]);
    assert.equal((await getRun(db, rows[0]!.id)).status, 'ok');
  } finally {
    await pg.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
