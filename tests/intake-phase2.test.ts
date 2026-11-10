/**
 * Central intake Phase 2, Owner A (planning/Central Intake/PHASE2-CONTRACT.md), offline: PGlite with
 * db/intake_schema.sql, fake settings tables, stub Field Notes sources, a stub Jev transport, stub scorecards.
 * No live Claude, Jev, web or real DB.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

import type { SourceEntry as FieldNotesSourceEntry } from '@/lib/field-notes/sources/registry';
import { FIELD_NOTES_SCORE } from '@/lib/field-notes/sources/questions';
import { depositFindAs, A4_DEPOSIT } from '@/lib/intake/deposit';
import { fetchFieldNotesItems, planSources, upsertItem, type FieldNotesFetchers } from '@/lib/intake/fetch';
import { pickFieldNotesStories } from '@/lib/intake/field-notes-cap';
import { groupIntake, type GroupingResult } from '@/lib/intake/group';
import { createIntakeJev } from '@/lib/intake/jev';
import { CAROUSEL_ORDER, FIELD_NOTES_ORDER, openOrders, REELS_ORDER } from '@/lib/intake/orders';
import { lastSuccessfulMainStart, listOrderStories, loadStories, readConsumerMode, readConsumerSettings, resolveStoryId } from '@/lib/intake/read';
import { pruneIntake, retentionDays } from '@/lib/intake/retention';
import { previousUnscored, runIntakeDeposit, runIntakeWith, type IntakeRunDeps, type ScoreForStories } from '@/lib/intake/run';
import { carouselMembersOf, FIELD_NOTES_CARD, fieldNotesCard, STORY_SCORING, type FieldNotesMember } from '@/lib/intake/scorecards';
import type { IntakeOrder, IntakeQuery, IntakeStory, Scorecard } from '@/lib/intake/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { Adapter, AdapterItem } from '@/lib/reels/types';

import { planReplay, renderPlan, safeKey, type Snapshot } from '../scripts/intake/replay';
import { carouselNightFrom, planPhase2, renderPhase2Report, runPhase2, type Phase2Snapshot } from '../scripts/intake/replay-phase2';

const SCHEMA = readFileSync(path.join(process.cwd(), 'db', 'intake_schema.sql'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => !line.startsWith('\\'))
  .join('\n');

async function newDb(extra = ''): Promise<{ pg: PGlite; q: IntakeQuery }> {
  const pg = new PGlite({ extensions: { pg_trgm } });
  await pg.exec(SCHEMA + extra);
  return { pg, q: { query: async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] }) } };
}

let pg: PGlite;
let q: IntakeQuery;
before(async () => ({ pg, q } = await newDb()));
after(async () => pg.close());
beforeEach(async () => {
  await pg.exec(`TRUNCATE intake.scores, intake.items, intake.pair_decisions, intake.runs, intake.watermarks, intake.cost_events CASCADE;
                 DELETE FROM intake.stories;`);
});

const NOW = new Date('2026-11-10T05:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LONG = ' It shipped with documentation, pricing, benchmarks and a long write-up that explains what changed and why.'.repeat(4);
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const count = async (sql: string, params: unknown[] = []) => Number((await q.query<{ n: number }>(sql, params)).rows[0]!.n);

/* ── stubs ────────────────────────────────────────────────────────────── */

function stubTransport(calls: { grouping: string[][]; other: number } = { grouping: [], other: 0 }): JevTransport {
  return {
    async systemOne(state, questions) {
      const keys = Object.keys(questions);
      const s = state as Record<string, { headline?: string }>;
      let answers: Record<string, unknown>;
      if (keys.includes('relationship')) {
        calls.grouping.push([String(s.item_a?.headline), String(s.item_b?.headline)]);
        const same = String(s.item_a?.headline).includes('Acme') && String(s.item_b?.headline).includes('Acme');
        answers = { sameEvent: { type: 'noul', noul: same ? 0.95 : 0.02 }, relationship: { type: 'choice', choice: same ? 'link' : 'unrelated', confidence: 0.9, probabilities: {} } };
      } else if (keys.includes('action')) {
        answers = { sameEvent: { type: 'noul', noul: 0.05 }, action: { type: 'choice', choice: 'keep_separate', confidence: 0.9, probabilities: {} } };
      } else {
        calls.other += 1;
        answers = Object.fromEntries(keys.map((k) => [k, { type: 'noul', noul: k === 'about_ai' ? 0.9 : 0.8 }]));
      }
      return { model: 'stub-jev', answers, usage: { input_tokens: 1000, output_tokens: 0 } } as never;
    },
  };
}

const adapterItem = (url: string, headline: string, publishTime = new Date(NOW.getTime() - HOUR)): AdapterItem => ({ canonicalUrl: url, headline, body: `${headline}.${LONG}`, publishTime, textIsComplete: true });

function fnEntry(id: string, items: () => AdapterItem[], seen = { fetches: 0 }): FieldNotesSourceEntry {
  const adapter: Adapter = {
    id,
    name: `Stub ${id}`,
    type: 'A6',
    bucket: 'A',
    kind: 'dated',
    async fetchItems() {
      seen.fetches += 1;
      return items();
    },
  };
  return { id, label: `Stub ${id}`, kind: 'rss', type: 'adapter', adapter, why: 'test' };
}

const NO_NET: FieldNotesFetchers = {
  fetchText: async () => {
    throw new Error('offline');
  },
  fetchJson: async () => {
    throw new Error('offline');
  },
};

async function insertStory(id: string, o: { lastJoined?: Date; mergedInto?: string | null } = {}) {
  await q.query(`INSERT INTO intake.stories (id, representative_key, headline, first_seen_at, last_joined_at, merged_into) VALUES ($1, $2, $3, $4, $4, $5)`, [
    id,
    `k-${id}`,
    `Story ${id}`,
    o.lastJoined ?? NOW,
    o.mergedInto ?? null,
  ]);
}

async function insertItem(key: string, storyId: string | null, cols: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = { key, family: 'reels', source_id: 'hacker-news', source_name: 'HN', source_type: 'B1', headline: `About ${key}`, body: 'text', url: `https://x.test/${key}`, story_id: storyId, role: storyId ? 'primary' : null, first_seen_at: NOW, last_seen_at: NOW, ...cols };
  const names = Object.keys(base);
  await q.query(`INSERT INTO intake.items (${names.join(', ')}) VALUES (${names.map((n, i) => (n === 'field_notes_meta' ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})`, Object.values(base));
}

/* ── 2. orders ────────────────────────────────────────────────────────── */

function fakeTables(tables: Record<string, unknown[]>): { q: IntakeQuery; reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    q: {
      async query<T>(text: string) {
        const table = (text.match(/FROM (\w+\.\w+)/) ?? [])[1] ?? text;
        reads.push(table);
        const rows = tables[table];
        if (!rows) throw new Error(`relation "${table}" does not exist`);
        return { rows: rows as T[] };
      },
    },
  };
}

test('reels order: open unless reels auto_run is false, or when a reels run is queued; a missing table is closed; reads only reels.*', async () => {
  assert.equal(await REELS_ORDER.isOpen(fakeTables({}).q, NOW), false, 'missing tables');
  assert.equal(await REELS_ORDER.isOpen(fakeTables({ 'reels.settings': [], 'reels.runs': [] }).q, NOW), true, 'no row = on (as the reels worker reads it)');
  assert.equal(await REELS_ORDER.isOpen(fakeTables({ 'reels.settings': [{ value: false }], 'reels.runs': [] }).q, NOW), false);
  const f = fakeTables({ 'reels.settings': [{ value: false }], 'reels.runs': [{ x: 1 }] });
  assert.equal(await REELS_ORDER.isOpen(f.q, NOW), true, 'a queued run');
  assert.ok(f.reads.every((r) => r.startsWith('reels.')), f.reads.join(','));
  assert.deepEqual([REELS_ORDER.sources, REELS_ORDER.lookbackDays, REELS_ORDER.scorecards], [['reels:*'], 14, ['reels-screen', 'reels-score']]);
});

test('carousel order: social auto_run true or a queued/running social run; reads only social.*', async () => {
  assert.equal(await CAROUSEL_ORDER.isOpen(fakeTables({}).q, NOW), false);
  assert.equal(await CAROUSEL_ORDER.isOpen(fakeTables({ 'social.settings': [], 'social.runs': [] }).q, NOW), false, 'off unless set');
  assert.equal(await CAROUSEL_ORDER.isOpen(fakeTables({ 'social.settings': [{ value: true }] }).q, NOW), true);
  const f = fakeTables({ 'social.settings': [{ value: false }], 'social.runs': [{ x: 1 }] });
  assert.equal(await CAROUSEL_ORDER.isOpen(f.q, NOW), true);
  assert.ok(f.reads.every((r) => r.startsWith('social.')), f.reads.join(','));
  assert.deepEqual([CAROUSEL_ORDER.sources, CAROUSEL_ORDER.lookbackDays, CAROUSEL_ORDER.scorecards], [['feeds:*', 'reels:*'], 2, ['story-scoring']]);
});

test('field-notes order: field_notes auto_run on or a requested Field Notes run; reads only field_notes.*', async () => {
  assert.equal(await FIELD_NOTES_ORDER.isOpen(fakeTables({}).q, NOW), false);
  assert.equal(await FIELD_NOTES_ORDER.isOpen(fakeTables({ 'field_notes.settings': [{ value: false }], 'field_notes.runs': [] }).q, NOW), false);
  assert.equal(await FIELD_NOTES_ORDER.isOpen(fakeTables({ 'field_notes.settings': [{ value: true }] }).q, NOW), true);
  const f = fakeTables({ 'field_notes.settings': [{ value: false }], 'field_notes.runs': [{ x: 1 }] });
  assert.equal(await FIELD_NOTES_ORDER.isOpen(f.q, NOW), true);
  assert.ok(f.reads.every((r) => r.startsWith('field_notes.')), f.reads.join(','));
  assert.deepEqual([FIELD_NOTES_ORDER.sources, FIELD_NOTES_ORDER.lookbackDays, FIELD_NOTES_ORDER.scorecards], [['field-notes:*'], 45, ['field-notes-score']]);
  // Each opens alone.
  const open = await openOrders(fakeTables({ 'field_notes.settings': [{ value: true }] }).q, NOW);
  assert.deepEqual(open.map((o) => o.id), ['field-notes']);
});

test('planSources: the new orders’ sources; Field Notes’ 45 days never widen the reels window', () => {
  const adapter: Adapter = { id: 'a1', name: 'A1', type: 'B1', bucket: 'B', kind: 'dated', fetchItems: async () => [] };
  const entries = [fnEntry('fn1', () => []), fnEntry('fn2', () => [])];
  const all = planSources([REELS_ORDER, CAROUSEL_ORDER, FIELD_NOTES_ORDER], [adapter], undefined, entries);
  assert.deepEqual([all.adapters.map((a) => a.id), all.feeds.length, all.fieldNotes.map((e) => e.id), all.lookbackDays, all.fieldNotesLookbackDays], [['a1'], 19, ['fn1', 'fn2'], 14, 45]);
  const fn = planSources([FIELD_NOTES_ORDER], [adapter], undefined, entries);
  assert.deepEqual([fn.adapters.length, fn.feeds.length, fn.fieldNotes.length], [0, 0, 2]);
  const carousel = planSources([CAROUSEL_ORDER], [adapter], undefined, entries);
  assert.deepEqual([carousel.adapters.length, carousel.feeds.length, carousel.fieldNotes.length, carousel.lookbackDays], [1, 19, 0, 2]);
});

/* ── 3. Field Notes fetch ─────────────────────────────────────────────── */

test('fetchFieldNotesItems: new items are field-notes items; a URL a reels adapter stored first gains membership (stored once)', async () => {
  await upsertItem(q, { key: 'https://example.com/shared', family: 'reels', sourceId: 'hacker-news', sourceName: 'HN', sourceType: 'B1', headline: 'Shared story', body: 'reels body', url: 'https://example.com/shared', publishTime: null, dropReason: null, runId: null }, NOW);
  const seen = { fetches: 0 };
  const entry = fnEntry('stub-fn', () => [adapterItem('https://www.example.com/shared/', 'Shared story'), adapterItem('https://example.com/tip?utm_source=x', 'A Claude Code tip')], seen);
  const touched = new Set<string>();
  const out = await fetchFieldNotesItems({ query: q, now: NOW, runId: null, entries: [entry], fetchers: NO_NET, touched });
  assert.deepEqual([out.collected, out.stored, out.joined, seen.fetches], [2, 1, 1, 1]);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items`), 2);
  const shared = (await q.query<{ family: string; field_notes_source_id: string; drop_reason: string | null; reels_source_id: string }>(`SELECT family, field_notes_source_id, drop_reason, reels_source_id FROM intake.items WHERE key = 'https://example.com/shared'`)).rows[0]!;
  assert.deepEqual(shared, { family: 'reels', field_notes_source_id: 'stub-fn', drop_reason: null, reels_source_id: 'hacker-news' });
  const tip = (await q.query<{ family: string; source_id: string; headline: string; body: string; field_notes_source_id: string }>(`SELECT family, source_id, headline, body, field_notes_source_id FROM intake.items WHERE key = 'https://example.com/tip'`)).rows[0]!;
  assert.deepEqual([tip.family, tip.source_id, tip.headline, tip.field_notes_source_id], ['field-notes', 'field-notes:stub-fn', 'A Claude Code tip', 'stub-fn']);
  assert.ok(tip.body.startsWith('A Claude Code tip.'));
  // Again: nothing new is stored.
  const again = await fetchFieldNotesItems({ query: q, now: NOW, runId: null, entries: [entry], fetchers: NO_NET });
  assert.deepEqual([again.stored, again.joined, again.alreadySeen], [0, 0, 2]);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items`), 2);
});

test('grouping skips Field Notes items: each is its own story, never in a grouping pair', async () => {
  const entry = fnEntry('fn', () => [adapterItem('https://example.com/fn-acme', 'Acme launches Rocket model')]);
  await fetchFieldNotesItems({ query: q, now: NOW, runId: null, entries: [entry], fetchers: NO_NET });
  await upsertItem(q, { key: 'https://example.com/reels-acme', family: 'reels', sourceId: 'hacker-news', sourceName: 'HN', sourceType: 'B1', headline: 'Acme launches Rocket model today', body: `Acme.${LONG}`, url: 'https://example.com/reels-acme', publishTime: NOW, dropReason: null, runId: null }, NOW);
  await upsertItem(q, { key: 'https://example.com/reels-acme-2', family: 'reels', sourceId: 'the-verge', sourceName: 'Verge', sourceType: 'B1', headline: 'Acme Rocket model launch', body: `Acme.${LONG}`, url: 'https://example.com/reels-acme-2', publishTime: NOW, dropReason: null, runId: null }, NOW);
  const calls = { grouping: [] as string[][], other: 0 };
  const jev = createIntakeJev(stubTransport(calls), q, null, 1);
  const summary: GroupingResult = { created: 0, joined: 0, merges: 0, pairCalls: 0, cacheHits: 0, touched: new Set(), failures: [] };
  await groupIntake(q, jev.asReelsRunner(), uid(77), NOW, summary);
  const rows = (await q.query<{ key: string; story_id: string }>(`SELECT key, story_id::text AS story_id FROM intake.items ORDER BY key`)).rows;
  const fn = rows.find((r) => r.key.endsWith('fn-acme'))!;
  const reels = rows.filter((r) => r.key.includes('reels-acme'));
  assert.ok(fn.story_id && reels.every((r) => r.story_id === reels[0]!.story_id), 'the two reels items grouped');
  assert.notEqual(fn.story_id, reels[0]!.story_id, 'the Field Notes item is its own story');
  assert.ok(calls.grouping.every((pair) => !pair.includes('Acme launches Rocket model')), 'no pair asked about the Field Notes item');
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items WHERE story_id = $1`, [fn.story_id]), 1);
});

/* ── 4. FIELD_NOTES_CARD ──────────────────────────────────────────────── */

test('FIELD_NOTES_CARD: Field Notes’ own version; scores one member, enriches only what it scores and keeps the enriched body', async () => {
  assert.equal(FIELD_NOTES_CARD.version, FIELD_NOTES_SCORE.version);
  assert.equal(FIELD_NOTES_CARD.version, 'field-notes-score@3');
  const key = 'https://github.com/acme/rocket';
  await insertStory(uid(1));
  await insertItem(key, uid(1), {
    family: 'field-notes',
    source_id: 'field-notes:gh',
    headline: 'acme/rocket',
    body: 'A rocket CLI.',
    field_notes_source_id: 'gh',
    field_notes_meta: JSON.stringify({ kind: 'github', label: 'GitHub search', item: {}, enrich: 'readme', publishedAt: null }),
  });
  const fetched: string[] = [];
  const card = fieldNotesCard({
    enrich: { fetchText: async (url) => (fetched.push(url), `# Rocket\n\n${'Rocket runs Claude agents from your terminal with one command. '.repeat(10)}`), fetchPage: async () => ({ html: '', finalUrl: '' }) },
    today: () => '2026-11-10',
  }).withQuery(q);
  const [story] = await loadStories(q, [uid(1)]);
  const calls = { grouping: [], other: 0 };
  const out = await card.score(story!, createIntakeJev(stubTransport(calls), q, null, 1));
  assert.equal(calls.other, 1, 'one Jev call');
  assert.equal(fetched.length, 1);
  assert.equal(out.result.kind, 'field-notes-score');
  assert.ok(out.result.kind === 'field-notes-score' && Math.abs(out.result.score - 0.8) < 1e-9, JSON.stringify(out.result));
  const body = (await q.query<{ body: string }>(`SELECT body FROM intake.items WHERE key = $1`, [key])).rows[0]!.body;
  assert.ok(body.startsWith('A rocket CLI.') && body.includes('Rocket runs Claude agents'), 'the enriched body is kept on the item');
  // The member carries its registry id for Field Notes (fieldNotesSourceId).
  assert.equal((story!.members[0] as FieldNotesMember).fieldNotesSourceId, 'gh');
});

test('Field Notes cap: at most MAX_SCORED_PER_RUN in scoringOrder (5 per source); the rest carry to the next run', async () => {
  const items = Array.from({ length: 7 }, (_, i) => adapterItem(`https://example.com/tip-${i}`, `Tip number ${i} about Claude`, new Date(NOW.getTime() - (i + 1) * HOUR)));
  const entry = fnEntry('one-source', () => items);
  const scored: string[][] = [];
  const card: Scorecard = { id: 'field-notes-score', version: 'field-notes-score@3', families: ['field-notes'], score: async () => ({ answers: {}, result: { kind: 'field-notes-score', score: 0.5, tags: { leaf: null, want: null, tier: null, purposes: [], fresh: false }, answers: {} }, usd: 0 }) };
  const score: ScoreForStories = async (_q, _j, stories, _o, cards) => {
    if (cards.some((c) => c.id === 'field-notes-score')) scored.push(stories.map((s) => s.members[0]!.key));
    for (const story of stories)
      await q.query(`INSERT INTO intake.scores (story_id, scorecard, version, member_hash, result) VALUES ($1, 'field-notes-score', 'v', 'h', '{}'::jsonb)`, [story.id]);
    return { 'field-notes-score': { scored: stories.length, cached: 0, usd: 0 } } as never;
  };
  const order: IntakeOrder = { ...FIELD_NOTES_ORDER, isOpen: async () => true };
  const deps = (now: Date): IntakeRunDeps => ({
    query: q,
    jev: createIntakeJev(stubTransport(), q, null, 1),
    now: () => now,
    adapters: [],
    fetchFeeds: async () => [],
    orders: [order],
    scorecards: [card],
    fieldNotes: NO_NET,
    fieldNotesEntries: [entry],
  });
  const first = await runIntakeWith(deps(NOW), 'main', score);
  assert.equal(scored[0]!.length, 5, 'five per source in one run');
  assert.deepEqual([...scored[0]!].sort(), items.slice(0, 5).map((i) => i.canonicalUrl).sort(), 'the five newest (scoringOrder)');
  assert.equal(first.record.unscored?.length, 2, 'two left for the next run');
  const second = await runIntakeWith(deps(new Date(NOW.getTime() + HOUR)), 'topup', score);
  // The two are re-seen tonight with no field-notes-score row (the backlog puts them back in touched), so they are not
  // also counted as carried; the five scored ones are not scored again.
  assert.equal(second.record.carried, undefined);
  assert.deepEqual(scored[1]!.sort(), items.slice(5).map((i) => i.canonicalUrl).sort(), 'the deferred two are scored next');
  // pickFieldNotesStories directly: a slot count is honoured.
  const stories = await loadStories(q, (await q.query<{ id: string }>(`SELECT id::text AS id FROM intake.stories`)).rows.map((r) => r.id));
  const pick = await pickFieldNotesStories(q, stories, card, 3);
  assert.deepEqual([pick.selected.length, pick.deferred.length], [3, 4]);
});

/* ── 5. deposit run ───────────────────────────────────────────────────── */

test('runIntakeDeposit: no fetch, groups and scores only the new items, passes the orphans on, honours the cap, never throws', async () => {
  // A previous main run left one orphan.
  await insertStory(uid(9));
  await q.query(`INSERT INTO intake.runs (kind, status, started_at, finished_at, record) VALUES ('main', 'ok', $1, $1, $2::jsonb)`, [new Date(NOW.getTime() - HOUR), JSON.stringify({ orders: ['reels'], unscored: [uid(9)] })]);
  await depositFindAs(q, adapterItem('https://example.com/a4-find', 'Globex adds a list of agent tools'), NOW, A4_DEPOSIT);
  const scored: IntakeStory[][] = [];
  const score: ScoreForStories = async (_q, _j, stories) => (scored.push(stories), { 'reels-score': { scored: stories.length, cached: 0, usd: 0 } } as never);
  const card: Scorecard = { id: 'reels-score', version: 'v', families: ['reels', 'search'], score: async () => ({ answers: {}, result: { kind: 'major-news', score: 0 }, usd: 0 }) };
  const order: IntakeOrder = { ...REELS_ORDER, isOpen: async () => true };
  const { runId, record } = await runIntakeDeposit(q, { jev: createIntakeJev(stubTransport(), q, null, 0.15), now: () => NOW, orders: [order], scorecards: [card], score, log: () => {} });
  assert.equal(record.kind, 'deposit');
  assert.deepEqual(record.sources, [], 'nothing fetched');
  assert.equal(scored.length, 1);
  assert.deepEqual(scored[0]!.map((s) => s.members.map((m) => m.key)), [['https://example.com/a4-find']], 'only the new find');
  assert.ok(record.unscored?.includes(uid(9)), 'the orphan passes through to the next fetching run');
  assert.equal(record.carried, undefined);
  assert.equal((await q.query<{ kind: string; status: string }>(`SELECT kind, status FROM intake.runs WHERE id = $1`, [runId])).rows[0]!.kind, 'deposit');

  // The cap: two similar finds need a pair call, the cap (0) refuses it; the run stops 'cap', the stories wait.
  await depositFindAs(q, adapterItem('https://example.com/acme-1', 'Acme ships an agent SDK'), NOW, A4_DEPOSIT);
  await depositFindAs(q, adapterItem('https://example.com/acme-2', 'Acme agent SDK ships'), NOW, A4_DEPOSIT);
  const capped = await runIntakeDeposit(q, { jev: createIntakeJev(stubTransport(), q, null, 0), now: () => NOW, orders: [order], scorecards: [card], score, log: () => {} });
  assert.equal(capped.record.stopReason, 'cap');
  assert.ok((capped.record.unscored ?? []).length >= 1);

  // Never throws.
  const broken: IntakeQuery = { query: async () => Promise.reject(new Error('db down')) };
  const failed = await runIntakeDeposit(broken, { jev: createIntakeJev(stubTransport(), q, null, 0.15), orders: [order], scorecards: [card], score, log: () => {} });
  assert.equal(failed.record.stopReason, 'error');
});

/* ── 6. reads ─────────────────────────────────────────────────────────── */

test('resolveStoryId follows the merge chain; unknown or non-uuid ids are null', async () => {
  await insertStory(uid(1));
  await insertStory(uid(2), { mergedInto: uid(1) });
  await insertStory(uid(3), { mergedInto: uid(2) });
  assert.equal(await resolveStoryId(q, uid(3)), uid(1));
  assert.equal(await resolveStoryId(q, uid(2)), uid(1));
  assert.equal(await resolveStoryId(q, uid(1)), uid(1));
  assert.equal(await resolveStoryId(q, uid(99)), null);
  assert.equal(await resolveStoryId(q, 'not-a-uuid'), null);
});

test('listOrderStories: each order gets the stories its sources cover and keep (its own seeds included)', async () => {
  for (const n of [1, 2, 3, 4, 5, 6]) await insertStory(uid(n));
  await insertItem('reels-kept', uid(1), { reels_source_id: 'hacker-news' });
  await insertItem('feed-only', uid(2), { family: 'feeds', source_id: 'feed:techcrunch', feed_slug: 'techcrunch' });
  await insertItem('fn-only', uid(3), { family: 'field-notes', source_id: 'field-notes:x', field_notes_source_id: 'x', field_notes_meta: '{}' });
  await insertItem('seed-reels', uid(4), { family: 'seed', source_id: 'seed:reels' });
  await insertItem('reels-dropped-feed-kept', uid(5), { reels_source_id: 'hacker-news', reels_drop_reason: 'off_topic', feed_slug: 'verge' });
  await insertItem('search-find', uid(6), { family: 'search', source_id: 'search:b6' });
  const ids = async (order: 'reels' | 'carousel' | 'field-notes' | 'lfd') =>
    (await listOrderStories(q, order, { since: new Date(NOW.getTime() - DAY) })).map((s) => s.members[0]!.key).sort();
  assert.deepEqual(await ids('reels'), ['reels-kept', 'search-find', 'seed-reels']);
  assert.deepEqual(await ids('carousel'), ['feed-only', 'reels-dropped-feed-kept', 'reels-kept', 'search-find']);
  assert.deepEqual(await ids('field-notes'), ['fn-only']);
  assert.deepEqual(await ids('lfd'), ['feed-only', 'reels-dropped-feed-kept', 'reels-kept', 'search-find']);
});

test('readConsumerSettings has seven keys; readConsumerMode is per order: its sources must be fetched in the window', async () => {
  await q.query(`INSERT INTO intake.settings (key, value) VALUES ('consumers', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [
    JSON.stringify({ md: 'intake', reels: 'intake', carousel: 'intake', 'field-notes': 'intake' }),
  ]);
  const settings = await readConsumerSettings(q);
  assert.deepEqual(settings, { lfd: 'legacy', md: 'intake', fvp: 'legacy', reels: 'intake', carousel: 'intake', 'field-notes': 'intake' });
  await q.query(`INSERT INTO intake.runs (kind, status, started_at, record) VALUES ('main', 'ok', $1, $2::jsonb)`, [new Date(NOW.getTime() - 2 * HOUR), JSON.stringify({ orders: ['md', 'reels', 'carousel'], scored: true })]);
  assert.equal(await readConsumerMode(q, 'md', NOW), 'intake');
  assert.equal(await readConsumerMode(q, 'carousel', NOW), 'intake');
  assert.equal(await readConsumerMode(q, 'reels', NOW), 'intake');
  assert.equal(await readConsumerMode(q, 'field-notes', NOW), 'stale-fallback', 'closed at midnight: nothing fresh');
  await q.query(`INSERT INTO intake.runs (kind, status, started_at, record) VALUES ('deposit', 'ok', $1, $2::jsonb)`, [new Date(NOW.getTime() - HOUR), JSON.stringify({ orders: ['field-notes'], scored: true })]);
  assert.equal(await readConsumerMode(q, 'field-notes', NOW), 'stale-fallback', 'a deposit fetches nothing');
  await q.query(`INSERT INTO intake.runs (kind, status, started_at, record) VALUES ('topup', 'ok', $1, $2::jsonb)`, [new Date(NOW.getTime() - HOUR), JSON.stringify({ orders: ['field-notes'], scored: true })]);
  assert.equal(await readConsumerMode(q, 'field-notes', NOW), 'intake', 'a later run that fetched Field Notes');
  assert.equal(await readConsumerMode(q, 'field-notes', new Date(NOW.getTime() + 30 * HOUR)), 'stale-fallback', 'the main is old');
});

/* ── 7. retention ─────────────────────────────────────────────────────── */

test('retention keeps ≥ 21 days and never drops a published or copy-bearing story’s items', async () => {
  const db = await newDb(`CREATE SCHEMA reels; CREATE TABLE reels.published_status (post_idea_id uuid PRIMARY KEY); CREATE TABLE reels.idea_copy (post_idea_id uuid NOT NULL);`);
  const prev = q;
  q = db.q;
  try {
    assert.equal(retentionDays(), 47, 'max order lookback (Field Notes 45) + 2');
    const old = new Date(NOW.getTime() - 60 * DAY);
    const mid = new Date(NOW.getTime() - 22 * DAY);
    await insertStory(uid(1), { lastJoined: old }); // plain old: dropped
    await insertStory(uid(2), { lastJoined: old }); // published: kept
    await insertStory(uid(3), { lastJoined: old }); // target of a merged story with copy: kept
    await insertStory(uid(4), { lastJoined: old, mergedInto: uid(3) });
    await insertStory(uid(5), { lastJoined: mid }); // 22 days: kept at 47, dropped at the 21-day floor
    for (const n of [1, 2, 3, 5]) await insertItem(`item-${n}`, uid(n), { first_seen_at: n === 5 ? mid : old, last_seen_at: n === 5 ? mid : old });
    await q.query(`INSERT INTO intake.scores (story_id, scorecard, version, member_hash, result) VALUES ($1, 'major-news', 'v', 'h', '{}')`, [uid(1)]);
    await q.query(`INSERT INTO reels.published_status (post_idea_id) VALUES ($1)`, [uid(2)]);
    await q.query(`INSERT INTO reels.idea_copy (post_idea_id) VALUES ($1)`, [uid(4)]);
    const r = await pruneIntake(q, NOW);
    assert.deepEqual([r.items, r.protectedStories >= 3], [1, true]);
    const keys = (await q.query<{ key: string }>(`SELECT key FROM intake.items ORDER BY key`)).rows.map((x) => x.key);
    assert.deepEqual(keys, ['item-2', 'item-3', 'item-5']);
    assert.equal(await count(`SELECT count(*)::int AS n FROM intake.stories WHERE id = $1`, [uid(1)]), 0, 'the empty old story and its scores go');
    const floor = await pruneIntake(q, NOW, 10);
    assert.equal(floor.cutoff.getTime(), NOW.getTime() - 21 * DAY, 'never under 21 days');
    assert.deepEqual((await q.query<{ key: string }>(`SELECT key FROM intake.items ORDER BY key`)).rows.map((x) => x.key), ['item-2', 'item-3']);
  } finally {
    q = prev;
    await db.pg.close();
  }
});

/* ── carousel parity ──────────────────────────────────────────────────── */

test('story-scoring reads kept feed members and kept reels members (as hub articles), never search deposits', () => {
  assert.deepEqual(STORY_SCORING.families, ['feeds', 'reels']);
  const base = { sourceName: 'X', sourceType: 'B1' as const, headline: 'h', body: 'b', url: 'u', publishTime: null, firstSeenAt: NOW, lastSeenAt: NOW, engagement: null, dropReason: null, storyId: 's', role: 'supporting' as const };
  const story: IntakeStory = {
    id: 's', representativeKey: 'r', headline: 'h', firstSeenAt: NOW, lastJoinedAt: NOW, mergedInto: null,
    members: [
      { ...base, key: 'r', family: 'reels', sourceId: 'hacker-news', reelsSourceId: 'hacker-news' },
      { ...base, key: 'f', family: 'feeds', sourceId: 'feed:verge', feedSlug: 'verge' },
      { ...base, key: 's', family: 'search', sourceId: 'search:b6' },
    ],
  };
  assert.deepEqual(carouselMembersOf(story).map((m) => [m.key, m.sourceId]), [['r', 'feed:reels-hacker-news'], ['f', 'feed:verge']]);
});

/* ── 8. replay ────────────────────────────────────────────────────────── */

const P2: Phase2Snapshot = {
  reels: [{ nyDate: '2026-11-09', runAt: NOW, legacy: [{ ideaId: uid(1), headline: 'Acme', keys: ['https://a.test/x'], net: 5, selected: true }] }],
  carousel: [
    carouselNightFrom('11111111-1111-4111-8111-111111111111', new Date('2026-10-28T08:00:00Z'), {
      scored: [
        { id: 'https://news.test/acme', status: 'qualified', body: `Acme ships.${LONG}`, representative: { url: 'https://news.test/acme', title: 'Acme ships a model' }, members: [{ url: 'https://news.test/acme', title: 'Acme ships a model', outlet: 'News', feedSlug: 'news', publishedAt: '2026-10-28T06:00:00Z' }] },
        { id: 'https://news.test/beta', status: 'not-qualified', body: 'Beta.', representative: { url: 'https://news.test/beta', title: 'Beta tweaks a button' }, members: [{ url: 'https://news.test/beta', title: 'Beta tweaks a button', outlet: 'News', feedSlug: 'news', publishedAt: '2026-10-28T06:00:00Z' }] },
      ],
      shortlist: [{ id: 'https://news.test/acme', representative: { url: 'https://news.test/acme', title: 'Acme ships a model' } }],
    }),
  ],
  fieldNotes: [
    {
      runId: '22222222-2222-4222-8222-222222222222',
      at: new Date('2026-11-06T09:00:00Z'),
      tips: [
        { key: 'https://docs.test/tip-a', kind: 'docs', label: 'Docs A', content: 'Tip A\n\nUse Claude for A.', score: 0.9, publishedAt: null },
        { key: 'https://docs.test/tip-b', kind: 'docs', label: 'Docs A', content: 'Tip B\n\nUse Claude for B.', score: 0.7, publishedAt: null },
      ],
    },
  ],
};

test('replay plan output includes the Phase 2 sections (no Jev, no HTTP)', () => {
  const snapshot: Snapshot = { nights: [{ nyDate: '2026-11-09', runAt: NOW, items: [], legacy: { mdReels: [], mdCarousel: [], fvp: [], lfdReels: [], lfdCarousel: [] }, postedHeadlines: [], feedSince: NOW }], previous: [] };
  const plan = planPhase2(P2);
  assert.deepEqual([plan.carousel[0]!.articles, plan.carousel[0]!.shortlist, plan.fieldNotes[0]!.tips, plan.fieldNotes[0]!.calls], [2, 1, 2, 2]);
  const text = renderPlan(planReplay(snapshot, 0), 1, plan);
  for (const section of ['Phase 2: Reels', 'Phase 2: Carousel', 'Phase 2: Field Notes', '2026-11-09: legacy 1 new ideas']) assert.ok(text.includes(section), section);
  assert.equal(P2.carousel[0]!.shortlist[0]!.key, safeKey('https://news.test/acme'));
});

test('replay Phase 2 (stubbed): carousel and Field Notes comparisons run in fresh in-memory stores', async () => {
  const stores: PGlite[] = [];
  const store = async () => {
    const db = await newDb();
    stores.push(db.pg);
    return { q: db.q, close: () => db.pg.close() };
  };
  const storyScoring: Scorecard = {
    id: 'story-scoring',
    version: 'story-scoring@4',
    families: ['feeds', 'reels'],
    score: async (s) => ({ answers: {}, result: { kind: 'story-scoring', status: s.headline.includes('Acme') ? 'qualified' : 'not-qualified', probSum: 3, outletCount: 1, answers: {} }, usd: 0 }),
  };
  const fieldNotes: Scorecard = {
    id: 'field-notes-score',
    version: 'field-notes-score@3',
    families: ['field-notes'],
    score: async (s) => ({ answers: {}, result: { kind: 'field-notes-score', score: s.headline.includes('Tip A') ? 0.9 : 0.6, tags: { leaf: null, want: null, tier: null, purposes: [], fresh: false }, answers: {} }, usd: 0 }),
  };
  const ledger = await newDb();
  try {
    const jev = createIntakeJev(stubTransport(), ledger.q, null, 1);
    const r = await runPhase2(P2, { store, jev, storyScoring, fieldNotes, fieldNotesSlots: 25 });
    assert.equal(r.stopped, null);
    assert.deepEqual([r.carousel[0]!.comparison.matched, r.carousel[0]!.pass], [1, true]);
    assert.deepEqual([r.fieldNotes[0]!.comparison.inScope, r.fieldNotes[0]!.comparison.matched, r.fieldNotes[0]!.pass], [2, 2, true]);
    assert.ok(renderPhase2Report(r).includes('### Phase 2: Field Notes'));
  } finally {
    await ledger.pg.close();
  }
});

/* ── review fixes (B–E, G) ────────────────────────────────────────────── */

test('Field Notes sightings never move other orders: shared last_seen_at, last_joined_at, a search drop reason', async () => {
  const before = new Date(NOW.getTime() - 2 * DAY);
  await insertStory(uid(1), { lastJoined: before });
  await insertItem('https://example.com/shared', uid(1), { last_seen_at: before, reels_source_id: 'hacker-news' });
  await insertItem('https://example.com/found', null, { family: 'search', source_id: 'search:b6', source_type: 'B6', drop_reason: 'stale', last_seen_at: before });
  const entry = fnEntry('fn', () => [adapterItem('https://example.com/shared', 'Shared story'), adapterItem('https://example.com/found', 'A search find')]);
  const touched = new Set<string>();
  const out = await fetchFieldNotesItems({ query: q, now: NOW, runId: null, entries: [entry], fetchers: NO_NET, touched });
  assert.equal(out.joined, 2);
  type Row = { key: string; last_seen_at: Date; field_notes_last_seen_at: Date | null; drop_reason: string | null; field_notes_source_id: string | null };
  const rows = async () => new Map((await q.query<Row>(`SELECT key, last_seen_at, field_notes_last_seen_at, drop_reason, field_notes_source_id FROM intake.items`)).rows.map((r) => [r.key, r]));
  let by = await rows();
  assert.equal(new Date(by.get('https://example.com/shared')!.last_seen_at).getTime(), before.getTime(), 'join: shared last_seen_at stays');
  assert.equal(new Date(by.get('https://example.com/shared')!.field_notes_last_seen_at!).getTime(), NOW.getTime());
  const joined = (await q.query<{ last_joined_at: Date }>(`SELECT last_joined_at FROM intake.stories WHERE id = $1`, [uid(1)])).rows[0]!;
  assert.equal(new Date(joined.last_joined_at).getTime(), before.getTime(), 'join: the story last_joined_at stays');
  assert.ok(touched.has(uid(1)), 'the story is still touched, so field-notes-score runs on it');
  assert.deepEqual([by.get('https://example.com/found')!.drop_reason, by.get('https://example.com/found')!.field_notes_source_id], ['stale', 'fn'], 'a dropped search item keeps its verdict');
  // A nightly re-sighting: only Field Notes' own last-seen moves.
  const later = new Date(NOW.getTime() + DAY);
  const again = await fetchFieldNotesItems({ query: q, now: later, runId: null, entries: [entry], fetchers: NO_NET });
  assert.equal(again.alreadySeen, 2);
  by = await rows();
  assert.equal(new Date(by.get('https://example.com/shared')!.last_seen_at).getTime(), before.getTime(), 're-sighting: shared last_seen_at stays');
  assert.equal(new Date(by.get('https://example.com/shared')!.field_notes_last_seen_at!).getTime(), later.getTime());
  // Retention keeps an item Field Notes still sees.
  // Cutoff NOW - 12 h: the shared last_seen_at (NOW - 2 days) is past it, Field Notes' (NOW + 1 day) is not.
  const pruned = await pruneIntake(q, new Date(NOW.getTime() + 20.5 * DAY), 21);
  assert.equal(pruned.items, 0);
});

test('Field Notes backlog: a re-seen carried item with no field-notes-score goes back to touched; nothing outside the fetch', async () => {
  const fn = { family: 'field-notes', source_id: 'field-notes:fn', field_notes_source_id: 'fn' };
  await insertStory(uid(5));
  await insertItem('https://example.com/fn-waiting', uid(5), fn);
  await insertStory(uid(6));
  await insertItem('https://example.com/fn-scored', uid(6), fn);
  await q.query(`INSERT INTO intake.scores (story_id, scorecard, version, member_hash, result) VALUES ($1, 'field-notes-score', 'v', 'h', '{}'::jsonb)`, [uid(6)]);
  await insertStory(uid(7));
  await insertItem('https://example.com/fn-absent', uid(7), fn);
  const entry = fnEntry('fn', () => [adapterItem('https://example.com/fn-waiting', 'Waiting tip'), adapterItem('https://example.com/fn-scored', 'Scored tip')]);
  const touched = new Set<string>();
  const out = await fetchFieldNotesItems({ query: q, now: NOW, runId: null, entries: [entry], fetchers: NO_NET, touched });
  assert.equal(out.alreadySeen, 2);
  assert.deepEqual([...touched], [uid(5)], 'only the unscored one seen tonight (not the scored one, not one absent from the fetch)');
});

test('runIntakeDeposit skips while an intake run is running (6 h window); never throws', async () => {
  let calls = 0;
  const score: ScoreForStories = async () => (calls++, {} as never);
  const order: IntakeOrder = { ...REELS_ORDER, isOpen: async () => true };
  await q.query(`INSERT INTO intake.runs (kind, status, started_at) VALUES ('main', 'running', $1)`, [new Date(NOW.getTime() - HOUR)]);
  await depositFindAs(q, adapterItem('https://example.com/a4-busy', 'Initech lists agent tools'), NOW, A4_DEPOSIT);
  const busy = await runIntakeDeposit(q, { jev: createIntakeJev(stubTransport(), q, null, 0.15), now: () => NOW, orders: [order], scorecards: [], score, log: () => {} });
  assert.match(busy.record.skipped ?? '', /main run .* still running/);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items WHERE story_id IS NOT NULL`), 0, 'nothing grouped');
  assert.equal((await q.query<{ status: string }>(`SELECT status FROM intake.runs WHERE id = $1`, [busy.runId])).rows[0]?.status, 'skipped');
  // A run 'running' for over 6 h crashed: it no longer blocks.
  await q.query(`UPDATE intake.runs SET started_at = $1 WHERE kind = 'main'`, [new Date(NOW.getTime() - 7 * HOUR)]);
  const ran = await runIntakeDeposit(q, { jev: createIntakeJev(stubTransport(), q, null, 0.15), now: () => NOW, orders: [order], scorecards: [], score, log: () => {} });
  assert.equal(ran.record.skipped, undefined);
  assert.equal(await count(`SELECT count(*)::int AS n FROM intake.items WHERE story_id IS NOT NULL`), 1, 'grouped');
  assert.equal(calls, 0);
});

test('previousUnscored carries the last fetching run’s orphans through deposits (a failed deposit drops nothing)', async () => {
  const run = (kind: string, status: string, at: number, unscored: string[]) =>
    q.query(`INSERT INTO intake.runs (kind, status, started_at, finished_at, record) VALUES ($1, $2, $3, $3, $4::jsonb)`, [kind, status, new Date(NOW.getTime() + at * HOUR), JSON.stringify({ unscored })]);
  await run('main', 'ok', 0, [uid(1)]);
  await run('deposit', 'failed', 1, []);
  await run('deposit', 'ok', 2, [uid(2)]);
  await run('deposit', 'skipped', 3, []);
  assert.deepEqual((await previousUnscored(q, uid(99))).sort(), [uid(1), uid(2)]);
  await run('topup', 'ok', 4, [uid(3)]);
  assert.deepEqual(await previousUnscored(q, uid(99)), [uid(3)], 'the next fetching run took them on');
});

test('reels order opens on a pending Reels seed (intake or legacy); a made, published or old seed does not open it', async () => {
  const db = await newDb(`
    CREATE SCHEMA reels;
    CREATE TABLE reels.settings (key text PRIMARY KEY, value jsonb);
    CREATE TABLE reels.runs (id uuid, status text);
    CREATE TABLE reels.video_jobs (post_idea_id uuid, status text);
    CREATE TABLE reels.published_status (post_idea_id uuid, published boolean);
    CREATE TABLE reels.sources (id uuid, adapter_id text, drop_reason text, ingest_time timestamptz);
    CREATE TABLE reels.post_idea_members (source_id uuid, post_idea_id uuid);
    INSERT INTO reels.settings VALUES ('auto_run', 'false');`);
  try {
    const open = () => REELS_ORDER.isOpen(db.q, NOW);
    assert.equal(await open(), false);
    await db.pg.query(`INSERT INTO intake.stories (id, representative_key, headline) VALUES ($1, 'k', 'A seed')`, [uid(1)]);
    await db.pg.query(
      `INSERT INTO intake.items (key, family, source_id, source_name, source_type, headline, url, story_id, role, seeded_by, seed_order)
       VALUES ('https://example.com/seed', 'seed', 'seed:reels', 'Lucas', 'seed', 'A seed', 'https://example.com/seed', $1, 'primary', 'lucas', 'reels')`,
      [uid(1)],
    );
    assert.equal(await open(), true, 'an intake Reels seed waiting');
    await db.pg.query(`INSERT INTO reels.video_jobs VALUES ($1, 'ok')`, [uid(1)]);
    assert.equal(await open(), false, 'made');
    await db.pg.query(`INSERT INTO reels.sources VALUES ($1, 'seed', 'seed', now() - interval '1 day'), ($2, 'seed', 'seed', now() - interval '8 days')`, [uid(2), uid(3)]);
    await db.pg.query(`INSERT INTO reels.post_idea_members VALUES ($1, $3), ($2, $4)`, [uid(2), uid(3), uid(12), uid(13)]);
    assert.equal(await open(), true, 'a legacy seed waiting');
    await db.pg.query(`INSERT INTO reels.published_status VALUES ($1, true)`, [uid(12)]);
    assert.equal(await open(), false, 'published; the other is over a week old');
  } finally {
    await db.pg.close();
  }
});

test('lastSuccessfulMainStart: the newest ok/partial main whose scoring ran', async () => {
  assert.equal(await lastSuccessfulMainStart(q), null);
  const run = (kind: string, status: string, at: number, record: object) =>
    q.query(`INSERT INTO intake.runs (kind, status, started_at, record) VALUES ($1, $2, $3, $4::jsonb)`, [kind, status, new Date(NOW.getTime() + at * HOUR), JSON.stringify(record)]);
  await run('main', 'ok', -3, {});
  await run('main', 'partial', -2, { scored: false });
  await run('main', 'failed', -1, {});
  await run('topup', 'ok', 0, {});
  assert.equal((await lastSuccessfulMainStart(q))?.getTime(), NOW.getTime() - 3 * HOUR);
});
