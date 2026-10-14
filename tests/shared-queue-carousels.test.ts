/**
 * Shared queue, Carousels (the 3 AM run), offline: the promoted story goes
 * ahead of the fresh candidates (deduped) and takes one of the usual posts,
 * demoted stories go last, a promoted story that already posted or is in no
 * recent shortlist is skipped with why, and the move is used once shipped.
 * Stub stages and PGlite: no feeds, no model calls.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { ALREADY_POSTED, NOT_IN_SHORTLIST, ON_CALENDAR, loadPromoted, pickPromoted, promotedStages, settlePromote } from '@/lib/social/overnight/promote';
import { claimRun, requestRun } from '@/lib/social/overnight/runs';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages, stubCandidates } from '@/lib/social/pipeline/stubs';
import type { ScoredCandidate } from '@/lib/social/pipeline/types';
import type { Query } from '@/lib/social/store/pg';

const NIGHT = new Date('2026-10-08T07:30:00Z'); // 3:30 AM New York

const schemaSql = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'db', file), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');

async function carouselDb(): Promise<Query> {
  const pg = new PGlite();
  await pg.exec(schemaSql('social_schema.sql'));
  await pg.exec(schemaSql('social_hub_schema.sql'));
  return async (text, params) => ({ rows: (await pg.query(text, params)).rows as any[] });
}

/** A real story id is its URL (the database tests below); the stub selection uses the URL's last segment. */
const OLD = 'https://example.com/story-old';

/** A stored story from an earlier night's shortlist, as selection would rank it (stub id `story-old`). */
const oldCandidate = (): ScoredCandidate => stubCandidates([{ ...STUB_ARTICLES[0]!, sourceUrl: OLD, headline: 'Old promoted story' }])[0]!;

async function night(promoted: ScoredCandidate | null, demoted: string[]) {
  return runDay({
    articles: STUB_ARTICLES,
    stages: promotedStages(createStubStages(), promoted, new Set(demoted)),
    meter: createCostMeter({ capUsd: 2 }),
    log: createInMemorySetAsideLog(),
    now: NIGHT,
    targetPosts: 2,
  });
}

test('the promoted story goes ahead of the fresh candidates and takes one of the usual posts; a demoted story goes last', async () => {
  const result = await night(oldCandidate(), ['story-a']);
  assert.deepEqual(result.shipped.map((e) => e.storyId), ['story-old', 'story-b'], 'two posts, as usual: the promote, then the best fresh story not demoted');
});

test('a promoted story that is also a fresh candidate appears once', async () => {
  const fresh = stubCandidates(STUB_ARTICLES);
  const stages = promotedStages(createStubStages(), { ...fresh[2]!, score: 0 }, new Set());
  const res = await stages.score(STUB_ARTICLES, NIGHT);
  assert.ok(res.ok);
  if (res.ok) assert.deepEqual(res.value.map((c) => c.id), ['story-c', 'story-a', 'story-b']);
  assert.deepEqual((await night({ ...fresh[2]!, score: 0 }, [])).shipped.map((e) => e.storyId), ['story-c', 'story-a']);
});

const group = (id: string, headline: string) => ({
  id,
  members: [{ url: id, title: headline, outlet: 'Example', feedSlug: 'x', publishedAt: '2026-10-05T12:00:00.000Z' }],
  outlets: ['Example'],
  outletCount: 1,
  publishedAt: '2026-10-05T12:00:00.000Z',
  representative: { headline, sourceUrl: id },
  articles: [],
  body: `${headline} body`,
  read: [{ url: id, chars: 900, outlet: 'Example' }],
  answers: {},
  status: 'qualified',
  passes: 4,
  probSum: 4.1,
});

async function shortlist(query: Query, ids: string[]) {
  await query(
    `INSERT INTO social.runs (kind, started_at, hook_pass, cap_usd, record, status) VALUES ('daily', '2026-10-06T07:00:00Z', true, 2, $1::jsonb, 'ok')`,
    [JSON.stringify({ selection: { shortlist: ids.map((id) => group(id, `Story ${id}`)) } })],
  );
}

async function promote(query: Query, storyId: string) {
  await query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('carousels', $1, '2026-10-07', 'promote')`, [`carousels:story:${storyId}`]);
}

const moveRow = async (query: Query, storyId: string) =>
  (await query(`SELECT consumed_at IS NOT NULL AS used, skip_reason FROM social_hub.idea_adjustments WHERE idea_id = $1`, [`carousels:story:${storyId}`])).rows[0] as { used: boolean; skip_reason: string | null };

test('loadPromoted: a story in an earlier shortlist is loaded; one in none is skipped with why', async () => {
  const query = await carouselDb();
  await shortlist(query, [OLD]);
  assert.equal((await loadPromoted(query, OLD))?.id, OLD);
  await promote(query, 'https://example.com/never-seen');
  assert.equal(await loadPromoted(query, 'https://example.com/never-seen'), null);
  assert.deepEqual(await moveRow(query, 'https://example.com/never-seen'), { used: false, skip_reason: NOT_IN_SHORTLIST });
});

test('Review Focus 1: a promoted story that already posted is never made again; it is skipped with why', async () => {
  const query = await carouselDb();
  await shortlist(query, [OLD]);
  await promote(query, OLD);
  await query(
    `INSERT INTO social.posts (slug, story_id, title, status, render, slide_objects) VALUES ('posted-old', $1, 't', 'published', $2::jsonb, $3::jsonb)`,
    [OLD, JSON.stringify({ caption: 'c', attributionBlock: null, slides: [] }), JSON.stringify(['posts/posted-old/a.jpg'])],
  );
  assert.equal(await loadPromoted(query, OLD), null);
  assert.deepEqual(await moveRow(query, OLD), { used: false, skip_reason: ALREADY_POSTED });
});

test('settlePromote: shipped uses the move; on the calendar or set aside records why and keeps it', async () => {
  const query = await carouselDb();
  await promote(query, OLD);
  await settlePromote(query, OLD, { shipped: [], onCalendar: [OLD], setAsides: [] });
  assert.deepEqual(await moveRow(query, OLD), { used: false, skip_reason: ON_CALENDAR });
  await settlePromote(query, OLD, { shipped: [], onCalendar: [], setAsides: [{ day: '2026-10-08', storyId: OLD, stage: 'reporter', reasonCode: 'service-error', kind: 'glitch', detail: 'x', at: NIGHT.toISOString() } as never] });
  assert.match((await moveRow(query, OLD)).skip_reason ?? '', /set it aside at reporter/);
  await settlePromote(query, OLD, { shipped: [{ storyId: OLD, reusedPostId: null }], onCalendar: [], setAsides: [] });
  assert.equal((await moveRow(query, OLD)).used, true);
});

test('claimRun says which trigger queued the run (only the scheduled run reads moves)', async () => {
  const query = await carouselDb();
  await requestRun(query, 'scheduled', { capUsd: 2, hookPass: true });
  assert.equal((await claimRun(query))?.trigger, 'scheduled');
});
const NEWER = 'https://example.com/story-newer';
const promoteAt = (query: Query, storyId: string, at: string) =>
  query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind, created_at) VALUES ('carousels', $1, '2026-10-07', 'promote', $2)`, [`carousels:story:${storyId}`, at]);

test('loadPromoted: a promoted story already on the calendar is skipped with why, before the run spends on it', async () => {
  const query = await carouselDb();
  await shortlist(query, [OLD]);
  await promote(query, OLD);
  const post = (await query(
    `INSERT INTO social.posts (slug, story_id, title, status, render, slide_objects) VALUES ('cal-old', $1, 't', 'review', $2::jsonb, $3::jsonb) RETURNING id`,
    [OLD, JSON.stringify({ caption: 'c', attributionBlock: null, slides: [] }), JSON.stringify([])],
  )).rows[0] as { id: string };
  const item = (await query(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('carousels', 'feed', $1) RETURNING id`, [String(post.id)])).rows[0] as { id: string };
  await query(`INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'carousels', '2026-10-08', 'morning', '2026-10-08T15:00:00Z', 'scheduled', 'user')`, [item.id]);
  assert.equal(await loadPromoted(query, OLD), null);
  assert.deepEqual(await moveRow(query, OLD), { used: false, skip_reason: ON_CALENDAR });
});

test('pickPromoted: a promote that cannot be used steps aside in the same run; the next promote is picked', async () => {
  const query = await carouselDb();
  await shortlist(query, [NEWER]); // OLD is in no shortlist
  await promoteAt(query, OLD, '2026-10-07T10:00:00Z');
  await promoteAt(query, NEWER, '2026-10-07T11:00:00Z');
  const picked = await pickPromoted(query, OLD);
  assert.equal(picked?.id, NEWER);
  assert.deepEqual(await moveRow(query, OLD), { used: false, skip_reason: NOT_IN_SHORTLIST });
});

test('pickPromoted: none usable means no promote, every miss recorded; a failed moves read means no re-pick and never throws', async () => {
  const query = await carouselDb();
  await promoteAt(query, OLD, '2026-10-07T10:00:00Z');
  await promoteAt(query, NEWER, '2026-10-07T11:00:00Z');
  assert.equal(await pickPromoted(query, OLD), null);
  assert.equal((await moveRow(query, OLD)).skip_reason, NOT_IN_SHORTLIST);
  assert.equal((await moveRow(query, NEWER)).skip_reason, NOT_IN_SHORTLIST);
  const broken: Query = async () => { throw new Error('db down'); };
  assert.equal(await pickPromoted(broken, OLD), null);
});

