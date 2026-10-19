// tests/social-health-reporters.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { readPosting, type PostingState } from '@/lib/content-type/posting';
import { setSlotSource } from '@/lib/social-hub/slots/write';
import { reportExplainers } from '@/lib/social-hub/health/reporters/explainers';
import { reportCarousels } from '@/lib/social-hub/health/reporters/carousels';
import { emptyReport, funnelFrom, publishingFor, quotaFor, withPublishing } from '@/lib/social-hub/health/reporters/shared';
import { typeVerdict } from '@/lib/social-hub/health/verdict';
import { reportReels } from '@/lib/social-hub/health/reporters/reels';
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

test('quota in template mode: the night\'s own slots from the week schedule, else the derived fields', () => {
  const day = (nyDate: string, count: number, series: string[] = []) => ({ nyDate, count, trial: 0, main: 0, series, override: false });
  const schedule = [day('2026-10-12', 2), day(NIGHT, 1, ['guess_the_number', 'free_vs_paid'])];
  // perDay is today's count (say 2); the night reads its own day.
  assert.equal(quotaFor(posting({ perDay: 2, schedule }), NIGHT), 1);
  assert.equal(quotaFor(posting({ perDay: 2, schedule }), '2026-10-20'), 2, 'outside the week: perDay');
  assert.equal(quotaFor(posting({ type: 'last_few_days', perDay: null, days: [], schedule } as never), NIGHT), 1);
  assert.equal(quotaFor(posting({ type: 'last_few_days', perDay: null, days: [2], schedule: [day(NIGHT, 0)] } as never), NIGHT), 0, 'no LFD slot that night');
  const series = [
    { id: 'morning_download', label: 'MD', enabled: true, generate: true, days: [2] },
    { id: 'guess_the_number', label: 'GN', enabled: true, generate: true, days: [] },
    { id: 'free_vs_paid', label: 'FP', enabled: false, generate: true, days: [] },
  ];
  // Tuesday's slots are GN and FP: GN counts, FP is disabled, MD has no slot that night.
  assert.equal(quotaFor(posting({ type: 'stories', perDay: null, series, schedule } as never), NIGHT), 1);
});

test('due follows generate, not the publishing switch; a run is always due', () => {
  const pub = { scheduledYesterday: 0, postedYesterday: 0, retriedOk: 0, failures: [], placedToday: 0, filledAutoToday: 0 };
  // Publishing off, generating on, the run crashed after making 0 of 1.
  const crashed = withPublishing({ ...emptyReport('carousels', NIGHT), ran: true, made: 0 }, posting({ live: false, generate: true }), pub);
  assert.equal(crashed.due, true);
  assert.equal(typeVerdict(crashed, 'worked').tone, 'failed');
  // Generation off and nothing ran: not due (grey).
  const off = withPublishing(emptyReport('carousels', NIGHT), posting({ live: true, generate: false }), pub);
  assert.equal(off.due, false);
  // Generation off but a run happened anyway: still judged.
  assert.equal(withPublishing({ ...emptyReport('carousels', NIGHT), ran: true }, posting({ generate: false }), pub).due, true);
  // Stories (generate null) follow each series' own switch through the quota.
  const series = [{ id: 'morning_download', label: 'MD', enabled: true, generate: false, days: [0, 1, 2, 3, 4, 5, 6] }];
  assert.equal(withPublishing(emptyReport('stories', NIGHT), posting({ type: 'stories', generate: null, perDay: null, series } as never), pub).due, false);
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

test('text on screen: made = ok videos; failed frame is a failure; a failed then ok video is healed', async () => {
  const { pg, query } = await openHubTestDb();
  const { rows: [idea] } = await query<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id::text`);
  const { rows: [idea2] } = await query<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id::text`);
  await pg.exec(`
    INSERT INTO reels.runs (trigger, status, requested_at, started_at, finished_at) VALUES ('scheduled', 'ok', '2026-10-13T05:00:00Z', '2026-10-13T05:00:00Z', '2026-10-13T06:00:00Z');
    INSERT INTO reels.visual_jobs (post_idea_id, status, error, finished_at) VALUES ('${idea!.id}', 'copy_does_not_fit', 'copy_does_not_fit', '2026-10-13T05:20:00Z');
    INSERT INTO reels.video_jobs (post_idea_id, status, error, finished_at) VALUES
      ('${idea2!.id}', 'failed', 'Kling request timed out', '2026-10-13T05:30:00Z'),
      ('${idea2!.id}', 'ok', NULL, '2026-10-13T05:45:00Z');
  `);
  const r = await reportReels(query, { night: NIGHT, posting: posting({ type: 'reels', perDay: 3 }), now: NOW });
  assert.equal(r.made, 1);
  assert.equal(r.target, 3);
  assert.deepEqual(r.failures.map((f) => [f.stage, f.reason, f.severity]).sort(), [['frame', 'too_long', 'failed'], ['video', 'timeout', 'healed']]);
  assert.equal(r.retriedOk, 1);
});

test('explainers: capped job is cap_hit; unknown-cost HeyGen rows are counted, not priced', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO explainers.topics (id, title, scope, source_url, origin, status, audience_fit, teachability_45s, analogy_potential, visual_potential, accuracy_under_simplification, hook_strength, weighted_score)
      VALUES ('00000000-0000-0000-0000-0000000000e1', 'Webhooks', NULL, NULL, 'generated', 'queued', 3, 3, 3, 3, 3, 3, 70);
    INSERT INTO explainers.idea_cycles (status, mode, ny_date, ideas_generated, ideas_entering_pool) VALUES ('ok', 'production', '2026-10-13', 12, 6);
    INSERT INTO explainers.jobs (id, topic_id, status, stage, trigger, mode, spend_usd, spend_cap_usd, capped, error, orchestrator_model, frame_worker_model, requested_at, finished_at) VALUES
      ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'failed', 'render', 'auto', 'production', 5, 5, true, 'spend cap reached', 'claude-opus-5-5', 'claude-sonnet-5-5', '2026-10-13T06:00:00Z', '2026-10-13T06:40:00Z');
    INSERT INTO explainers.cost_events (job_id, mode, vendor, component, usd, usd_known, created_at) VALUES
      ('00000000-0000-0000-0000-0000000000f1', 'production', 'anthropic', 'session_a', 4.5, true, '2026-10-13T06:10:00Z'),
      ('00000000-0000-0000-0000-0000000000f1', 'production', 'heygen', 'tts+bgm+sfx', 0, false, '2026-10-13T06:20:00Z');
  `);
  const r = await reportExplainers(query, { night: NIGHT, posting: posting({ type: 'explainers', perDay: 2 }), now: NOW });
  assert.equal(r.made, 0);
  assert.equal(r.failures[0]!.reason, 'cap_hit');
  assert.equal(r.unknownCostCalls, 1);
  assert.equal(r.spendUsd, 4.5);
  assert.equal(r.funnel[0]!.in, 12);
});

test('carousels: no quota on a Last Few Days night while Last Few Days auto_run is on', async () => {
  const { query } = await openHubTestDb();
  // NIGHT 2026-10-13 is a Tuesday, one of Last Few Days' days ([2, 5]).
  const off = await reportCarousels(query, { night: NIGHT, posting: posting(), now: NOW });
  assert.deepEqual([off.needed, off.due], [1, true], 'Last Few Days off: Tuesday is an ordinary carousel night');
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  const on = await reportCarousels(query, { night: NIGHT, posting: posting(), now: NOW });
  assert.deepEqual([on.needed, on.target, on.due], [0, 0, false], 'Carousels gave the night to Last Few Days: not "did not run"');
  const wed = await reportCarousels(query, { night: '2026-10-14', posting: posting(), now: NOW });
  assert.equal(wed.needed, 1, 'a Wednesday keeps its carousel quota');
});

// ── Fix 1: each reported night is checked against its own slots, not this week's or today's ──

type PoolHolder = { __outreachHubPool?: unknown };

async function withAppDb<T>(fn: (db: Awaited<ReturnType<typeof openHubTestDb>>) => Promise<T>): Promise<T> {
  const db = await openHubTestDb();
  const holder = globalThis as PoolHolder;
  const before = holder.__outreachHubPool;
  holder.__outreachHubPool = { query: (text: string, params?: unknown[]) => db.pg.query(text, params as unknown[]) };
  try {
    return await fn(db);
  } finally {
    if (before === undefined) delete holder.__outreachHubPool;
    else holder.__outreachHubPool = before;
  }
}

const removeReels = (nyDate: string, windows: string[]) =>
  windows.map((w) => `INSERT INTO social_hub.slot_override (ny_date, vertical, window_id, action, updated_by) VALUES ('${nyDate}', 'reels', '${w}', 'remove', 't');`).join('\n');

test('template mode: a Sunday night reported on Monday uses Sunday\'s slots, not this week\'s or today\'s', async () => {
  await withAppDb(async ({ pg, query }) => {
    await setSlotSource(query as never, 'template', 't');
    await pg.exec(removeReels('2026-10-18', ['midday', 'evening'])); // Sunday: 1 reels slot
    const MON_EARLY = new Date('2026-10-19T10:00:00Z'); // Mon Oct 19, 6:00 AM New York: before the 7:30 report, so Sunday's night
    const p = await readPosting('reels', MON_EARLY);
    assert.equal(p.perDay, 3, 'Monday has 3');
    assert.equal(quotaFor(p, '2026-10-18'), 1);
    assert.equal(quotaFor(p, '2026-10-19'), 3);
    assert.equal(p.schedule!.length, 7, 'the type page still gets this Monday–Sunday week');
    assert.equal(p.schedule![0]!.nyDate, '2026-10-19');
  });
});

test('template mode: a backfilled night 20 days back uses its own slots', async () => {
  await withAppDb(async ({ pg, query }) => {
    await setSlotSource(query as never, 'template', 't');
    await pg.exec(removeReels('2026-09-29', ['evening'])); // Tue Sep 29: 2 reels slots
    const p = await readPosting('reels', new Date('2026-10-19T14:00:00Z'));
    assert.equal(quotaFor(p, '2026-09-29'), 2);
    assert.equal(quotaFor(p, '2026-09-30'), 3);
  });
});

test('legacy mode: no nights, the quota is posts_per_day as before', async () => {
  await withAppDb(async ({ pg }) => {
    await pg.exec(removeReels('2026-10-18', ['midday', 'evening'])); // ignored while legacy
    const p = await readPosting('reels', new Date('2026-10-19T10:00:00Z'));
    assert.equal(p.schedule, null);
    assert.equal(p.nights, null);
    assert.equal(quotaFor(p, '2026-10-18'), p.perDay);
  });
});
