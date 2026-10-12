/**
 * Run now makes the story you promoted (not whatever fresh selection ranks
 * first). Offline: the real schema on in-memory PGlite, no feeds, no Jev, no
 * Claude. Covers the planner, the run queue, the pinned-story loader and the
 * stage swap that replaces selection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { loadPinnedCandidates, pinnedStages } from '@/lib/social/overnight/pinned';
import { claimRun, requestRun } from '@/lib/social/overnight/runs';
import type { Query } from '@/lib/social/store/pg';
import { planFrom, stepsFor, type RunInputs } from '@/lib/social-hub/run-today';

const AMAZON = 'https://www.bloomberg.com/news/articles/2026-10-11/amazon-is-in-talks-to-buy-ai-startup-decart';
const PHILLY = 'https://www.bloomberg.com/news/videos/2026-10-12/anthropic-ai-model-goes-rogue';

const base: RunInputs = {
  today: '2026-10-12',
  reels: { quota: 0, held: 0, missing: [], slateToday: true },
  carousels: { quota: 2, held: 0, missing: [] },
  explainers: { quota: 0, held: 0, missing: [] },
  series: [],
  inFlight: { reelsRun: false, reelsBuilding: [], carouselRun: false, explainerTopics: [] },
  cost: { reelsNight: 2.5, reelBuild: 1, carouselCap: 2, explainerCap: 5, storySet: 0.45 },
};
const idea = (url: string, title: string) => ({ ideaId: `carousels:story:${url}`, ref: url, title });
const carouselStep = (i: RunInputs) => planFrom(i).steps.find((s) => s.vertical === 'carousels')!;

// ── Planner ─────────────────────────────────────────────────────────────────

test('planner: the carousel run targets the top of the queue, in rank order, and names it', () => {
  const s = carouselStep({ ...base, carousels: { quota: 2, held: 0, missing: [idea(AMAZON, 'Amazon to buy Decart'), idea(PHILLY, 'Claude files a false tip'), idea('https://x/3', 'Third')] } });
  assert.equal(s.action, 'carousel_run');
  assert.deepEqual(s.targets, [AMAZON, PHILLY], 'only as many as the day still needs, top first');
  assert.match(s.note, /Amazon to buy Decart/);
  assert.match(s.note, /Claude files a false tip/);
});

test('planner: a slot already held leaves fewer targets, still the top of the queue', () => {
  const s = carouselStep({ ...base, carousels: { quota: 2, held: 1, missing: [idea(AMAZON, 'Amazon to buy Decart'), idea(PHILLY, 'Philly')] } });
  assert.deepEqual(s.targets, [AMAZON]);
});

test('planner: with no ranked story to name, the run still falls back to fresh selection', () => {
  const s = carouselStep(base);
  assert.equal(s.action, 'carousel_run');
  assert.deepEqual(s.targets, []);
});

// ── Run queue ───────────────────────────────────────────────────────────────

const schemaSql = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function scratchDb(): Promise<{ query: Query; pg: PGlite }> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_schema.sql')); // idempotent
  const query: Query = async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
  return { query, pg };
}

test('queue: a run keeps the stories it was asked to make, and the worker claims them in order', async () => {
  const { query } = await scratchDb();
  const id = await requestRun(query, 'manual', { capUsd: 2, hookPass: true, storyIds: [AMAZON, PHILLY] });
  assert.ok(id);
  const claimed = await claimRun(query);
  assert.deepEqual(claimed?.storyIds, [AMAZON, PHILLY]);
});

test('queue: a scheduled run has no pinned stories', async () => {
  const { query } = await scratchDb();
  await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true });
  assert.deepEqual((await claimRun(query))?.storyIds, []);
});

// ── Loader ──────────────────────────────────────────────────────────────────

const group = (id: string, headline: string, extra: Record<string, unknown> = {}) => ({
  id,
  members: [{ url: id, title: headline, outlet: 'Bloomberg', feedSlug: 'x', publishedAt: '2026-10-11T12:00:00.000Z' }],
  outlets: ['Bloomberg'],
  outletCount: 1,
  publishedAt: '2026-10-11T12:00:00.000Z',
  representative: { headline, sourceUrl: id },
  articles: [],
  body: `${headline} body`,
  read: [{ url: id, chars: 900, outlet: 'Bloomberg' }],
  answers: {},
  status: 'qualified',
  passes: 4,
  probSum: 4.1,
  ...extra,
});

async function insertRun(query: Query, startedAt: string, shortlist: unknown[] | null) {
  await query(
    `INSERT INTO social.runs (kind, started_at, hook_pass, cap_usd, record, status) VALUES ('daily', $1::timestamptz, true, 2, $2::jsonb, 'ok')`,
    [startedAt, JSON.stringify(shortlist ? { selection: { shortlist } } : {})],
  );
}

test('loader: finds a promoted story in an older run when the newest run’s pool no longer has it', async () => {
  const { query } = await scratchDb();
  await insertRun(query, '2026-10-12T07:00:00Z', [group(AMAZON, 'Amazon to buy Decart'), group(PHILLY, 'Philly old')]); // 03:00
  await insertRun(query, '2026-10-12T19:14:00Z', [group(PHILLY, 'Philly new')]); // the manual run replaced the pool
  const found = await loadPinnedCandidates(query, [AMAZON, PHILLY]);
  assert.deepEqual(found.map((c) => c.id), [AMAZON, PHILLY], 'in the order asked');
  assert.equal(found[0]!.title, 'Amazon to buy Decart');
  assert.equal(found[1]!.title, 'Philly new', 'the newest copy of a story wins');
});

test('loader: a candidate is a real candidate (dates revived, sources from the read members)', async () => {
  const { query } = await scratchDb();
  await insertRun(query, '2026-10-12T07:00:00Z', [group(AMAZON, 'Amazon to buy Decart')]);
  const [c] = await loadPinnedCandidates(query, [AMAZON]);
  assert.ok(c!.publishedAt instanceof Date);
  assert.ok(c!.members[0]!.publishedAt instanceof Date);
  assert.deepEqual(c!.sources, [AMAZON]);
  assert.equal(c!.body, 'Amazon to buy Decart body');
});

test('loader: a story it cannot find fails the run loudly instead of swapping in another', async () => {
  const { query } = await scratchDb();
  await insertRun(query, '2026-10-12T07:00:00Z', [group(PHILLY, 'Philly')]);
  await assert.rejects(() => loadPinnedCandidates(query, [AMAZON]), (e: Error) => e.message.includes(AMAZON) && /not in any recent run/i.test(e.message));
});

// ── Stage swap ──────────────────────────────────────────────────────────────

test('stages: selection is replaced by exactly the pinned stories, at no cost, and no feed is read', async () => {
  const { query } = await scratchDb();
  await insertRun(query, '2026-10-12T07:00:00Z', [group(AMAZON, 'Amazon to buy Decart')]);
  const candidates = await loadPinnedCandidates(query, [AMAZON]);
  let selectionCalls = 0;
  const stages = pinnedStages({ score: async () => { selectionCalls += 1; throw new Error('selection must not run'); } } as any, candidates);
  const res = await stages.score([], new Date());
  assert.equal(selectionCalls, 0);
  assert.ok(res.ok);
  if (res.ok) {
    assert.deepEqual(res.value.map((c) => c.id), [AMAZON]);
    assert.equal(res.costUsd, 0);
  }
});

// ── A type's own Run button follows the same plan ───────────────────────────

test('a type’s own Run now uses that type’s step of the same plan', () => {
  const plan = planFrom({ ...base, carousels: { quota: 2, held: 0, missing: [idea(AMAZON, 'Amazon to buy Decart')] } });
  assert.deepEqual(stepsFor(plan, 'carousels').map((s) => s.vertical), ['carousels']);
  assert.deepEqual(stepsFor(plan, 'carousels')[0]!.targets, [AMAZON]);
  assert.equal(stepsFor(plan, undefined).length, plan.steps.length, 'no type named: the whole day, as Content’s Run now does');
});
