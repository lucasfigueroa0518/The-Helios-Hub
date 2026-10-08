/** P1-M7: the social_hub schema (written, not applied) and the account read. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { summarizeAccount } from '@/lib/social-hub/account';
import { readAccount } from '@/lib/social-hub/queries/account';
import { parseRange } from '@/lib/social-hub/time';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-08T16:00:00Z');

test('no social_hub tables: the account read says absent; applied but empty says empty', async () => {
  const { query } = await openHubTestDb();
  const read = await readAccount(query);
  assert.deepEqual(read, { present: false });
  assert.equal(summarizeAccount(read, parseRange({}, NOW)), null);
  const applied = await openHubTestDb({ withHubSchema: true });
  const empty = await readAccount(applied.query);
  assert.equal(empty.present, true);
  assert.equal(summarizeAccount(empty, parseRange({}, NOW)), null, 'no rows yet: same empty Profile, different message');
});

test('the schema is additive, idempotent, and creates only social_hub objects', async () => {
  const { pg, query } = await openHubTestDb();
  const tables = async () => (await query<{ s: string; t: string }>(`SELECT table_schema AS s, table_name AS t FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2`)).rows.map((r) => `${r.s}.${r.t}`);
  const before = await tables();
  const sql = readFileSync(path.join(process.cwd(), 'db/social_hub_schema.sql'), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
  await pg.exec(sql);
  await pg.exec(sql); // second run is a no-op
  const after = await tables();
  const added = after.filter((t) => !before.includes(t));
  assert.deepEqual(added.sort(), ['social_hub.account_demographics_daily', 'social_hub.account_insights_daily', 'social_hub.online_followers_daily', 'social_hub.publishing_quota', 'social_hub.refreshes']);
  assert.ok(before.every((t) => after.includes(t)), 'nothing removed');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(ALTER|DROP|INSERT|UPDATE|DELETE)\b/i, 'no change to anything existing');
  for (const line of sql.split('\n').filter((l) => /^\s*CREATE\s/i.test(l))) assert.match(line, /IF NOT EXISTS/i, line);
  // one queued + one running refresh at most (claim pattern)
  await pg.exec(`INSERT INTO social_hub.refreshes (trigger) VALUES ('visit')`);
  await assert.rejects(pg.exec(`INSERT INTO social_hub.refreshes (trigger) VALUES ('visit')`));
});

test('with rows: summed daily numbers in range, net follows, follower share, demographics, active times', async () => {
  const { pg, query } = await openHubTestDb({ withHubSchema: true });
  await pg.exec(`
    INSERT INTO social_hub.account_insights_daily (ny_date, reach, reach_followers, reach_non_followers, views, accounts_engaged, total_interactions, profile_links_taps, follows, unfollows, follower_count) VALUES
      ('2026-10-01', 100, 30, 70, 300, 10, 20, 2, 5, 1, 4000),
      ('2026-10-02', 200, 50, 150, NULL, 20, 30, 3, 7, 2, 4010),
      ('2026-08-01', 999, 1, 1, 999, 999, 999, 999, 999, 0, 3000);
    INSERT INTO social_hub.account_demographics_daily (ny_date, metric, timeframe, breakdown, key, value) VALUES
      ('2026-10-02', 'follower_demographics', 'this_week', 'age', '25-34', 40),
      ('2026-10-02', 'follower_demographics', 'prev_month', 'age', '25-34', 500),
      ('2026-10-02', 'follower_demographics', 'this_month', 'age', '25-34', 300),
      ('2026-10-02', 'follower_demographics', 'this_month', 'age', '35-44', 100),
      ('2026-09-01', 'follower_demographics', 'this_month', 'age', 'old snapshot', 999);
    INSERT INTO social_hub.online_followers_daily (ny_date, hour, value) VALUES ('2026-10-01', 9, 50), ('2026-10-08', 9, 150);
    INSERT INTO social_hub.refreshes (trigger, status, finished_at) VALUES ('overnight', 'ok', '2026-10-08T09:45:00Z');
  `);
  const read = await readAccount(query);
  assert.equal(read.present, true);
  const s = summarizeAccount(read, parseRange({}, NOW))!;
  assert.equal(s.days, 2, 'August is outside the 30-day range');
  assert.equal(s.reach, 300);
  assert.equal(s.views, 300, 'a blank day stays out of the sum');
  assert.equal(s.netFollows, 9);
  assert.equal(s.followerShare, 80 / 300);
  assert.equal(s.followerCount, 4010);
  assert.deepEqual(s.demographics[0]!.rows.map((r) => [r.key, r.share]), [['25-34', 0.75], ['35-44', 0.25]], 'latest snapshot, this_month only (no timeframes mixed)');
  // 2026-10-01 and 2026-10-08 are both Thursdays (weekday 4): one cell, averaged.
  assert.equal(s.online![4]![9], 100);
  assert.equal(s.online![3]![9], 0);
  assert.match(s.lastRefresh ?? '', /2026-10-08/);
});

test('the apply script refuses to run without --apply', () => {
  const out = spawnSync(process.execPath, ['scripts/apply_social_hub_schema.js'], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DIRECT_DATABASE_URL: '' } });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /Refusing to run without --apply/);
});
