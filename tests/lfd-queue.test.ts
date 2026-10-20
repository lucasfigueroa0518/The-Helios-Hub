import assert from 'node:assert/strict';
import test from 'node:test';

import { datesByWeekday, weekdayOfDate } from '@/lib/lfd/days';
import { carouselOffDays, parseLfdSettings, readLfdSettings } from '@/lib/lfd/settings';
import { adoptRun, claimRun, failRun, requestRun } from '@/lib/lfd/store';

import { openHubTestDb } from './fixtures/social-hub/pglite';

test('settings: defaults ship off, days fall back to Tue/Fri, a bad cap reads as null', () => {
  assert.deepEqual(parseLfdSettings([]), { autoRun: false, publishingLive: false, requireApproval: true, days: [2, 5], runCapUsd: 1, runCapRaw: 1, memes: true, memesCapUsd: 1 });
  assert.equal(parseLfdSettings([{ key: 'memes', value: false }]).memes, false, 'memes switch off only on an explicit false');
  assert.equal(parseLfdSettings([{ key: 'memes_cap_usd', value: 'abc' }]).memesCapUsd, 1, 'a bad meme cap falls back to the default');
  const s = parseLfdSettings([
    { key: 'auto_run', value: true },
    { key: 'days', value: [5, 2, 2] },
    { key: 'run_cap_usd', value: '0.75' },
    { key: 'require_approval', value: false },
  ]);
  assert.deepEqual([s.autoRun, s.days, s.runCapUsd, s.requireApproval], [true, [2, 5], 0.75, false]);
  assert.deepEqual(parseLfdSettings([{ key: 'days', value: [9] }]).days, [2, 5]);
  assert.deepEqual(parseLfdSettings([{ key: 'days', value: [] }]).days, [2, 5]);
  for (const bad of ['abc', 0, -1, null, true]) assert.equal(parseLfdSettings([{ key: 'run_cap_usd', value: bad }]).runCapUsd, null, String(bad));
});

test('settings: read from lfd.settings; carousels give up its days only while auto_run is on', async () => {
  const { query } = await openHubTestDb();
  const s = await readLfdSettings(query);
  assert.deepEqual([s.autoRun, s.publishingLive, s.requireApproval, s.days, s.runCapUsd], [false, false, true, [2, 5], 1]);
  assert.deepEqual(await carouselOffDays(query), []);
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  assert.deepEqual(await carouselOffDays(query), [2, 5]);
  assert.deepEqual(await carouselOffDays(async () => { throw new Error('relation "lfd.settings" does not exist'); }), []);
});

test('days: weekdays by New York date', () => {
  assert.equal(weekdayOfDate('2026-10-13'), 2);
  assert.deepEqual(datesByWeekday('2026-10-13', 7, [2, 5], true), ['2026-10-13', '2026-10-16']);
  assert.deepEqual(datesByWeekday('2026-10-13', 4, [2, 5], false), ['2026-10-14', '2026-10-15']);
});

test('runs: one queued at a time; the worker claims it when none is running', async () => {
  const { query } = await openHubTestDb();
  const id = await requestRun(query, 'scheduled', 1.5);
  assert.ok(id);
  assert.equal(await requestRun(query, 'manual', 1), null);
  assert.deepEqual(await claimRun(query), { id, trigger: 'scheduled' });
  assert.equal(await claimRun(query), null);
  const second = await requestRun(query, 'manual', 1);
  assert.equal(await claimRun(query), null, 'a run is still running');
  await failRun(query, id!, 'boom');
  assert.deepEqual(await claimRun(query), { id: second, trigger: 'manual' });
  const row = (await query<{ status: string; error: string; cap_usd: number }>(`SELECT status, error, cap_usd FROM lfd.runs WHERE id = $1`, [id])).rows[0]!;
  assert.deepEqual([row.status, row.error, row.cap_usd], ['failed', 'boom', 1.5]);
});

test('runs: an abandoned running run is failed so a queued one can start; adopting needs a running run', async () => {
  const { query } = await openHubTestDb();
  await query(`INSERT INTO lfd.runs (trigger, status, started_at) VALUES ('manual', 'running', now() - interval '3 hours')`);
  const id = await requestRun(query, 'scheduled', 1);
  assert.deepEqual(await claimRun(query), { id, trigger: 'scheduled' });
  assert.equal(await adoptRun(query, id!, 0.8, '2026-10-13'), id);
  const row = (await query<{ cap_usd: number; ny_date: string }>(`SELECT cap_usd, ny_date::text AS ny_date FROM lfd.runs WHERE id = $1`, [id])).rows[0]!;
  assert.deepEqual([row.cap_usd, row.ny_date], [0.8, '2026-10-13']);
  const abandoned = (await query<{ status: string; stop_reason: string }>(`SELECT status, stop_reason FROM lfd.runs WHERE id <> $1`, [id])).rows[0]!;
  assert.deepEqual([abandoned.status, abandoned.stop_reason], ['failed', 'abandoned']);
  await failRun(query, id!, 'x');
  await assert.rejects(adoptRun(query, id!, 1, '2026-10-13'), /is not running/);
});
