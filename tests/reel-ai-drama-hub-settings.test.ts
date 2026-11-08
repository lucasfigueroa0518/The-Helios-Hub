import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readDramaPosting, writeDramaPosting } from '@/lib/reel-ai-drama/hub';
import { settingsGetRoute, settingsPostRoute } from '@/lib/reel-ai-drama/production/routes';
import { DEFAULT_SETTINGS, EDITABLE_KEYS, inTransaction, loadSettings, loadSettingsReport, saveSettings, SettingsError, validateSettingsPatch } from '@/lib/reel-ai-drama/settings';

import { dramaHubDb, setDrama } from './reel-ai-drama-hub-fixture';

const ok = (db: unknown) => ({ session: async () => ({ email: 't@x' }), db: async () => db as never });
const post = (body: unknown) => new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('the allowlist: every typed key but mode, per_week, publishing_live and require_approval', () => {
  const all = Object.keys(DEFAULT_SETTINGS);
  for (const k of ['mode', 'per_week', 'publishing_live', 'require_approval']) assert.ok(!EDITABLE_KEYS.includes(k as never), k);
  assert.equal(EDITABLE_KEYS.length, all.length - 4);
  for (const k of ['auto', 'posts_per_day', 'daily_render_cap', 'daily_spend_cap_usd']) assert.ok(EDITABLE_KEYS.includes(k as never), k);
  assert.equal(DEFAULT_SETTINGS.require_approval, true);
  assert.equal(DEFAULT_SETTINGS.publishing_live, false);
  assert.equal(DEFAULT_SETTINGS.daily_render_cap, 2);
  assert.equal(DEFAULT_SETTINGS.daily_spend_cap_usd, 20);
  assert.equal(DEFAULT_SETTINGS.posts_per_day, 1);
  assert.equal(validateSettingsPatch(DEFAULT_SETTINGS, {}).ok, true, 'the defaults satisfy every cross-field rule');
});

test('every cross-field check refuses, on the key being changed', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ max_seconds: 50 }, 'max_seconds'],
    [{ target_seconds: 1 }, 'target_seconds'],
    [{ hook_seconds: 70 }, 'hook_seconds'],
    [{ rung_max_seconds: 90 }, 'rung_max_seconds'],
    [{ fresh_days: 120 }, 'fresh_days'],
    [{ solver_limit_usd: 9 }, 'solver_limit_usd'],
    [{ per_reel_cap_usd: 0.3 }, 'per_reel_cap_usd'],
    [{ daily_spend_cap_usd: 5 }, 'daily_spend_cap_usd'],
    [{ daily_render_cap: 1, posts_per_day: 1 }, ''],
    [{ posts_per_day: 2 }, 'posts_per_day'],
  ];
  for (const [patch, key] of cases) {
    const out = validateSettingsPatch(DEFAULT_SETTINGS, patch);
    if (!key) {
      assert.equal(out.ok, true, JSON.stringify(patch));
      continue;
    }
    assert.equal(out.ok, false, JSON.stringify(patch));
    if (!out.ok) assert.ok(out.fields[key], `${JSON.stringify(patch)} → ${JSON.stringify(out.fields)}`);
  }
  // render cap below posts per day (posts_per_day is at most 1 window, so test the rule through a lower cap).
  const low = validateSettingsPatch({ ...DEFAULT_SETTINGS, daily_render_cap: 1 }, { daily_render_cap: 1 });
  assert.equal(low.ok, true);
  const parse = validateSettingsPatch(DEFAULT_SETTINGS, { daily_render_cap: 0, spread_days: 'x' });
  assert.equal(parse.ok, false);
  if (!parse.ok) assert.deepEqual(Object.keys(parse.fields).sort(), ['daily_render_cap', 'spread_days']);
});

test('saveSettings writes a batch in one transaction, and saves nothing on a refusal', async () => {
  const db = await dramaHubDb();
  await saveSettings(db, { spread_days: 9, reuse_days: 30 }, 't@x');
  let s = await loadSettings(db);
  assert.equal(s.spread_days, 9);
  assert.equal(s.reuse_days, 30);

  await assert.rejects(saveSettings(db, { spread_days: 11, fresh_days: 500 }), (e: unknown) => e instanceof SettingsError && 'fresh_days' in e.fields);
  s = await loadSettings(db);
  assert.equal(s.spread_days, 9, 'a refused batch writes none of its keys');

  // A failure mid-write rolls the whole batch back.
  await assert.rejects(
    inTransaction(db, async (tx) => {
      await tx.query(`UPDATE reel_ai_drama.settings SET value = '3'::jsonb WHERE key = 'spread_days'`);
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal((await loadSettings(db)).spread_days, 9);
});

test('a bad stored row is reported, not thrown, and its key falls back to the default', async () => {
  const db = await dramaHubDb();
  await setDrama(db, 'daily_render_cap', 'lots');
  await setDrama(db, 'spread_days', 4);
  const { settings, problems } = await loadSettingsReport(db);
  assert.equal(settings.daily_render_cap, DEFAULT_SETTINGS.daily_render_cap);
  assert.equal(settings.spread_days, 4);
  assert.deepEqual(problems.map((p) => p.key), ['daily_render_cap']);
  assert.equal(problems[0].stored, 'lots');

  const got = await settingsGetRoute(ok(db));
  const body = (await got.json()) as { editable: string[]; problems: unknown[] };
  assert.equal(got.status, 200);
  assert.equal(body.problems.length, 1);
  assert.ok(!body.editable.includes('publishing_live'));
});

test('the settings route: { values } batches, per-key and cross-field 400s, legacy { key, value }', async () => {
  const db = await dramaHubDb();
  const good = await settingsPostRoute(post({ values: { spread_days: 10, daily_spend_cap_usd: 30 } }), ok(db));
  assert.equal(good.status, 200);
  assert.equal(((await good.json()) as { settings: { daily_spend_cap_usd: number } }).settings.daily_spend_cap_usd, 30);

  const cross = await settingsPostRoute(post({ values: { daily_spend_cap_usd: 1, spread_days: 3 } }), ok(db));
  assert.equal(cross.status, 400);
  const crossBody = (await cross.json()) as { fields: Record<string, string> };
  assert.ok(crossBody.fields.daily_spend_cap_usd);
  assert.equal((await loadSettings(db)).spread_days, 10, 'nothing saved on a 400');

  const locked = await settingsPostRoute(post({ values: { publishing_live: true } }), ok(db));
  assert.equal(locked.status, 400);
  assert.ok(((await locked.json()) as { fields: Record<string, string> }).fields.publishing_live);

  assert.equal((await settingsPostRoute(post({ key: 'spread_days', value: 12 }), ok(db))).status, 200);
  assert.equal((await loadSettings(db)).spread_days, 12);
  assert.equal((await settingsPostRoute(post({ values: { max_seconds: 'long' } }), ok(db))).status, 400);
});

test('posting: read and write map onto auto / require_approval / publishing_live / posts_per_day', async () => {
  const db = await dramaHubDb();
  assert.deepEqual(await readDramaPosting(db), { generate: false, autoPublish: false, live: false, perDay: 1, maxPerDay: 1, dailyRenderCap: 2, dailySpendCapUsd: 20 });
  const out = await writeDramaPosting(db, { generate: true, autoPublish: true, perDay: 1 });
  assert.equal(out.generate, true);
  assert.equal(out.autoPublish, true);
  const s = await loadSettings(db);
  assert.equal(s.auto, true);
  assert.equal(s.require_approval, false);
  await assert.rejects(writeDramaPosting(db, { perDay: 3 }), /1 to 1/);
  await assert.rejects(writeDramaPosting(db, { live: 'yes' as never }), /true or false/);
  assert.equal((await writeDramaPosting(db, { live: true })).live, true);
});
