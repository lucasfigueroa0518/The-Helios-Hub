/**
 * "Run didn't finish" (B6): today's run records, per type, onto the empty
 * cards they explain. Only today's records (New York) count; a card with
 * content, or a run in flight, never shows it. Offline: the real schema
 * files on PGlite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import type { ProgressItem } from '@/lib/content-type/progress';
import { MISS_TITLE, missFor, NO_MISSES, readRunMisses, type RunMisses } from '@/lib/content-type/run-misses';
import type { HubIdea, HubPost } from '@/lib/social-hub/types';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-14T16:00:00Z'); // noon New York
const TODAY_2AM = '2026-10-14T06:05:00Z';
const YESTERDAY = '2026-10-13T16:00:00Z';

async function topic(pg: PGlite, title: string): Promise<string> {
  return (await pg.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status) VALUES ($1, 'manual', 'pool') RETURNING id::text AS id`, [title])).rows[0]!.id;
}
async function job(pg: PGlite, topicId: string, status: 'ok' | 'failed', requestedAt: string, error: string | null = null): Promise<void> {
  await pg.query(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, requested_at, error)
     VALUES ($1, $2, 'auto', 'production', 5, 'o', 'f', $3::timestamptz, $4)`,
    [topicId, status, requestedAt, error],
  );
}

test('explainers: the topic’s latest render failed today; yesterday’s, or one tried again since, does not count', async () => {
  const { pg, query } = await openHubTestDb();
  const a = await topic(pg, 'A');
  const b = await topic(pg, 'B');
  const c = await topic(pg, 'C');
  await job(pg, a, 'failed', TODAY_2AM, 'HeyGen render timed out');
  await job(pg, b, 'failed', YESTERDAY, 'old');
  await job(pg, c, 'failed', TODAY_2AM, 'first try');
  await job(pg, c, 'ok', '2026-10-14T09:00:00Z');
  const misses = await readRunMisses(query, NOW);
  assert.deepEqual(misses.explainers, [{ key: a, title: MISS_TITLE, detail: 'HeyGen render timed out' }]);
});

test('stories: a set skipped or failed while being built today; a set that failed while posting is not one (Review Focus 5)', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.query(
    `INSERT INTO stories.sets (series, ny_date, status, trigger, style, error, publish_at) VALUES
       ('free_vs_paid', '2026-10-14', 'skipped', 'auto', 'homemade', 'no good pair found', NULL),
       ('morning_download', '2026-10-14', 'failed', 'auto', 'polished', 'publish: container ERROR', '2026-10-14T13:00:00Z'),
       ('guess_the_number', '2026-10-13', 'failed', 'auto', 'homemade', 'old', NULL)`,
  );
  const misses = await readRunMisses(query, NOW);
  assert.deepEqual(misses.stories, [{ key: 'free_vs_paid', title: MISS_TITLE, detail: 'Free vs. Paid: skipped, no good pair found' }]);
});

test('reels: an idea’s finish request failed today', async () => {
  const { pg, query } = await openHubTestDb();
  const run = (await pg.query<{ id: string }>(`INSERT INTO reels.runs (trigger, status) VALUES ('scheduled', 'ok') RETURNING id::text AS id`)).rows[0]!.id;
  const slate = (await pg.query<{ id: string }>(`INSERT INTO reels.score_slates (run_id, ny_date, pass1_version, pass2_version) VALUES ($1, '2026-10-14', 'p1', 'p2') RETURNING id::text AS id`, [run])).rows[0]!.id;
  const today = (await pg.query<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id::text AS id`)).rows[0]!.id;
  const old = (await pg.query<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id::text AS id`)).rows[0]!.id;
  await pg.query(
    `INSERT INTO reels.finish_requests (post_idea_id, slate_id, status, error, updated_at) VALUES
       ($1, $3, 'failed', 'Copy gate missed twice', $4::timestamptz),
       ($2, $3, 'failed', 'old', $5::timestamptz)`,
    [today, old, slate, TODAY_2AM, YESTERDAY],
  );
  const misses = await readRunMisses(query, NOW);
  assert.deepEqual(misses.reels, [{ key: today, title: MISS_TITLE, detail: 'Copy gate missed twice' }]);
});

test('carousels: today’s latest daily run failed; a good run after it clears the line (Review Focus 5)', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.query(
    `INSERT INTO social.runs (kind, hook_pass, cap_usd, trigger, status, requested_at, error)
     VALUES ('daily', true, 2, 'scheduled', 'failed', '2026-10-14T07:00:00Z', 'Spend cap reached')`,
  );
  assert.deepEqual((await readRunMisses(query, NOW)).carousels, [{ key: null, title: 'Tonight’s carousel run didn’t finish', detail: 'Spend cap reached' }]);
  await pg.query(
    `INSERT INTO social.runs (kind, hook_pass, cap_usd, trigger, status, requested_at)
     VALUES ('daily', true, 2, 'manual', 'ok', '2026-10-14T13:00:00Z')`,
  );
  assert.deepEqual((await readRunMisses(query, NOW)).carousels, []);
});

const idea = (id: string, vertical: HubIdea['vertical']) => ({ id, vertical, title: id }) as unknown as HubIdea;
const card = (o: Partial<QuotaCandidate> & Pick<QuotaCandidate, 'vertical'>): QuotaCandidate => ({ idea: null, post: null, locked: false, rank: 1, moved: null, ...o });
const MISSES: RunMisses = {
  ...NO_MISSES,
  explainers: [{ key: 'T1', title: MISS_TITLE, detail: 'HeyGen render timed out' }],
  stories: [{ key: 'free_vs_paid', title: MISS_TITLE, detail: 'Free vs. Paid: skipped, no good pair found' }],
  carousels: [{ key: null, title: 'Tonight’s carousel run didn’t finish', detail: null }],
};

test('missFor: the idea’s or series’ miss on an empty card; every empty carousel card; never on a card with content or a run in flight', () => {
  assert.equal(missFor(card({ vertical: 'explainers', idea: idea('explainers:topic:T1', 'explainers') }), MISSES, null)?.detail, 'HeyGen render timed out');
  assert.equal(missFor(card({ vertical: 'explainers', idea: idea('explainers:topic:T2', 'explainers') }), MISSES, null), null);
  assert.equal(missFor(card({ vertical: 'stories', seriesId: 'free_vs_paid', series: 'Free vs. Paid' }), MISSES, null)?.key, 'free_vs_paid');
  assert.equal(missFor(card({ vertical: 'carousels' }), MISSES, null)?.title, 'Tonight’s carousel run didn’t finish');
  assert.equal(missFor(card({ vertical: 'carousels', post: { id: 'p' } as HubPost }), MISSES, null), null, 'a card with content');
  const running = { id: 'r', label: 'x', state: 'running', stage: null, error: null, topicId: 'T1', requestedAt: TODAY_2AM, startedAt: TODAY_2AM, typicalSeconds: null } as ProgressItem;
  assert.equal(missFor(card({ vertical: 'explainers', idea: idea('explainers:topic:T1', 'explainers') }), MISSES, running), null, 'a run in flight');
});
