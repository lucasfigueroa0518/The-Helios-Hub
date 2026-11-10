/**
 * Reels on the central intake (Phase 2, planning/Central Intake/PHASE2-CONTRACT.md, Owner B), offline: PGlite with
 * the real reels, hub and intake schemas plus reels.idea_sources_v, a stubbed Jev transport, stubbed adapters and a
 * copy client that refuses every call. No live model, search or HTTP call.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { A4_DEPOSIT, depositFindsQuietly } from '@/lib/intake/deposit';
import { listOrderStories, resolveStoryId } from '@/lib/intake/read';
import type { AddIntakeSeed, IntakeJev, IntakeQuery, IntakeRunRecord } from '@/lib/intake/types';
import { intakeScoreSource, intakeTimelyFrom, isTonightsMain, listReelsStories, registerIntakeIdeas, type IntakeRunDeps } from '@/lib/reels/pipeline/intake';
import { loadHealthPage } from '@/lib/reels/health';
import { executeRun } from '@/lib/reels/pipeline/run';
import { scoreOneIdea, scoreRun, switchTwinDrops } from '@/lib/reels/pipeline/scoring';
import { createPostIdea, insertSource, listRunSources, startRun } from '@/lib/reels/repository';
import { nyDateKey, previousNyDateKey } from '@/lib/reels/scoring/decide';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import { addReelSeed, isUnscoredSeed, readOpenSeeds, type ReelSeedOutcome } from '@/lib/reels/seeds';
import type { Adapter, AdapterItem } from '@/lib/reels/types';

import { NEW_SLATE, PAGE, reelsDb, stub } from './fixtures/reels-seed';

delete process.env.ANTHROPIC_API_KEY; // belt and braces: nothing here may reach a live model

const HOUR = 3_600_000;
const sql = (file: string) =>
  readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function db(opts: { withSlate?: boolean } = {}): Promise<{ pg: PGlite; q: IntakeQuery }> {
  const pg = await reelsDb({ withSlate: opts.withSlate ?? false });
  await pg.exec(sql('intake_schema.sql'));
  await pg.exec(sql('reels_intake_views.sql'));
  const q: IntakeQuery = { query: async <T,>(text: string, params?: unknown[]) => ({ rows: (await pg.query(text, params)).rows as T[] }) };
  return { pg, q };
}

const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const count = async (pg: PGlite, from: string) => Number((await pg.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${from}`)).rows[0]!.n);

/** A reels-score the way the intake's REELS_SCORE stores it: scoreOneIdea on the members (stub Jev, no live call). */
async function scoreOf(headline: string, level: number): Promise<InterpretedScore> {
  const { jev } = stub({ scoreBy: () => level });
  return scoreOneIdea(null as unknown as string, jev, {
    id: 'fixture',
    lastJoinedMs: 0,
    members: [{ role: 'primary', sourceName: 'Wire', headline, body: PAGE }],
  }, null);
}

type StoryFixture = {
  n: number;
  headline: string;
  lastSeen: Date;
  score?: InterpretedScore;
  reelsDrop?: string | null;
  seed?: boolean;
  mergedInto?: string;
};

async function story(pg: PGlite, s: StoryFixture): Promise<string> {
  const sid = id(s.n);
  const seen = s.lastSeen.toISOString();
  await pg.query(
    `INSERT INTO intake.stories (id, representative_key, headline, first_seen_at, last_joined_at, merged_into) VALUES ($1, $2, $3, $4, $4, $5)`,
    [sid, `https://wire.test/${s.n}`, s.headline, seen, s.mergedInto ?? null],
  );
  await pg.query(
    `INSERT INTO intake.items (key, family, source_id, source_name, source_type, headline, body, url, first_seen_at, last_seen_at,
                               story_id, role, joined_at, reels_source_id, reels_drop_reason, drop_reason, seeded_by, seed_order)
     VALUES ($1, $2, $3, 'Wire', $4, $5, $6, $1, $7, $7, $8, 'primary', $7, $9, $10, $10, $11, $12)`,
    [
      `https://wire.test/${s.n}`, s.seed ? 'seed' : 'reels', s.seed ? 'seed:reels' : 'rss', s.seed ? 'seed' : 'A1', s.headline, PAGE, seen, sid,
      s.seed ? null : 'rss', s.reelsDrop ?? null, s.seed ? 'someone' : null, s.seed ? 'reels' : null,
    ],
  );
  if (s.score) {
    await pg.query(
      `INSERT INTO intake.scores (story_id, scorecard, version, member_hash, result) VALUES ($1, 'reels-score', 'v', 'h', $2::jsonb)`,
      [sid, JSON.stringify({ kind: 'reels-score', score: s.score })],
    );
  }
  return sid;
}

/** A copy client that refuses every call: the night must never reach a live writer in these tests. */
const refusingCopy = {
  messages: { create: async () => { throw new Error('stub: copy is not called in this test'); } },
} as never;

function derivedStub(adapterId: string, item: AdapterItem, deposit: 'a4' | 'b6', seen: string[][]): Adapter {
  return {
    id: adapterId,
    name: adapterId,
    type: deposit === 'a4' ? 'A4' : 'B6',
    bucket: deposit === 'a4' ? 'A' : 'B',
    kind: deposit === 'a4' ? 'catalog' : 'generated',
    phase: 'derived',
    async fetchItems({ runId, now }) {
      // What A4's news peg and B6's "tonight" list read.
      seen.push((await listRunSources(runId)).map((s) => s.headline));
      // As the real adapters do (awesome-lists.ts, web-search.ts): deposit each find, quietly.
      await depositFindsQuietly([item], now, deposit === 'a4' ? A4_DEPOSIT : undefined);
      return [item];
    },
  } as Adapter;
}

const find = (n: number, type: 'A4' | 'B6'): AdapterItem => ({
  canonicalUrl: `https://finds.test/${type}/${n}`,
  headline: `${type} find number ${n}`,
  body: PAGE,
  sourceName: type,
  sourceType: type,
  author: null,
  byline: null,
  publishTime: null,
}) as unknown as AdapterItem;

function intakeDeps(q: IntakeQuery, over: Partial<IntakeRunDeps> = {}): Partial<IntakeRunDeps> & { deposits: { n: number } } {
  const deposits = { n: 0 };
  return {
    deposits,
    query: q,
    readMode: async () => 'intake',
    listOrderStories,
    resolveStoryId,
    runIntakeDeposit: async () => {
      deposits.n += 1;
      return { runId: 'stub', record: {} as IntakeRunRecord };
    },
    lastMainStart: async () => new Date(Date.now() - HOUR),
    ...over,
  };
}

test('intake night: no primary fetch, derived finds deposit (no reels.sources), one deposit run, registry ids are story ids, timely rule, stored scores', async () => {
  const { pg, q } = await db();
  const now = Date.now();
  const scoreA = await scoreOf('Alpha model ships', 4);
  const a = await story(pg, { n: 1, headline: 'Alpha model ships', lastSeen: new Date(now - 30 * 60_000), score: scoreA });
  const b = await story(pg, { n: 2, headline: 'Beta chip delayed', lastSeen: new Date(now - 48 * HOUR), score: await scoreOf('Beta chip delayed', 2) });
  const dropped = await story(pg, { n: 3, headline: 'Gamma teaser', lastSeen: new Date(now - 30 * 60_000), score: scoreA, reelsDrop: 'teaser' });
  const mine = await story(pg, { n: 4, headline: 'My own seed story', lastSeen: new Date(now - 10 * 60_000), score: scoreA, seed: true });

  const seen: string[][] = [];
  const intake = intakeDeps(q);
  const { jev } = stub();
  const run = (await startRun('scheduled'))!;
  const outcome = await executeRun(run, {
    jev,
    copyClient: refusingCopy,
    adapters: {
      primary: [{ id: 'rss', name: 'RSS', type: 'A1', bucket: 'A', kind: 'article', async fetchItems() { assert.fail('a primary adapter is never fetched in intake mode'); } } as unknown as Adapter],
      derived: [derivedStub('awesome-lists', find(1, 'A4'), 'a4', seen), derivedStub('claude-web-search', find(2, 'B6'), 'b6', seen)],
    },
    intake,
  });

  assert.notEqual(outcome.status, 'failed', outcome.note);
  assert.equal(await count(pg, 'reels.sources'), 0, 'no reels.sources rows in intake mode');
  assert.equal(await count(pg, 'reels.post_idea_members'), 0);
  assert.deepEqual(
    (await pg.query<{ source_id: string }>(`SELECT source_id FROM intake.items WHERE family = 'search' ORDER BY source_id`)).rows.map((r) => r.source_id),
    ['search:a4', 'search:b6'],
  );
  assert.equal(intake.deposits.n, 1, 'runIntakeDeposit once');
  assert.deepEqual(outcome.sourceResults.map((r) => [r.adapterId, r.fetched, r.ingested]), [['awesome-lists', 1, 1], ['claude-web-search', 1, 1]]);
  // Tonight's sources for A4 / B6 are the intake's kept reels items seen tonight.
  assert.deepEqual(seen[0], ['Alpha model ships']);

  const ideas = (await pg.query<{ id: string; timely: boolean }>(`SELECT id::text AS id, timely FROM reels.post_ideas ORDER BY id`)).rows;
  assert.deepEqual(ideas, [
    { id: a, timely: true },
    { id: b, timely: false },
  ]);
  assert.ok(!ideas.some((i) => i.id === dropped), 'a story with no kept reels/search member is not an idea');
  assert.ok(!ideas.some((i) => i.id === mine), 'a seed-only story is registered by the seed, not by the night');

  const slate = (await pg.query<{ post_idea_id: string; origin: string; net: number }>(
    `SELECT post_idea_id::text AS post_idea_id, origin, net FROM reels.idea_scores`,
  )).rows;
  assert.deepEqual(slate.map((r) => [r.post_idea_id, r.origin]), [[a, 'timely']]);
  assert.equal(slate[0]!.net, scoreA.net);
  assert.equal(await count(pg, `reels.jev_logs WHERE component LIKE 'scoring%' AND run_id = '${run.id}'`), 0, 'no scoring call for an intake-scored story');
});

test('registration is an idempotent upsert keyed by the story id', async () => {
  const { pg, q } = await db();
  const now = new Date();
  const a = await story(pg, { n: 1, headline: 'Alpha', lastSeen: new Date(now.getTime() - 60_000), score: await scoreOf('Alpha', 3) });
  // A legacy idea that was timely last night goes cold, as resetTimelyFlags would make it.
  await pg.exec(`INSERT INTO reels.post_ideas (id, timely) VALUES ('${id(99)}', true)`);
  const deps = intakeDeps(q) as IntakeRunDeps;
  const stories = await listReelsStories(deps, now);
  const from = intakeTimelyFrom(now, new Date(now.getTime() - HOUR));
  assert.deepEqual(await registerIntakeIdeas(q, stories, from), { created: 1, updated: 0, timely: 1 });
  assert.equal(await count(pg, `reels.post_ideas WHERE id = '${id(99)}' AND NOT timely`), 1);
  await pg.exec(`DELETE FROM reels.post_ideas WHERE id = '${id(99)}'`);
  const first = (await pg.query(`SELECT id::text AS id, first_seen, last_joined, timely FROM reels.post_ideas`)).rows;
  assert.deepEqual(await registerIntakeIdeas(q, stories, from), { created: 0, updated: 1, timely: 1 });
  const again = (await pg.query(`SELECT id::text AS id, first_seen, last_joined, timely FROM reels.post_ideas`)).rows;
  assert.deepEqual(again, first);
  assert.equal((first[0] as { id: string }).id, a);
  // The timely window: tonight's main run when it began shortly before; else the Reels run itself.
  assert.equal(intakeTimelyFrom(now, null).getTime(), now.getTime());
  assert.equal(intakeTimelyFrom(now, new Date(now.getTime() - 20 * HOUR)).getTime(), now.getTime());
});

test('an intake idea_scores row equals the row the legacy night writes for the same InterpretedScore', async () => {
  const runStartedAt = new Date();
  const headline = 'Delta lab opens weights';
  const cols = `origin, net, rank, selected, chosen_bucket, chosen_framework, psychology, bucket_score, value_score, blockbuster, confidence, components`;

  // Legacy: a stored idea scored by scoreRun with scoreOneIdea.
  const legacy = await db();
  const { jev: legacyJev } = stub({ scoreBy: () => 4 });
  const legacyRun = (await startRun('scheduled'))!;
  const sid = await insertSource({ runId: legacyRun.id, canonicalUrl: 'https://wire.test/d', headline, body: PAGE, author: null, byline: null, sourceName: 'Wire', sourceType: 'A1', adapterId: 'rss', bucket: 'A', publishTime: null, language: null, engagement: {}, mediaUrls: [], citationUrls: [], rawPayload: {}, dropReason: null });
  await createPostIdea(sid!, legacyRun.id, 'test');
  await scoreRun(legacyRun.id, runStartedAt, legacyJev);
  const legacyRow = (await legacy.pg.query(`SELECT ${cols} FROM reels.idea_scores`)).rows;

  // Intake: the same InterpretedScore, stored by the intake, written by scoreRun without a Jev call.
  const intake = await db();
  const { calls, jev } = stub({ scoreBy: () => 4 });
  const stored = await scoreOf(headline, 4);
  calls.n = 0;
  const a = await story(intake.pg, { n: 1, headline, lastSeen: new Date(runStartedAt.getTime() - 60_000), score: stored });
  const deps = intakeDeps(intake.q) as IntakeRunDeps;
  await registerIntakeIdeas(intake.q, await listReelsStories(deps, runStartedAt), new Date(runStartedAt.getTime() - HOUR));
  const run = (await startRun('scheduled'))!;
  await scoreRun(run.id, runStartedAt, jev, intakeScoreSource(deps));
  const intakeRow = (await intake.pg.query(`SELECT ${cols}, post_idea_id::text AS post_idea_id FROM reels.idea_scores`)).rows as Array<Record<string, unknown>>;
  assert.equal(calls.n, 0);
  assert.equal(intakeRow[0]!.post_idea_id, a);
  delete intakeRow[0]!.post_idea_id;
  assert.deepEqual(intakeRow, legacyRow);
});

test('a legacy carryover is scored the legacy way; an intake carryover uses its stored score; a merged story gives way to its survivor', async () => {
  const { pg, q } = await db();
  const runStartedAt = new Date();
  const yesterday = previousNyDateKey(runStartedAt);
  const old = new Date(runStartedAt.getTime() - 30 * HOUR);
  const survivor = await story(pg, { n: 1, headline: 'Epsilon raises', lastSeen: old, score: await scoreOf('Epsilon raises', 3) });
  const merged = await story(pg, { n: 2, headline: 'Epsilon raises money', lastSeen: old, score: await scoreOf('Epsilon raises money', 3), mergedInto: survivor });
  const prior = (await startRun('scheduled'))!;
  await pg.query(`UPDATE reels.runs SET status = 'ok' WHERE id = $1`, [prior.id]);
  const sid = await insertSource({ runId: prior.id, canonicalUrl: 'https://wire.test/legacy', headline: 'Zeta legacy story', body: PAGE, author: null, byline: null, sourceName: 'Wire', sourceType: 'A1', adapterId: 'rss', bucket: 'A', publishTime: null, language: null, engagement: {}, mediaUrls: [], citationUrls: [], rawPayload: {}, dropReason: null });
  const legacyId = await createPostIdea(sid!, prior.id, 'test');
  await pg.query(`UPDATE reels.post_ideas SET timely = false`);
  await pg.query(`INSERT INTO reels.post_ideas (id, timely) VALUES ($1, false), ($2, false)`, [survivor, merged]);
  const slate = (await pg.query<{ id: string }>(
    `INSERT INTO reels.score_slates (run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ($1, $2::date, $3, 'p1', 'p2') RETURNING id::text AS id`,
    [prior.id, yesterday, old.toISOString()],
  )).rows[0]!.id;
  // Three selected ideas so the misses below carry (a legacy idea, a merged-away story).
  for (const [n, idea, selected, net] of [[90, null, true, 3], [91, null, true, 3], [92, null, true, 3], [0, legacyId, false, 1.2], [0, merged, false, 1.1]] as const) {
    const ideaId = idea ?? id(n);
    if (!idea) await pg.query(`INSERT INTO reels.post_ideas (id, timely) VALUES ($1, false)`, [ideaId]);
    await pg.query(
      `INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, psychology, bucket_score, confidence, components)
       VALUES ($1, $2, 'timely', $3, 1, $4, 'the_saga', 'arousal', 0.6, 0.6, 0.8, '{}'::jsonb)`,
      [slate, ideaId, net, selected],
    );
  }

  const deps = intakeDeps(q) as IntakeRunDeps;
  await registerIntakeIdeas(q, await listReelsStories(deps, runStartedAt), runStartedAt);
  const { calls, jev } = stub();
  const run = (await startRun('scheduled'))!;
  const summary = await scoreRun(run.id, runStartedAt, jev, intakeScoreSource(deps));
  assert.equal(calls.n, 2, 'pass 1 + pass 2 for the legacy carryover only');
  const rows = (await pg.query<{ post_idea_id: string; origin: string }>(
    `SELECT post_idea_id::text AS post_idea_id, origin FROM reels.idea_scores WHERE slate_id = $1 ORDER BY post_idea_id`,
    [summary.slateId],
  )).rows;
  assert.deepEqual(rows, [
    { post_idea_id: survivor, origin: 'carryover' },
    { post_idea_id: legacyId, origin: 'carryover' },
  ].sort((x, y) => (x.post_idea_id < y.post_idea_id ? -1 : 1)));
  assert.ok(!rows.some((r) => r.post_idea_id === merged), 'the merged-away story is not offered again');
  assert.equal(nyDateKey(runStartedAt) !== yesterday, true);
});

test('stale-fallback and legacy run the legacy path: primary adapters fetched, no deposit run, no registration', async () => {
  for (const mode of ['stale-fallback', 'legacy'] as const) {
    const { pg, q } = await db();
    await story(pg, { n: 1, headline: 'Alpha', lastSeen: new Date(), score: await scoreOf('Alpha', 3) });
    const fetched: string[] = [];
    const intake = intakeDeps(q, { readMode: async () => mode });
    const run = (await startRun('scheduled'))!;
    const { jev } = stub();
    const outcome = await executeRun(run, {
      jev,
      copyClient: refusingCopy,
      adapters: {
        primary: [{ id: 'rss', name: 'RSS', type: 'A1', bucket: 'A', kind: 'article', async fetchItems() { fetched.push('rss'); return []; } } as unknown as Adapter],
        derived: [{ id: 'claude-web-search', name: 'B6', type: 'B6', bucket: 'B', kind: 'generated', phase: 'derived', async fetchItems() { fetched.push('b6'); return []; } } as unknown as Adapter],
      },
      intake,
    });
    assert.notEqual(outcome.status, 'failed', outcome.note);
    assert.deepEqual(fetched, ['rss', 'b6'], mode);
    assert.equal(intake.deposits.n, 0, mode);
    assert.equal(await count(pg, `reels.post_ideas WHERE id = '${id(1)}'`), 0, `${mode}: no registry row`);
    if (mode === 'stale-fallback') assert.match(outcome.note ?? '', /intake is stale/);
    else assert.doesNotMatch(outcome.note ?? '', /intake/i);
  }
});

test('an intake read that throws sends the night to the legacy path before any derived fetch', async () => {
  const { q } = await db();
  const fetched: string[] = [];
  const intake = intakeDeps(q, { listOrderStories: async () => { throw new Error('boom'); } });
  const run = (await startRun('scheduled'))!;
  const { jev } = stub();
  const outcome = await executeRun(run, {
    jev,
    copyClient: refusingCopy,
    adapters: {
      primary: [{ id: 'rss', name: 'RSS', type: 'A1', bucket: 'A', kind: 'article', async fetchItems() { fetched.push('rss'); return []; } } as unknown as Adapter],
      derived: [{ id: 'claude-web-search', name: 'B6', type: 'B6', bucket: 'B', kind: 'generated', phase: 'derived', async fetchItems() { fetched.push('b6'); return []; } } as unknown as Adapter],
    },
    intake,
  });
  assert.deepEqual(fetched, ['rss', 'b6'], 'B6 fetched once, by the legacy path');
  assert.equal(intake.deposits.n, 0);
  assert.match(outcome.note ?? '', /Intake read failed \(boom\)/);
});

test('a seed in intake mode: addIntakeSeed for the reels order, a registry row, one carryover row from the stored score', async () => {
  const { pg, q } = await db({ withSlate: true });
  const stored = await scoreOf('Seeded story', 4);
  const seeds: Array<Parameters<AddIntakeSeed>[2]> = [];
  const addSeed: AddIntakeSeed = async (_q, _jev, input) => {
    seeds.push(input);
    const sid = await story(pg, { n: 7, headline: input.headline!, lastSeen: new Date(), score: stored, seed: true });
    return { storyId: sid, created: true };
  };
  const { calls, jev } = stub();
  const intake = { query: q, readMode: async () => 'intake' as const, jev: async () => ({}) as IntakeJev, addSeed, seededBy: 'tester', now: () => new Date() };
  const out = (await addReelSeed({ headline: 'Seeded story', text: PAGE, url: 'https://news.test/seed?utm_source=x' }, { jev, intake })) as Extract<ReelSeedOutcome, { status: 'added' }>;
  assert.equal(out.status, 'added', JSON.stringify(out));
  assert.equal(out.id, id(7), 'the idea id is the story id');
  assert.equal(out.scored, true);
  assert.equal(out.net, stored.net);
  assert.equal(calls.n, 0, 'the stored reels-score is used');
  assert.deepEqual(seeds.map((s) => [s.order, s.url, s.seededBy]), [['reels', 'https://news.test/seed?utm_source=x', 'tester']]);
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 0, 'no legacy seed source');
  const idea = (await pg.query<{ timely: boolean }>(`SELECT timely FROM reels.post_ideas WHERE id = $1`, [out.id])).rows[0];
  assert.equal(idea?.timely, false);
  const rows = (await pg.query<{ slate_id: string; origin: string; net: number }>(`SELECT slate_id::text AS slate_id, origin, net FROM reels.idea_scores WHERE post_idea_id = $1`, [out.id])).rows;
  assert.deepEqual(rows, [{ slate_id: NEW_SLATE, origin: 'carryover', net: stored.net }]);
  assert.ok((await readOpenSeeds()).some((seed) => seed.id === out.id), 'listed as an open seed (through the view)');
  assert.equal(await isUnscoredSeed(out.id), false);

  // A typed idea with no link keeps the legacy write (the intake keys items by URL).
  const textOnly = await addReelSeed({ headline: 'A wholly different typed idea', text: PAGE }, { jev, intake });
  assert.equal(textOnly.status, 'added');
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 1);
});

test('an intake seed with no stored reels-score is scored once, as a legacy seed is', async () => {
  const { pg, q } = await db({ withSlate: true });
  const addSeed: AddIntakeSeed = async (_q, _jev, input) => ({ storyId: await story(pg, { n: 8, headline: input.headline!, lastSeen: new Date(), seed: true }), created: true });
  const { calls, jev } = stub();
  const out = await addReelSeed(
    { headline: 'Unscored seed story', text: PAGE, url: 'https://news.test/unscored' },
    { jev, intake: { query: q, readMode: async () => 'intake', jev: async () => ({}) as IntakeJev, addSeed, now: () => new Date() } },
  );
  assert.equal(out.status, 'added');
  assert.equal(calls.n, 2);
  assert.equal(await count(pg, `reels.idea_scores WHERE post_idea_id = '${id(8)}'`), 1);
});

/* ── review fixes ─────────────────────────────────────────────────────── */

const primaryStub = (fetched: string[]) =>
  ({ id: 'rss', name: 'RSS', type: 'A1', bucket: 'A', kind: 'article', async fetchItems() { fetched.push('rss'); return []; } }) as unknown as Adapter;
const b6Stub = (fetched: string[]) =>
  ({ id: 'claude-web-search', name: 'B6', type: 'B6', bucket: 'B', kind: 'generated', phase: 'derived', async fetchItems() { fetched.push('b6'); return []; } }) as unknown as Adapter;

test("no successful main intake run tonight: the stale (legacy) path before any fetch, with a note", async () => {
  for (const last of [null, 20] as const) {
    const { pg, q } = await db();
    await story(pg, { n: 1, headline: 'Alpha', lastSeen: new Date(Date.now() - 20 * HOUR), score: await scoreOf('Alpha', 3) });
    const fetched: string[] = [];
    const intake = intakeDeps(q, { lastMainStart: async () => (last == null ? null : new Date(Date.now() - last * HOUR)) });
    const run = (await startRun('scheduled'))!;
    const { jev } = stub();
    const outcome = await executeRun(run, { jev, copyClient: refusingCopy, adapters: { primary: [primaryStub(fetched)], derived: [b6Stub(fetched)] }, intake });
    assert.notEqual(outcome.status, 'failed', outcome.note);
    assert.deepEqual(fetched, ['rss', 'b6'], 'B6 fetched once, by the legacy path');
    assert.equal(intake.deposits.n, 0);
    assert.equal(await count(pg, `reels.post_ideas WHERE id = '${id(1)}'`), 0, 'no registration');
    assert.match(outcome.note ?? '', /main intake run has not succeeded/);
  }
  const now = new Date();
  assert.equal(isTonightsMain(now, new Date(now.getTime() - HOUR)), true);
  assert.equal(isTonightsMain(now, new Date(now.getTime() - 13 * HOUR)), false);
  assert.equal(isTonightsMain(now, null), false);
});

test('an intake read that throws inside the slate reads falls back to the legacy path, B6 not fetched twice', async () => {
  const { pg, q } = await db();
  await story(pg, { n: 1, headline: 'Alpha model ships', lastSeen: new Date(Date.now() - 10 * 60_000), score: await scoreOf('Alpha model ships', 3) });
  // The stored-score read (readStoredReelsScores) fails; everything else reads as normal.
  const failing: IntakeQuery = {
    query: async (text, params) => {
      if (text.includes('LEFT JOIN reels.post_ideas i ON i.id = s.id')) throw new Error('scores read down');
      return q.query(text, params);
    },
  };
  const seen: string[][] = [];
  const fetched: string[] = [];
  const intake = intakeDeps(failing);
  const run = (await startRun('scheduled'))!;
  const { jev } = stub();
  const outcome = await executeRun(run, {
    jev,
    copyClient: refusingCopy,
    adapters: { primary: [primaryStub(fetched)], derived: [derivedStub('claude-web-search', find(3, 'B6'), 'b6', seen)] },
    intake,
  });
  assert.equal(seen.length, 1, 'B6 fetched once (intake night); the legacy path replays its finds');
  assert.deepEqual(fetched, ['rss'], 'the legacy path fetched the primary adapters');
  assert.equal(intake.deposits.n, 1);
  assert.match(outcome.note ?? '', /Intake read failed \(scores read down\)/);
  assert.notEqual(outcome.status, 'failed', outcome.note);
});

test('switchTwinDrops: the intake twin wins unless only the legacy idea has been made; a held legacy idea drops only its twin', () => {
  const pairs = [{ legacy: 'L', intake: 'S' }];
  assert.deepEqual([...switchTwinDrops(pairs, new Set(['L', 'S']), new Set())], ['L']);
  assert.deepEqual([...switchTwinDrops(pairs, new Set(['L', 'S']), new Set(['L']))], ['S']);
  assert.deepEqual([...switchTwinDrops(pairs, new Set(['L', 'S']), new Set(['S']))], ['L']);
  assert.deepEqual([...switchTwinDrops(pairs, new Set(['L', 'S']), new Set(['L', 'S']))], ['L']);
  // Held (selected yesterday, scheduled, not a candidate): its twin gives way when the legacy idea has the work.
  assert.deepEqual([...switchTwinDrops(pairs, new Set(['S']), new Set(['L']))], ['S']);
  assert.deepEqual([...switchTwinDrops(pairs, new Set(['S']), new Set())], []);
});

test('switch night: a legacy carryover and its intake twin (same URL) are never both on the slate', async () => {
  for (const legacyMade of [false, true]) {
    const { pg, q } = await db();
    const runStartedAt = new Date();
    const yesterday = previousNyDateKey(runStartedAt);
    const old = new Date(runStartedAt.getTime() - 30 * HOUR);
    const prior = (await startRun('scheduled'))!;
    await pg.query(`UPDATE reels.runs SET status = 'ok' WHERE id = $1`, [prior.id]);
    // The legacy idea X carries https://wire.test/1, the URL of intake story S (n = 1), timely tonight.
    const sid = await insertSource({ runId: prior.id, canonicalUrl: 'https://wire.test/1', headline: 'Theta legacy', body: PAGE, author: null, byline: null, sourceName: 'Wire', sourceType: 'A1', adapterId: 'rss', bucket: 'A', publishTime: null, language: null, engagement: {}, mediaUrls: [], citationUrls: [], rawPayload: {}, dropReason: null });
    const legacyId = await createPostIdea(sid!, prior.id, 'test');
    await pg.query(`UPDATE reels.post_ideas SET timely = false`);
    const slate = (await pg.query<{ id: string }>(
      `INSERT INTO reels.score_slates (run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES ($1, $2::date, $3, 'p1', 'p2') RETURNING id::text AS id`,
      [prior.id, yesterday, old.toISOString()],
    )).rows[0]!.id;
    for (const [n, idea, selected, net] of [[90, null, true, 3], [91, null, true, 3], [92, null, true, 3], [0, legacyId, false, 1.2]] as const) {
      const ideaId = idea ?? id(n);
      if (!idea) await pg.query(`INSERT INTO reels.post_ideas (id, timely) VALUES ($1, false)`, [ideaId]);
      await pg.query(
        `INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, rank, selected, chosen_bucket, chosen_framework, psychology, bucket_score, confidence, components)
         VALUES ($1, $2, 'timely', $3, 1, $4, 'the_saga', 'arousal', 0.6, 0.6, 0.8, '{}'::jsonb)`,
        [slate, ideaId, net, selected],
      );
    }
    if (legacyMade) await pg.query(`INSERT INTO reels.video_jobs (post_idea_id, status) VALUES ($1, 'ok')`, [legacyId]);
    const twin = await story(pg, { n: 1, headline: 'Theta intake', lastSeen: new Date(runStartedAt.getTime() - 60_000), score: await scoreOf('Theta intake', 3) });

    const deps = intakeDeps(q) as IntakeRunDeps;
    await registerIntakeIdeas(q, await listReelsStories(deps, runStartedAt), new Date(runStartedAt.getTime() - HOUR));
    const { calls, jev } = stub();
    const run = (await startRun('scheduled'))!;
    const summary = await scoreRun(run.id, runStartedAt, jev, intakeScoreSource(deps));
    const ids = (await pg.query<{ post_idea_id: string }>(
      `SELECT post_idea_id::text AS post_idea_id FROM reels.idea_scores WHERE slate_id = $1`,
      [summary.slateId],
    )).rows.map((r) => r.post_idea_id);
    if (legacyMade) {
      assert.deepEqual(ids, [legacyId], 'the legacy idea that already has a video stays; its twin gives way');
      assert.equal(calls.n, 2, 'the legacy carryover is scored the legacy way');
    } else {
      assert.deepEqual(ids, [twin], 'the intake twin replaces the legacy carryover');
      assert.equal(calls.n, 0);
    }
  }
});

test('health in intake mode: primary adapter counts come from the newest main intake run record; legacy reads reels.sources', async () => {
  const { pg } = await db();
  const started = new Date(Date.now() - HOUR).toISOString();
  await pg.query(
    `INSERT INTO intake.runs (kind, status, record, started_at, finished_at) VALUES ('main', 'ok', $1::jsonb, $2, $2)`,
    [JSON.stringify({ kind: 'main', orders: ['reels'], scored: true, sources: [{ id: 'hacker-news', fetched: 9, kept: 4, dropped: {} }] }), started],
  );
  await pg.query(`INSERT INTO intake.watermarks (source_id, last_success_at, last_attempt_at) VALUES ('hacker-news', $1, $1)`, [started]);

  const legacy = (await loadHealthPage()).sources.find((s) => s.id === 'hacker-news')!;
  assert.deepEqual([legacy.ingested, legacy.seen], [0, 0], 'legacy: reels.sources (none)');

  await pg.query(`UPDATE intake.settings SET value = jsonb_set(value, '{reels}', '"intake"') WHERE key = 'consumers'`);
  const sources = (await loadHealthPage()).sources;
  const hn = sources.find((s) => s.id === 'hacker-news')!;
  assert.deepEqual([hn.ingested, hn.seen], [4, 9]);
  assert.equal(hn.lastSuccessAt != null, true, 'the intake watermark');
  assert.equal(hn.tone, 'fresh');
});

test('a typed idea with no link in intake mode: a double-click is the same legacy seed, never a second one', async () => {
  const { pg, q } = await db({ withSlate: true });
  const { jev } = stub();
  const intake = { query: q, readMode: async () => 'intake' as const, jev: async () => ({}) as IntakeJev, addSeed: (async () => assert.fail('no link: not an intake seed')) as AddIntakeSeed, now: () => new Date() };
  const first = await addReelSeed({ headline: 'A typed idea with no link', text: PAGE }, { jev, intake });
  const again = await addReelSeed({ headline: 'A typed idea with no link', text: PAGE }, { jev, intake });
  assert.equal(first.status, 'added');
  assert.equal(again.status, 'added');
  assert.equal((again as Extract<ReelSeedOutcome, { status: 'added' }>).repeat, true);
  assert.equal((again as Extract<ReelSeedOutcome, { status: 'added' }>).id, (first as Extract<ReelSeedOutcome, { status: 'added' }>).id);
  assert.equal(await count(pg, `reels.sources WHERE adapter_id = 'seed'`), 1);
});
