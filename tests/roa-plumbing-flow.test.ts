/**
 * Real or AI? plumbing (planning/Real or AI/CONTRACT.md §4 Owner C, §5 C), offline: the series registry, the
 * schema file, a real_or_ai set through the worker (stubbed build → still render → stubbed publish with 4 image
 * containers), the daily candidate run's once-per-pool-day pass, and Free vs. Paid's history still reading.
 * PGlite and stubs only; no live call of any kind.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { STORIES_STAGES } from '@/lib/social-hub/cost-page/stages/stories';
import { setHeadline } from '@/lib/social-hub/adapters/stories';
import { seedTemplate, DEFAULT_SEED_INPUTS } from '@/lib/social-hub/slots/seed';
import { STORY_SERIES, isStorySeries } from '@/lib/social-hub/slots/types';
import { STORY_WINDOW_DEFAULTS } from '@/lib/social-hub/placement';
import { isKnownSeries, isSeries, listView } from '@/lib/stories/api';
import { buildSet } from '@/lib/stories/build';
import { REAL_OR_AI_PATH, AI_TRIVIA_PATH, schemaSql } from '@/lib/stories/local-db';
import { poolDay } from '@/lib/stories/pool';
import type { StoriesMetaClient } from '@/lib/stories/publish/meta';
import type { ReviewCall } from '@/lib/stories/render/review';
import { SERIES_STYLE, VIDEO_SERIES } from '@/lib/stories/render/types';
import { claimNextRequested, getSet, listSets, recentKeys, requestSet } from '@/lib/stories/repository';
import { DEFAULT_SETTINGS, SERIES, loadSettings, saveSeriesSetting } from '@/lib/stories/settings';
import type { StoriesStorage } from '@/lib/stories/storage';
import { ROA_DAILY_KEY, tick } from '@/lib/stories/worker';

import { harnessDb, roaFrames, stubJev, stubPhotos, stubRenderer, stubWriter } from './stories-harness';

const storage = (): StoriesStorage & { uploads: string[] } => {
  const uploads: string[] = [];
  return { uploads, upload: async (p) => { uploads.push(p); }, sign: async (p) => `https://signed.test/${p}`, signMany: async (paths: string[]) => paths.map((p) => `https://signed.test/${p}`), download: async () => Buffer.alloc(0), remove: async () => {} };
};
const cleanReview: ReviewCall = async () => ({ flags: [], usage: { model: 'claude-haiku-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.0001 } });

async function setSwitches(db: Awaited<ReturnType<typeof harnessDb>>['db'], s: { requireApproval: boolean; publishingLive: boolean }) {
  for (const [key, value] of [['require_approval', s.requireApproval], ['publishing_live', s.publishingLive]] as const) {
    await db.query(`INSERT INTO stories.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);
  }
}

test('registry: real_or_ai is requestable on Tue/Sat, polished, stills; free_vs_paid is retired but still known', () => {
  assert.ok(SERIES.includes('real_or_ai'));
  assert.ok(!SERIES.includes('free_vs_paid'), 'Free vs. Paid is not requestable');
  const roa = DEFAULT_SETTINGS.series.real_or_ai;
  assert.deepEqual({ enabled: roa.enabled, auto: roa.auto, style: roa.style, days: roa.window.days }, { enabled: true, auto: false, style: 'polished', days: [2, 6] });
  assert.deepEqual(roa.window, { ...DEFAULT_SETTINGS.series.free_vs_paid.window }, "Free vs. Paid's window");
  assert.equal(DEFAULT_SETTINGS.series.free_vs_paid.enabled, false);
  assert.equal(SERIES_STYLE.real_or_ai, 'polished');
  assert.ok(!VIDEO_SERIES.has('real_or_ai'), 'Real or AI? takes the still path (RA-8)');
  assert.equal(isSeries('free_vs_paid'), false);
  assert.equal(isKnownSeries('free_vs_paid'), true, 'its history list still filters by it');
  assert.equal(isKnownSeries('real_or_ai'), true);
  // The hub's slots: Real or AI? takes Free vs. Paid's Tuesday and Saturday slot (RA-10).
  assert.deepEqual([...STORY_SERIES], ['morning_download', 'ai_trivia', 'real_or_ai']);
  assert.equal(isStorySeries('free_vs_paid'), false);
  assert.deepEqual(STORY_WINDOW_DEFAULTS.real_or_ai.days, roa.window.days);
  const days = seedTemplate(DEFAULT_SEED_INPUTS).filter((r) => r.series === 'real_or_ai').map((r) => r.weekday);
  assert.deepEqual([...new Set(days)], [2, 6]);
  // Cost page components and the hub's short name.
  assert.deepEqual(['roa-write', 'roa-image', 'roa-screen', 'roa-reveal'].map((c) => STORIES_STAGES[c]), ['writing', 'visuals', 'research', 'writing']);
  assert.equal(setHeadline({ series: 'real_or_ai', payload: roaFrames().payload } as never), 'Real, then AI');
});

test('schema: real_or_ai rows, still roles, the openai cost vendor, archive and lab CHECKs; re-applying both files with a real_or_ai row is fine', async () => {
  const { db, pg } = await harnessDb();
  const { set } = await requestSet(db, { series: 'real_or_ai', nyDate: '2026-10-13', trigger: 'click', style: 'polished' });
  await db.query(`INSERT INTO stories.frames (set_id, seq, role, backdrop, copy) VALUES ($1, 1, 'roa_question', 'black', '{}'::jsonb)`, [set.id]);
  await db.query(`INSERT INTO stories.pool (series, key, origin, ref, title, payload, score) VALUES ('real_or_ai', 'roa:a1b2c3d4e5f60718', 'model', 'a1b2c3d4e5f60718', 'x', '{}'::jsonb, 0.5)`);
  await db.query(`INSERT INTO stories.history (series, key, set_id) VALUES ('real_or_ai', 'roa:a1b2c3d4e5f60718', $1)`, [set.id]);
  await db.query(`INSERT INTO stories.roa_archive (key, payload, reason) VALUES ('roa:x', '{}'::jsonb, 'cap')`);
  await assert.rejects(() => db.query(`INSERT INTO stories.roa_archive (key, payload, reason) VALUES ('roa:x', '{}'::jsonb, 'other')`));
  await db.query(`INSERT INTO stories.cost_events (set_id, vendor, component) VALUES ($1, 'openai', 'roa-image')`, [set.id]);
  await assert.rejects(() => db.query(`INSERT INTO stories.cost_events (set_id, vendor, component) VALUES ($1, 'acme', 'roa-image')`, [set.id]));
  await db.query(`INSERT INTO stories.roa_lab (batch_id, image_key, truth, guess, ms) VALUES ('b1', 'k', 'ai', 'real', 2900)`);
  await assert.rejects(() => db.query(`INSERT INTO stories.roa_lab (batch_id, image_key, truth, guess) VALUES ('b1', 'k', 'maybe', 'real')`));
  await assert.rejects(() => db.query(`INSERT INTO stories.frames (set_id, seq, role, backdrop, copy) VALUES ($1, 2, 'roa_other', 'black', '{}'::jsonb)`, [set.id]));
  // RA-10: Free vs. Paid's weekly template slots become Real or AI?'s, under its own type since the Stories split (SS-1); a re-run leaves them so.
  await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series) VALUES (2, 'stories', 510, 'free_vs_paid')`);
  await pg.exec(schemaSql(AI_TRIVIA_PATH));
  await pg.exec(schemaSql(REAL_OR_AI_PATH));
  await pg.exec(schemaSql(REAL_OR_AI_PATH));
  const { rows } = await pg.query<{ vertical: string; series: string }>(`SELECT vertical, series FROM social_hub.slot_template WHERE weekday = 2 AND start_minute = 510 AND vertical IN ('stories', 'real_or_ai')`);
  assert.deepEqual(rows.map((r) => `${r.vertical}/${r.series}`), ['real_or_ai/real_or_ai']);
});

test('worker (approval off, publishing live): a real_or_ai set → stubbed build → still render → 4 image containers in order; the daily run once per pool day', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'real_or_ai', { auto: true });
  await setSwitches(db, { requireApproval: false, publishingLive: true });
  const renderer = await stubRenderer();
  const published: string[] = [];
  const created: Array<{ kind: 'image' | 'video'; url: string }> = [];
  const meta: StoriesMetaClient = {
    createStoryContainer: async (url) => (created.push({ kind: 'image', url }), `c:${url.split('/').pop()}`),
    createStoryVideoContainer: async (url) => (created.push({ kind: 'video', url }), `v:${url.split('/').pop()}`),
    containerStatus: async () => ({ state: 'FINISHED', status: null }),
    publishContainer: async (id) => (published.push(id), `m:${id}`),
    publishingQuota: async () => ({ used: 0, total: 100 }),
    publishingLimit: async () => ({ quotaUsage: 0, quotaTotal: 100 }),
  };
  const st = storage();
  let clock = new Date('2026-10-13T07:00:00Z'); // 3:00 AM New York, a Tuesday (Real or AI? posts Tue/Sat)
  const r = roaFrames();
  const daily: string[] = [];
  const deps = {
    db, sourceDb: db, now: () => clock, sleep: async () => {}, photoHttp: (async () => new Response('', { status: 404 })) as typeof fetch,
    triviaDaily: async () => null,
    // runRoaDaily records its pool day under 'roa_daily' (in a finally); the stub does the same.
    roaDaily: async (now: Date) => {
      daily.push('ran');
      await db.query(`INSERT INTO stories.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [ROA_DAILY_KEY, JSON.stringify({ day: poolDay(now) })]);
      return { ran: true };
    },
    builder: async () => ({ db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), renderer, review: cleanReview, storage: st, now: () => clock, builders: { real_or_ai: async () => ({ ok: true as const, payload: r.payload, frames: r.frames, candidates: [], historyKeys: r.historyKeys }) } }),
    meta: () => meta,
    storage: () => st,
    insights: () => ({ storyInsights: async () => ({ metrics: { reach: 50, taps_forward: 40 }, raw: [], notEnoughViewers: false }) }),
  };
  const first = await tick(deps);
  assert.deepEqual(first, { built: 1, scheduled: 1, published: 0, insights: 0 });
  assert.deepEqual(daily, ['ran'], 'the daily candidate run follows the 3:00 refresh');
  assert.equal(renderer.renders, 1, 'Real or AI? goes through the still renderer');
  const [set] = await listSets(db, { series: 'real_or_ai' });
  assert.equal(set!.status, 'scheduled');
  assert.deepEqual(st.uploads, ['01-roa_question.jpg', '02-roa_reveal.jpg', '03-roa_question.jpg', '04-roa_reveal.jpg'].map((n) => `sets/${set!.id}/${n}`));

  clock = new Date(new Date(set!.publish_at!).getTime() + 1000);
  const second = await tick(deps);
  assert.equal(second.published, 1);
  assert.deepEqual(created.map((c) => c.kind), ['image', 'image', 'image', 'image']);
  assert.deepEqual(published, ['c:01-roa_question.jpg', 'c:02-roa_reveal.jpg', 'c:03-roa_question.jpg', 'c:04-roa_reveal.jpg']);
  const got = await getSet(db, set!.id);
  assert.equal(got!.set.status, 'published');
  assert.deepEqual(got!.frames.map((f) => [f.role, f.media]), [['roa_question', 'image'], ['roa_reveal', 'image'], ['roa_question', 'image'], ['roa_reveal', 'image']]);
  assert.deepEqual([...(await recentKeys(db, 'real_or_ai', 30, clock))].sort(), [...r.historyKeys].sort());
  assert.equal(daily.length, 1, 'the roa_daily record holds for the pool day');
});

test('worker: the daily candidate run is held while Real or AI? is off', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'real_or_ai', { enabled: false });
  assert.equal((await loadSettings(db)).series.real_or_ai.enabled, false);
  const daily: string[] = [];
  await tick({
    db, sourceDb: db, now: () => new Date('2026-10-13T07:00:00Z'), triviaDaily: async () => null, roaDaily: async () => (daily.push('ran'), null),
    builder: async () => { throw new Error('nothing to build'); },
    meta: () => { throw new Error('not used'); }, storage: () => { throw new Error('not used'); }, insights: () => { throw new Error('not used'); },
    poolReads: () => { throw new Error('no pool in this test'); },
  });
  assert.deepEqual(daily, []);
});

test('Free vs. Paid: its published history still reads; a set still requested for it is skipped as retired', async () => {
  const { db } = await harnessDb();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO stories.sets (series, ny_date, status, trigger, style, payload) VALUES ('free_vs_paid', '2026-10-03', 'published', 'click', 'homemade', $1::jsonb) RETURNING id`,
    [JSON.stringify({ pair: { free: 'GIMP', paid: 'Photoshop' } })],
  );
  const history = await listView(db, 'history', 'free_vs_paid');
  assert.deepEqual(history.map((s: { id: string }) => s.id), [rows[0]!.id]);
  assert.equal(setHeadline({ series: 'free_vs_paid', payload: { pair: { free: 'GIMP', paid: 'Photoshop' } } } as never), 'GIMP vs. Photoshop');

  const { set } = await requestSet(db, { series: 'free_vs_paid', nyDate: '2026-10-13', trigger: 'click', style: 'homemade' });
  await claimNextRequested(db);
  const renderer = await stubRenderer();
  const out = await buildSet({ db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), renderer, review: cleanReview, storage: storage(), now: () => new Date('2026-10-13T12:00:00Z') }, set.id);
  assert.equal(out.status, 'skipped');
  assert.match(out.detail, /retired/);
});
