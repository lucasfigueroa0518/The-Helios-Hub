// tests/slots-write.test.ts
/**
 * Slot writes on free-time keys (week board spec §Decisions 11/14, §Must
 * handle 1–4, §Calls I made): every change through rules.ts, a booked slot's
 * post moving with it (Review Focus 1), booked removals asking first, caps,
 * seeding on the first flip. Offline PGlite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { loadSlots, readCaps, readOverrides, readTemplate } from '@/lib/social-hub/slots/load';
import { LFD_CAROUSEL_CONFLICT } from '@/lib/social-hub/slots/resolve';
import { ALREADY_STARTED, PAST_DAY } from '@/lib/social-hub/slots/rules';
import { DEFAULT_SEED_INPUTS, seedTemplate, type SeedInputs } from '@/lib/social-hub/slots/seed';
import { DEFAULT_CAPS } from '@/lib/social-hub/slots/times';
import { legacyKey } from '@/lib/social-hub/slots/legacy';
import { applySlotChanges, parseChanges, setSlotSource, writeCaps, type SlotChange } from '@/lib/social-hub/slots/write';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-15T14:00:00Z'); // Thu Oct 15, 10:00 AM New York
const opts = { by: 't', now: NOW };

type Pg = Awaited<ReturnType<typeof openHubTestDb>>['pg'];

async function seeded(seed?: SeedInputs) {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 'tommy@example.com', seed);
  return { pg, q };
}

/** New York minute of the day of an instant. */
function nyMinute(at: Date | string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(at));
  return Number(parts.find((p) => p.type === 'hour')!.value) * 60 + Number(parts.find((p) => p.type === 'minute')!.value);
}

/** A waiting booking at `slot` (a slot id); publish_at defaults to the slot minute (EDT, UTC-4). */
async function book(pg: Pg, vertical: string, nyDate: string, slot: string, feedMode: string | null, nativeRef: string, publishAt?: string) {
  const format = vertical === 'stories' ? 'story' : vertical === 'carousels' || vertical === 'last_few_days' ? 'feed' : 'reel';
  const item = await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, $2, $3) RETURNING id`, [vertical, format, nativeRef]);
  const minute = Number(/^t(\d{4})/.exec(slot)?.[1] ?? 600);
  const at = publishAt ?? `${nyDate}T${String(Math.floor(minute / 60) + 4).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00Z`;
  const row = await pg.query<{ id: string }>(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
     VALUES ($1, $2, $3::date, $4, $5::timestamptz, 'scheduled', 'auto', $6) RETURNING id`,
    [item.rows[0]!.id, vertical, nyDate, slot, at, feedMode],
  );
  return { itemId: item.rows[0]!.id, scheduleId: row.rows[0]!.id };
}

const scheduleRow = async (pg: Pg, id: string) =>
  (await pg.query<{ ny_date: string; slot: string; publish_at: string; status: string; feed_mode: string | null }>(
    `SELECT ny_date::text AS ny_date, slot, publish_at, status, feed_mode FROM social_hub.schedule WHERE id = $1`, [id],
  )).rows[0]!;

const dayOf = async (q: never, nyDate: string, vertical?: string) =>
  ((await loadSlots(q, nyDate, nyDate)).get(nyDate) ?? []).filter((s) => !vertical || s.vertical === vertical).map((s) => (s.series ? `${s.startMinute}:${s.series}` : s.startMinute));

const dateMove = (nyDate: string, vertical: string, startMinute: number, to: { nyDate?: string; startMinute: number }, series: string | null = null) =>
  ({ scope: 'date', op: 'move', from: { nyDate, vertical, startMinute, series }, to: { nyDate: to.nyDate ?? nyDate, startMinute: to.startMinute } }) as SlotChange;

// ── Seeding ──

test('seeded counts the rows actually inserted, not the attempts', async () => {
  const { pg, query } = await openHubTestDb();
  const rows = seedTemplate(DEFAULT_SEED_INPUTS);
  // Another flip lands the first seed row between the empty check and this one's insert.
  let raced = false;
  const q = (async (text: string, params?: unknown[]) => {
    if (!raced && text.includes('INSERT INTO social_hub.slot_template')) {
      raced = true;
      const r = rows[0]!;
      await pg.query(`INSERT INTO social_hub.slot_template (weekday, vertical, start_minute, series, feed_mode, updated_by) VALUES ($1, $2, $3, $4, $5, 'other')`, [r.weekday, r.vertical, r.startMinute, r.series, r.feedMode]);
    }
    return query(text, params);
  }) as never;
  const out = await setSlotSource(q, 'template', 'tommy@example.com', DEFAULT_SEED_INPUTS);
  assert.equal(out.seeded, rows.length - 1);
  assert.equal((await readTemplate(query as never)).length, rows.length);
});

test('the first flip to template seeds the default times; later flips do not reseed', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  const first = await setSlotSource(q, 'template', 'tommy@example.com');
  assert.equal(first.seeded, seedTemplate(DEFAULT_SEED_INPUTS).length);
  assert.deepEqual(await dayOf(q, '2026-10-19', 'explainers'), [780, 930]);
  assert.deepEqual(await dayOf(q, '2026-10-19', 'stories'), ['510:guess_the_number', '510:morning_download']);
  const n = (await readTemplate(q)).length;
  await pg.query(`DELETE FROM social_hub.slot_template WHERE vertical = 'reels' AND weekday = 0`);
  await setSlotSource(q, 'legacy', 'tommy@example.com');
  assert.equal((await setSlotSource(q, 'template', 'tommy@example.com')).seeded, 0);
  assert.equal((await readTemplate(q)).length, n - 3);
});

// ── Puts, deletes and the rules ──

test('a template put and delete work at a free minute (12:00 PM)', async () => {
  const { q } = await seeded();
  const put = await applySlotChanges(q, [{ scope: 'template', op: 'put', weekday: 3, vertical: 'explainers', startMinute: 720, series: null, feedMode: 'main' }], opts);
  assert.equal(put.ok, true);
  assert.deepEqual((put as { minutes: unknown[] }).minutes, [720]);
  assert.ok((await readTemplate(q)).some((r) => r.weekday === 3 && r.vertical === 'explainers' && r.startMinute === 720 && r.feedMode === 'main'));
  assert.deepEqual(await dayOf(q, '2026-10-21', 'explainers'), [720, 780, 930]);
  const del = await applySlotChanges(q, [{ scope: 'template', op: 'delete', weekday: 3, vertical: 'explainers', startMinute: 720, series: null }], opts);
  assert.equal(del.ok, true);
  assert.deepEqual(await dayOf(q, '2026-10-21', 'explainers'), [780, 930]);
});

test('a second slot of one type at the same minute is refused; a Stories series twice a day at different times is allowed', async () => {
  const { q } = await seeded();
  const dup = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'explainers', startMinute: 780, series: null, action: 'add', feedMode: 'trial' }], opts);
  assert.equal(dup.ok, true, 'a put on an existing key changes its Trial / Main');
  assert.equal(((await loadSlots(q, '2026-10-21', '2026-10-21')).get('2026-10-21') ?? []).find((s) => s.vertical === 'explainers' && s.startMinute === 780)!.feedMode, 'trial');
  const moveOnto = await applySlotChanges(q, [dateMove('2026-10-21', 'explainers', 930, { startMinute: 780 })], opts);
  assert.equal((moveOnto as { status: number }).status, 422);
  const twice = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'stories', startMinute: 900, series: 'morning_download', action: 'add' }], opts);
  assert.equal(twice.ok, true);
  assert.deepEqual(await dayOf(q, '2026-10-21', 'stories'), ['510:morning_download', '900:morning_download']);
});

test('a Carousel on a Last Few Days day is refused (template)', async () => {
  const { q } = await seeded();
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'put', weekday: 2, vertical: 'carousels', startMinute: 600, series: null }], opts);
  assert.deepEqual(out, { ok: false, status: 422, errors: [LFD_CAROUSEL_CONFLICT] });
});

test('Last Few Days on a Carousel day asks first; the yes removes that day\'s Carousels', async () => {
  const { q } = await seeded();
  const change: SlotChange = { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'last_few_days', startMinute: 540, series: null, action: 'add' };
  const ask = await applySlotChanges(q, [change], opts);
  assert.equal((ask as { status: number }).status, 422);
  assert.equal((ask as { confirm?: string }).confirm, 'remove-carousels');
  const yes = await applySlotChanges(q, [{ ...change, clearCarousels: true } as SlotChange], opts);
  assert.equal(yes.ok, true);
  assert.deepEqual(await dayOf(q, '2026-10-21', 'carousels'), []);
  assert.deepEqual(await dayOf(q, '2026-10-21', 'last_few_days'), [540]);
  // The override rows say exactly that: LFD added, both Carousels removed.
  const rows = (await readOverrides(q, '2026-10-21', '2026-10-21')).map((o) => `${o.vertical}@${o.startMinute}:${o.action}`).sort();
  assert.deepEqual(rows, ['carousels@540:remove', 'carousels@870:remove', 'last_few_days@540:add']);
});

test('a template edit that breaks a future override date is refused', async () => {
  const { q } = await seeded();
  const setup = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-28', vertical: 'last_few_days', startMinute: 540, series: null, action: 'add', clearCarousels: true }], opts);
  assert.equal(setup.ok, true);
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'put', weekday: 3, vertical: 'carousels', startMinute: 600, series: null }], opts);
  assert.equal((out as { status: number }).status, 422);
  assert.ok((out as { errors: string[] }).errors.some((e) => e.startsWith('2026-10-28') && e.includes(LFD_CAROUSEL_CONFLICT)));
});

test('past dates and slots already started today are read-only', async () => {
  const { q } = await seeded();
  const past = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-14', vertical: 'reels', startMinute: 1080, series: null, action: 'remove' }], opts);
  assert.deepEqual(past, { ok: false, status: 422, errors: [PAST_DAY] });
  // 10:00 AM: the 8:45 reel has started; the 6:00 PM one hasn't.
  const started = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-15', vertical: 'reels', startMinute: 525, series: null, action: 'remove' }], opts);
  assert.deepEqual(started, { ok: false, status: 422, errors: [ALREADY_STARTED] });
  const movedStarted = await applySlotChanges(q, [dateMove('2026-10-15', 'reels', 525, { startMinute: 1200 })], opts);
  assert.deepEqual(movedStarted, { ok: false, status: 422, errors: [ALREADY_STARTED] });
  const later = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-15', vertical: 'reels', startMinute: 1080, series: null, action: 'remove' }], opts);
  assert.equal(later.ok, true);
});

test('a move onto a time already passed today lands at the next 15-minute mark (10:00 AM → 10:15)', async () => {
  const { q } = await seeded();
  const out = await applySlotChanges(q, [dateMove('2026-10-15', 'explainers', 780, { startMinute: 540 })], opts);
  assert.equal(out.ok, true);
  assert.deepEqual((out as { minutes: unknown[] }).minutes, [615]);
  assert.deepEqual(await dayOf(q, '2026-10-15', 'explainers'), [615, 930]);
});

test('a date reset (op delete) brings the standard slot back', async () => {
  const { q } = await seeded();
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'reels', startMinute: 1080, series: null, action: 'remove' }], opts);
  assert.deepEqual(await dayOf(q, '2026-10-21', 'reels'), [525, 675]);
  const out = await applySlotChanges(q, [{ scope: 'date', op: 'delete', nyDate: '2026-10-21', vertical: 'reels', startMinute: 1080, series: null }], opts);
  assert.equal(out.ok, true);
  assert.deepEqual(await dayOf(q, '2026-10-21', 'reels'), [525, 675, 1080]);
  assert.deepEqual(await readOverrides(q, '2026-10-21', '2026-10-21'), []);
});

// ── "Make it every <weekday>" applies only that change ──

test('"Make it every Tuesday" (template put) applies only that slot, not the whole edited day', async () => {
  const { q } = await seeded();
  // Tue Oct 20 is edited: its 6:00 PM reel is removed for that date only.
  await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'reels', startMinute: 1080, series: null, action: 'remove' }], opts);
  const before = (await readTemplate(q)).filter((r) => r.weekday === 2);
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'put', weekday: 2, vertical: 'explainers', startMinute: 720, series: null, feedMode: 'main' }], opts);
  assert.equal(out.ok, true);
  const after = (await readTemplate(q)).filter((r) => r.weekday === 2);
  assert.equal(after.length, before.length + 1);
  assert.ok(after.some((r) => r.vertical === 'reels' && r.startMinute === 1080), 'the date-only removal did not spread to the template');
  assert.deepEqual((await readOverrides(q, '2026-10-20', '2026-10-20')).map((o) => [o.vertical, o.startMinute, o.action]), [['reels', 1080, 'remove']]);
});

test('"Make it every Tuesday" for a move (template move) moves only that slot', async () => {
  const { q } = await seeded();
  const before = (await readTemplate(q)).filter((r) => r.weekday === 2 && r.vertical !== 'explainers').length;
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'move', from: { weekday: 2, vertical: 'explainers', startMinute: 780, series: null }, to: { weekday: 2, startMinute: 720 } }], opts);
  assert.equal(out.ok, true);
  const after = (await readTemplate(q)).filter((r) => r.weekday === 2);
  assert.deepEqual(after.filter((r) => r.vertical === 'explainers').map((r) => r.startMinute).sort(), [720, 930]);
  assert.equal(after.filter((r) => r.vertical !== 'explainers').length, before);
  assert.deepEqual(await dayOf(q, '2026-10-27', 'explainers'), [720, 930]);
});

// ── A booked slot's post moves with it (Review Focus 1) ──

test('moving a booked Explainer 1:00 → 12:00 PM on Tue reschedules its post into [12:00, 12:15], same day, no 409', async () => {
  const { pg, q } = await seeded();
  const b = await book(pg, 'explainers', '2026-10-20', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
  const out = await applySlotChanges(q, [dateMove('2026-10-20', 'explainers', 780, { startMinute: 720 })], opts);
  assert.equal(out.ok, true, JSON.stringify(out));
  const row = await scheduleRow(pg, b.scheduleId);
  assert.equal(row.ny_date, '2026-10-20');
  assert.equal(row.slot, 't0720');
  assert.equal(row.status, 'scheduled');
  const m = nyMinute(row.publish_at);
  assert.ok(m >= 720 && m <= 735, `publish_at minute ${m}`);
  assert.deepEqual((out as { rescheduled: Array<{ scheduleId: string }> }).rescheduled.map((r) => r.scheduleId), [b.scheduleId]);
  assert.deepEqual(await dayOf(q, '2026-10-20', 'explainers'), [720, 930]);
});

test('the drift minute comes from the rng: 0 → the slot time, 15 → slot + 15', async () => {
  for (const [pick, want] of [[0, 720], [15, 735]] as const) {
    const { pg, q } = await seeded();
    const b = await book(pg, 'explainers', '2026-10-20', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
    const out = await applySlotChanges(q, [dateMove('2026-10-20', 'explainers', 780, { startMinute: 720 })], { ...opts, rng: () => pick });
    assert.equal(out.ok, true);
    assert.equal(nyMinute((await scheduleRow(pg, b.scheduleId)).publish_at), want);
  }
});

test('a moved Main-feed post keeps 30 minutes from other feed posts (pushed later by the smallest amount)', async () => {
  const { pg, q } = await seeded();
  const b = await book(pg, 'explainers', '2026-10-20', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
  // A Carousel already posting at 12:05 PM that day.
  await book(pg, 'carousels', '2026-10-20', 't0720', null, '66666666-6666-6666-6666-666666666666', '2026-10-20T16:05:00Z');
  const out = await applySlotChanges(q, [dateMove('2026-10-20', 'explainers', 780, { startMinute: 720 })], { ...opts, rng: () => 0 });
  assert.equal(out.ok, true);
  assert.equal(nyMinute((await scheduleRow(pg, b.scheduleId)).publish_at), 755, '12:05 + 30 = 12:35 PM');
});

test('a cross-day move of a booked Carousel Tue → Thu reschedules it to Thu', async () => {
  // LFD only on Fridays here, so Tuesday has Carousels.
  const { pg, q } = await seeded({ ...DEFAULT_SEED_INPUTS, lfdDays: [5] });
  const b = await book(pg, 'carousels', '2026-10-20', 't0870', null, '11111111-1111-1111-1111-111111111111');
  const out = await applySlotChanges(q, [dateMove('2026-10-20', 'carousels', 870, { nyDate: '2026-10-22', startMinute: 900 })], opts);
  assert.equal(out.ok, true, JSON.stringify(out));
  const row = await scheduleRow(pg, b.scheduleId);
  assert.equal(row.ny_date, '2026-10-22');
  assert.equal(row.slot, 't0900');
  assert.equal(row.status, 'scheduled');
  const m = nyMinute(row.publish_at);
  assert.ok(m >= 900 && m <= 915, `publish_at minute ${m}`);
  assert.deepEqual(await dayOf(q, '2026-10-20', 'carousels'), [540]);
  assert.deepEqual(await dayOf(q, '2026-10-22', 'carousels'), [540, 870, 900]);
});

test('a "Make it every Tuesday" move takes the upcoming Tuesdays\' booked posts with it', async () => {
  const { pg, q } = await seeded();
  const b = await book(pg, 'explainers', '2026-10-27', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'move', from: { weekday: 2, vertical: 'explainers', startMinute: 780, series: null }, to: { weekday: 2, startMinute: 720 } }], opts);
  assert.equal(out.ok, true, JSON.stringify(out));
  const row = await scheduleRow(pg, b.scheduleId);
  assert.deepEqual([row.ny_date, row.slot], ['2026-10-27', 't0720']);
});

test('a booked Stories slot can\'t move from here: 409, nothing changes', async () => {
  const { pg, q } = await seeded();
  const b = await book(pg, 'stories', '2026-10-20', 't0510:morning_download', null, '77777777-7777-7777-7777-777777777777');
  const out = await applySlotChanges(q, [dateMove('2026-10-20', 'stories', 510, { startMinute: 600 }, 'morning_download')], opts);
  assert.equal((out as { status: number }).status, 409);
  const booked = (out as { booked: Array<{ scheduleId: string; why: string }> }).booked;
  assert.deepEqual(booked.map((x) => [x.scheduleId, x.why]), [[b.scheduleId, 'cannot-move']]);
  assert.equal((await scheduleRow(pg, b.scheduleId)).slot, 't0510:morning_download');
  assert.deepEqual(await readOverrides(q, '2026-10-20', '2026-10-20'), []);
});

// ── Removing a booked slot asks first (decision 14) ──

test('removing a booked slot returns 409 with its refs, and nothing changes (booking and approval intact)', async () => {
  const { pg, q } = await seeded();
  const b = await book(pg, 'carousels', '2026-10-21', 't0540', null, '11111111-1111-1111-1111-111111111111');
  await pg.query(`INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ($1, 'approved', 'user')`, [b.itemId]);
  const out = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'carousels', startMinute: 540, series: null, action: 'remove' }], opts);
  assert.equal((out as { status: number }).status, 409);
  const booked = (out as { booked: Array<{ scheduleId: string; nyDate: string; slot: string; refs: Record<string, string>; why: string }> }).booked;
  assert.deepEqual(booked.map((x) => [x.scheduleId, x.nyDate, x.slot, x.refs, x.why]), [[b.scheduleId, '2026-10-21', 't0540', { postId: '11111111-1111-1111-1111-111111111111' }, 'removed']]);
  assert.equal((await scheduleRow(pg, b.scheduleId)).status, 'scheduled');
  assert.equal((await pg.query(`SELECT 1 FROM social_hub.approvals WHERE content_item_id = $1 AND decision = 'approved'`, [b.itemId])).rows.length, 1);
  assert.deepEqual(await readOverrides(q, '2026-10-21', '2026-10-21'), []);
  assert.deepEqual(await dayOf(q, '2026-10-21', 'carousels'), [540, 870]);
});

test('a template delete with a booked post 13 days out returns 409 with its refs', async () => {
  const { pg, q } = await seeded();
  await book(pg, 'carousels', '2026-10-28', 't0870', null, '11111111-1111-1111-1111-111111111111');
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'delete', weekday: 3, vertical: 'carousels', startMinute: 870, series: null }], opts);
  assert.equal((out as { status: number }).status, 409);
  assert.deepEqual((out as { booked: Array<{ nyDate: string; refs: unknown }> }).booked.map((x) => [x.nyDate, x.refs]), [['2026-10-28', { postId: '11111111-1111-1111-1111-111111111111' }]]);
});

// ── Bookings made before the cutover (legacy window ids) ──

test('a legacy "afternoon" Explainer booking is in the way when the 1:00 PM slot goes, and moves (slot t0720) when it moves', async () => {
  const { pg, q } = await seeded();
  const b = await book(pg, 'explainers', '2026-10-20', 'afternoon', null, '22222222-2222-2222-2222-222222222222', '2026-10-20T17:05:00Z');
  const removed = await applySlotChanges(q, [{ scope: 'template', op: 'delete', weekday: 2, vertical: 'explainers', startMinute: 780, series: null }], opts);
  assert.equal((removed as { status: number }).status, 409);
  assert.deepEqual((removed as { booked: Array<{ scheduleId: string; slot: string; why: string; refs: unknown }> }).booked.map((x) => [x.scheduleId, x.slot, x.why, x.refs]), [[b.scheduleId, 'afternoon', 'removed', { jobId: '22222222-2222-2222-2222-222222222222' }]]);
  const moved = await applySlotChanges(q, [dateMove('2026-10-20', 'explainers', 780, { startMinute: 720 })], opts);
  assert.equal(moved.ok, true, JSON.stringify(moved));
  const row = await scheduleRow(pg, b.scheduleId);
  assert.deepEqual([row.ny_date, row.slot], ['2026-10-20', 't0720']);
  const m = nyMinute(row.publish_at);
  assert.ok(m >= 720 && m <= 735, `publish_at minute ${m}`);
});

test('legacyKey maps each type\'s window ids to their start minutes', () => {
  assert.deepEqual(['morning', 'midday', 'evening'].map((w) => legacyKey('reels', w)!.startMinute), [525, 675, 1080]);
  assert.deepEqual(['afternoon', 'late'].map((w) => legacyKey('explainers', w)!.startMinute), [780, 930]);
  assert.deepEqual(['morning', 'afternoon'].map((w) => legacyKey('carousels', w)!.startMinute), [540, 870]);
  assert.deepEqual(legacyKey('last_few_days', 'morning'), { startMinute: 540, series: null });
  assert.deepEqual(legacyKey('stories', 'free_vs_paid'), { startMinute: 510, series: 'free_vs_paid' });
  assert.equal(legacyKey('reels', 'late'), null);
  assert.equal(legacyKey('stories', 'morning'), null);
});

test('a cross-weekday "every" move takes a booking to that weekday\'s date in the same week (Tue Oct 27 → Thu Oct 29)', async () => {
  const { pg, q } = await seeded();
  const b = await book(pg, 'explainers', '2026-10-27', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'move', from: { weekday: 2, vertical: 'explainers', startMinute: 780, series: null }, to: { weekday: 4, startMinute: 720 } }], opts);
  assert.equal(out.ok, true, JSON.stringify(out));
  const row = await scheduleRow(pg, b.scheduleId);
  assert.deepEqual([row.ny_date, row.slot], ['2026-10-29', 't0720']);
});

test('a Standard-week move Sat → Sun takes Saturday bookings to the next day, in the board\'s Monday-first week (final review #2)', async () => {
  const { pg, q } = await seeded();
  const a = await book(pg, 'explainers', '2026-10-17', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
  const b = await book(pg, 'explainers', '2026-10-24', 't0780', 'main', '33333333-3333-3333-3333-333333333333');
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'move', from: { weekday: 6, vertical: 'explainers', startMinute: 780, series: null }, to: { weekday: 0, startMinute: 720 } }], opts);
  assert.equal(out.ok, true, JSON.stringify(out));
  const ra = await scheduleRow(pg, a.scheduleId);
  const rb = await scheduleRow(pg, b.scheduleId);
  assert.deepEqual([ra.ny_date, ra.slot], ['2026-10-18', 't0720'], 'Sat Oct 17 → Sun Oct 18, not Sun Oct 11');
  assert.deepEqual([rb.ny_date, rb.slot], ['2026-10-25', 't0720']);
});

test('a Standard-week move Thu → Tue on a Thursday: today\'s booking keeps its slot, next Thursday\'s moves to next Tuesday (final review #2)', async () => {
  const { pg, q } = await seeded();
  const today = await book(pg, 'explainers', '2026-10-15', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
  const next = await book(pg, 'explainers', '2026-10-22', 't0780', 'main', '33333333-3333-3333-3333-333333333333');
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'move', from: { weekday: 4, vertical: 'explainers', startMinute: 780, series: null }, to: { weekday: 2, startMinute: 720 } }], opts);
  assert.equal(out.ok, true, JSON.stringify(out));
  const rt = await scheduleRow(pg, today.scheduleId);
  assert.deepEqual([rt.ny_date, rt.slot, rt.status], ['2026-10-15', 't0780', 'scheduled'], 'Tue Oct 13 has passed: no Move-it-back, the post stays');
  assert.ok((await dayOf(q, '2026-10-15', 'explainers')).includes(780), 'this Thursday keeps the 1:00 PM slot');
  const rn = await scheduleRow(pg, next.scheduleId);
  assert.deepEqual([rn.ny_date, rn.slot], ['2026-10-20', 't0720']);
  assert.ok(!(await dayOf(q, '2026-10-22', 'explainers')).includes(780), 'later Thursdays follow the Standard week');
});

test('a feed-gap push stays on the slot\'s own day: nothing clears before 9 PM → 422, nothing written', async () => {
  const { pg, q } = await seeded();
  const b = await book(pg, 'explainers', '2026-10-20', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
  // A feed post at 8:50 PM: every minute from 8:45 to 8:59 PM is within 30 minutes of it.
  await book(pg, 'carousels', '2026-10-20', 't1245', null, '66666666-6666-6666-6666-666666666666', '2026-10-21T00:50:00Z');
  const out = await applySlotChanges(q, [dateMove('2026-10-20', 'explainers', 780, { startMinute: 1245 })], opts);
  assert.equal((out as { status: number }).status, 422, JSON.stringify(out));
  assert.match((out as { errors: string[] }).errors[0]!, /within 30 minutes of another feed post/);
  assert.equal((await scheduleRow(pg, b.scheduleId)).slot, 't0780');
  assert.deepEqual(await dayOf(q, '2026-10-20', 'explainers'), [780, 930]);
});

test('a moved post whose new slot id another post already holds returns 409 "That slot is taken." and writes nothing', async () => {
  const { pg, q } = await seeded();
  const b = await book(pg, 'explainers', '2026-10-20', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
  await book(pg, 'explainers', '2026-10-20', 't0720', 'main', '88888888-8888-8888-8888-888888888888');
  const out = await applySlotChanges(q, [dateMove('2026-10-20', 'explainers', 780, { startMinute: 720 })], opts);
  assert.deepEqual(out, { ok: false, status: 409, error: 'That slot is taken.' });
  assert.equal((await scheduleRow(pg, b.scheduleId)).slot, 't0780');
  assert.deepEqual(await readOverrides(q, '2026-10-20', '2026-10-20'), []);
});

test('a batch that fails part-way writes nothing (an earlier valid change is not kept)', async () => {
  const { pg, q } = await seeded();
  const b = await book(pg, 'explainers', '2026-10-21', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
  const snapshot = async () => [
    (await pg.query(`SELECT weekday, vertical, start_minute, series, feed_mode FROM social_hub.slot_template ORDER BY 1, 2, 3, 4`)).rows,
    (await pg.query(`SELECT * FROM social_hub.slot_override ORDER BY ny_date, vertical, start_minute`)).rows,
    (await pg.query(`SELECT id, ny_date, slot, publish_at, status FROM social_hub.schedule ORDER BY id`)).rows,
  ];
  const before = await snapshot();
  const out = await applySlotChanges(q, [
    { scope: 'template', op: 'put', weekday: 1, vertical: 'explainers', startMinute: 720, series: null, feedMode: 'main' },
    dateMove('2026-10-21', 'explainers', 780, { startMinute: 720 }),
    { scope: 'date', op: 'put', nyDate: '2026-10-14', vertical: 'reels', startMinute: 1080, series: null, action: 'remove' },
  ], opts);
  assert.deepEqual(out, { ok: false, status: 422, errors: [PAST_DAY] });
  assert.deepEqual(await snapshot(), before);
  assert.equal((await scheduleRow(pg, b.scheduleId)).slot, 't0780');
});

test('flipping Trial / Main on a booked reel asks first; the same mode does not', async () => {
  const { pg, q } = await seeded();
  await book(pg, 'explainers', '2026-10-20', 't0780', 'main', '22222222-2222-2222-2222-222222222222');
  const flip = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'explainers', startMinute: 780, series: null, action: 'add', feedMode: 'trial' }], opts);
  assert.equal((flip as { status: number }).status, 409);
  assert.equal((flip as { booked: Array<{ why: string }> }).booked[0]!.why, 'feed-mode');
  const same = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'explainers', startMinute: 780, series: null, action: 'add', feedMode: 'main' }], opts);
  assert.equal(same.ok, true);
});

test('a booked reel reports its idea as the ref (native_ref is the video job)', async () => {
  const { pg, q } = await seeded();
  await book(pg, 'reels', '2026-10-22', 't1080', 'trial', '33333333-3333-3333-3333-333333333333');
  await pg.query(`UPDATE social_hub.schedule SET idea_ref = '44444444-4444-4444-4444-444444444444' WHERE vertical = 'reels'`);
  const out = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-22', vertical: 'reels', startMinute: 1080, series: null, action: 'remove' }], opts);
  assert.equal((out as { status: number }).status, 409);
  assert.deepEqual((out as { booked: Array<{ refs: unknown }> }).booked.map((b) => b.refs), [{ postIdeaId: '44444444-4444-4444-4444-444444444444' }]);
});

// ── A weekly edit made today leaves today's started slots alone ──

const TUE_10AM = new Date('2026-10-20T14:00:00Z'); // Tue Oct 20, 10:00 AM New York: the 8:45 reel started, 6:00 PM not
const tue = { by: 't', now: TUE_10AM };

test('"Every Tuesday" removing a slot started today: the template changes, today keeps it, next Tuesday does not', async () => {
  const { q } = await seeded();
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'delete', weekday: 2, vertical: 'reels', startMinute: 525, series: null }], tue);
  assert.equal(out.ok, true);
  assert.equal((await readTemplate(q)).some((r) => r.weekday === 2 && r.vertical === 'reels' && r.startMinute === 525), false);
  assert.deepEqual(await readOverrides(q, '2026-10-20', '2026-10-20'), [{ nyDate: '2026-10-20', vertical: 'reels', startMinute: 525, series: null, action: 'add', feedMode: 'trial' }]);
  assert.deepEqual(await dayOf(q, '2026-10-20', 'reels'), [525, 675, 1080]);
  assert.deepEqual(await dayOf(q, '2026-10-27', 'reels'), [675, 1080]);
});

test('"Every Tuesday" adding a slot at a time already started today writes a remove for today', async () => {
  const { q } = await seeded();
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'put', weekday: 2, vertical: 'reels', startMinute: 600, series: null, feedMode: 'main' }], tue);
  assert.equal(out.ok, true);
  assert.deepEqual(await readOverrides(q, '2026-10-20', '2026-10-20'), [{ nyDate: '2026-10-20', vertical: 'reels', startMinute: 600, series: null, action: 'remove', feedMode: null }]);
  assert.deepEqual(await dayOf(q, '2026-10-27', 'reels'), [525, 600, 675, 1080]);
});

test('"Every Tuesday" on a slot that has not started today: today follows the template, no override', async () => {
  const { q } = await seeded();
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'put', weekday: 2, vertical: 'reels', startMinute: 1080, series: null, feedMode: 'main' }], tue);
  assert.equal(out.ok, true);
  assert.deepEqual(await readOverrides(q, '2026-10-20', '2026-10-20'), []);
  assert.equal(((await loadSlots(q, '2026-10-20', '2026-10-20')).get('2026-10-20') ?? []).find((s) => s.vertical === 'reels' && s.startMinute === 1080)!.feedMode, 'main');
});

test('an override already on today\'s started slot is left untouched by an "Every Tuesday" edit', async () => {
  const { pg, q } = await seeded();
  await pg.query(`INSERT INTO social_hub.slot_override (ny_date, vertical, start_minute, action, feed_mode, updated_by) VALUES ('2026-10-20', 'reels', 525, 'add', 'main', 'earlier')`);
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'delete', weekday: 2, vertical: 'reels', startMinute: 525, series: null }], tue);
  assert.equal(out.ok, true);
  const rows = await pg.query<{ action: string; feed_mode: string; updated_by: string }>(`SELECT action, feed_mode, updated_by FROM social_hub.slot_override WHERE ny_date = '2026-10-20'`);
  assert.deepEqual(rows.rows, [{ action: 'add', feed_mode: 'main', updated_by: 'earlier' }]);
});

test('a booking in today\'s started slot is not in the way of an "Every Tuesday" remove', async () => {
  const { pg, q } = await seeded();
  await book(pg, 'reels', '2026-10-20', 't0525', 'trial', '55555555-5555-5555-5555-555555555555');
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'delete', weekday: 2, vertical: 'reels', startMinute: 525, series: null }], tue);
  assert.equal(out.ok, true);
});

test('a no-op "Every Tuesday" edit on a started slot writes no hold for today', async () => {
  const { q } = await seeded();
  const out = await applySlotChanges(q, [
    { scope: 'template', op: 'put', weekday: 2, vertical: 'reels', startMinute: 525, series: null, feedMode: 'trial' },
    { scope: 'template', op: 'delete', weekday: 2, vertical: 'carousels', startMinute: 540, series: null },
  ], tue);
  assert.equal(out.ok, true);
  assert.deepEqual(await readOverrides(q, '2026-10-20', '2026-10-20'), []);
});

// ── Caps ──

test('readCaps returns the defaults; writeCaps merges and validates 0–10', async () => {
  const { q } = await seeded();
  assert.deepEqual(await readCaps(q), DEFAULT_CAPS);
  await writeCaps(q, { explainers: 4 });
  assert.deepEqual(await readCaps(q), { ...DEFAULT_CAPS, explainers: 4 });
  await writeCaps(q, { stories: 1 });
  assert.deepEqual(await readCaps(q), { ...DEFAULT_CAPS, explainers: 4, stories: 1 });
  await assert.rejects(() => writeCaps(q, { explainers: 11 }));
  await assert.rejects(() => writeCaps(q, { explainers: 1.5 }));
  await assert.rejects(() => writeCaps(q, { nope: 2 } as never));
  assert.equal((await readCaps(q)).explainers, 4);
});

// ── Parsing ──

test('parseChanges reads the new keys and rejects junk with a 400 message', () => {
  const ok = parseChanges({ changes: [
    { scope: 'template', op: 'put', weekday: 1, vertical: 'reels', startMinute: 540, series: null, feedMode: 'trial' },
    { scope: 'date', op: 'move', from: { nyDate: '2026-10-20', vertical: 'stories', startMinute: 510, series: 'morning_download' }, to: { startMinute: 600 } },
    { scope: 'template', op: 'delete', weekday: 1, vertical: 'stories', startMinute: 510, series: 'guess_the_number' },
  ] });
  assert.ok(Array.isArray(ok));
  assert.deepEqual((ok as SlotChange[])[1], { scope: 'date', op: 'move', from: { nyDate: '2026-10-20', vertical: 'stories', startMinute: 510, series: 'morning_download' }, to: { nyDate: '2026-10-20', startMinute: 600 } });
  for (const bad of [
    { scope: 'template', op: 'put', weekday: 9, vertical: 'reels', startMinute: 540, series: null },
    { scope: 'date', op: 'put', nyDate: 'tomorrow', vertical: 'reels', startMinute: 540, series: null, action: 'add' },
    { scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'reels', startMinute: 'noon', series: null, action: 'add' },
    { scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'reels', startMinute: 540, series: null, action: 'add', feedMode: 'sideways' },
    { scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'stories', startMinute: 510, series: 'nope', action: 'add' },
    { scope: 'date', op: 'move', from: { nyDate: '2026-10-20', vertical: 'reels', startMinute: 540, series: null }, to: {} },
    { scope: 'template', op: 'put', weekday: 1, vertical: 'reels', windowId: 'morning', feedMode: 'trial' },
  ]) assert.equal(typeof parseChanges({ changes: [bad] }), 'string', JSON.stringify(bad));
  assert.equal(typeof parseChanges({ changes: [] }), 'string');
  assert.equal(typeof parseChanges({ changes: [null] }), 'string');
  assert.equal(typeof parseChanges({ changes: [1] }), 'string');
  assert.equal(typeof parseChanges({ changes: [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'reels', startMinute: 541, series: null, action: 'add' }] }), 'string', 'off the 15-minute grid');
  assert.equal(typeof parseChanges(null), 'string');
});
