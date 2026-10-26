/**
 * The idea pool standard on Carousels' 3 AM run (spec 2026-10-21), offline with stub stages and PGlite: several pins
 * lead in the order pinned (and appear once), an archived story is never made (matched by id or by a shared URL, since a
 * group's id can drift), a placed story sorts at its key, and the pins the run shipped are used while one that could not
 * be made is skipped with why.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { loadArchivedUrls, pickPins, promotedStages, settlePins } from '@/lib/social/overnight/promote';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages, stubCandidates } from '@/lib/social/pipeline/stubs';

const NIGHT = new Date('2026-10-08T07:30:00Z');
const fresh = stubCandidates(STUB_ARTICLES); // story-a (score 3), story-b (2), story-c (1)
const stub = (n: string) => ({ ...stubCandidates([{ ...STUB_ARTICLES[0]!, sourceUrl: `https://example.com/${n}`, headline: n }])[0]!, score: 0 });

async function night(promoted: Parameters<typeof promotedStages>[1], night: Parameters<typeof promotedStages>[3] = {}, targetPosts = 3) {
  const result = await runDay({
    articles: STUB_ARTICLES,
    stages: promotedStages(createStubStages(), promoted, new Set(), night),
    meter: createCostMeter({ capUsd: 5 }),
    log: createInMemorySetAsideLog(),
    now: NIGHT,
    targetPosts,
  });
  return result.shipped.map((e) => e.storyId);
}

test('several pins lead in the order pinned; a pin that is also a fresh story appears once', async () => {
  assert.deepEqual(await night([stub('story-old'), fresh[2]!]), ['story-old', 'story-c', 'story-a']);
  assert.deepEqual(await night([fresh[2]!, stub('story-old')], {}, 2), ['story-c', 'story-old']);
});

test('an archived story is never made: by id, or by a shared URL when its id has drifted', async () => {
  assert.deepEqual(await night([], { archived: new Set(['story-a']) }, 2), ['story-b', 'story-c']);
  const drifted = new Set([fresh[0]!.url]);
  assert.deepEqual(await night([], { archived: new Set(['some-old-id']), archivedUrls: drifted }, 2), ['story-b', 'story-c']);
});

test('a placed story sorts at its key; an archived pin is not made', async () => {
  assert.deepEqual(await night([], { placed: new Map([['story-c', 99]]) }, 2), ['story-c', 'story-a']);
  assert.deepEqual(await night([fresh[2]!], { archived: new Set(['story-c']) }, 2), ['story-a', 'story-b']);
});

test('no night info: the same as before the standard', async () => {
  assert.deepEqual(await night(null, {}, 2), ['story-a', 'story-b']);
});

// ── With the database: skips with why, used when shipped ────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { NOT_IN_SHORTLIST } from '@/lib/social/overnight/promote';
import type { Query } from '@/lib/social/store/pg';

const schemaSql = (file: string) => fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
async function carouselDb(): Promise<{ query: Query; pg: PGlite }> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  return { pg, query: async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] }) };
}

test('a pin in no recent shortlist is skipped with why and the rest are still tried; nothing throws', async () => {
  const { pg, query } = await carouselDb();
  await pg.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ('carousels', 'carousels:story:gone', '2026-10-07', 'pin', '2026-10-07T20:00:00Z')`);
  assert.deepEqual(await pickPins(query, ['gone']), []);
  const row = (await pg.query<{ skip_reason: string | null }>(`SELECT skip_reason FROM social_hub.idea_adjustments WHERE idea_id = 'carousels:story:gone'`)).rows[0]!;
  assert.equal(row.skip_reason, NOT_IN_SHORTLIST);
  assert.deepEqual([...(await loadArchivedUrls(query, ['gone']))], [], 'an archived story in no shortlist is matched by id only');
});

test('settlePins uses every shipped pin up and skips with why the one the pipeline set aside', async () => {
  const { pg, query } = await carouselDb();
  for (const [id, at] of [['made', '2026-10-07T20:00:00Z'], ['aside', '2026-10-07T21:00:00Z']] as const) {
    await pg.query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ('carousels', $1, '2026-10-07', 'pin', $2)`, [`carousels:story:${id}`, at]);
  }
  await settlePins(query, ['made', 'aside'], { shipped: [{ storyId: 'made' }], onCalendar: [], setAsides: [{ storyId: 'aside', stage: 'fact-check', reasonCode: 'unsupported' }] } as never);
  const rows = (await pg.query<{ idea_id: string; used: boolean; skip_reason: string | null }>(`SELECT idea_id, consumed_at IS NOT NULL AS used, skip_reason FROM social_hub.idea_adjustments ORDER BY idea_id`)).rows;
  assert.deepEqual(rows.map((r) => [r.idea_id.slice(-5), r.used, r.skip_reason !== null]), [['aside', false, true], [':made', true, false]]);
});
