/**
 * Placing content on the calendar from the hub (D50), carousel and Trial
 * Reels regenerate (D51, D52) and Explainers reject with tags (D53).
 * Offline: the real schema files on PGlite (tests/fixtures/social-hub/pglite.ts),
 * stub pipeline stages, no network, no model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { publishReadiness } from '@/lib/explainers/publish/publish';
import { explainerItemId } from '@/lib/explainers/publish/items';
import { scheduleApproved } from '@/lib/explainers/publish/schedule';
import { getFeedback, REJECTED_SLOT_NOTE, setVerdict } from '@/lib/explainers/repository';
import { explainerActions } from '@/lib/publishing/actions/explainers';
import { storyActions } from '@/lib/publishing/actions/stories';
import { findReelLock } from '@/lib/reels/locks';
import { todaySlateFor } from '@/lib/reels/visual/finish';
import { createStubStages, stubBrief } from '@/lib/social/pipeline/stubs';
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import type { StageName } from '@/lib/social/pipeline/types';
import { carouselItemId } from '@/lib/social/overnight/items';
import { loadRerunStory, rerunCandidate, rerunStages } from '@/lib/social/overnight/rerun';
import { claimRerun, claimRun, requestRerun, requestRun, settleReruns } from '@/lib/social/overnight/runs';
import {
  activeSlotByRef,
  formatPlacement,
  openSlots,
  placeItem,
  planPlacement,
  rescheduleItem,
  STORY_WINDOW_DEFAULTS,
} from '@/lib/social-hub/placement';
import { approveItem, bookSlot, ensureContentItem, rejectItem, type SpineQuery } from '@/lib/social-hub/spine';
import { getSet, rescheduleSet } from '@/lib/stories/repository';
import { pgliteDb } from '@/lib/stories/local-db';
import { DEFAULT_SETTINGS as STORY_SETTINGS } from '@/lib/stories/settings';

import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Thursday 2026-10-08, 8:00 AM New York. */
const NOW = new Date('2026-10-08T12:00:00Z');
const first = () => 0;
const last = (n: number) => n - 1;

async function spineDb(): Promise<{ pg: PGlite; q: SpineQuery }> {
  const { pg, query } = await openHubTestDb();
  return { pg, q: query as SpineQuery };
}

/** New York wall clock of an instant, "YYYY-MM-DD HH:MM". */
function ny(at: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const p = (t: string) => parts.find((x) => x.type === t)!.value;
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}`;
}

let serial = 0;
/** A carousel in review and its spine item. */
async function carousel(pg: PGlite, q: SpineQuery, opts: { storyId?: string; brief?: boolean; origin?: string } = {}) {
  serial += 1;
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO social.posts (slug, story_id, title, status, render, brief, origin)
     VALUES ($1, $2, $3, 'review', $4::jsonb, $5::jsonb, $6) RETURNING id::text AS id`,
    [`post-test-${serial}`, opts.storyId ?? `story-${serial}`, `Story ${serial}`, JSON.stringify({ publishedAt: '2026-10-07T12:00:00Z' }),
      opts.brief === false ? null : JSON.stringify(stubBrief(`Story ${serial}`)), opts.origin ?? 'pipeline'],
  );
  const postId = rows[0]!.id;
  return { postId, itemId: (await carouselItemId(q, postId))! };
}

/** A finished explainer render and its spine item. */
async function explainer(pg: PGlite) {
  serial += 1;
  const topic = (await pg.query<{ id: string }>(`INSERT INTO explainers.topics (title, origin, status) VALUES ($1, 'manual', 'rendered') RETURNING id::text AS id`, [`Topic ${serial}`])).rows[0]!.id;
  const job = (await pg.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model, finished_at)
     VALUES ($1, 'ok', 'click', 'development', 5, 'o', 'f', now()) RETURNING id::text AS id`,
    [topic],
  )).rows[0]!.id;
  return { topic, job };
}

/** A feed slot booked directly (another type's post, for spacing). */
async function busy(q: SpineQuery, vertical: 'carousels' | 'explainers', nyDate: string, slot: string, at: string) {
  const itemId = await ensureContentItem(q, { vertical, format: vertical === 'carousels' ? 'feed' : 'reel', nativeRef: `busy-${(serial += 1)}`, ideaRef: null });
  return bookSlot(q, { vertical, itemId, nyDate, slot, publishAt: new Date(at), source: 'auto' });
}

// ── Place: the rules ────────────────────────────────────────────────────────

test('place: a carousel goes into the chosen day and window as a person’s slot, at a minute inside the window', async () => {
  const { pg, q } = await spineDb();
  const c = await carousel(pg, q);
  const out = await placeItem(q, { vertical: 'carousels', itemId: c.itemId, nyDate: '2026-10-09', slot: 'morning', now: NOW, rng: first });
  assert.equal(out.ok, true, out.note);
  assert.equal(out.note, 'Scheduled for Fri Oct 9, 9:00 AM.');
  const row = (await pg.query<{ ny_date: string; slot: string; publish_at: string; status: string; source: string; content_item_id: string }>(
    `SELECT ny_date::text AS ny_date, slot, publish_at, status, source, content_item_id::text AS content_item_id FROM social_hub.schedule`,
  )).rows[0]!;
  assert.deepEqual([row.ny_date, row.slot, ny(row.publish_at), row.status, row.source, row.content_item_id], ['2026-10-09', 'morning', '2026-10-09 09:00', 'scheduled', 'user', c.itemId]);
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.approvals`)).rows.length, 0, 'placing is not approving (D36)');

  // The last minute of the window is still inside it.
  const c2 = await carousel(pg, q);
  const late = await placeItem(q, { vertical: 'carousels', itemId: c2.itemId, nyDate: '2026-10-09', slot: 'afternoon', now: NOW, rng: last });
  assert.ok(late.ok);
  assert.equal(ny((late as { publishAt: string }).publishAt), '2026-10-09 15:30');
  assert.equal(formatPlacement(new Date('2026-10-09T13:23:00Z')), 'Fri Oct 9, 9:23 AM');
});

test('place: a slot the type doesn’t have is refused, with the windows it does have', async () => {
  const { pg, q } = await spineDb();
  const c = await carousel(pg, q);
  const bad = await placeItem(q, { vertical: 'carousels', itemId: c.itemId, nyDate: '2026-10-09', slot: 'late', now: NOW });
  assert.equal(bad.ok, false);
  assert.match(bad.note, /^Carousels have no “late” slot\. Pick morning \(Morning, 9:00–10:00 AM\) or afternoon \(Afternoon, 2:30–3:30 PM\)\.$/);
  for (const [vertical, slot] of [['explainers', 'morning'], ['reels', 'late'], ['stories', 'morning']] as const) {
    const plan = await planPlacement(q, { vertical, nyDate: '2026-10-09', slot, now: NOW });
    assert.equal(plan.ok, false, `${vertical} ${slot}`);
  }
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.schedule`)).rows.length, 0);
});

test('place: never in the past, never outside the window, at most two weeks ahead', async () => {
  const { pg, q } = await spineDb();
  const c = await carousel(pg, q);
  const at = (nyDate: string, now = NOW) => placeItem(q, { vertical: 'carousels', itemId: c.itemId, nyDate, slot: 'morning', now, rng: first });
  assert.equal((await at('2026-10-07')).note, 'That day has passed.');
  assert.equal((await at('2026-10-23')).note, 'Pick a day in the next two weeks.');
  assert.equal((await at('2026-02-30')).note, 'Pick a day as YYYY-MM-DD.');
  // 11:00 AM: today's morning window is over.
  assert.equal((await at('2026-10-08', new Date('2026-10-08T15:00:00Z'))).note, 'Today’s morning window (9:00–10:00 AM) is over.');
  // 9:30 AM: the window has started; the minute is still ahead.
  const midWindow = new Date('2026-10-08T13:30:00Z');
  const ok = await at('2026-10-08', midWindow);
  assert.ok(ok.ok, ok.note);
  assert.ok(new Date((ok as { publishAt: string }).publishAt) > midWindow);
  assert.equal(ny((ok as { publishAt: string }).publishAt), '2026-10-08 09:31');
});

test('place: one item per window per day; a taken slot is refused, here and on a move', async () => {
  const { pg, q } = await spineDb();
  const a = await carousel(pg, q);
  const b = await carousel(pg, q);
  assert.ok((await placeItem(q, { vertical: 'carousels', itemId: a.itemId, nyDate: '2026-10-09', slot: 'morning', now: NOW, rng: first })).ok);
  assert.equal((await placeItem(q, { vertical: 'carousels', itemId: b.itemId, nyDate: '2026-10-09', slot: 'morning', now: NOW })).note, 'That slot is taken.');
  assert.ok((await placeItem(q, { vertical: 'carousels', itemId: b.itemId, nyDate: '2026-10-10', slot: 'morning', now: NOW, rng: first })).ok);
  assert.equal((await rescheduleItem(q, { vertical: 'carousels', itemId: b.itemId, nyDate: '2026-10-09', slot: 'morning', now: NOW })).note, 'That slot is taken.');
  // Content with a waiting slot is moved, not placed twice.
  assert.match((await placeItem(q, { vertical: 'carousels', itemId: a.itemId, nyDate: '2026-10-11', slot: 'morning', now: NOW })).note, /^It already has a slot \(Fri Oct 9, 9:00 AM\)\. Move it instead\.$/);
});

test('spacing: carousels and explainers keep 30 minutes from every other feed post', async () => {
  const { pg, q } = await spineDb();
  // Explainer posts at 2:45 and 3:15 PM leave no carousel minute in 2:30–3:30 PM.
  await busy(q, 'explainers', '2026-10-09', 'afternoon', '2026-10-09T18:45:00Z');
  await busy(q, 'explainers', '2026-10-09', 'late', '2026-10-09T19:15:00Z');
  const c = await carousel(pg, q);
  const crowded = await placeItem(q, { vertical: 'carousels', itemId: c.itemId, nyDate: '2026-10-09', slot: 'afternoon', now: NOW, rng: first });
  assert.equal(crowded.note, 'Every minute left in that window is within 30 minutes of another feed post.');
  // One carousel at 1:15 PM: an explainer in 1:00–2:30 PM starts at 1:45 at the earliest.
  await busy(q, 'carousels', '2026-10-10', 'morning', '2026-10-10T17:15:00Z');
  const e = await explainer(pg);
  const itemId = (await explainerItemId({ query: (t, p) => pg.query(t, p) as never }, e.job))!;
  const spaced = await placeItem(q, { vertical: 'explainers', itemId, nyDate: '2026-10-10', slot: 'afternoon', now: NOW, rng: first });
  assert.ok(spaced.ok, spaced.note);
  assert.equal(ny((spaced as { publishAt: string }).publishAt), '2026-10-10 13:45');
  const slots = await openSlots(q, 'carousels', '2026-10-09', { now: NOW });
  assert.deepEqual(slots.map((s) => [s.slot, s.state]), [['morning', 'free'], ['afternoon', 'crowded']]);
});

test('spacing: Trial Reels and Stories are exempt in both directions (D33)', async () => {
  const { pg, q } = await spineDb();
  await busy(q, 'carousels', '2026-10-09', 'morning', '2026-10-09T13:00:00Z'); // 9:00 AM
  // A reel and a story at the carousel's very minute.
  const reel = await placeItem(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-1', nyDate: '2026-10-09', slot: 'morning', now: NOW, rng: () => 15 });
  assert.ok(reel.ok, reel.note);
  assert.equal(ny((reel as { publishAt: string }).publishAt), '2026-10-09 09:00');
  const story = await planPlacement(q, { vertical: 'stories', nyDate: '2026-10-09', slot: 'morning_download', now: NOW, rng: () => 30 });
  assert.ok(story.ok);
  assert.equal(ny(story.publishAt), '2026-10-09 09:00');
  // And the reel doesn't make a carousel wait.
  const c = await carousel(pg, q);
  assert.ok((await placeItem(q, { vertical: 'carousels', itemId: c.itemId, nyDate: '2026-10-10', slot: 'morning', now: NOW, rng: first })).ok);
  await placeItem(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-2', nyDate: '2026-10-11', slot: 'morning', now: NOW, rng: () => 15 }); // 9:00 AM
  const c2 = await carousel(pg, q);
  const beside = await placeItem(q, { vertical: 'carousels', itemId: c2.itemId, nyDate: '2026-10-11', slot: 'morning', now: NOW, rng: first });
  assert.equal(ny((beside as { publishAt: string }).publishAt), '2026-10-11 09:00');
});

test('refusals: rejected content, a try in flight, already posted', async () => {
  const { pg, q } = await spineDb();
  const rejected = await carousel(pg, q);
  await rejectItem(q, rejected.itemId, 'tommy');
  assert.equal((await placeItem(q, { vertical: 'carousels', itemId: rejected.itemId, nyDate: '2026-10-09', slot: 'morning', now: NOW })).note, 'It was rejected, so it can’t be scheduled.');

  const posting = await carousel(pg, q);
  await pg.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'carousels', 'force', 'creating', 'c')`, [posting.itemId]);
  assert.equal((await placeItem(q, { vertical: 'carousels', itemId: posting.itemId, nyDate: '2026-10-09', slot: 'morning', now: NOW })).note, 'It is posting right now. Wait for that try to finish.');

  const posted = await carousel(pg, q);
  await pg.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'carousels', 'approve', 'published', 'c')`, [posted.itemId]);
  assert.equal((await placeItem(q, { vertical: 'carousels', itemId: posted.itemId, nyDate: '2026-10-09', slot: 'morning', now: NOW })).note, 'It has already posted.');

  // A slot already publishing can't move.
  const moving = await carousel(pg, q);
  await bookSlot(q, { vertical: 'carousels', itemId: moving.itemId, nyDate: '2026-10-09', slot: 'afternoon', publishAt: new Date('2026-10-09T18:40:00Z'), source: 'auto' });
  await pg.exec(`UPDATE social_hub.schedule SET status = 'publishing' WHERE content_item_id = '${moving.itemId}'`);
  assert.equal((await rescheduleItem(q, { vertical: 'carousels', itemId: moving.itemId, nyDate: '2026-10-10', slot: 'morning', now: NOW })).note, 'It is posting right now, so it can’t move.');
  // A Trial Reels idea counts every video made for it.
  const video = await ensureContentItem(q, { vertical: 'reels', format: 'reel', nativeRef: 'video-x', ideaRef: 'idea-posting' });
  await pg.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'reels', 'auto', 'processing', 'c')`, [video]);
  assert.equal((await placeItem(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-posting', nyDate: '2026-10-09', slot: 'evening', now: NOW })).note, 'It is posting right now. Wait for that try to finish.');
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.schedule WHERE status = 'scheduled'`)).rows.length, 0);
});

// ── Reschedule ──────────────────────────────────────────────────────────────

test('reschedule: the same slot row moves; its source stays; its own time doesn’t space against itself', async () => {
  const { pg, q } = await spineDb();
  const c = await carousel(pg, q);
  const booked = await bookSlot(q, { vertical: 'carousels', itemId: c.itemId, nyDate: '2026-10-09', slot: 'morning', publishAt: new Date('2026-10-09T13:10:00Z'), source: 'auto' });
  // Same window, earlier minute: 9:00 is 10 minutes from its own old 9:10, which doesn't count.
  const same = await rescheduleItem(q, { vertical: 'carousels', itemId: c.itemId, nyDate: '2026-10-09', slot: 'morning', now: NOW, rng: first });
  assert.equal(same.note, 'Moved to Fri Oct 9, 9:00 AM.');
  const moved = await rescheduleItem(q, { vertical: 'carousels', itemId: c.itemId, nyDate: '2026-10-10', slot: 'afternoon', now: NOW, rng: first });
  assert.equal(moved.note, 'Moved to Sat Oct 10, 2:30 PM.');
  const rows = (await pg.query<{ id: string; ny_date: string; slot: string; source: string; status: string }>(`SELECT id, ny_date::text AS ny_date, slot, source, status FROM social_hub.schedule`)).rows;
  assert.deepEqual(rows, [{ id: booked.id, ny_date: '2026-10-10', slot: 'afternoon', source: 'auto', status: 'scheduled' }]);
  const nothing = await carousel(pg, q);
  assert.equal((await rescheduleItem(q, { vertical: 'carousels', itemId: nothing.itemId, nyDate: '2026-10-10', slot: 'morning', now: NOW })).note, 'It isn’t scheduled, so there is nothing to move.');
});

test('Trial Reels: slots belong to the idea; a move keeps the slot’s approval', async () => {
  const { pg, q } = await spineDb();
  const placed = await placeItem(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-a', nyDate: '2026-10-09', slot: 'midday', now: NOW, rng: first });
  assert.ok(placed.ok, placed.note);
  let row = (await pg.query<{ idea_ref: string; content_item_id: string | null; approved_at: string | null; source: string }>(`SELECT idea_ref, content_item_id, approved_at, source FROM social_hub.schedule`)).rows[0]!;
  assert.deepEqual([row.idea_ref, row.content_item_id, row.approved_at, row.source], ['idea-a', null, null, 'user']);
  assert.match((await placeItem(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-a', nyDate: '2026-10-10', slot: 'midday', now: NOW })).note, /already has a slot/);

  // An approved slot (a person scheduled the idea) moves by idea and stays approved.
  await bookSlot(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-b', nyDate: '2026-10-09', slot: 'evening', publishAt: new Date('2026-10-09T23:00:00Z'), source: 'user', approved: true });
  const before = (await pg.query<{ approved_at: string }>(`SELECT approved_at::text AS approved_at FROM social_hub.schedule WHERE idea_ref = 'idea-b'`)).rows[0]!.approved_at;
  const moved = await rescheduleItem(q, { vertical: 'reels', itemId: null, ideaRef: 'idea-b', nyDate: '2026-10-10', slot: 'morning', now: NOW, rng: first });
  assert.equal(moved.note, 'Moved to Sat Oct 10, 8:45 AM.');
  row = (await pg.query<{ idea_ref: string; content_item_id: string | null; approved_at: string; source: string }>(`SELECT idea_ref, content_item_id, approved_at::text AS approved_at, source FROM social_hub.schedule WHERE idea_ref = 'idea-b'`)).rows[0]!;
  assert.equal(row.approved_at, before);
});

// ── Stories: their own set, re-projected ────────────────────────────────────

const SET = '70000000-0000-4000-8000-000000000001';
const OTHER = '70000000-0000-4000-8000-000000000002';

function stories(pg: PGlite, q: SpineQuery) {
  const db = pgliteDb(pg);
  return storyActions({
    approve: async () => undefined, reject: async () => undefined, publishNow: async () => undefined, regenerate: async () => undefined,
    query: q,
    getSet: (id) => getSet(db, id),
    slotOf: (id) => activeSlotByRef(q, 'stories', id),
    plan: (query, input) => planPlacement(query, { ...input, now: NOW, rng: first }),
    rescheduleSet: (id, nyDate, at) => db.transaction((tx) => rescheduleSet(tx, id, nyDate, at)),
  });
}

test('Stories: stories.sets moves (day and minute) and the spine is re-projected from it', async () => {
  const { pg, q } = await spineDb();
  await pg.query(`INSERT INTO stories.sets (id, series, ny_date, status, trigger, style, approved_at) VALUES ($1, 'morning_download', '2026-10-09', 'approved', 'click', 'polished', now())`, [SET]);
  const act = stories(pg, q);
  const placed = await act.place!({ setId: SET }, 'tommy', { nyDate: '2026-10-10', slot: 'morning_download' });
  assert.deepEqual(placed, { ok: true, note: 'Scheduled for Sat Oct 10, 8:30 AM.' });
  const set = async () => (await pg.query<{ status: string; ny_date: string; publish_at: string }>(`SELECT status, ny_date::text AS ny_date, publish_at FROM stories.sets WHERE id = $1`, [SET])).rows[0]!;
  const spine = async () => (await pg.query<{ ny_date: string; slot: string; publish_at: string; status: string; idea_ref: string }>(
    `SELECT s.ny_date::text AS ny_date, s.slot, s.publish_at, s.status, ci.idea_ref FROM social_hub.schedule s JOIN social_hub.content_items ci ON ci.id = s.content_item_id WHERE s.legacy_id = $1`, [SET])).rows[0]!;
  let s = await set();
  let p = await spine();
  assert.deepEqual([s.status, s.ny_date, ny(s.publish_at)], ['scheduled', '2026-10-10', '2026-10-10 08:30']);
  assert.deepEqual([p.ny_date, p.slot, ny(p.publish_at), p.status, p.idea_ref], ['2026-10-10', 'morning_download', '2026-10-10 08:30', 'scheduled', 'morning_download:2026-10-10']);

  const moved = await act.reschedule!({ setId: SET }, 'tommy', { nyDate: '2026-10-12', slot: 'morning_download' });
  assert.equal(moved.note, 'Moved to Mon Oct 12, 8:30 AM.');
  s = await set();
  p = await spine();
  assert.deepEqual([s.ny_date, p.ny_date, ny(p.publish_at), p.idea_ref], ['2026-10-12', '2026-10-12', '2026-10-12 08:30', 'morning_download:2026-10-12']);
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.schedule WHERE vertical = 'stories'`)).rows.length, 1, 'one slot, moved');

  // Another live set of the series that day: the series' one-set-a-day rule holds.
  await pg.query(`INSERT INTO stories.sets (id, series, ny_date, status, trigger, style) VALUES ($1, 'morning_download', '2026-10-13', 'ready', 'click', 'polished')`, [OTHER]);
  assert.deepEqual(await act.reschedule!({ setId: SET }, 'tommy', { nyDate: '2026-10-13', slot: 'morning_download' }), { ok: false, note: 'That day already has a Morning Download set.' });
  assert.equal((await set()).ny_date, '2026-10-12', 'nothing moved');
  assert.equal((await spine()).ny_date, '2026-10-12', 'the spine still matches the set');
  assert.equal((await act.place!({ setId: OTHER }, 'tommy', { nyDate: '2026-10-14', slot: 'morning_download' })).note, 'Approve this set first: a Story set goes on the calendar only once approved.');
});

test('Stories: their series days and slot, and never a set that is posting', async () => {
  const { pg, q } = await spineDb();
  await pg.query(`INSERT INTO stories.sets (id, series, ny_date, status, trigger, style, approved_at) VALUES ($1, 'guess_the_number', '2026-10-12', 'approved', 'click', 'polished', now())`, [SET]);
  const act = stories(pg, q);
  // Guess the Number posts Mondays and Thursdays; 2026-10-09 is a Friday.
  assert.equal((await act.place!({ setId: SET }, 'tommy', { nyDate: '2026-10-09', slot: 'guess_the_number' })).note, 'Guess the Number doesn’t post on Fridays (it posts Mon, Thu).');
  assert.match((await act.place!({ setId: SET }, 'tommy', { nyDate: '2026-10-12', slot: 'morning_download' })).note, /posts only in its own slot/);
  assert.ok((await act.place!({ setId: SET }, 'tommy', { nyDate: '2026-10-12', slot: 'guess_the_number' })).ok);
  await pg.query(`UPDATE stories.sets SET status = 'publishing' WHERE id = $1`, [SET]);
  assert.equal((await act.reschedule!({ setId: SET }, 'tommy', { nyDate: '2026-10-15', slot: 'guess_the_number' })).note, 'It is posting or has posted, so it can’t move.');
  const slots = await openSlots(q, 'stories', '2026-10-09', { now: NOW });
  assert.deepEqual(slots.map((x) => [x.slot, x.state]), [['morning_download', 'free'], ['guess_the_number', 'off'], ['free_vs_paid', 'off']]);
});

test('the Stories window copy matches lib/stories/settings.ts', () => {
  for (const [series, w] of Object.entries(STORY_WINDOW_DEFAULTS)) {
    const own = STORY_SETTINGS.series[series as keyof typeof STORY_SETTINGS.series].window;
    assert.deepEqual({ start: own.start, end: own.end, days: own.days }, w, series);
  }
});

test('openSlots: free, taken (with what holds it), over; the slot being moved shows free', async () => {
  const { pg, q } = await spineDb();
  const c = await carousel(pg, q);
  const placed = await placeItem(q, { vertical: 'carousels', itemId: c.itemId, nyDate: '2026-10-08', slot: 'afternoon', now: NOW, rng: first });
  assert.ok(placed.ok);
  const at11 = new Date('2026-10-08T15:00:00Z');
  const today = await openSlots(q, 'carousels', '2026-10-08', { now: at11 });
  assert.deepEqual(today.map((s) => [s.slot, s.state, s.free]), [['morning', 'over', false], ['afternoon', 'taken', false]]);
  assert.equal(today[1]!.scheduleId, (placed as { scheduleId: string }).scheduleId);
  assert.equal(today[1]!.window, '2:30–3:30 PM');
  const moving = await openSlots(q, 'carousels', '2026-10-08', { now: at11, moving: (placed as { scheduleId: string }).scheduleId });
  assert.equal(moving[1]!.state, 'free');
  assert.deepEqual((await openSlots(q, 'reels', '2026-10-09', { now: NOW })).map((s) => s.slot), ['morning', 'midday', 'evening']);
});

// ── Explainers: placement through the action layer; reject with tags (D53) ──

function explainersDb(pg: PGlite) {
  const run = <T,>(text: string, params?: unknown[]) => pg.query<T>(text, params).then((r) => ({ rows: r.rows }));
  return { query: run, transaction: <R,>(fn: (tx: { query: typeof run }) => Promise<R>) => fn({ query: run }) } as never;
}

function explainerLayer(pg: PGlite) {
  const db = explainersDb(pg);
  return explainerActions({
    db: async () => db,
    setVerdict,
    hardPublishJob: async () => ({ queued: false }),
    loadSettings: async () => ({}),
    requestRerender: async () => ({ ok: false }),
    itemId: explainerItemId,
    verdictOf: async (d, jobId) => (await getFeedback(d, jobId))?.verdict ?? null,
    placeItem: (query, input) => placeItem(query, { ...input, now: NOW, rng: first }),
    rescheduleItem: (query, input) => rescheduleItem(query, { ...input, now: NOW, rng: first }),
  });
}

test('explainers reject with tags: the review keeps them, the spine says rejected, the waiting slot is cancelled, and no approval overrides it', async () => {
  const { pg, q } = await spineDb();
  const e = await explainer(pg);
  const layer = explainerLayer(pg);
  // Approved by a Hard publish's force earlier, and waiting in a slot.
  const placed = await layer.place!({ jobId: e.job }, 'tommy', { nyDate: '2026-10-09', slot: 'late' });
  assert.ok(placed.ok, placed.note);
  const itemId = (await pg.query<{ id: string }>(`SELECT id::text AS id FROM social_hub.content_items WHERE vertical = 'explainers'`)).rows[0]!.id;
  await approveItem(q, itemId, 'force', 'tommy');

  const out = await layer.reject!({ jobId: e.job }, 'tommy@helios.test', { tags: ['hook', 'pacing'], note: 'Slow open.' });
  assert.deepEqual(out, { ok: true, note: 'Rejected. It will not post.' });
  const fb = (await pg.query<{ verdict: string; tags: string[]; note: string; created_by: string }>(`SELECT verdict, tags, note, created_by FROM explainers.feedback WHERE job_id = $1`, [e.job])).rows[0]!;
  assert.deepEqual([fb.verdict, fb.tags, fb.note, fb.created_by], ['rejected', ['hook', 'pacing'], 'Slow open.', 'tommy@helios.test']);
  const ap = (await pg.query<{ decision: string }>(`SELECT decision FROM social_hub.approvals WHERE content_item_id = $1`, [itemId])).rows[0]!;
  assert.equal(ap.decision, 'rejected', 'the force approval became a rejection');
  const slot = (await pg.query<{ status: string; error: string }>(`SELECT status, error FROM social_hub.schedule`)).rows[0]!;
  assert.deepEqual([slot.status, slot.error], ['cancelled', REJECTED_SLOT_NOTE]);

  // A stray approval on the spine alone can't bring it back: the review's rejection still wins.
  await approveItem(q, itemId, 'auto');
  assert.equal(await scheduleApproved(explainersDb(pg), NOW), 0);
  assert.deepEqual(await publishReadiness(explainersDb(pg), e.job), { ok: false, note: 'This reel was rejected.' });
  assert.equal((await layer.place!({ jobId: e.job }, 'tommy', { nyDate: '2026-10-10', slot: 'late' })).note, 'It was rejected, so it can’t be scheduled.');

  // A reject without a review keeps the reviewer's tags and note.
  await layer.reject!({ jobId: e.job }, 'someone-else', undefined);
  const kept = (await getFeedback(explainersDb(pg), e.job))!;
  assert.deepEqual([kept.tags, kept.note], [['hook', 'pacing'], 'Slow open.']);
  await assert.rejects(setVerdict(explainersDb(pg), e.job, 'rejected', 'x', { tags: ['boring'] }), /unknown failure tag/);
});

// ── Carousel regenerate: the rerun queue (D51) ──────────────────────────────

test('carousel regenerate: the app writes a requested row; refusals are plain', async () => {
  const { pg, q } = await spineDb();
  const c = await carousel(pg, q, { storyId: 'story-r' });
  const queued = await requestRerun(q, c.postId, 'tommy@helios.test');
  assert.equal(queued.queued, true);
  const row = (await pg.query<{ post_id: string; story_id: string; status: string; requested_by: string }>(`SELECT post_id::text AS post_id, story_id, status, requested_by FROM social.rerun_requests`)).rows;
  assert.deepEqual(row, [{ post_id: c.postId, story_id: 'story-r', status: 'requested', requested_by: 'tommy@helios.test' }]);
  // One open rerun per story, whichever version asks.
  const newer = await carousel(pg, q, { storyId: 'story-r' });
  assert.deepEqual(await requestRerun(q, newer.postId, 'tommy'), { queued: false, note: 'A rerun of this story is already queued.' });
  const noBrief = await carousel(pg, q, { brief: false });
  assert.deepEqual(await requestRerun(q, noBrief.postId, 'tommy'), { queued: false, note: 'This carousel has no saved brief to rerun from.' });
  const dev = await carousel(pg, q, { origin: 'dev' });
  assert.deepEqual(await requestRerun(q, dev.postId, 'tommy'), { queued: false, note: 'Only carousels from the daily run can be regenerated here.' });
  const posted = await carousel(pg, q);
  await pg.query(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'carousels', 'approve', 'published', 'c')`, [posted.itemId]);
  assert.deepEqual(await requestRerun(q, posted.postId, 'tommy'), { queued: false, note: 'This carousel has already posted.' });
  assert.deepEqual(await requestRerun(q, '70000000-0000-4000-8000-0000000000ff', 'tommy'), { queued: false, note: 'The post is gone.' });
});

test('carousel regenerate: the worker claims a request once, as its own capped run, and never takes the nightly run’s place', async () => {
  const { pg, q } = await spineDb();
  const c = await carousel(pg, q, { storyId: 'story-w' });
  await requestRerun(q, c.postId, 'tommy');
  const claimed = await claimRerun(q, { capUsd: 2, hookPass: true }, NOW);
  assert.ok(claimed);
  assert.equal(claimed.postId, c.postId);
  assert.equal(await claimRerun(q, { capUsd: 2, hookPass: true }, NOW), null, 'claimed once');
  const run = (await pg.query<{ status: string; trigger: string; cap_usd: string; kind: string }>(`SELECT status, trigger, cap_usd::text AS cap_usd, kind FROM social.runs WHERE id = $1`, [claimed.runId])).rows[0]!;
  assert.deepEqual([run.status, run.trigger, Number(run.cap_usd), run.kind], ['running', 'manual', 2, 'daily']);

  // The nightly run can still be queued behind it, and waits for it.
  const nightly = await requestRun(q, 'scheduled', { capUsd: 2, hookPass: true });
  assert.ok(nightly, 'a queued rerun never takes the one queued place');
  assert.equal(await claimRun(q, NOW), null, 'nothing else runs while the rerun runs');

  // The script finishes the run with its ship list; the request is settled from it.
  const newPost = await carousel(pg, q, { storyId: 'story-w' });
  await pg.query(`UPDATE social.runs SET status = 'ok', finished_at = now(), ship_post_ids = $2::jsonb WHERE id = $1`, [claimed.runId, JSON.stringify([newPost.postId])]);
  assert.equal(await settleReruns(q, NOW), 1);
  const done = (await pg.query<{ status: string; new_post_id: string; error: string | null }>(`SELECT status, new_post_id::text AS new_post_id, error FROM social.rerun_requests`)).rows[0]!;
  assert.deepEqual(done, { status: 'ok', new_post_id: newPost.postId, error: null });

  // A rerun waits while a run is running; one that ships nothing fails with why.
  const d = await carousel(pg, q, { storyId: 'story-x' });
  await requestRerun(q, d.postId, 'tommy');
  assert.ok(await claimRun(q, NOW), 'the nightly run goes first');
  assert.equal(await claimRerun(q, { capUsd: 2, hookPass: true }, NOW), null);
  await pg.exec(`UPDATE social.runs SET status = 'ok' WHERE status = 'running'`);
  const second = (await claimRerun(q, { capUsd: 2, hookPass: true }, NOW))!;
  await pg.query(`UPDATE social.runs SET status = 'partial', stop_reason = 'out-of-stories', finished_at = now() WHERE id = $1`, [second.runId]);
  await settleReruns(q, NOW);
  const failed = (await pg.query<{ status: string; error: string }>(`SELECT status, error FROM social.rerun_requests WHERE id = $1`, [second.id])).rows[0]!;
  assert.deepEqual(failed, { status: 'failed', error: 'The rerun shipped no post (out-of-stories).' });
  // Applying the schema again over these rows changes nothing (additive, idempotent).
  const { readFileSync } = await import('node:fs');
  await pg.exec(readFileSync('db/social_schema.sql', 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n'));
  assert.equal((await pg.query(`SELECT 1 FROM social.rerun_requests`)).rows.length, 2);
});

test('carousel regenerate: the run makes the stored story again from its saved brief, Writer onward', async () => {
  const { pg, q } = await spineDb();
  const c = await carousel(pg, q, { storyId: 'story-a' });
  const story = (await loadRerunStory(q, c.postId))!;
  assert.equal(story.storyId, 'story-a');
  assert.equal(rerunCandidate(story).url, 'https://example.com');
  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const stages = rerunStages(createStubStages({ calls }), story);
  const result = await runDay({
    articles: [],
    stages,
    meter: createCostMeter({ capUsd: 2 }),
    log: createInMemorySetAsideLog(),
    now: NOW,
    targetPosts: 1,
  });
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0]!.storyId, 'story-a');
  assert.deepEqual(result.shipped, [{ storyId: 'story-a', reusedPostId: null }]);
  assert.deepEqual(calls.map((x) => x.stage), ['writer', 'editor', 'fact-checker', 'mechanical', 'design'], 'no selection, no Reporter');
  assert.equal(result.costByStage['jev-scoring'] ?? 0, 0);
  assert.equal(result.costByStage.reporter ?? 0, 0);
});

// ── Trial Reels regenerate: today's slate only (D52) ────────────────────────

test('Trial Reels regenerate: today’s slate for the idea, and its lock', async () => {
  const { pg } = await openHubTestDb();
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = { query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]) };
  const RUN = '80000000-0000-4000-8000-000000000001';
  const IDEA = '80000000-0000-4000-8000-000000000002';
  const OLD = '80000000-0000-4000-8000-000000000003';
  const TODAY = '80000000-0000-4000-8000-000000000004';
  const YESTERDAY = '80000000-0000-4000-8000-000000000005';
  const RUN2 = '80000000-0000-4000-8000-000000000006';
  await pg.exec(`
    INSERT INTO reels.runs (id, trigger, status) VALUES ('${RUN}', 'scheduled', 'ok'), ('${RUN2}', 'scheduled', 'ok');
    INSERT INTO reels.post_ideas (id) VALUES ('${IDEA}'), ('${OLD}');
    INSERT INTO reels.score_slates (id, run_id, ny_date, scored_at, pass1_version, pass2_version) VALUES
      ('${TODAY}', '${RUN}', '2026-10-08', '2026-10-08T05:30:00Z', 'p1', 'p2'),
      ('${YESTERDAY}', '${RUN2}', '2026-10-07', '2026-10-07T05:30:00Z', 'p1', 'p2');
    INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, components) VALUES ('${TODAY}', '${IDEA}', 'timely', '{}'::jsonb), ('${YESTERDAY}', '${OLD}', 'timely', '{}'::jsonb);`);
  assert.equal(await todaySlateFor(IDEA, NOW), TODAY);
  assert.equal(await todaySlateFor(OLD, NOW), null, 'yesterday’s idea is not rebuilt today (SH-59)');
  assert.equal(await findReelLock(TODAY, IDEA), null);
  await pg.exec(`INSERT INTO reels.reel_locks (ny_date, slot, post_idea_id, slate_id, note) VALUES ('2026-10-08', 1, '${IDEA}', '${TODAY}', 'Lucas')`);
  assert.deepEqual(await findReelLock(TODAY, IDEA), { nyDate: '2026-10-08', slot: 1 });
});
