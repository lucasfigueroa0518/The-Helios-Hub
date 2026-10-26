/**
 * AI Events This Week in the Social Hub (plan M4): the registry, the spine checks, the hub's read
 * of its posts and its weekly ranked pool, the bench by city, today's card, the health report and
 * the posting settings. Offline (PGlite); nothing here ranks, scores or calls a model.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { AI_EVENTS_NIGHT_WINDOW, AI_EVENTS_WINDOW, DEFAULT_AI_EVENTS_DAYS } from '@/lib/ai-events/config';
import { isPostingType, writePosting, type PostingState } from '@/lib/content-type/posting';
import { typeHubModel } from '@/lib/content-type/model';
import { maxCapFor } from '@/lib/content-type/caps';
import { EVENTS_FEED_STATE_ID as SNAPSHOT_STATE_ID } from '@/lib/networking/public-snapshot';
import { SCORE_FORMULA, SCORE_MAX } from '@/lib/networking/pick/score';
import { buildDataset } from '@/lib/social-hub/dataset';
import { EVENTS_FEED_STATE_ID, reportAiEvents, SNAPSHOT_STALE_LABEL } from '@/lib/social-hub/health/reporters/ai-events';
import { quotaFor } from '@/lib/social-hub/health/reporters/shared';
import { parseHubId } from '@/lib/social-hub/ids';
import { readAll } from '@/lib/social-hub/load';
import { DEFAULT_DAY_QUOTAS, readDayQuotas } from '@/lib/social-hub/queries/day';
import { bookSlot, ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';
import { isVertical, TYPE_PAGE_IDS, typeHref, verticalInfo } from '@/lib/social-hub/verticals';
import { quotaCandidates } from '@/lib/social-hub/views/day-rank';
import { PLAN, windowsOn } from '@/lib/social-hub/views/plan';
import { poolStale } from '@/lib/social-hub/views/pools';

import { addEvent, openAiEventsDb, seedAiEventsPost, seedPoolRow, seedRenderedPost, SUN_NOON, WEEK } from './fixtures/ai-events/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Monday 2026-10-26, 8:00 AM New York. */
const MON_8 = new Date('2026-10-26T12:00:00Z');

const hubSql = () =>
  readFileSync(path.join(process.cwd(), 'db/social_hub_schema.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');

const read = async (query: Parameters<typeof readAll>[0], now = SUN_NOON) => buildDataset(await readAll(query, undefined, now), null, now);

test('AI Events This Week is the sixth type: its page, color, icon, ids and Sunday evening and night windows', () => {
  assert.ok(isVertical('ai_events'));
  const info = verticalInfo('ai_events');
  assert.deepEqual([info.label, info.short, info.format, info.colorVar, info.href], ['AI Events This Week', 'AI Events', 'feed', '--sh-v-ai_events', '/ai-events']);
  assert.ok(TYPE_PAGE_IDS.includes('ai_events'));
  assert.equal(typeHref('ai_events'), '/ai-events');
  assert.equal(typeHref('ai_events', '/social/preview'), '/social/preview/type/ai_events');
  assert.match(readFileSync(path.join(process.cwd(), 'app/social-hub.css'), 'utf8'), /--sh-v-ai_events: #b8860b;/);
  assert.match(readFileSync(path.join(process.cwd(), 'components/social-hub/ui/marks.tsx'), 'utf8'), /ai_events: CalendarDays/);
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(parseHubId(`ai_events:${id}`), { vertical: 'ai_events', kind: 'content', ref: id });
  // PLAN copies lib/ai-events/config.ts (hub views never import the engine's live modules).
  assert.deepEqual(
    PLAN.ai_events.map((w) => [w.id, w.startMinute, w.endMinute, w.days]),
    [AI_EVENTS_WINDOW, AI_EVENTS_NIGHT_WINDOW].map((w) => [w.id, w.startMinute, w.endMinute, [...DEFAULT_AI_EVENTS_DAYS]]),
  );
  assert.equal(windowsOn('ai_events', '2026-10-25').length, 2, 'Sunday: Miami, then Boston');
  assert.equal(windowsOn('ai_events', '2026-10-26').length, 0, 'Monday');
  assert.equal(maxCapFor('ai_events'), 2);
  // The health reporter's copy of the snapshot's state row id.
  assert.equal(EVENTS_FEED_STATE_ID, SNAPSHOT_STATE_ID);
});

test('the spine takes an ai_events item, its evening slot only, and approve/auto/force attempts', async () => {
  const { query } = await openHubTestDb();
  const item = (await query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('ai_events', 'feed', 'p1') RETURNING id`)).rows[0]!.id;
  const slot = (s: string, day: string) =>
    query(
      `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'ai_events', $2::date, $3, $4::timestamptz, 'cancelled', 'auto')`,
      [item, day, s, `${day}T22:30:00Z`],
    );
  await slot('evening', '2026-10-25');
  await slot('t1080', '2026-11-01');
  await assert.rejects(slot('morning', '2026-11-08'), /schedule_slot_check/);
  for (const trigger of ['approve', 'auto', 'force']) {
    await query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'ai_events', $2, 'failed', 'c')`, [item, trigger]);
  }
  await assert.rejects(query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'ai_events', 'mix_test', 'failed', 'c')`, [item]), /publish_attempts_trigger_check/);
  await query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('ai_events', 'x', '2026-10-25', 'promote')`);
  await query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute) VALUES (0, 'ai_events', 1080)`);
});

test('re-applying the schema widens existing checks that lack ai_events (D45)', async () => {
  const { pg, query } = await openHubTestDb();
  // The tables as they stood before this change: the five-type checks.
  await pg.exec(`
    ALTER TABLE social_hub.content_items DROP CONSTRAINT content_items_vertical_check;
    ALTER TABLE social_hub.content_items ADD CONSTRAINT content_items_vertical_check CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days'));
    ALTER TABLE social_hub.idea_adjustments DROP CONSTRAINT idea_adjustments_vertical_check;
    ALTER TABLE social_hub.idea_adjustments ADD CONSTRAINT idea_adjustments_vertical_check CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days'));`);
  await assert.rejects(query(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('ai_events', 'feed', 'p1')`));
  await assert.rejects(query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('ai_events', 'x', '2026-10-25', 'promote')`));
  await pg.exec(hubSql());
  await query(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('ai_events', 'feed', 'p1')`);
  await query(`INSERT INTO social_hub.idea_adjustments (vertical, idea_id, ny_date, kind) VALUES ('ai_events', 'x', '2026-10-25', 'promote')`);
  // The daily caps seed names the type (a fresh database starts with it at two: Miami and Boston).
  const caps = (await query<{ value: Record<string, number> }>(`SELECT value FROM social_hub.settings WHERE key = 'daily_caps'`)).rows[0]!.value;
  assert.equal(caps.ai_events, 2);
});

test('a post in review reads as one ready post with its slides, caption, sources and week; once booked it is the same post', async () => {
  const { query } = await openAiEventsDb();
  const { id, slides } = await seedRenderedPost(query);
  let d = await read(query);
  assert.deepEqual(d.errors, []);
  let mine = d.posts.filter((p) => p.vertical === 'ai_events');
  assert.equal(mine.length, 1);
  const post = mine[0]!;
  assert.deepEqual([post.id, post.status, post.format, post.name], [`ai_events:${id}`, 'ready', 'feed', 'AI Events This Week · Oct 26–Nov 1']);
  const media = post.media.kind === 'slides' ? post.media.slides : [];
  assert.equal(media.length, slides);
  assert.equal(media[0]!.src, `/api/ai-events/slides/${id}/0?v=1`);
  assert.equal(media[0]!.layout, 'ae_spotlight_cover');
  assert.equal(media[1]!.headline, 'Boston');
  assert.match(media[1]!.body ?? '', /Boston AI Builders Night/);
  assert.match(post.description ?? '', /Your city has one AI event this week/);
  assert.deepEqual(post.sources, [{ url: 'https://luma.com/boston-builders', title: 'Boston: Boston AI Builders Night' }]);
  assert.deepEqual(post.idea, { id: 'ai_events:2026-10-25', label: 'AI Events for Oct 26–Nov 1' });
  assert.equal(post.costItemKey, `ai_events:${id}`);
  assert.deepEqual(post.refs, { aiEventsPostId: id });
  const facts = Object.fromEntries(post.native.map((f) => [f.label, f.value]));
  assert.deepEqual([facts.Cities, facts.Events, facts.Look], ['Boston', '1', 'Spotlight']);

  const item = await ensureContentItem(query as SpineQuery, { vertical: 'ai_events', format: 'feed', nativeRef: id, ideaRef: null });
  await bookSlot(query as SpineQuery, { vertical: 'ai_events', itemId: item, nyDate: '2026-10-25', slot: 'evening', publishAt: new Date('2026-10-25T22:30:00Z'), source: 'auto' });
  d = await read(query);
  mine = d.posts.filter((p) => p.vertical === 'ai_events');
  assert.deepEqual(mine.map((p) => [p.id, p.status, p.nyDate, p.slot?.label]), [[`ai_events:${id}`, 'scheduled', '2026-10-25', 'Evening · 6:00–7:00 PM']]);
  assert.equal(mine[0]!.approval.required, true, 'require_approval is on and the slot was booked automatically');
});

/** Four events of the coming week in Boston and NYC: a pick (pinned), a waiting one, a gated one, an excluded one. */
async function seedWeek(query: Parameters<typeof addEvent>[0]) {
  const parts = [{ label: 'Notable speakers', points: 1.6, detail: '0.80 yes' }, { label: 'Vendor pitch', points: -0.1, detail: '0.10 yes' }];
  const pick = await addEvent(query, { title: 'AI Tinkerers Boston | Oct 27', startAt: '2026-10-27T22:30:00Z', organizer: 'AI Tinkerers', guests: 140 });
  const wait = await addEvent(query, { title: 'Founders & Funders Mixer', startAt: '2026-10-28T22:00:00Z' });
  const gated = await addEvent(query, { title: 'Buy Our AI Platform Webinar', startAt: '2026-10-29T17:00:00Z' });
  const nyc = await addEvent(query, { title: 'Data Driven NYC', metro: 'nyc', startAt: '2026-10-28T22:00:00Z' });
  await seedPoolRow(query, pick, { rank: 1, score: 7.2, picked: true, pickRank: 1, pinnedBy: 'tommy@helios.test', parts });
  await seedPoolRow(query, wait, { rank: 2, score: 4.1, parts });
  await seedPoolRow(query, gated, { rank: 3, score: null, gate: 'vendor_pitch, ai_relevant', parts: [{ label: 'Gate: Vendor pitch', points: null, detail: '0.90 yes, must stay under 0.60 (failed)' }] });
  await seedPoolRow(query, nyc, { metro: 'nyc', rank: 1, score: 6, excludedBy: 'tommy@helios.test', parts });
  return { pick, wait, gated, nyc };
}

test('the week’s pool reads as ideas by city: picks content ready, gated and excluded retired with the reason, parts on each', async () => {
  const { query } = await openAiEventsDb();
  const { pick, wait, gated, nyc } = await seedWeek(query);
  const d = await read(query);
  assert.deepEqual(d.aiEventsWeek, { weekKey: WEEK, startDate: '2026-10-26', endDate: '2026-11-01', editable: true });
  const ideas = new Map(d.ideas.filter((i) => i.vertical === 'ai_events').map((i) => [i.id, i]));
  assert.equal(ideas.size, 4);
  const p = ideas.get(`ai_events:event:${pick}`)!;
  assert.deepEqual([p.state, p.group, p.score, p.hold, p.title], ['content_ready', 'Boston', 7.2, 'pinned', 'AI Tinkerers Boston']);
  assert.match(p.link ?? '', /^https:\/\/luma\.com\/ae\d+$/);
  assert.match(p.detail ?? '', /Tue, Oct 27 · 6:30 PM · AI Tinkerers · Venue \d+ · 140 going · Ranked #1 \(held for the site\)$/);
  assert.deepEqual(p.breakdown?.formula, SCORE_FORMULA);
  assert.deepEqual(p.breakdown?.parts.map((x) => [x.label, x.points]), [['Notable speakers', 1.6], ['Vendor pitch', -0.1]]);
  assert.equal(p.scoreLabel, `Event score (of ${SCORE_MAX.toFixed(1)})`);
  assert.equal(ideas.get(`ai_events:event:${wait}`)!.state, 'idea_only');
  const g = ideas.get(`ai_events:event:${gated}`)!;
  assert.deepEqual([g.state, g.score], ['retired', null]);
  assert.match(g.detail ?? '', /Gated out: Vendor pitch, AI relevant$/);
  assert.equal(g.breakdown?.note, 'Excluded by gate: Vendor pitch, AI relevant.');
  const x = ideas.get(`ai_events:event:${nyc}`)!;
  assert.deepEqual([x.state, x.group, x.hold], ['retired', 'NYC', 'excluded']);
  assert.match(x.detail ?? '', /Excluded by tommy@helios\.test$/);
});

test('the bench: city tabs in post order, ranked within each city, retired listed last, chips and a score bar', async () => {
  const { query } = await openAiEventsDb();
  const { id } = await seedRenderedPost(query);
  const { pick, wait, gated, nyc } = await seedWeek(query);
  const m = typeHubModel({ ...(await read(query, MON_8)), dayQuotas: DEFAULT_DAY_QUOTAS }, 'ai_events', MON_8);
  assert.deepEqual(m.groups, ['Miami', 'Boston', 'NYC', 'SF']);
  assert.equal(m.scoreMax, SCORE_MAX);
  assert.deepEqual(m.poolWeek, { label: 'Oct 26–Nov 1', editable: false }, 'Monday: the shown week’s post is out; pins wait for next Sunday');
  // The week's post leads the bench, outside the tabs; then Boston, then NYC.
  assert.deepEqual(m.bench.map((b) => [b.idea.id, b.rank, b.chip ?? null]), [
    [`ai_events:${id}`, 0, null],
    [`ai_events:event:${pick}`, 1, 'In the post · pinned'],
    [`ai_events:event:${wait}`, 2, 'In the pool'],
    [`ai_events:event:${gated}`, 3, 'Gated out'],
    [`ai_events:event:${nyc}`, 1, 'Excluded'],
  ]);
  assert.equal(m.bench[0]!.card?.post.id, `ai_events:${id}`);
  // On the Sunday it is made, the pool is the coming week's and the post is today's card.
  const sun = typeHubModel({ ...(await read(query)), dayQuotas: DEFAULT_DAY_QUOTAS }, 'ai_events', SUN_NOON);
  assert.equal(sun.poolWeek?.editable, true);
  assert.deepEqual(sun.days.find((x) => x.date === '2026-10-25')?.cards.map((c) => c.post.id), [`ai_events:${id}`]);
});

test('a later week shows the newest pooled week, never one past the coming week', async () => {
  const { query } = await openAiEventsDb();
  const a = await addEvent(query, { title: 'Next Week Thing', startAt: '2026-11-03T22:00:00Z' });
  await seedPoolRow(query, a, { weekKey: '2026-W45' });
  const b = await addEvent(query, { title: 'This Week Thing', startAt: '2026-10-27T22:00:00Z' });
  await seedPoolRow(query, b);
  // Thursday Oct 29: the coming week is W45, which has a pool.
  const thu = await read(query, new Date('2026-10-29T16:00:00Z'));
  assert.deepEqual(thu.aiEventsWeek, { weekKey: '2026-W45', startDate: '2026-11-02', endDate: '2026-11-08', editable: true });
  // Sunday Oct 25: the coming week is W44; W45 is not shown yet.
  const sun = await read(query, SUN_NOON);
  assert.equal(sun.aiEventsWeek?.weekKey, WEEK);
  assert.deepEqual(sun.ideas.filter((i) => i.vertical === 'ai_events').map((i) => i.title), ['This Week Thing']);
});

test('today’s AI Events card is the week’s post on Sunday, and nothing on other days', async () => {
  const { query } = await openAiEventsDb();
  const { id } = await seedRenderedPost(query);
  const data = { ...(await read(query)), dayQuotas: DEFAULT_DAY_QUOTAS };
  assert.deepEqual(quotaCandidates(data, 'ai_events', SUN_NOON).map((c) => [c.post?.id ?? null, c.idea, c.locked]), [[`ai_events:${id}`, null, false]]);
  assert.deepEqual(quotaCandidates(data, 'ai_events', MON_8), []);
});

test('Sunday shows both city posts as today’s AI Events cards; a week has one post per city', async () => {
  const { query } = await openAiEventsDb();
  const miami = await seedAiEventsPost(query, { metro: 'miami' });
  const boston = await seedAiEventsPost(query, { metro: 'boston' });
  await assert.rejects(seedAiEventsPost(query, { metro: 'miami', slug: 'again' }), /idx_ai_events_posts_one_per_week_city|duplicate/);
  for (const [id, slot, at] of [[miami, 'evening', '2026-10-25T22:30:00Z'], [boston, 'night', '2026-10-25T23:30:00Z']] as const) {
    const item = await ensureContentItem(query as SpineQuery, { vertical: 'ai_events', format: 'feed', nativeRef: id, ideaRef: null });
    await bookSlot(query as SpineQuery, { vertical: 'ai_events', itemId: item, nyDate: '2026-10-25', slot, publishAt: new Date(at), source: 'auto' });
  }
  const data = { ...(await read(query)), dayQuotas: DEFAULT_DAY_QUOTAS };
  assert.deepEqual(quotaCandidates(data, 'ai_events', SUN_NOON).map((c) => [c.post?.id ?? null, c.locked]), [[`ai_events:${miami}`, true], [`ai_events:${boston}`, true]]);
  assert.deepEqual(quotaCandidates({ ...data, dayQuotas: { ...DEFAULT_DAY_QUOTAS, ai_events: 1 } }, 'ai_events', SUN_NOON).length, 1, 'a limit of 1 shows one');
});

test('readDayQuotas asks for the Sunday posts only while auto_run is on', async () => {
  const { query } = await openHubTestDb();
  assert.equal((await readDayQuotas(query, Promise.resolve(query))).ai_events, 0);
  await query(`UPDATE ai_events.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  assert.equal((await readDayQuotas(query, Promise.resolve(query))).ai_events, 2, 'Miami and Boston');
});

const posting: PostingState = { type: 'ai_events', live: false, generate: true, autoPublish: false, perDay: null, maxPerDay: null, series: null, days: [0], schedule: null, nights: null, cap: null, costPerPostMicros: null };

test('health: the Sunday run and post are Monday’s night; a failed scheduled run is a run failure', async () => {
  assert.equal(quotaFor(posting, '2026-10-26'), 1, 'Monday asks about Sunday');
  assert.equal(quotaFor(posting, '2026-10-25'), 0, 'Sunday asks about Saturday');
  assert.equal(quotaFor({ ...posting, nights: [{ nyDate: '2026-10-25', count: 1, trial: 0, main: 0, series: [], override: false }], cap: 1 }, '2026-10-26'), 1, 'template: Sunday’s slot');
  assert.equal(quotaFor({ ...posting, nights: [{ nyDate: '2026-10-25', count: 0, trial: 0, main: 0, series: [], override: false }], cap: 1 }, '2026-10-26'), 0);
  const { query } = await openAiEventsDb();
  await query(`INSERT INTO ai_events.runs (trigger, kind, status, requested_at, started_at, finished_at, total_usd, cap_usd, error)
               VALUES ('scheduled', 'build', 'failed', '2026-10-25T16:00:00Z', '2026-10-25T16:00:05Z', '2026-10-25T16:03:00Z', 0.02, 0.5, 'ranking failed: Jev 503')`);
  const mon = await reportAiEvents(query, { night: '2026-10-26', posting, now: MON_8 });
  assert.deepEqual([mon.vertical, mon.due, mon.ran, mon.made, mon.needed, mon.failures.length, mon.failures[0]!.stage, mon.spendUsd], ['ai_events', true, true, 0, 1, 1, 'run', 0.02]);
  const tue = await reportAiEvents(query, { night: '2026-10-27', posting, now: new Date('2026-10-27T12:00:00Z') });
  assert.deepEqual([tue.due, tue.ran, tue.needed], [false, false, 0]);
});

test('health: a scheduled run skipped because a person already made the week counts as made; no picks is a warning', async () => {
  const { query } = await openAiEventsDb();
  await query(`INSERT INTO ai_events.runs (trigger, kind, status, requested_at, started_at, stop_reason) VALUES ('scheduled', 'build', 'skipped', '2026-10-25T16:00:00Z', '2026-10-25T16:00:05Z', 'post-exists: The 2026-W44 post already exists')`);
  const made = await reportAiEvents(query, { night: '2026-10-26', posting, now: MON_8 });
  assert.deepEqual([made.made, made.failures.length], [1, 0]);
  const { query: q2 } = await openAiEventsDb();
  await q2(`INSERT INTO ai_events.runs (trigger, kind, status, requested_at, started_at, stop_reason) VALUES ('scheduled', 'build', 'skipped', '2026-10-25T16:00:00Z', '2026-10-25T16:00:05Z', 'No city has an event above the bar this week, so there is no post.')`);
  const none = await reportAiEvents(q2, { night: '2026-10-26', posting, now: MON_8 });
  assert.deepEqual([none.made, none.failures.map((f) => [f.reason, f.severity])], [0, [['no_picks', 'warning']]]);
});

test('health: the public calendar snapshot is flagged stale after 8 days, on any night; never published is not stale', async () => {
  const { query } = await openAiEventsDb();
  const tue = { night: '2026-10-27', posting, now: new Date('2026-10-27T12:00:00Z') };
  assert.deepEqual((await reportAiEvents(query, tue)).feedsStale, []);
  await query(`INSERT INTO networking.publish_state (id, last_hash, last_published_at) VALUES ($1, 'h', '2026-10-18T13:00:00Z')`, [EVENTS_FEED_STATE_ID]);
  const stale = await reportAiEvents(query, tue);
  assert.deepEqual(stale.feedsStale, [SNAPSHOT_STALE_LABEL]);
  assert.deepEqual(stale.failures.map((f) => [f.stage, f.reason, f.severity]), [['snapshot', 'snapshot_stale', 'warning']]);
  await query(`UPDATE networking.publish_state SET last_published_at = '2026-10-25T16:05:00Z' WHERE id = $1`, [EVENTS_FEED_STATE_ID]);
  assert.deepEqual((await reportAiEvents(query, tue)).feedsStale, []);
});

test('posting: AI Events is a posting type with no daily quota; its pool goes stale after eight days, not three', async () => {
  assert.equal(isPostingType('ai_events'), true);
  await assert.rejects(() => writePosting('ai_events', { perDay: 1 }, 't'), /no daily quota/);
  await assert.rejects(() => writePosting('ai_events', { cap: 3 }, 't'), /AI Events posts Miami and Boston, so its daily limit is 0 to 2/);
  const sevenDaysAgo = new Date(SUN_NOON.getTime() - 7 * 86_400_000).toISOString();
  assert.equal(poolStale(sevenDaysAgo, SUN_NOON), true);
  assert.equal(poolStale(sevenDaysAgo, SUN_NOON, 'ai_events'), false);
  assert.equal(poolStale(new Date(SUN_NOON.getTime() - 9 * 86_400_000).toISOString(), SUN_NOON, 'ai_events'), true);
});

test('AI Events copy: Generate names its Jev spend and no Claude; the switches name Sunday noon', () => {
  const type = readFileSync('components/content-type/TypeControls.tsx', 'utf8');
  assert.match(type, /export function AiEventsRunButton\(\)/);
  assert.match(type, />Generate<\/button>/);
  assert.ok(type.includes('Make the AI Events post every Sunday at 12:00 PM? Each run ranks the coming week’s events with live Jev calls (about $0.02, up to the run cap). No Claude calls.'));
  const hub = readFileSync('components/social-hub/content/HubControls.tsx', 'utf8');
  assert.ok(hub.includes('Makes the week’s carousel at 12:00 PM on Sundays.'));
  for (const file of ['components/content-type/TypeControls.tsx', 'components/content-type/AiEventsPoolButtons.tsx', 'components/content-type/ContentTypePage.tsx']) {
    const strings = [...readFileSync(file, 'utf8').matchAll(/'([^'\n]*AI Events[^'\n]*)'/g)].map((m) => m[1]!);
    for (const s of strings) assert.doesNotMatch(s, /!/, `${file}: no exclamation marks in UI copy`);
  }
});
