// tests/slots-write.test.ts
/** Slot writes (spec §4): validation, booked-post 409s, keep, seeding on the first flip. Offline PGlite. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { applySlotChanges, parseChanges, setSlotSource } from '@/lib/social-hub/slots/write';
import { readTemplate } from '@/lib/social-hub/slots/load';
import { LFD_CAROUSEL_CONFLICT } from '@/lib/social-hub/slots/resolve';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const NOW = new Date('2026-10-15T14:00:00Z'); // Thu Oct 15, 10:00 AM New York

async function seeded() {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  await setSlotSource(q, 'template', 'tommy@example.com');
  return { pg, q };
}

async function book(pg: Awaited<ReturnType<typeof openHubTestDb>>['pg'], vertical: string, nyDate: string, slot: string, feedMode: string | null, nativeRef: string) {
  const format = vertical === 'stories' ? 'story' : vertical === 'carousels' || vertical === 'last_few_days' ? 'feed' : 'reel';
  const item = await pg.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ($1, $2, $3) RETURNING id`, [vertical, format, nativeRef]);
  await pg.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, feed_mode)
     VALUES ($1, $2, $3::date, $4, ($3 || 'T14:00:00Z')::timestamptz, 'scheduled', 'auto', $5)`,
    [item.rows[0]!.id, vertical, nyDate, slot, feedMode],
  );
}

test('the first flip to template seeds from current settings; later flips do not reseed', async () => {
  const { pg, query } = await openHubTestDb();
  const q = query as never;
  const first = await setSlotSource(q, 'template', 'tommy@example.com');
  assert.ok(first.seeded > 0);
  const n = (await readTemplate(q)).length;
  await pg.query(`DELETE FROM social_hub.slot_template WHERE vertical = 'reels' AND weekday = 0`);
  await setSlotSource(q, 'legacy', 'tommy@example.com');
  assert.equal((await setSlotSource(q, 'template', 'tommy@example.com')).seeded, 0);
  assert.equal((await readTemplate(q)).length, n - 3);
});

test('a template put validates the weekday: Carousel on an LFD day is refused', async () => {
  const { q } = await seeded();
  const out = await applySlotChanges(q, [{ scope: 'template', op: 'put', weekday: 2, vertical: 'carousels', windowId: 'morning', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  assert.deepEqual(out, { ok: false, status: 422, errors: [LFD_CAROUSEL_CONFLICT] });
});

test('LFD on Wednesday plus removing that day\'s Carousels in one request is accepted', async () => {
  const { q } = await seeded();
  const out = await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'last_few_days', windowId: 'morning', action: 'add', feedMode: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'carousels', windowId: 'morning', action: 'remove', feedMode: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-21', vertical: 'carousels', windowId: 'afternoon', action: 'remove', feedMode: null },
  ], { by: 't', now: NOW, keepBooked: false });
  assert.deepEqual(out, { ok: true });
});

test('a template edit that breaks a future override date is refused', async () => {
  const { q } = await seeded();
  await applySlotChanges(q, [
    { scope: 'date', op: 'put', nyDate: '2026-10-28', vertical: 'last_few_days', windowId: 'morning', action: 'add', feedMode: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-28', vertical: 'carousels', windowId: 'morning', action: 'remove', feedMode: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-28', vertical: 'carousels', windowId: 'afternoon', action: 'remove', feedMode: null },
  ], { by: 't', now: NOW, keepBooked: false });
  // Deleting the override that removed Oct 28's morning Carousel brings it back on an LFD day: refused.
  const out = await applySlotChanges(q, [{ scope: 'date', op: 'delete', nyDate: '2026-10-28', vertical: 'carousels', windowId: 'morning' }], { by: 't', now: NOW, keepBooked: false });
  assert.equal(out.ok, false);
});

test('removing a slot with a booked post 13 days out returns 409 with its refs (Review Focus 2)', async () => {
  const { pg, q } = await seeded();
  await book(pg, 'carousels', '2026-10-28', 'afternoon', null, '11111111-1111-1111-1111-111111111111');
  const change = [{ scope: 'template' as const, op: 'delete' as const, weekday: 3, vertical: 'carousels' as const, windowId: 'afternoon' }];
  const out = await applySlotChanges(q, change, { by: 't', now: NOW, keepBooked: false });
  assert.equal(out.ok, false);
  assert.equal((out as { status: number }).status, 409);
  const booked = (out as { booked: Array<{ nyDate: string; refs: Record<string, string> }> }).booked;
  assert.deepEqual(booked.map((b) => [b.nyDate, b.refs]), [['2026-10-28', { postId: '11111111-1111-1111-1111-111111111111' }]]);
  // Keep it: the template changes, the booking stays.
  assert.deepEqual(await applySlotChanges(q, change, { by: 't', now: NOW, keepBooked: true }), { ok: true });
  const left = await pg.query(`SELECT status FROM social_hub.schedule WHERE vertical = 'carousels'`);
  assert.equal((left.rows[0] as { status: string }).status, 'scheduled');
});

test('flipping Trial to Main asks about a booked reel; a carousel edit elsewhere does not', async () => {
  const { pg, q } = await seeded();
  await book(pg, 'explainers', '2026-10-20', 'afternoon', 'main', '22222222-2222-2222-2222-222222222222');
  const flip = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'explainers', windowId: 'afternoon', action: 'add', feedMode: 'trial' }], { by: 't', now: NOW, keepBooked: false });
  assert.equal((flip as { status: number }).status, 409);
  const other = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', vertical: 'explainers', windowId: 'late', action: 'add', feedMode: 'trial' }], { by: 't', now: NOW, keepBooked: false });
  assert.deepEqual(other, { ok: true });
});

test('past dates and windows already started today are read-only (Review Focus 4)', async () => {
  const { q } = await seeded();
  const past = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-14', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  assert.equal((past as { status: number }).status, 422);
  // 10:00 AM: the reels morning window (8:45) has started; evening hasn't.
  const started = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-15', vertical: 'reels', windowId: 'morning', action: 'remove', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  assert.equal((started as { status: number }).status, 422);
  const later = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-15', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  assert.deepEqual(later, { ok: true });
});

test('parseChanges rejects junk with a 400 message', () => {
  assert.equal(typeof parseChanges({ changes: [{ scope: 'template', op: 'put', weekday: 9, vertical: 'reels', windowId: 'morning', feedMode: 'trial' }] }), 'string');
  assert.equal(typeof parseChanges({ changes: [{ scope: 'date', op: 'put', nyDate: 'tomorrow', vertical: 'reels', windowId: 'morning', action: 'add', feedMode: 'trial' }] }), 'string');
  assert.equal(typeof parseChanges({ changes: [] }), 'string');
  assert.ok(Array.isArray(parseChanges({ changes: [{ scope: 'template', op: 'delete', weekday: 1, vertical: 'stories', windowId: 'guess_the_number' }] })));
});

test('a booked reel reports its idea as the ref (native_ref is the video job)', async () => {
  const { pg, q } = await seeded();
  await book(pg, 'reels', '2026-10-22', 'evening', 'trial', '33333333-3333-3333-3333-333333333333');
  await pg.query(`UPDATE social_hub.schedule SET idea_ref = '44444444-4444-4444-4444-444444444444' WHERE vertical = 'reels'`);
  const out = await applySlotChanges(q, [{ scope: 'date', op: 'put', nyDate: '2026-10-22', vertical: 'reels', windowId: 'evening', action: 'remove', feedMode: null }], { by: 't', now: NOW, keepBooked: false });
  assert.equal((out as { status: number }).status, 409);
  assert.deepEqual((out as { booked: Array<{ refs: unknown }> }).booked.map((b) => b.refs), [{ postIdeaId: '44444444-4444-4444-4444-444444444444' }]);
});
