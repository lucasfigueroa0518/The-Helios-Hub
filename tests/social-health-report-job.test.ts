import assert from 'node:assert/strict';
import test from 'node:test';

import type { PostingState } from '@/lib/content-type/posting';
import type { HubQuery } from '@/lib/social-hub/db';
import { MORNING_REPORT_TIMEOUT_MS, runMorningReport, withTimeout } from '@/lib/social-hub/health/job';
import { buildNight, publisherTone } from '@/lib/social-hub/health/night';
import { readinessFor } from '@/lib/social-hub/health/readiness';
import { readReports } from '@/lib/social-hub/health/store';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-13T11:31:00Z');
const posting = async (v: string): Promise<PostingState> =>
  ({ type: v, live: true, generate: true, autoPublish: false, perDay: v === 'stories' ? null : 1, maxPerDay: 3,
     series: v === 'stories' ? [{ id: 'morning_download', label: 'MD', enabled: true, generate: true, days: [0, 1, 2, 3, 4, 5, 6] }] : null }) as PostingState;

test('a reporter that throws does not break the night: that type reads as unknown', async () => {
  const { query } = await openHubTestDb();
  const broken: HubQuery = async () => { throw new Error('explainers database unreachable'); };
  const night = await buildNight({ q: query, explainersQ: async () => broken, posting }, '2026-10-13', NOW, 'worked');
  const exp = night.reports.find((r) => r.vertical === 'explainers')!;
  assert.match(exp.reportError ?? '', /unreachable/);
  assert.equal(night.verdict.types.find((t) => t.vertical === 'explainers')!.tone, 'short');
  assert.equal(night.reports.length, 4);
});

test('failures on a type that met its target are downgraded to warnings', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO social.runs (kind, started_at, hook_pass, cap_usd, total_usd, trigger, status, requested_at, record) VALUES
      ('daily', '2026-10-13T07:00:00Z', true, 2, 1, 'scheduled', 'ok', '2026-10-13T07:00:00Z', '{"result":{"posts":[{"storyId":"a"}]}}');
    INSERT INTO social.set_asides (day, story_id, stage, reason_code, kind, detail, at) VALUES
      ('2026-10-13', 'st-9', 'writer', 'over-limit', 'pipeline-fault', 'too long', '2026-10-13T07:14:00Z');
  `);
  const night = await buildNight({ q: query, explainersQ: async () => query, posting }, '2026-10-13', NOW, 'worked');
  const car = night.reports.find((r) => r.vertical === 'carousels')!;
  assert.equal(car.made, 1);
  assert.equal(car.failures.find((f) => f.stage === 'writer')!.severity, 'warning');
});

test('publisher tone: fresh heartbeat worked, stale failed, missing none', async () => {
  const { query } = await openHubTestDb();
  assert.equal(await publisherTone(query, NOW), 'none');
  await query(`INSERT INTO social_hub.settings (key, value) VALUES ('publisher_heartbeat', $1::jsonb)`, [JSON.stringify({ at: '2026-10-13T11:30:00Z', verticals: [] })]);
  assert.equal(await publisherTone(query, NOW), 'worked');
  assert.equal(await publisherTone(query, new Date('2026-10-13T11:40:00Z')), 'failed');
});

test('morning report: saves today, backfills missing nights once, is idempotent', async () => {
  const { query } = await openHubTestDb();
  const h = { q: query, explainersQ: async () => query, posting };
  const first = await runMorningReport(h, NOW, 5);
  assert.equal(first.night, '2026-10-13');
  assert.equal(first.backfilled, 4);
  const again = await runMorningReport(h, NOW, 5);
  assert.equal(again.backfilled, 0);
  const stored = await readReports(query, '2026-10-09', '2026-10-13');
  assert.deepEqual(stored.map((r) => r.night), ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
  assert.equal(stored[0]!.verdict.publisher, 'none'); // backfilled nights have no heartbeat
  assert.match(stored[0]!.builtAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
});

test('readiness: approved-as-is rate per type over 30 days', async () => {
  const { pg, query } = await openHubTestDb();
  await pg.exec(`
    INSERT INTO social_hub.content_items (id, vertical, format, native_ref) VALUES
      ('00000000-0000-0000-0000-0000000000b1', 'reels', 'reel', 'v1'), ('00000000-0000-0000-0000-0000000000b2', 'reels', 'reel', 'v2'),
      ('00000000-0000-0000-0000-0000000000b3', 'reels', 'reel', 'v3'), ('00000000-0000-0000-0000-0000000000b4', 'reels', 'reel', 'v4');
    INSERT INTO social_hub.approvals (content_item_id, decision, decided_at, via) VALUES
      ('00000000-0000-0000-0000-0000000000b1', 'approved', '2026-10-10T12:00:00Z', 'user'),
      ('00000000-0000-0000-0000-0000000000b2', 'approved', '2026-10-10T12:00:00Z', 'user'),
      ('00000000-0000-0000-0000-0000000000b3', 'approved', '2026-10-10T12:00:00Z', 'user'),
      ('00000000-0000-0000-0000-0000000000b4', 'rejected', '2026-10-10T12:00:00Z', 'user');
  `);
  const r = (await readinessFor(query, NOW)).find((x) => x.vertical === 'reels')!;
  assert.equal(r.rate, 0.75);
});

test('worker cap: a hung report rejects with a timeout; a quick one passes its result through', async () => {
  assert.equal(MORNING_REPORT_TIMEOUT_MS, 600_000);
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'health report'), /health report timed out/);
  assert.deepEqual(await withTimeout(Promise.resolve({ night: '2026-10-13', backfilled: 0 }), 1000, 'health report'), { night: '2026-10-13', backfilled: 0 });
  await assert.rejects(withTimeout(Promise.reject(new Error('db down')), 1000, 'health report'), /db down/);
});

test('worker: the 07:30 report call is wrapped in the timeout and logged at startup', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('scripts/social_worker.ts', 'utf8');
  assert.match(src, /health\s*\.withTimeout\(\s*health\.runMorningReport\(/);
  assert.match(src, /nextHealthReportAt: healthAt\.toISOString\(\)/);
  assert.match(src, /7:30 AM morning report/);
});
