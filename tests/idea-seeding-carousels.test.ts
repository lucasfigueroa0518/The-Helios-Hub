/**
 * Idea seeding, Carousels (design 2026-10-25-carousels-seeding), offline on PGlite with the real social and hub schemas, a
 * stubbed page fetch and a stubbed Jev (no live calls): a pasted link becomes a scored story of the person's own, found by
 * pins, Run now and the night through loadPinnedCandidates, listed in the hub's ideas with `yours`, made like any shortlisted
 * story, and held to 10 open, 7 days, and one scoring call each.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { CAROUSEL_IDEAS_SQL, type CarouselIdeaRow } from '@/lib/social-hub/queries/carousels';
import { carouselIdeas } from '@/lib/social-hub/adapters/carousels';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages } from '@/lib/social/pipeline/stubs';
import type { JevAsk } from '@/lib/social/jev/client';
import { loadPinnedCandidates, pinnedStages } from '@/lib/social/overnight/pinned';
import { MAX_OPEN_SEEDS, SeedError, addCarouselSeed, readOpenSeeds } from '@/lib/social/overnight/seeds';
import type { Query } from '@/lib/social/store/pg';

const NOW = new Date('2026-10-26T14:00:00Z');
const schemaSql = (file: string) => fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function db(): Promise<{ query: Query; pg: PGlite }> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  return { pg, query: async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] }) };
}

const PAGE = 'OpenAI announced a new model today. '.repeat(20);
function deps() {
  const calls = { fetch: 0, jev: 0 };
  const jev: JevAsk = async (request) => {
    calls.jev += 1;
    return { answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { noul: 0.1 }])), usage: { input_tokens: 100, output_tokens: 0 }, model: 'stub' };
  };
  return { calls, deps: { fetchBody: async () => (calls.fetch += 1, PAGE), jev, now: NOW } };
}
const link = (n: number) => `https://news.test/story-${n}`;
const refused = (p: Promise<unknown>, status: number, match: RegExp) => assert.rejects(p, (e: unknown) => e instanceof SeedError && e.status === status && match.test(e.message));

test('a pasted link is read, scored once, stored, and listed as the person’s own', async () => {
  const { query } = await db();
  const { calls, deps: d } = deps();
  const out = await addCarouselSeed(query, { url: link(1), headline: 'OpenAI ships a new model' }, d);
  assert.equal(out.title, 'OpenAI ships a new model');
  assert.deepEqual(calls, { fetch: 1, jev: 1 }, 'one page read, one scoring call, no model');
  assert.equal((await readOpenSeeds(query, NOW)).length, 1);
  const { rows } = await query(CAROUSEL_IDEAS_SQL);
  const ideas = carouselIdeas(rows as CarouselIdeaRow[]);
  assert.equal(ideas.length, 1);
  assert.deepEqual([ideas[0]!.id, ideas[0]!.yours, ideas[0]!.title, ideas[0]!.state], [`carousels:story:${link(1)}`, true, 'OpenAI ships a new model', 'idea_only']);
});

test('pins, Run now and the night find a seed, and a run makes it like any shortlisted story', async () => {
  const { query } = await db();
  const { deps: d } = deps();
  await addCarouselSeed(query, { url: link(2) }, d);
  const [candidate] = await loadPinnedCandidates(query, [link(2)]);
  assert.equal(candidate!.id, link(2));
  assert.deepEqual(candidate!.sources, [link(2)]);
  const result = await runDay({ articles: STUB_ARTICLES, stages: pinnedStages(createStubStages(), [candidate!]), meter: createCostMeter({ capUsd: 5 }), log: createInMemorySetAsideLog(), now: NOW, targetPosts: 1 });
  assert.deepEqual(result.shipped.map((e) => e.storyId), [link(2)]);
});

test('a bad link, an unreadable page and a story already in the queue are refused and write nothing', async () => {
  const { query } = await db();
  const { deps: d } = deps();
  await refused(addCarouselSeed(query, { url: 'not a link' }, d), 400, /http/);
  await refused(addCarouselSeed(query, { url: link(3) }, { ...d, fetchBody: async () => null }), 422, /couldn’t read/);
  await refused(addCarouselSeed(query, { url: link(3) }, { ...d, fetchBody: async () => 'too short' }), 422, /couldn’t read/);
  assert.deepEqual(await readOpenSeeds(query, NOW), []);
  await addCarouselSeed(query, { url: link(3) }, d);
  await refused(addCarouselSeed(query, { url: link(3) }, d), 409, /already in the queue/);
});

test('only so many seeds wait; archiving one frees a place; a seed goes after 7 days', async () => {
  const { query, pg } = await db();
  const { deps: d } = deps();
  for (let i = 0; i < MAX_OPEN_SEEDS; i++) await addCarouselSeed(query, { url: link(100 + i) }, d);
  await refused(addCarouselSeed(query, { url: link(999) }, d), 409, /make or archive one first/);
  await pg.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('carousels', $1, '2026-10-26', 'archive')`, [`carousels:story:${link(100)}`]);
  await addCarouselSeed(query, { url: link(999) }, d);
  const later = new Date(NOW.getTime() + 8 * 86_400_000);
  assert.equal((await readOpenSeeds(query, later)).length, 0, 'all gone after a week');
  assert.equal((await query(CAROUSEL_IDEAS_SQL.replace('now()', `'${later.toISOString()}'::timestamptz`))).rows.length, 0, 'and the hub stops listing them');
});
