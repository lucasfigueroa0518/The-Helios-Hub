// tests/social-health-reporters.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PostingState } from '@/lib/content-type/posting';
import { reportCarousels } from '@/lib/social-hub/health/reporters/carousels';
import { funnelFrom, publishingFor, quotaFor } from '@/lib/social-hub/health/reporters/shared';
import { reportStories } from '@/lib/social-hub/health/reporters/stories';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NIGHT = '2026-10-13';
const NOW = new Date('2026-10-13T11:31:00Z');
const posting = (over: Partial<PostingState> = {}): PostingState =>
  ({ type: 'carousels', live: true, generate: true, autoPublish: false, perDay: 1, maxPerDay: 2, series: null, ...over }) as PostingState;

test('quota: perDay for most types; enabled series that run that weekday for Stories', () => {
  assert.equal(quotaFor(posting({ perDay: 2 }), NIGHT), 2);
  const series = [
    { id: 'morning_download', label: 'MD', enabled: true, generate: true, days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'guess_the_number', label: 'GN', enabled: true, generate: true, days: [1, 4] },
    { id: 'free_vs_paid', label: 'FP', enabled: false, generate: true, days: [2] },
  ];
  assert.equal(quotaFor(posting({ type: 'stories', perDay: null, series } as never), NIGHT), 1); // Tue: MD only (FP disabled)
});

test('funnel subtracts drops stage by stage', () => {
  assert.deepEqual(funnelFrom(10, [['scoring', 6], ['writer', 2]]), [
    { stage: 'scoring', in: 10, out: 4 },
    { stage: 'writer', in: 4, out: 2 },
  ]);
});

test('publishing: yesterday posted, failed and healed-by-retry, plus today placed/filled', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO social_hub.content_items (id, vertical, format, native_ref, idea_ref) VALUES
      ('00000000-0000-0000-0000-0000000000a1', 'carousels', 'feed', 'p1', 's1'),
      ('00000000-0000-0000-0000-0000000000a2', 'carousels', 'feed', 'p2', 's2');
    INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, requested_at, caption) VALUES
      ('00000000-0000-0000-0000-0000000000a1', 'carousels', 'auto', 'failed', '2026-10-12T13:00:00Z', 'c'),
      ('00000000-0000-0000-0000-0000000000a1', 'carousels', 'auto', 'published', '2026-10-12T13:05:00Z', 'c');
    INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, requested_at, caption, error) VALUES
      ('00000000-0000-0000-0000-0000000000a2', 'carousels', 'auto', 'failed', '2026-10-12T18:00:00Z', 'c', 'Meta 500');
    UPDATE social_hub.publish_attempts SET error = 'Meta returned 500' WHERE status = 'failed' AND error IS NULL;
    INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES
      ('00000000-0000-0000-0000-0000000000a1', 'carousels', '2026-10-12', 'morning', '2026-10-12T13:00:00Z', 'published', 'auto'),
      ('00000000-0000-0000-0000-0000000000a2', 'carousels', '2026-10-12', 'afternoon', '2026-10-12T18:30:00Z', 'failed', 'auto');
  `);
  const p = await publishingFor(query, 'carousels', NIGHT);
  assert.equal(p.scheduledYesterday, 2);
  assert.equal(p.postedYesterday, 1);
  assert.equal(p.retriedOk, 1);
  assert.deepEqual(p.failures.map((f) => [f.stage, f.reason, f.severity]).sort(), [
    ['publish', 'service_5xx', 'failed'],
    ['publish', 'service_5xx', 'healed'],
  ]);
});

test('carousels: made from run posts, pipeline-fault set-asides are failures, should-not-run feed the funnel', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO social.runs (kind, started_at, hook_pass, cap_usd, total_usd, trigger, status, requested_at, record) VALUES
      ('daily', '2026-10-13T07:00:00Z', true, 2, 1.2, 'scheduled', 'ok', '2026-10-13T07:00:00Z',
       '{"result":{"posts":[]}}');
    INSERT INTO social.set_asides (day, story_id, stage, reason_code, kind, detail, at) VALUES
      ('2026-10-13', 'st-1', 'writer', 'over-limit', 'pipeline-fault', 'slide 3 over 40 words', '2026-10-13T07:14:00Z'),
      ('2026-10-13', 'st-2', 'writer', 'over-limit', 'pipeline-fault', 'slide 2 over 40 words', '2026-10-13T07:15:00Z'),
      ('2026-10-13', 'st-3', 'jev-scoring', 'refused', 'should-not-run', 'off-topic', '2026-10-13T07:05:00Z');
    INSERT INTO social.feed_health (day, slug, name, fetched, in_window, flagged) VALUES
      ('2026-10-11', 'tc', 'TechCrunch AI', 5, 0, false), ('2026-10-12', 'tc', 'TechCrunch AI', 5, 0, false), ('2026-10-13', 'tc', 'TechCrunch AI', 5, 0, false);
  `);
  const r = await reportCarousels(query, { night: NIGHT, posting: posting(), now: NOW });
  assert.equal(r.ran, true);
  assert.equal(r.made, 0);
  assert.equal(r.target, 1);
  assert.equal(r.failures.filter((f) => f.stage === 'writer' && f.reason === 'too_long').length, 2);
  assert.equal(r.funnel[0]!.stage, 'jev-scoring');
  assert.deepEqual(r.feedsStale, ['TechCrunch AI']);
  assert.equal(r.spendUsd, 1.2);
});

test('stories: failed set is a failure, watch-reached skip is a cap warning', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO stories.sets (series, ny_date, trigger, style, status, error, spend_usd) VALUES
      ('morning_download', '2026-10-13', 'auto', 'polished', 'failed', 'Request timed out', 0.4),
      ('guess_the_number', '2026-10-13', 'auto', 'polished', 'skipped', 'monthly watch reached (25)', 0);
  `);
  const series = [
    { id: 'morning_download', label: 'MD', enabled: true, generate: true, days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'guess_the_number', label: 'GN', enabled: true, generate: true, days: [2] },
  ];
  const r = await reportStories(query, { night: NIGHT, posting: posting({ type: 'stories', perDay: null, series } as never), now: NOW });
  assert.equal(r.made, 0);
  assert.equal(r.target, 2);
  assert.deepEqual(r.failures.map((f) => [f.reason, f.severity]).sort(), [['cap_hit', 'warning'], ['timeout', 'failed']]);
  assert.equal(r.spendUsd, 0.4);
});

test('feed staleness counts distinct days, not rows', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO social.feed_health (day, slug, name, fetched, in_window, flagged) VALUES
      ('2026-10-13', 'tc', 'TechCrunch AI', 5, 0, false), ('2026-10-13', 'tc', 'TechCrunch AI', 5, 0, false), ('2026-10-13', 'tc', 'TechCrunch AI', 5, 0, false);
  `);
  const r = await reportCarousels(query, { night: NIGHT, posting: posting(), now: NOW });
  assert.deepEqual(r.feedsStale, []);
});

test('publishing: a published slot with a non-failed earlier attempt is not healed', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO social_hub.content_items (id, vertical, format, native_ref, idea_ref) VALUES
      ('00000000-0000-0000-0000-0000000000b1', 'carousels', 'feed', 'p1', 's1');
    INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, requested_at, caption) VALUES
      ('00000000-0000-0000-0000-0000000000b1', 'carousels', 'auto', 'requested', '2026-10-12T13:00:00Z', 'c'),
      ('00000000-0000-0000-0000-0000000000b1', 'carousels', 'auto', 'published', '2026-10-12T13:05:00Z', 'c');
    INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES
      ('00000000-0000-0000-0000-0000000000b1', 'carousels', '2026-10-12', 'morning', '2026-10-12T13:00:00Z', 'published', 'auto');
  `);
  const p = await publishingFor(query, 'carousels', NIGHT);
  assert.equal(p.postedYesterday, 1);
  assert.equal(p.retriedOk, 0);
  assert.equal(p.failures.length, 0);
});
