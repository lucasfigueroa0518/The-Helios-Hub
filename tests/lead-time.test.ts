/**
 * Lead time (Bald-Eagle D4, D8; planning/bald-eagle-2026-11-12/CONTRACT.md §Lead time): the shared core
 * (lib/social-hub/lead.ts), booking with a start date, the quota on a target date, the board, and Stories
 * (Guess the Number and Free vs. Paid 2 days ahead, Morning Download same-day). Offline: PGlite and pure
 * functions; no model, no Meta, no network. Field Notes' lead tests live in field-notes-run.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { fieldNotesPosts } from '@/lib/social-hub/adapters/field-notes';
import { boardDate } from '@/lib/social-hub/adapters/common';
import { dailyFill, quotaFilledNote } from '@/lib/social-hub/fill';
import { quotaDay, quotaFor } from '@/lib/social-hub/health/reporters/shared';
import { fillDates, LEAD_DAYS, leadDaysFor, runDayFor, targetDateFor } from '@/lib/social-hub/lead';
import { chooseSlotTime } from '@/lib/social-hub/slots/book';
import type { ResolvedSlot } from '@/lib/social-hub/slots/types';
import { bookSlot, ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';
import type { FieldNotesPostRow, FieldNotesRead } from '@/lib/social-hub/queries/field-notes';
import { chooseFromWindows } from '@/lib/instagram/window';
import { capSpendUsd, keysToAvoid } from '@/lib/stories/build/common';
import { requestAutoSets } from '@/lib/stories/schedule';
import { loadSettings, saveSeriesSetting } from '@/lib/stories/settings';
import { freshnessDay } from '@/lib/stories/sources/reels';
import type { PostingState } from '@/lib/content-type/posting';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { harnessDb } from './stories-harness';

// ── lead.ts ─────────────────────────────────────────────────────────────────

test('LEAD_DAYS: the six cushion types are 2 days ahead; Morning Download, Last Few Days, Carousels and AI Events same-day', () => {
  for (const v of ['reels', 'explainers', 'reel_ai_drama', 'field_notes'] as const) assert.equal(leadDaysFor(v), 2, v);
  assert.equal(leadDaysFor('stories', 'guess_the_number'), 2);
  assert.equal(leadDaysFor('stories', 'free_vs_paid'), 2);
  assert.equal(leadDaysFor('stories', 'morning_download'), 0);
  assert.equal(leadDaysFor('stories'), 0, 'Stories without a series reads as same-day');
  for (const v of ['carousels', 'last_few_days', 'ai_events'] as const) assert.equal(leadDaysFor(v), 0, v);
  assert.ok(Object.isFrozen(LEAD_DAYS));
});

test('fillDates: lead 0 fills the run day; lead 2 fills the run day through day+2 (the cutover); the type drops what is filled', () => {
  assert.deepEqual(fillDates('2026-11-12', 0), ['2026-11-12']);
  // A night run starts after midnight, so its run day is a posting day too (integration review M1).
  assert.deepEqual(fillDates('2026-11-12', 2), ['2026-11-12', '2026-11-13', '2026-11-14'], 'cutover night (D8): all three are candidates');
  // Steady state: the two nights before filled the run day and day+1, so the type's own quota leaves only day+2.
  const filled = new Set(['2026-11-12', '2026-11-13']);
  assert.deepEqual(fillDates('2026-11-12', 2).filter((d) => !filled.has(d)), ['2026-11-14']);
  assert.deepEqual(fillDates('2026-12-31', 2), ['2026-12-31', '2027-01-01', '2027-01-02'], 'across a year end');
  assert.deepEqual(fillDates('2026-11-12', -1), ['2026-11-12'], 'a bad lead reads as 0');
  assert.throws(() => fillDates('Nov 12', 2), /YYYY-MM-DD/);
  assert.equal(targetDateFor('2026-11-12', 'explainers'), '2026-11-14');
  assert.equal(targetDateFor('2026-11-12', 'stories', 'morning_download'), '2026-11-12');
  assert.equal(runDayFor('2026-11-14', 'stories', 'guess_the_number'), '2026-11-12');
});

// ── booking with a start date ───────────────────────────────────────────────

const slot = (startMinute: number): ResolvedSlot => ({ vertical: 'explainers', startMinute, series: null, feedMode: 'main', origin: 'template' });
const RUN = new Date('2026-11-12T08:00:00Z'); // 3:00 AM New York, Thursday

test('booking: fromDate = throughDate = target books only the target date, never today', () => {
  const byDate = new Map([['2026-11-12', [slot(780)]], ['2026-11-13', [slot(780)]], ['2026-11-14', [slot(780)]]]);
  const first = () => 0;
  assert.equal(chooseSlotTime(byDate, RUN, new Set(), [], first)!.nyDate, '2026-11-12', 'no fromDate: the earliest, today');
  const target = chooseSlotTime(byDate, RUN, new Set(), [], first, '2026-11-14', '2026-11-14');
  assert.equal(target!.nyDate, '2026-11-14');
  assert.equal(chooseSlotTime(byDate, RUN, new Set(['2026-11-14|t0780']), [], first, '2026-11-14', '2026-11-14'), null, 'the target taken: nothing, not another day');
  // The legacy window chooser takes the same start date.
  const w = { id: 'afternoon', label: '', startMinute: 780, endMinute: 840 };
  assert.equal(chooseFromWindows([w], RUN, new Set(), [], first)!.nyDate, '2026-11-12');
  assert.equal(chooseFromWindows([w], RUN, new Set(), [], first, '2026-11-14', '2026-11-14')!.nyDate, '2026-11-14');
});

// ── the quota on a target date ──────────────────────────────────────────────

test('quota: on a cushion type’s target date every booking counts, the night’s own too; a same-day type counts people only', async () => {
  const { query } = await openHubTestDb();
  const q = query as SpineQuery;
  const book = async (nyDate: string, source: 'auto' | 'user', s: string) => {
    const itemId = await ensureContentItem(q, { vertical: 'explainers', format: 'reel', nativeRef: `x-${Math.random()}`, ideaRef: null });
    await bookSlot(q, { vertical: 'explainers', itemId, ideaRef: null, nyDate, slot: s, publishAt: new Date(`${nyDate}T18:00:00Z`), source });
  };
  await book('2026-11-14', 'auto', 'afternoon');
  await book('2026-11-14', 'user', 'late');
  await book('2026-11-13', 'auto', 'afternoon');
  const lead = await dailyFill(q, 'explainers', '2026-11-14', 3, { lead: leadDaysFor('explainers') });
  assert.deepEqual(lead, { vertical: 'explainers', nyDate: '2026-11-14', quota: 3, userPlaced: 2, making: 1, counted: 'every' });
  assert.match(quotaFilledNote({ ...lead, making: 0 }, 'explainer'), /already booked for 2026-11-14/);
  const sameDay = await dailyFill(q, 'explainers', '2026-11-14', 3);
  assert.equal(sameDay.userPlaced, 1, 'without lead only the person’s booking counts (D54 as before)');
  assert.equal(sameDay.counted, undefined);
});

// ── the board ───────────────────────────────────────────────────────────────

test('board: an unbooked item shows on its target date; a booked or posted one on its slot’s or post’s day', () => {
  assert.equal(boardDate({ target: '2026-11-14', madeAt: '2026-11-12T08:00:00Z' }), '2026-11-14');
  assert.equal(boardDate({ target: '2026-11-14T00:00:00', madeAt: '2026-11-12T08:00:00Z' }), '2026-11-14', 'read as a calendar date, not shifted by a time zone');
  assert.equal(boardDate({ publishAt: '2026-11-15T18:00:00Z', target: '2026-11-14' }), '2026-11-15');
  assert.equal(boardDate({ postedAt: '2026-11-16T18:00:00Z', publishAt: '2026-11-15T18:00:00Z' }), '2026-11-16');
  assert.equal(boardDate({ madeAt: '2026-11-12T08:00:00Z' }), '2026-11-12', 'same-day types: as before');

  const row = {
    post_id: 'p1', run_id: null, tip_id: null, tip_ids: [], tips: [], seq: 1, slug: 'field-notes-2026-11-14', ny_date: '2026-11-14', status: 'review',
    caption: 'c', created_at: '2026-11-12T07:30:00Z', updated_at: '2026-11-12T07:30:00Z', published_at: null, approved_by: null,
    subject: null, branch: null, source_url: null, source_label: null, render: { slides: [] }, slide_count: 0, has_slide_objects: false,
    render_version: 1, fit_problems: [], render_problems: [],
  } as unknown as FieldNotesPostRow;
  const read = { posts: [row], attempts: [], schedules: [], insights: [], tips: [], latestRun: null, requireApproval: true, publishingLive: true } as unknown as FieldNotesRead;
  const [post] = fieldNotesPosts(read);
  assert.equal(post!.status, 'ready');
  assert.equal(post!.nyDate, '2026-11-14', 'made Thursday for Saturday: shown on Saturday');
});

// ── health ──────────────────────────────────────────────────────────────────

test('health: night N’s quota is the date it fills: N for same-day types, N+2 for types made ahead (Stories per series)', () => {
  const base = { live: true, generate: true, autoPublish: false, perDay: null, maxPerDay: null, series: null, schedule: null, cap: 5, costPerPostMicros: null };
  const day = (nyDate: string, count: number, series: string[] = []) => ({ nyDate, count, series }) as never;
  const explainers = { ...base, type: 'explainers', nights: [day('2026-11-12', 1), day('2026-11-14', 3)] } as unknown as PostingState;
  assert.equal(quotaDay('2026-11-12', 'explainers'), '2026-11-14');
  assert.equal(quotaFor(explainers, '2026-11-12'), 3);
  const carousels = { ...explainers, type: 'carousels' } as unknown as PostingState;
  assert.equal(quotaFor(carousels, '2026-11-12'), 1);
  const series = [
    { id: 'morning_download', label: 'MD', enabled: true, generate: true, days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'guess_the_number', label: 'GTN', enabled: true, generate: true, days: [1, 4] },
  ];
  const stories = { ...base, type: 'stories', series, nights: [day('2026-11-12', 1, ['morning_download']), day('2026-11-14', 2, ['morning_download', 'guess_the_number'])] } as unknown as PostingState;
  assert.equal(quotaFor(stories, '2026-11-12'), 2, 'MD on the 12th, GTN on the 14th');
  const legacyStories = { ...base, type: 'stories', series, nights: null } as unknown as PostingState;
  // Legacy days: Thu Nov 12 → MD daily; GTN for Sat Nov 14 is not a GTN day; Sat Nov 14's run makes Mon Nov 16 (a GTN day).
  assert.equal(quotaFor(legacyStories, '2026-11-12'), 1);
  assert.equal(quotaFor(legacyStories, '2026-11-14'), 2);
});

// ── Stories ─────────────────────────────────────────────────────────────────

type Db = Awaited<ReturnType<typeof harnessDb>>['db'];
const SAT_3AM = new Date('2026-10-10T07:00:00Z'); // Saturday 3:00 AM New York
const SAT_11AM = new Date('2026-10-10T15:00:00Z'); // after the 8:30-10:00 window
const setsOf = async (db: Db) => (await db.query<{ series: string; ny_date: string }>(`SELECT series, ny_date::text AS ny_date FROM stories.sets ORDER BY series, ny_date`)).rows.map((r) => [r.series, r.ny_date.slice(0, 10)]);

async function allAuto(db: Db) {
  for (const s of ['morning_download', 'guess_the_number', 'free_vs_paid'] as const) await saveSeriesSetting(db, s, { auto: true });
}

test('stories: the 3 AM request makes Morning Download for today and Guess the Number / Free vs. Paid for the run day through 2 days on', async () => {
  const { db } = await harnessDb();
  await allAuto(db);
  // Cutover Saturday: MD for Sat; GTN (Mon/Thu) finds Mon Oct 12 in Sat–Mon; FvP (Tue/Sat) finds Sat itself, whose window is still ahead.
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), SAT_3AM), ['morning_download', 'guess_the_number', 'free_vs_paid']);
  assert.deepEqual(await setsOf(db), [['free_vs_paid', '2026-10-10'], ['guess_the_number', '2026-10-12'], ['morning_download', '2026-10-10']]);
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), SAT_3AM), [], 'one live set per series day');
  // Steady state: Sunday's night finds Sat-made sets holding Mon; only Tue (FvP, +2) is new.
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), new Date('2026-10-11T07:00:00Z')), ['morning_download', 'free_vs_paid']);
  assert.deepEqual((await setsOf(db)).filter(([s]) => s === 'free_vs_paid'), [['free_vs_paid', '2026-10-10'], ['free_vs_paid', '2026-10-13']]);
});

test('stories: "window passed, skip" applies only to the run day; a set 2 days ahead is still requested late in the day', async () => {
  const { db } = await harnessDb();
  await allAuto(db);
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), SAT_11AM), ['guess_the_number'], 'MD’s and FvP’s Saturday windows have passed; GTN’s Monday has not');
  assert.deepEqual(await setsOf(db), [['guess_the_number', '2026-10-12']]);
});

test('stories template: each series reads the slots of its own target date', async () => {
  const { db } = await harnessDb();
  await allAuto(db);
  const asked: string[] = [];
  const slotsFor = async (d: string): Promise<ResolvedSlot[]> => {
    asked.push(d);
    return d === '2026-10-11' ? [{ vertical: 'stories', startMinute: 600, series: 'free_vs_paid', feedMode: null, origin: 'template' }] : [];
  };
  assert.deepEqual(await requestAutoSets(db, await loadSettings(db), SAT_3AM, { slotsFor }), ['free_vs_paid']);
  assert.deepEqual([...new Set(asked)].sort(), ['2026-10-10', '2026-10-11', '2026-10-12']);
  const rows = (await db.query<{ series: string; ny_date: string; m: number }>(`SELECT series, ny_date::text AS ny_date, slot_minute AS m FROM stories.sets`)).rows;
  assert.deepEqual(rows.map((r) => [r.series, r.ny_date.slice(0, 10), Number(r.m)]), [['free_vs_paid', '2026-10-11', 600]]);
});

test('stories: keysToAvoid sees a built-but-unposted set on a neighboring date (GTN/FvP); Morning Download keeps the same-date rule', async () => {
  const { db } = await harnessDb();
  const put = async (series: string, nyDate: string, keys: string[], status = 'ready', slotMinute: number | null = null) =>
    (await db.query<{ id: string }>(`INSERT INTO stories.sets (series, ny_date, status, trigger, style, payload, slot_minute) VALUES ($1, $2, $3, 'auto', 'polished', $4::jsonb, $5) RETURNING id::text AS id`,
      [series, nyDate, status, JSON.stringify({ historyKeys: keys }), slotMinute])).rows[0]!.id;
  const me = await put('guess_the_number', '2026-10-12', [], 'building');
  await put('guess_the_number', '2026-10-11', ['k-neighbor']);
  await put('guess_the_number', '2026-10-14', ['k-two-ahead']);
  await put('guess_the_number', '2026-10-15', ['k-far']);
  await put('guess_the_number', '2026-10-13', ['k-rejected'], 'rejected');
  const gtn = await keysToAvoid({ db, now: SAT_3AM, nyDate: '2026-10-12', setId: me }, 'guess_the_number', 30);
  assert.deepEqual([...gtn].sort(), ['k-neighbor', 'k-two-ahead']);

  const md = await put('morning_download', '2026-10-12', [], 'building', 510);
  await put('morning_download', '2026-10-11', ['md-yesterday']);
  await put('morning_download', '2026-10-12', ['md-same-day'], 'ready', 900);
  assert.deepEqual([...(await keysToAvoid({ db, now: SAT_3AM, nyDate: '2026-10-12', setId: md }, 'morning_download', 3))], ['md-same-day']);
});

test('stories: a series made ahead counts the daily cap against its target date; Morning Download against the run day', async () => {
  const { db } = await harnessDb();
  const set = async (series: string, nyDate: string) =>
    (await db.query<{ id: string }>(`INSERT INTO stories.sets (series, ny_date, status, trigger, style) VALUES ($1, $2, 'ready', 'auto', 'polished') RETURNING id::text AS id`, [series, nyDate])).rows[0]!.id;
  const cost = (setId: string, usd: number) => db.query(`INSERT INTO stories.cost_events (set_id, vendor, component, usd, created_at) VALUES ($1, 'anthropic', 't', $2, $3)`, [setId, usd, SAT_3AM.toISOString()]);
  await cost(await set('guess_the_number', '2026-10-12'), 1.5);
  await cost(await set('free_vs_paid', '2026-10-11'), 0.4);
  await cost(await set('morning_download', '2026-10-10'), 0.3);
  assert.equal(await capSpendUsd(db, 'guess_the_number', '2026-10-12', SAT_3AM), 1.5);
  assert.equal(await capSpendUsd(db, 'free_vs_paid', '2026-10-11', SAT_3AM), 0.4, 'the cutover night spends up to one cap per date it fills');
  assert.ok(Math.abs((await capSpendUsd(db, 'morning_download', '2026-10-10', SAT_3AM)) - 0.3) < 1e-9, 'MD: the run day’s same-day spend only, never the builds for later dates');
});

test('stories: freshness windows end on the run day, not the target date', () => {
  assert.equal(freshnessDay(SAT_3AM), '2026-10-10');
  assert.equal(freshnessDay('2026-10-10'), '2026-10-10');
});
