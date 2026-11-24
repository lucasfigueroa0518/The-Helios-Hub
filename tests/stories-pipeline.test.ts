/**
 * Stories M3, M7, M8: Morning Download's (and the retired Free vs. Paid's) builds, the set build, the
 * schedule and the worker loop, offline (PGlite, stubbed Jev, Sonnet, photo
 * finder, renderer, storage, Meta). No live call of any kind.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { BuildDeps } from '@/lib/stories/build/common';
import { buildSet } from '@/lib/stories/build';
import { buildFreeVsPaid, pairKey, struckPrice } from '@/lib/stories/build/free-vs-paid';
import { MAJOR_NEWS_BAR, buildMorningDownload, chooseStories, namesIn } from '@/lib/stories/build/morning-download';
import { createStoriesJev } from '@/lib/stories/jev';
import type { StoriesMetaClient } from '@/lib/stories/publish/meta';
import type { ReviewCall } from '@/lib/stories/render/review';
import { claimNextRequested, getSet, listSets, recentKeys, recordCost, recordHistory, requestSet } from '@/lib/stories/repository';
import { isDueOn, MAX_AUTO_FAILURES_PER_DAY, pickPublishAt, requestAutoSets, windowBounds } from '@/lib/stories/schedule';
import { DEFAULT_SETTINGS, loadSettings, saveSeriesSetting } from '@/lib/stories/settings';
import { morningDownloadCarousel, recentUsedPhotoUrls, recordPublishedPhoto } from '@/lib/stories/sources/carousel';
import { freeToolLeads, morningDownloadReels, storyKey } from '@/lib/stories/sources/reels';
import type { StoriesStorage } from '@/lib/stories/storage';
import { poolDay } from '@/lib/stories/pool';
import { tick } from '@/lib/stories/worker';
import { writeStructured } from '@/lib/stories/writer';

import { addIdea, addSlate, harnessDb, stubJev, stubPhotos, stubRenderer, stubTriviaClips, stubWriter, triviaFrames } from './stories-harness';

const NOW = new Date('2026-10-08T05:00:00Z'); // 1:00 AM New York, Thursday Oct 8
const DATE = '2026-10-08';

async function buildDeps(db: Awaited<ReturnType<typeof harnessDb>>['db'], series: 'morning_download' | 'free_vs_paid', o: { jev?: ReturnType<typeof stubJev>; write?: ReturnType<typeof stubWriter>; photos?: ReturnType<typeof stubPhotos> } = {}): Promise<BuildDeps & { jevStub: ReturnType<typeof stubJev> }> {
  const { set } = await requestSet(db, { series, nyDate: DATE, trigger: 'click', style: DEFAULT_SETTINGS.series[series].style });
  await claimNextRequested(db);
  const jevStub = o.jev ?? stubJev();
  return { db, sourceDb: db, jev: createStoriesJev(jevStub, db), write: o.write ?? stubWriter({}), photos: o.photos ?? stubPhotos(), settings: DEFAULT_SETTINGS, now: NOW, setId: set.id, nyDate: DATE, jevStub };
}

/* ── Sources ─────────────────────────────────────────────────────── */

test('reels pool: the latest slate, top 10 news ideas by net plus every blockbuster, no Warning or Callout, read only', async () => {
  const { db } = await harnessDb();
  const old = await addSlate(db, '2026-10-01');
  await addIdea(db, old, { headline: 'Old news', url: 'https://x.test/old', net: 99 });
  const slate = await addSlate(db, DATE);
  await addIdea(db, slate, { headline: 'Your chatbot is leaking your secrets', url: 'https://x.test/w', net: 200, bucket: 'the_warning' });
  await addIdea(db, slate, { headline: 'Stop paying for AI note-takers', url: 'https://x.test/c', net: 150, blockbuster: 0.2, bucket: 'the_callout' });
  for (let i = 0; i < 12; i++) await addIdea(db, slate, { headline: `Story ${i}`, url: `https://x.test/${i}`, net: 100 - i, blockbuster: i === 11 ? 0.2 : 0 });
  const pool = await morningDownloadReels(db, DATE);
  assert.equal(pool.length, 11);
  assert.equal(pool[0]!.headline, 'Story 0');
  assert.equal(pool[10]!.headline, 'Story 11');
  assert.ok(!pool.some((c) => c.headline === 'Old news'));
  assert.ok(!pool.some((c) => /secrets|note-takers/.test(c.headline)), 'Warning and Callout ideas stay with Text on Screen');
  assert.equal(storyKey('https://www.X.test/a/?utm_source=ig#top'), 'x.test/a');
});

test('reels: free-tool hints (Ball Knowledge, GitHub Trending; never the catalog)', async () => {
  const { db } = await harnessDb();
  const slate = await addSlate(db, '2026-10-06');
  await addIdea(db, slate, { headline: 'This free app replaces Photoshop', url: 'https://x.test/b', net: 5, bucket: 'ball_knowledge' });
  await db.query(`INSERT INTO reels.sources (canonical_url, headline, source_name, adapter_id) VALUES ('https://github.com/a/b', 'a/b: a local Whisper app', 'GitHub', 'github-trending')`);
  await db.query(`INSERT INTO reels.list_catalog (list_id, entry_name, entry_url, description) VALUES ('awesome', 'GIMP', 'https://gimp.org', 'Image editor')`);
  const leads = await freeToolLeads(db, DATE);
  assert.deepEqual(leads.map((l) => l.origin).sort(), ['github', 'reels']);
});

test('carousel: qualified stories from the last 30 hours with their post photo; used photos', async () => {
  const { db } = await harnessDb();
  const group = (id: string, title: string, status = 'qualified') => ({ id, status, passes: 3, outlets: ['Bloomberg', 'Reuters'], members: [{ title, outlet: 'Bloomberg' }], representative: { title, url: id }, body: `${title}. Text.`, publishedAt: '2026-10-07T20:00:00Z' });
  await db.query(`INSERT INTO social.runs (finished_at, record) VALUES ($1, $2)`, ['2026-10-07T22:00:00Z', JSON.stringify({ selection: { scored: [group('https://b.test/1', 'Newsom signs AI order'), group('https://b.test/2', 'Skipped', 'not-qualified'), group('https://b.test/3', 'Crusoe raises $3.9B')], shortlist: [group('https://b.test/3', 'Crusoe raises $3.9B')] } })]);
  await db.query(`INSERT INTO social.posts (slug, story_id, status, brief, render, created_at) VALUES ('crusoe', 'https://b.test/3', 'review', $1, $2, '2026-10-07T23:00:00Z')`, [
    JSON.stringify({ the_news: { text: 'Crusoe raised $3.9B.' }, facts: [{ text: 'Crusoe is now valued at $30.9B.', ids: ['N1'] }], numbers: [{ id: 'N1', value: '$30.9B', counts: 'valuation' }], sources: [{ outlet: 'TechCrunch', url: 'https://tc.test/crusoe' }] }),
    JSON.stringify({ slides: [{ photoUrl: 'https://img.test/dc.jpg', photoCredit: 'Photo: X', photoKind: 'scene' }] }),
  ]);
  const md = await morningDownloadCarousel(db, NOW);
  assert.deepEqual(md.map((c) => c.headline), ['Crusoe raises $3.9B', 'Newsom signs AI order']);
  assert.deepEqual(md[0]!.photo, { url: 'https://img.test/dc.jpg', credit: 'Photo: X' });
  // A failed fetch still writes a URL-only ledger row; the same row twice is one row.
  const offline = { http: (async () => new Response('gone', { status: 404 })) as unknown as typeof fetch };
  await recordPublishedPhoto(db, { url: 'https://img.test/dc.jpg', usedAt: NOW, storyId: 'stories:x', slide: 2 }, offline);
  await recordPublishedPhoto(db, { url: 'https://img.test/dc.jpg', usedAt: NOW, storyId: 'stories:x', slide: 2 }, offline);
  assert.deepEqual([...(await recentUsedPhotoUrls(db, NOW))], ['https://img.test/dc.jpg']);
});

/* ── Morning Download (M3) ───────────────────────────────────────── */

test('chooseStories (S-04): everything over the bar up to 5, else the top 2', () => {
  const s = (score: number) => ({ score });
  assert.equal(chooseStories([0.9, 0.8, 0.7, 0.7, 0.6, 0.6, 0.2].map(s)).length, 5);
  assert.deepEqual(chooseStories([0.9, 0.1, 0.3].map(s)).map((x) => x.score), [0.9, 0.3]);
  assert.ok(MAJOR_NEWS_BAR > 0 && MAJOR_NEWS_BAR < 1);
  assert.ok(namesIn('OpenAI and Sam Altman launch GPT-6').has('OpenAI'));
});

// The Morning Download chain (shortlist → rerank → photos/video → choosePosts → writer) is tested in
// tests/stories-md-chain.test.ts with stubbed clients (WIRING-CONTRACT Owner D, 2026-11-24).

// Bald-Eagle D2: "shown in the last 3 days → dropped" became the development test. A story we ran with nothing to
// compare against (no set, so no headline) stays out as before, and is now recorded as a candidate with the reason.
test('Morning Download: stories we ran lately stay out without a new event; fewer than 2 left skips the day', async () => {
  const { db } = await harnessDb();
  const slate = await addSlate(db, DATE);
  await addIdea(db, slate, { headline: 'A', url: 'https://r.test/a', net: 9 });
  await addIdea(db, slate, { headline: 'B', url: 'https://r.test/b', net: 8 });
  await recordHistory(db, 'morning_download', [storyKey('https://r.test/b')], null);
  const deps = await buildDeps(db, 'morning_download');
  const r = await buildMorningDownload(deps);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.skip, 'only 1 new stories in the pool');
  assert.deepEqual(r.candidates.map((c) => [c.payload?.url, c.chosen, c.reason]), [['https://r.test/b', false, 'ran before; no stored headline to compare']]);
});

/* ── Free vs. Paid (M7) ──────────────────────────────────────────── */

const PAIRS = [
  { paid_tool: 'Adobe Photoshop', paid_price: '$22.99', price_period: 'a month', paid_price_url: 'https://adobe.test/pricing', free_tool: 'GIMP', free_url: 'https://gimp.test', what_it_does: 'A full photo editor.', how_to_get: 'Free download at gimp.org', platforms: 'Mac, Windows and Linux', dev_tool: false },
  { paid_tool: 'Otter', paid_price: '$16.99', price_period: 'a month', paid_price_url: 'https://otter.test/pricing', free_tool: 'Whisper app', free_url: 'https://whisper.test', what_it_does: 'Transcribes audio offline.', how_to_get: 'Free on the App Store', platforms: 'Mac and iPhone', dev_tool: false },
];

test('Free vs. Paid: a pair shown in 90 days is dropped; a pair that fails verification is skipped for the next', async () => {
  const { db } = await harnessDb();
  await recordHistory(db, 'free_vs_paid', [pairKey(PAIRS[0]!)], null);
  let verifies = 0;
  const write = stubWriter({
    submit_pairs: () => ({ pairs: [...PAIRS, { ...PAIRS[1]!, paid_tool: 'Notion', free_tool: 'AppFlowy', paid_price: '$10' }] }),
    submit_check: () => ({ price_confirmed: ++verifies > 1, price_seen: '$12', free_confirmed: true, note: verifies === 1 ? 'price changed' : '' }),
    submit_tease: () => ({ tease: 'There is a free one that does most of this.' }),
  });
  const photos = stubPhotos();
  const deps = await buildDeps(db, 'free_vs_paid', { write, photos });
  const r = await buildFreeVsPaid(deps, async () => [{ origin: 'catalog', ref: '1', name: 'Whisper app', url: 'https://whisper.test', description: 'offline transcription' }]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(verifies, 2);
  const paid = r.frames[1]!.copy as { tool: string; price: string; tease: string; logo?: { kind: string } };
  assert.ok(['Otter', 'Notion'].includes(paid.tool));
  assert.equal(paid.logo?.kind, 'logo');
  assert.ok(!r.candidates.some((c) => c.chosen && c.ref === pairKey(PAIRS[0]!)));
  assert.equal(r.candidates.filter((c) => /verification failed/.test(c.reason ?? '')).length, 1);
  // Web search spend is costed at $10 per 1,000 searches.
  const { rows } = await db.query<{ usd: number }>(`SELECT usd::float8 AS usd FROM stories.cost_events WHERE vendor = 'web_search'`);
  assert.deepEqual(rows, [{ usd: 0.04 }]);
  assert.deepEqual(r.frames.map((f) => f.role), ['intro', 'paid', 'free']);
  // Web search is offered to the pairing call only; web fetch to verification.
  const toolTypes = write.calls.map((c) => (c.tools as Array<{ type?: string }>).map((t) => t.type).filter(Boolean));
  assert.deepEqual(toolTypes, [['web_search_20260209'], ['web_fetch_20260209'], ['web_fetch_20260209'], []]);
});

test('Free vs. Paid: struck prices read naturally', () => {
  assert.equal(struckPrice('$22.99', 'a month'), '$22.99/mo');
  assert.equal(struckPrice('$99', 'per year'), '$99/yr');
  assert.equal(struckPrice('$5', 'per seat'), '$5 per seat');
});

/* ── The set build (M3 + M2) ─────────────────────────────────────── */

const storage = (): StoriesStorage & { uploads: string[] } => {
  const uploads: string[] = [];
  return { uploads, upload: async (p) => { uploads.push(p); }, sign: async (p) => `https://signed.test/${p}`, signMany: async (paths: string[]) => paths.map((p) => `https://signed.test/${p}`), download: async () => Buffer.alloc(0), remove: async () => {} };
};
const cleanReview: ReviewCall = async () => ({ flags: [], usage: { model: 'claude-haiku-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0.0001 } });

test('buildSet: the monthly watch skips; a builder error fails the set; a good build is ready and rendered', async () => {
  const { db } = await harnessDb();
  const renderer = await stubRenderer();
  const base = { db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), renderer, review: cleanReview, storage: storage(), now: () => NOW };

  const { set: a } = await requestSet(db, { series: 'morning_download', nyDate: DATE, trigger: 'click', style: 'polished' });
  await claimNextRequested(db);
  const ok = await buildSet({ ...base, builders: { morning_download: async () => ({ ok: true, payload: { x: 1 }, frames: [{ seq: 1, role: 'opener', backdrop: 'black', copy: { role: 'opener', date: 'Thursday, October 8', storyCount: 2 } }, { seq: 2, role: 'closer', backdrop: 'black', copy: { role: 'closer' } }], candidates: [], historyKeys: ['k1'] }) } }, a.id);
  assert.equal(ok.status, 'ready');
  const got = await getSet(db, a.id);
  assert.equal(got!.set.status, 'ready');
  assert.deepEqual(got!.set.payload.historyKeys, ['k1']);
  assert.equal(got!.frames.every((f) => f.storage_path), true);

  const { set: b } = await requestSet(db, { series: 'real_or_ai', nyDate: DATE, trigger: 'click', style: 'polished' });
  await claimNextRequested(db);
  const bad = await buildSet({ ...base, builders: { real_or_ai: async () => { throw new Error('web search refused'); } } }, b.id);
  assert.deepEqual(bad, { status: 'failed', detail: 'web search refused' });
  assert.equal((await getSet(db, b.id))!.set.status, 'failed');

  await recordCost(db, { vendor: 'anthropic', component: 'x', usd: 30 });
  // cost_events.created_at defaults to the real now(): put it on the test's clock, or the month reads empty outside October.
  await db.query(`UPDATE stories.cost_events SET created_at = $1`, [NOW]);
  const { set: c } = await requestSet(db, { series: 'ai_trivia', nyDate: DATE, trigger: 'click', style: 'polished' });
  await claimNextRequested(db);
  const watch = await buildSet(base, c.id);
  assert.equal(watch.status, 'skipped');
  assert.match((await getSet(db, c.id))!.set.error!, /monthly watch reached/);
});

/* ── Schedule (M8) ───────────────────────────────────────────────── */

test('schedule: windows in New York time, a uniform minute, never late', () => {
  // Every series posts 8:30–10:00 AM (Tommy, 2026-10-08).
  for (const s of Object.values(DEFAULT_SETTINGS.series)) assert.deepEqual([s.window.start, s.window.end], ['08:30', '10:00']);
  const md = DEFAULT_SETTINGS.series.morning_download.window;
  const { start, end } = windowBounds(md, DATE);
  assert.equal(start.toISOString(), '2026-10-08T12:30:00.000Z');
  assert.equal(end.toISOString(), '2026-10-08T14:00:00.000Z');
  assert.equal(pickPublishAt(md, DATE, NOW, () => 0)!.toISOString(), '2026-10-08T12:30:00.000Z');
  assert.equal(pickPublishAt(md, DATE, NOW, (n) => n - 1)!.toISOString(), '2026-10-08T14:00:00.000Z');
  assert.equal(pickPublishAt(md, DATE, new Date('2026-10-08T13:30:20Z'), () => 0)!.toISOString(), '2026-10-08T13:31:00.000Z');
  assert.equal(pickPublishAt(md, DATE, new Date('2026-10-08T14:01:00Z')), null);
  // Trivia posts Sun/Mon/Thu, Real or AI? Tue/Sat: Thursday is Trivia's, not Real or AI?'s.
  assert.equal(isDueOn(DEFAULT_SETTINGS.series.ai_trivia.window, DATE), true);
  assert.equal(isDueOn(DEFAULT_SETTINGS.series.real_or_ai.window, DATE), false);
  assert.equal(isDueOn(DEFAULT_SETTINGS.series.real_or_ai.window, '2026-10-10'), true, 'Saturday');
  assert.equal(isDueOn(DEFAULT_SETTINGS.series.morning_download.window, DATE), true);
});

test('auto sets: only for series switched to auto, due in their lead window, still before the window closes', async () => {
  const { db } = await harnessDb();
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), NOW), []);
  await saveSeriesSetting(db, 'ai_trivia', { auto: true });
  await saveSeriesSetting(db, 'real_or_ai', { auto: true });
  const s = await loadSettings(db);
  // Both are made up to 2 days ahead: Thursday's night fills Trivia's Thursday and Real or AI?'s Saturday.
  assert.deepEqual(await requestAutoSets(db, s, NOW), ['ai_trivia', 'real_or_ai']);
  const { rows } = await db.query<{ series: string; ny_date: string }>(`SELECT series, ny_date::text FROM stories.sets ORDER BY series`);
  assert.deepEqual(rows.map((r) => `${r.series}@${r.ny_date}`), ['ai_trivia@2026-10-08', 'real_or_ai@2026-10-10']);
  assert.deepEqual(await requestAutoSets(db, s, NOW), []);
});

test('auto sets: a skipped auto set is not requested again on every tick (the 1,126-sets-in-six-hours loop); a person can still Generate', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'ai_trivia', { auto: true });
  const s = await loadSettings(db);
  const count = async () => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.sets WHERE series = 'ai_trivia' AND ny_date = $1::date`, [DATE])).rows[0]!.n);
  assert.deepEqual(await requestAutoSets(db, s, NOW), ['ai_trivia']);
  // The build found nothing that cleared the bar: the set is skipped.
  await db.query(`UPDATE stories.sets SET status = 'skipped', error = 'no pair cleared the bar and its checks' WHERE series = 'ai_trivia'`);
  for (let tick = 0; tick < 50; tick++) assert.deepEqual(await requestAutoSets(db, s, NOW), [], 'no new auto set');
  assert.equal(await count(), 1, 'fifty ticks made no new sets');
  // The next day the series is due (Monday) is a new day: it is tried again.
  assert.deepEqual(await requestAutoSets(db, s, new Date('2026-10-12T12:00:00Z')), ['ai_trivia']);
  assert.equal(await count(), 1, 'Thursday still has its one skipped set');
});

test('auto sets: errors are retried, but only up to the daily limit', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'ai_trivia', { auto: true });
  const s = await loadSettings(db);
  for (let attempt = 1; attempt <= MAX_AUTO_FAILURES_PER_DAY; attempt++) {
    assert.deepEqual(await requestAutoSets(db, s, NOW), ['ai_trivia'], `attempt ${attempt}`);
    await db.query(`UPDATE stories.sets SET status = 'failed', error = 'render: boom' WHERE series = 'ai_trivia' AND status = 'requested'`);
  }
  for (let tick = 0; tick < 20; tick++) assert.deepEqual(await requestAutoSets(db, s, NOW), []);
  assert.equal(Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stories.sets WHERE series = 'ai_trivia'`)).rows[0]!.n), MAX_AUTO_FAILURES_PER_DAY);
});

/* ── The worker loop (M8) ────────────────────────────────────────── */

/** The two switches every content type has (docs/social-overnight.md); both ship in the safe position. */
async function setSwitches(db: Awaited<ReturnType<typeof harnessDb>>['db'], s: { requireApproval: boolean; publishingLive: boolean }) {
  for (const [key, value] of [['require_approval', s.requireApproval], ['publishing_live', s.publishingLive]] as const) {
    await db.query(`INSERT INTO stories.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);
  }
}

// Settings standard (D16): every post needs a person's approval, so the old "approval off → self-approve" expectation
// contradicts the contract; the set now waits at ready, a person approves it, and a Live type schedules it.
test('worker (Live, approval stored off): auto request at 3 AM → build → waits for Approve → schedule → publish in order → history, no photos, insights, cell stays open (AT-78)', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'ai_trivia', { auto: true });
  await setSwitches(db, { requireApproval: false, publishingLive: true });
  const renderer = await stubRenderer();
  const triviaRender = await stubTriviaClips();
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
  let clock = new Date('2026-10-08T07:00:00Z'); // 3:00 AM New York, a Thursday (AI Trivia posts Sun/Mon/Thu)
  const t = triviaFrames('t03a07');
  const daily: string[] = [];
  const deps = {
    db, sourceDb: db, now: () => clock, sleep: async () => {}, photoHttp: (async () => new Response("", { status: 404 })) as typeof fetch,
    // runTriviaDaily records its pool day under 'trivia_daily'; the stub does the same.
    triviaDaily: async (now: Date) => {
      daily.push('ran');
      await db.query(`INSERT INTO stories.settings (key, value) VALUES ('trivia_daily', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ day: poolDay(now) })]);
      return { ran: true };
    },
    roaDaily: async () => null,
    builder: async () => ({ db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), renderer, triviaRender, review: cleanReview, storage: st, now: () => clock, builders: { ai_trivia: async () => ({ ok: true as const, payload: t.payload, frames: t.frames, candidates: [], historyKeys: t.historyKeys }) } }),
    meta: () => meta,
    storage: () => st,
    insights: () => ({ storyInsights: async () => ({ metrics: { reach: 50, taps_forward: 40 }, raw: [], notEnoughViewers: false }) }),
  };
  const first = await tick(deps);
  assert.deepEqual(first, { built: 1, scheduled: 0, published: 0, insights: 0 });
  assert.equal(daily.length, 1, 'the daily writer runs at the 3:00 refresh');
  assert.equal(renderer.renders, 0, 'AI Trivia never goes through the image renderer');
  const [built] = await listSets(db, { series: 'ai_trivia' });
  assert.equal(built!.status, 'ready', 'require_approval stored off is never read: the set waits for a person');
  await (await import('@/lib/stories/repository')).approveSet(db, built!.id);
  assert.equal((await tick(deps)).scheduled, 1);
  const [set] = await listSets(db, { series: 'ai_trivia' });
  assert.deepEqual(st.uploads, ['01-question.mp4', '01-question.jpg', '02-answer.mp4', '02-answer.jpg'].map((n) => `sets/${set!.id}/${n}`));
  assert.deepEqual(triviaRender.calls.map((c) => c.roles), [['question', 'answer']]);
  assert.equal(set!.status, 'scheduled');
  const at = new Date(set!.publish_at!);
  assert.ok(at >= new Date('2026-10-08T12:30:00Z') && at <= new Date('2026-10-08T14:00:00Z'));

  clock = new Date(at.getTime() + 1000);
  const second = await tick(deps);
  assert.equal(second.published, 1);
  assert.deepEqual(published, ['v:01-question.mp4', 'v:02-answer.mp4']);
  assert.deepEqual(created.map((c) => c.kind), ['video', 'video']);
  const got = await getSet(db, set!.id);
  assert.equal(got!.set.status, 'published');
  assert.deepEqual(got!.frames.map((f) => [f.media, f.poster_path?.endsWith('.jpg'), f.media_bytes]), [['video', true, 'mp4:question'.length], ['video', true, 'mp4:answer'.length]]);
  assert.deepEqual([...(await recentKeys(db, 'ai_trivia', 30, clock))], ['trivia:t03a07']);
  assert.equal((await db.query<{ state: string }>(`SELECT state FROM stories.trivia_cells WHERE cell_id = 't03a07'`)).rows[0]!.state, 'open', 'a cell holds many questions: posting never closes it');
  // Only the published person photo goes into Tommy's used-photo log (S-24).
  assert.deepEqual([...(await recentUsedPhotoUrls(db, clock))], [], 'an Are you smarter than AI? set carries no photo (CONTRACT-2 §3)');

  // The same pass polled the new frames' first insights; a minute later nothing is due.
  assert.equal(second.insights, 2);
  clock = new Date(clock.getTime() + 60_000);
  assert.equal((await tick(deps)).insights, 0);
  assert.equal(daily.length, 1, 'the writer record holds for the pool day');
  const { rows } = await db.query<{ reach: number; final: boolean }>(`SELECT reach, final FROM stories.insights`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.final, false);
});

const MD_FRAMES = [{ seq: 1, role: 'opener' as const, backdrop: 'black' as const, copy: { role: 'opener' as const, date: 'Thursday, October 8', storyCount: 1 } }];
const noDaily = async () => null;

test('worker: a flagged auto set is not self-approved (no set ever is, D16)', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'morning_download', { auto: true });
  await setSwitches(db, { requireApproval: false, publishingLive: true });
  const renderer = await stubRenderer();
  const flagging: ReviewCall = async () => ({ error: 'review call failed: 529', usage: null });
  const st = storage();
  const deps = {
    db, sourceDb: db, now: () => new Date('2026-10-08T08:00:00Z'), triviaDaily: noDaily, roaDaily: noDaily,
    builder: async () => ({ db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), renderer, review: flagging, storage: st, builders: { morning_download: async () => ({ ok: true as const, payload: {}, frames: MD_FRAMES, candidates: [], historyKeys: [] }) } }),
    meta: () => { throw new Error('not used'); },
    storage: () => st,
    insights: () => { throw new Error('not used'); },
  };
  const r = await tick(deps);
  assert.equal(r.built, 1);
  assert.equal(r.scheduled, 0);
  const sets = await listSets(db, {});
  assert.equal(sets[0]!.status, 'ready');
  assert.equal(sets[0]!.flagged, true);
});

test('worker (Approval: auto on, Live off): nothing before 3 AM; an auto set waits at ready for Approve; an approved set takes its minute but never posts, and goes back to Made once it passes', async () => {
  const { db } = await harnessDb();
  await saveSeriesSetting(db, 'morning_download', { auto: true });
  const renderer = await stubRenderer();
  const st = storage();
  let clock = new Date('2026-10-08T06:30:00Z'); // 2:30 AM New York
  const daily: string[] = [];
  const deps = {
    db, sourceDb: db, now: () => clock, triviaDaily: async () => (daily.push('ran'), null), roaDaily: noDaily,
    builder: async () => ({ db, sourceDb: db, jevTransport: stubJev(), write: stubWriter({}), photos: stubPhotos(), renderer, review: cleanReview, storage: st, builders: { morning_download: async () => ({ ok: true as const, payload: {}, frames: MD_FRAMES, candidates: [], historyKeys: [] }) } }),
    meta: () => { throw new Error('nothing may publish'); },
    storage: () => st,
    insights: () => { throw new Error('not used'); },
  };
  assert.deepEqual(await tick(deps), { built: 0, scheduled: 0, published: 0, insights: 0 });
  assert.equal(daily.length, 0, 'no writer run before 3 AM');
  clock = new Date('2026-10-08T07:00:00Z'); // 3:00 AM
  assert.equal((await tick(deps)).built, 1);
  const repo = await import('@/lib/stories/repository');
  const [set] = await repo.listSets(db, { series: 'morning_download' });
  assert.equal(set!.status, 'ready', 'require_approval is on by default');
  await repo.approveSet(db, set!.id);
  // Approval holds slots (contract §4.3): the approved set gets its minute; only Live posts (meta would throw).
  const booked = await tick(deps);
  assert.deepEqual([booked.scheduled, booked.published], [1, 0], 'publishing_live is off by default: Approval books, never posts');
  assert.equal((await getSet(db, set!.id))!.set.status, 'scheduled');
  // Its minute passes without posting: back to Made, still approved, never re-slotted (D17, D18).
  clock = new Date('2026-10-08T15:00:00Z'); // 11:00 AM
  const after = await tick(deps);
  assert.deepEqual([after.scheduled, after.published], [0, 0]);
  assert.equal((await getSet(db, set!.id))!.set.status, 'approved');
  assert.equal((await tick(deps)).scheduled, 0, 'never re-slotted by the worker');
});

test('insights: a frame gets its final capture at 23 hours, before it drops out at 24', async () => {
  const { db } = await harnessDb();
  const { set } = await requestSet(db, { series: 'morning_download', nyDate: DATE, trigger: 'click', style: 'polished' });
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO stories.frames (set_id, seq, role, template, backdrop, copy, ig_media_id, published_at)
     VALUES ($1, 1, 'opener', 't', 'black', '{}'::jsonb, 'm1', '2026-10-08T13:00:00Z') RETURNING id`,
    [set.id],
  );
  const repo = await import('@/lib/stories/repository');
  // Captured at 22:10; the next 2-hour poll would be at 24:10, after the cutoff.
  await repo.recordInsights(db, rows[0]!.id, { reach: 1 }, [], false, new Date('2026-10-09T11:10:00Z'));
  const at23 = new Date('2026-10-09T12:00:30Z');
  assert.deepEqual((await repo.framesDueForInsights(db, { now: at23 })).map((f) => f.ig_media_id), ['m1']);
});

/* ── The writer call ─────────────────────────────────────────────── */

test('writer: a paused web-search turn is resumed; a refusal throws; costs land on the set', async () => {
  const { db } = await harnessDb();
  const { set } = await requestSet(db, { series: 'free_vs_paid', nyDate: DATE, trigger: 'click', style: 'homemade' });
  let n = 0;
  const create = async (params: Record<string, unknown>) => {
    n++;
    const base = { id: `m${n}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } };
    if (n === 1) return { ...base, stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's', name: 'web_search', input: {} }] } as never;
    assert.equal((params.messages as unknown[]).length, 2);
    return { ...base, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'submit_tease', input: { tease: 'ok' } }] } as never;
  };
  const r = await writeStructured<{ tease: string }>({ create, db, setId: set.id, component: 'fvp-copy@1', model: 'claude-sonnet-5-5', system: 'S', tool: { name: 'submit_tease', description: 'd', input_schema: {} }, user: 'U', webSearch: { maxUses: 5 } });
  assert.equal(r.value.tease, 'ok');
  assert.equal(r.usage.length, 2);
  assert.equal((await getSet(db, set.id))!.set.spend_usd, 0.0006);
  const refusing = async () => ({ id: 'r', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 }, content: [] }) as never;
  await assert.rejects(writeStructured({ create: refusing, db, setId: null, component: 'x', model: 'claude-sonnet-5-5', system: 'S', tool: { name: 't', description: 'd', input_schema: {} }, user: 'U' }), /refused/);
});
