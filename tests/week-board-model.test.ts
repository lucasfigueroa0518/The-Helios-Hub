/** The week board's model and its undo history (spec 2026-10-20-calendar-week-board-redesign). Pure, offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createHistory, type Command } from '@/components/social-hub/calendar/history';
import { resolveDay } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import { DEFAULT_CAPS } from '@/lib/social-hub/slots/times';
import type { ResolvedSlot } from '@/lib/social-hub/slots/types';
import { addDays, weekdayOf } from '@/lib/social-hub/time';
import type { HubPost } from '@/lib/social-hub/types';
import { boardModel, lanes, minuteForY, standardByWeekday, yForMinute, type BoardPost } from '@/lib/social-hub/views/week';
import { bookedHits, dayCtx, defaultPlaceMinute, dropState, everyFor, openMinutes, planCopyDay, readyMinutes, planEdit, planReady, planReset, toastText, type BoardState } from '@/lib/social-hub/views/week-edit';

const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
const NOW = new Date('2026-10-20T14:00:00Z'); // Tue Oct 20, 10:00 AM New York
const MON = '2026-10-19';
const week = () => Array.from({ length: 7 }, (_, i) => {
  const nyDate = addDays(MON, i);
  return { nyDate, weekday: weekdayOf(nyDate), slots: resolveDay(tpl, [], nyDate) };
});
const slot = (vertical: ResolvedSlot['vertical'], startMinute: number, extra: Partial<ResolvedSlot> = {}): ResolvedSlot =>
  ({ vertical, startMinute, series: null, feedMode: null, origin: 'template', ...extra });
const standardOf = () => Object.fromEntries(Array.from({ length: 7 }, (_, i) => [weekdayOf(addDays(MON, i)), resolveDay(tpl, [], addDays(MON, i))]));
const post = (o: Partial<HubPost> & { slotId: string }): HubPost => ({
  id: 'p', vertical: 'explainers', nyDate: '2026-10-21', status: 'scheduled', slot: { id: o.slotId, label: '' },
  approval: { required: true, approvedAt: '2026-10-20T00:00:00Z', note: null }, ...o,
}) as unknown as HubPost;

test('an empty Wed explainer says which run makes it and on which day', () => {
  const m = boardModel({ mode: 'week', days: week(), posts: [], now: NOW, caps: DEFAULT_CAPS });
  const c = m.cards.find((x) => x.day === 2 && x.vertical === 'explainers' && x.startMinute === 780)!;
  assert.equal(c.status, 'empty');
  assert.equal(c.statusText, 'Empty for now. The 2 AM run makes it on Wed Oct 21.');
  assert.equal(c.locked, false);
});

test('a posted card is locked with status posted', () => {
  const m = boardModel({ mode: 'week', days: week(), posts: [post({ slotId: 't0780', status: 'published' })], now: NOW, caps: DEFAULT_CAPS });
  const c = m.cards.find((x) => x.day === 2 && x.vertical === 'explainers' && x.startMinute === 780)!;
  assert.equal(c.status, 'posted');
  assert.equal(c.statusText, 'Posted');
  assert.equal(c.locked, true);
  assert.equal(c.booked?.id, 'p');
});

test('waiting and approved posts read as such', () => {
  const waiting = post({ slotId: 't0780', status: 'ready', approval: { required: true, approvedAt: null, note: null } });
  const approved = post({ id: 'q', slotId: 't0930' });
  const m = boardModel({ mode: 'week', days: week(), posts: [waiting, approved], now: NOW, caps: DEFAULT_CAPS });
  const at = (min: number) => m.cards.find((x) => x.day === 2 && x.vertical === 'explainers' && x.startMinute === min)!;
  assert.equal(at(780).statusText, 'Made, waiting for your approval.');
  assert.equal(at(930).statusText, 'Ready and approved.');
});

test('today\'s 9:00 card at 10:00 has started and is locked', () => {
  const m = boardModel({ mode: 'week', days: week(), posts: [], now: NOW, caps: DEFAULT_CAPS });
  const c = m.cards.find((x) => x.day === 1 && x.vertical === 'last_few_days' && x.startMinute === 540)!;
  assert.equal(c.status, 'started');
  assert.equal(c.statusText, 'Already started.');
  assert.equal(c.locked, true);
  const later = m.cards.find((x) => x.day === 1 && x.vertical === 'reels' && x.startMinute === 1080)!;
  assert.equal(later.locked, false);
});

test('past days fold; today does not; template mode never folds', () => {
  const m = boardModel({ mode: 'week', days: week(), posts: [], now: NOW, caps: DEFAULT_CAPS });
  assert.deepEqual(m.columns.map((c) => c.folded), [true, false, false, false, false, false, false]);
  assert.equal(m.columns[0]!.past, true);
  assert.equal(m.columns[1]!.isToday, true);
  const days = week().map((d) => ({ ...d, nyDate: null }));
  const t = boardModel({ mode: 'template', days, posts: [], now: NOW, caps: DEFAULT_CAPS });
  assert.ok(t.columns.every((c) => !c.folded && !c.edited));
  assert.ok(t.cards.every((c) => !c.locked));
});

test('a folded column counts the posts that went out', () => {
  const monExplainer = post({ slotId: 't0780', nyDate: MON, status: 'published' });
  const m = boardModel({ mode: 'week', days: week(), posts: [monExplainer], now: NOW, caps: DEFAULT_CAPS });
  assert.equal(m.columns[0]!.count, 1);
  assert.equal(m.columns[2]!.count, m.cards.filter((c) => c.day === 2).length);
});

test('edited is true only when the date differs from its standard weekday by key, time or mode', () => {
  const standard = standardOf();
  const same = boardModel({ mode: 'week', days: week(), posts: [], now: NOW, caps: DEFAULT_CAPS, standard });
  assert.ok(same.columns.every((c) => !c.edited));
  const edit = (f: (s: ResolvedSlot[]) => ResolvedSlot[]) => {
    const days = week();
    days[2]!.slots = f(days[2]!.slots);
    return boardModel({ mode: 'week', days, posts: [], now: NOW, caps: DEFAULT_CAPS, standard }).columns[2]!.edited;
  };
  assert.equal(edit((s) => [...s].reverse()), false, 'order alone is not an edit');
  assert.equal(edit((s) => [...s, slot('explainers', 1000)]), true, 'extra key');
  assert.equal(edit((s) => s.map((x) => (x.vertical === 'explainers' && x.startMinute === 780 ? { ...x, startMinute: 795 } : x))), true, 'time');
  assert.equal(edit((s) => s.map((x) => (x.vertical === 'explainers' && x.startMinute === 780 ? { ...x, feedMode: x.feedMode === 'main' ? 'trial' : 'main' } : x))), true, 'mode');
  assert.equal(edit((s) => s.map((x) => ({ ...x, origin: 'override' as const }))), false, 'origin alone is not an edit');
});

test('a 4th explainer is over the daily cap; each Stories series counts on its own', () => {
  const days = week();
  days[2]!.slots = [slot('explainers', 780), slot('explainers', 840), slot('explainers', 930), slot('explainers', 1000)];
  const m = boardModel({ mode: 'week', days, posts: [], now: NOW, caps: DEFAULT_CAPS });
  assert.deepEqual(m.cards.filter((c) => c.day === 2).map((c) => c.overCap), [false, false, false, true]);
  assert.equal(m.cards.find((c) => c.day === 2 && c.overCap)!.statusText, 'Over today’s limit, so nothing is made for this slot.');
  days[3]!.slots = [
    slot('stories', 510, { series: 'morning_download' }), slot('stories', 540, { series: 'guess_the_number' }),
    slot('stories', 600, { series: 'morning_download' }), slot('stories', 630, { series: 'morning_download' }),
  ];
  const s = boardModel({ mode: 'week', days, posts: [], now: NOW, caps: DEFAULT_CAPS }).cards.filter((c) => c.day === 3);
  assert.deepEqual(s.map((c) => c.overCap), [false, false, false, true]);
});

test('outsideUsual flags a time away from the usual windows', () => {
  const days = week();
  days[2]!.slots = [slot('explainers', 780), slot('explainers', 660)];
  const m = boardModel({ mode: 'week', days, posts: [], now: NOW, caps: DEFAULT_CAPS });
  assert.deepEqual(m.cards.filter((c) => c.day === 2).map((c) => c.outsideUsual), [true, false]);
});

test('cards at 510/525/540 cluster side by side; 540 takes the lane 510 has left; a far card is alone', () => {
  const cards = [510, 525, 540, 900].map((startMinute) => ({ key: `2|reels|${startMinute}`, day: 2, startMinute }));
  const l = lanes(cards);
  assert.deepEqual([510, 525, 540].map((m) => l.get(`2|reels|${m}`)), [{ lane: 0, of: 2 }, { lane: 1, of: 2 }, { lane: 0, of: 2 }]);
  assert.deepEqual(l.get('2|reels|900'), { lane: 0, of: 1 });
});

test('lanes: three cards at one minute need three lanes', () => {
  const l = lanes([510, 510, 510].map((startMinute, i) => ({ key: `k${i}`, day: 1, startMinute })));
  assert.deepEqual(['k0', 'k1', 'k2'].map((k) => l.get(k)), [{ lane: 0, of: 3 }, { lane: 1, of: 3 }, { lane: 2, of: 3 }]);
});

test('lanes: days are separate, and equal times break ties by key', () => {
  const l = lanes([
    { key: 'b', day: 1, startMinute: 600 }, { key: 'a', day: 1, startMinute: 600 }, { key: 'c', day: 2, startMinute: 600 },
  ]);
  assert.deepEqual(l.get('a'), { lane: 0, of: 2 });
  assert.deepEqual(l.get('b'), { lane: 1, of: 2 });
  assert.deepEqual(l.get('c'), { lane: 0, of: 1 });
});

test('time and y round-trip over 8 AM to 9 PM', () => {
  for (const H of [520, 780, 1000]) {
    assert.equal(minuteForY(yForMinute(780, H), H), 780);
    assert.equal(yForMinute(480, H), 0);
    assert.equal(yForMinute(1260, H), H);
  }
});

test('lanes: Stories at one minute in different series split the width, in key order', () => {
  const l = lanes([
    { key: '1|stories|t0510:morning_download', day: 1, startMinute: 510 },
    { key: '1|stories|t0510:free_vs_paid', day: 1, startMinute: 510 },
  ]);
  assert.deepEqual(l.get('1|stories|t0510:free_vs_paid'), { lane: 0, of: 2 });
  assert.deepEqual(l.get('1|stories|t0510:morning_download'), { lane: 1, of: 2 });
});

test('y and minute are held to the 8 AM-9 PM axis', () => {
  assert.equal(yForMinute(400, 780), 0);
  assert.equal(yForMinute(1400, 780), 780);
  assert.equal(minuteForY(-20, 780), 480);
  assert.equal(minuteForY(900, 780), 1260);
});

test('now is New York wall-clock, so DST days lock the right cards', () => {
  // Fall back Sun Nov 1 2026: 10:00 EST = 15:00Z. Spring forward Sun Mar 14 2027: 10:00 EDT = 14:00Z.
  for (const [date, iso] of [['2026-11-01', '2026-11-01T15:00:00Z'], ['2027-03-14', '2027-03-14T14:00:00Z']] as const) {
    const days = [{ nyDate: date, weekday: 0, slots: [slot('carousels', 540), slot('carousels', 660)] }];
    const m = boardModel({ mode: 'week', days, posts: [], now: new Date(iso), caps: DEFAULT_CAPS });
    const nine = m.cards.find((c) => c.startMinute === 540)!;
    const eleven = m.cards.find((c) => c.startMinute === 660)!;
    assert.equal(nine.status, 'started', date);
    assert.equal(nine.locked, true, date);
    assert.equal(eleven.locked, false, date);
    assert.equal(eleven.status, 'empty', date);
  }
});

const cmd = (label: string, tab: Command['tab'], undoable = true): Command => ({ label, tab, undoable, changes: [], inverse: [] });

test('history: undo is scoped to the tab', () => {
  const h = createHistory();
  const w = cmd('week edit', 'week');
  h.push(w);
  h.push(cmd('standard edit', 'standard'));
  assert.equal(h.undo('week'), w);
  assert.equal(h.canUndo('week'), false);
  assert.equal(h.canUndo('standard'), true);
  assert.equal(h.undo('week'), null);
});

test('history: a non-undoable command blocks older undos until a newer command exists', () => {
  const h = createHistory();
  h.push(cmd('move', 'week'));
  h.push(cmd('unschedule', 'week', false));
  assert.equal(h.canUndo('week'), false);
  assert.equal(h.undo('week'), null);
  const newer = cmd('newer', 'week');
  h.push(newer);
  assert.equal(h.canUndo('week'), true);
  assert.equal(h.undo('week'), newer);
  assert.equal(h.canUndo('week'), false, 'the blocker is back on top');
});

/* ── Board edits (lib/social-hub/views/week-edit.ts): drop preview, plans, booked hits, reset ── */

const CLOCK = { today: '2026-10-20', nowMinute: 600 }; // Tue Oct 20, 10:00 AM
const WED = 2; // day index of Wed Oct 21
const state = (posts: BoardPost[] = []): BoardState => ({ mode: 'week', days: week(), standard: standardOf(), posts });
const key = (vertical: ResolvedSlot['vertical'], startMinute: number, series: ResolvedSlot['series'] = null) => ({ vertical, startMinute, series });
const booked = (o: Partial<BoardPost> & { slotId: string }): BoardPost => ({
  id: 'b1', vertical: 'explainers', nyDate: '2026-10-21', status: 'scheduled', slot: { id: o.slotId, label: '' }, approval: { required: true, approvedAt: null }, ...o,
});

test('drop: a raw minute near a usual start snaps to it and says so', () => {
  const s = state();
  s.days[WED]!.slots = s.days[WED]!.slots.filter((x) => !(x.vertical === 'explainers' && x.startMinute === 780));
  const ctx = dayCtx(s, WED, CLOCK);
  const d = dropState({ ctx, vertical: 'explainers', series: null, raw: 786, caps: DEFAULT_CAPS });
  assert.equal(d.minute, 780);
  assert.equal(d.tone, 'usual');
  assert.equal(d.tag, '1:00 PM · usual afternoon');
});

test('drop: away from usual windows is allowed and marked outside', () => {
  const d = dropState({ ctx: dayCtx(state(), WED, CLOCK), vertical: 'explainers', series: null, raw: 722, caps: DEFAULT_CAPS });
  assert.equal(d.minute, 720);
  assert.equal(d.tone, 'outside');
  assert.equal(d.tag, '12:00 PM · outside usual window');
});

test('drop: once snapped it stays snapped within 10 minutes (hysteresis)', () => {
  const s = state();
  s.days[WED]!.slots = s.days[WED]!.slots.filter((x) => !(x.vertical === 'explainers' && x.startMinute === 780));
  const ctx = dayCtx(s, WED, CLOCK);
  const first = dropState({ ctx, vertical: 'explainers', series: null, raw: 783, caps: DEFAULT_CAPS });
  const held = dropState({ ctx, vertical: 'explainers', series: null, raw: 790, caps: DEFAULT_CAPS, prev: first });
  assert.equal(held.minute, 780);
  const free = dropState({ ctx, vertical: 'explainers', series: null, raw: 795, caps: DEFAULT_CAPS, prev: first });
  assert.equal(free.minute, 795);
});

test('drop: a Carousel onto a Last Few Days day is refused with the reason', () => {
  const tue = dayCtx(state(), 1, { today: '2026-10-19', nowMinute: 0 });
  const d = dropState({ ctx: tue, vertical: 'carousels', series: null, raw: 870, caps: DEFAULT_CAPS });
  assert.equal(d.tone, 'refused');
  assert.equal(d.reason, 'Last Few Days runs the 3 AM job that day. Carousels are off.');
});

test('drop: Last Few Days onto a Carousel day asks first', () => {
  const d = dropState({ ctx: dayCtx(state(), WED, CLOCK), vertical: 'last_few_days', series: null, raw: 540, caps: DEFAULT_CAPS });
  assert.equal(d.tone, 'confirm');
  assert.equal(d.confirm, 'remove-carousels');
});

test('drop: a day at its cap says "At the daily limit" but still allows the drop', () => {
  const s = state();
  s.days[WED]!.slots.push(slot('explainers', 1020, { feedMode: 'main' }));
  const d = dropState({ ctx: dayCtx(s, WED, CLOCK), vertical: 'explainers', series: null, raw: 720, caps: DEFAULT_CAPS });
  assert.equal(d.tone, 'cap');
  assert.equal(d.tag, '12:00 PM · At the daily limit for Explainers (3)');
});

test('drop: a time already passed today lands on the next 15-minute mark', () => {
  const d = dropState({ ctx: dayCtx(state(), 1, CLOCK), vertical: 'explainers', series: null, raw: 540, caps: DEFAULT_CAPS });
  assert.equal(d.minute, 615);
});

test('drop: a Ready Story only goes into an existing slot of its series', () => {
  const ctx = dayCtx(state(), WED, CLOCK);
  const into = dropState({ ctx, vertical: 'stories', series: 'morning_download', raw: 510, caps: DEFAULT_CAPS, ready: { taken: () => false } });
  assert.notEqual(into.tone, 'refused');
  const off = dropState({ ctx, vertical: 'stories', series: 'morning_download', raw: 720, caps: DEFAULT_CAPS, ready: { taken: () => false } });
  assert.equal(off.tone, 'refused');
  const taken = dropState({ ctx, vertical: 'stories', series: 'morning_download', raw: 510, caps: DEFAULT_CAPS, ready: { taken: () => true } });
  assert.equal(taken.reason, 'That slot is taken.');
});

test('plan: moving a slot within a day sends one move, undoes with the reverse move, and carries its post', () => {
  const s = state([booked({ slotId: 't0780' })]);
  const p = planEdit(s, { op: 'move', day: WED, key: key('explainers', 780), to: WED, minute: 720 }, CLOCK);
  assert.ok(p.ok && !p.noop);
  assert.deepEqual(p.changes, [{ scope: 'date', op: 'move', from: { nyDate: '2026-10-21', vertical: 'explainers', startMinute: 780, series: null }, to: { nyDate: '2026-10-21', startMinute: 720 } }]);
  assert.deepEqual(p.inverse, [{ scope: 'date', op: 'move', from: { nyDate: '2026-10-21', vertical: 'explainers', startMinute: 720, series: null }, to: { nyDate: '2026-10-21', startMinute: 780 } }]);
  assert.equal(p.label, 'Explainer moved to 12:00 PM on Wed Oct 21');
  assert.equal(p.next.posts[0]!.slot!.id, 't0720');
  assert.deepEqual(bookedHits(s, p.next), []);
});

test('plan: a move onto its own minute is a no-op', () => {
  const p = planEdit(state(), { op: 'move', day: WED, key: key('explainers', 780), to: WED, minute: 780 }, CLOCK);
  assert.ok(p.ok && p.noop);
});

test('plan: Last Few Days with a yes clears the Carousels, and undo puts them back after LFD goes', () => {
  const p = planEdit(state(), { op: 'place', day: WED, vertical: 'last_few_days', series: null, minute: 540, clearCarousels: true }, CLOCK);
  assert.ok(p.ok);
  assert.ok(!p.next.days[WED]!.slots.some((x) => x.vertical === 'carousels'));
  assert.equal((p.changes[0] as { clearCarousels?: boolean }).clearCarousels, true);
  assert.deepEqual(p.inverse.map((c) => [c.op, (c as { action?: string }).action, (c as { vertical: string }).vertical]), [
    ['put', 'remove', 'last_few_days'], ['put', 'add', 'carousels'], ['put', 'add', 'carousels'],
  ]);
});

test('plan: Trial / Main flip is a put with the new mode; the inverse restores the old one', () => {
  const p = planEdit(state(), { op: 'mode', day: WED, key: key('reels', 525), feedMode: 'main' }, CLOCK);
  assert.ok(p.ok);
  assert.equal((p.changes[0] as { feedMode: string }).feedMode, 'main');
  assert.equal((p.inverse[0] as { feedMode: string }).feedMode, 'trial');
  assert.equal(p.label, 'Text on Screen on Wed Oct 21 now posts to the main feed');
});

test('plan: the Standard week tab writes the template', () => {
  const t: BoardState = { mode: 'template', days: week().map((d) => ({ ...d, nyDate: null })), standard: standardOf(), posts: [] };
  const p = planEdit(t, { op: 'remove', day: WED, key: key('explainers', 930) }, CLOCK);
  assert.ok(p.ok);
  assert.deepEqual(p.changes, [{ scope: 'template', op: 'delete', weekday: 3, vertical: 'explainers', startMinute: 930, series: null }]);
  assert.equal(p.label, 'Explainer removed from every Wednesday');
});

test('make it every: a move between days applies both halves to the Standard week', () => {
  const s = state();
  const edit = { op: 'move' as const, day: WED, key: key('explainers', 930), to: 3, minute: 720 };
  const e = everyFor(s, edit, CLOCK);
  assert.ok(e);
  assert.deepEqual(e.changes, [{ scope: 'template', op: 'move', from: { weekday: 3, vertical: 'explainers', startMinute: 930, series: null }, to: { weekday: 4, startMinute: 720 } }]);
  assert.equal(e.button, 'Make it every Wednesday and Thursday');
  assert.ok(e.standard[4]!.some((x) => x.vertical === 'explainers' && x.startMinute === 720));
});

test('make it every: a removal of a slot the Standard week lacks has nothing to save', () => {
  const s = state();
  s.days[WED]!.slots.push(slot('explainers', 1020, { feedMode: 'main', origin: 'override' }));
  assert.equal(everyFor(s, { op: 'remove', day: WED, key: key('explainers', 1020) }, CLOCK), null);
  assert.equal(everyFor(s, { op: 'remove', day: WED, key: key('explainers', 930) }, CLOCK)?.button, 'Make it every Wednesday');
});

test('booked hits: removing or flipping a booked slot asks; moving a booked Story cannot', () => {
  const s = state([booked({ slotId: 't0780' }), booked({ id: 'r1', vertical: 'reels', slotId: 't0525' }), booked({ id: 's1', vertical: 'stories', slotId: 't0510:morning_download' })]);
  const rm = planEdit(s, { op: 'remove', day: WED, key: key('explainers', 780) }, CLOCK);
  assert.ok(rm.ok);
  assert.deepEqual(bookedHits(s, rm.next).map((h) => [h.post.id, h.why]), [['b1', 'removed']]);
  const flip = planEdit(s, { op: 'mode', day: WED, key: key('reels', 525), feedMode: 'main' }, CLOCK);
  assert.ok(flip.ok);
  assert.deepEqual(bookedHits(s, flip.next).map((h) => [h.post.id, h.why]), [['r1', 'feed-mode']]);
  const story = planEdit(s, { op: 'move', day: WED, key: key('stories', 510, 'morning_download'), to: WED, minute: 720 }, CLOCK);
  assert.ok(story.ok);
  assert.deepEqual(bookedHits(s, story.next).map((h) => [h.post.id, h.why]), [['s1', 'cannot-move']]);
});

test('reset day: only unlocked keys go back to the standard week; the inverse rebuilds the day', () => {
  const s = state();
  // Today (Tue): the started 9:00 LFD was removed (stays removed), an extra 1:30 PM Explainer was added.
  s.days[1]!.slots = s.days[1]!.slots.filter((x) => x.vertical !== 'last_few_days').concat(slot('explainers', 810, { feedMode: 'main', origin: 'override' }));
  const r = planReset(s, 1, CLOCK);
  assert.ok(r.ok && !r.noop);
  assert.deepEqual(r.changes, [{ scope: 'date', op: 'delete', nyDate: '2026-10-20', vertical: 'explainers', startMinute: 810, series: null }]);
  assert.deepEqual(r.inverse, [{ scope: 'date', op: 'put', nyDate: '2026-10-20', action: 'add', vertical: 'explainers', startMinute: 810, series: null, feedMode: 'main' }]);
  assert.ok(!r.next.days[1]!.slots.some((x) => x.vertical === 'last_few_days'), 'the started LFD stays as it was');
  assert.equal(r.label, 'Tue Oct 20 is back to the standard week');
});

test('ready: a placed post books the slot, still needing approval', () => {
  const r = planReady(state(), { id: 'n1', vertical: 'explainers', nyDate: null, status: 'ready', slot: null, approval: { required: true, approvedAt: null }, name: 'Why GPUs cost so much' }, null, WED, 720, CLOCK);
  assert.ok(r.ok);
  assert.equal(r.slot, 't0720');
  assert.equal(r.label, '“Why GPUs cost so much” placed on Wed Oct 21 at 12:00 PM. It still needs approval.');
  const m = boardModel({ mode: 'week', days: r.next.days, posts: r.next.posts, now: NOW, caps: DEFAULT_CAPS });
  assert.equal(m.cards.find((c) => c.day === WED && c.startMinute === 720)!.status, 'waiting');
});

test('toast copy: a date edit is just this date; a Standard week edit is every week', () => {
  assert.equal(toastText('Explainer moved to 12:00 PM on Wed Oct 21', 'week'), 'Explainer moved to 12:00 PM on Wed Oct 21. Just this date.');
  assert.equal(toastText('Explainer removed from every Wednesday', 'template'), 'Explainer removed from every Wednesday. Every week from now on.');
});

test('make this every weekday (details panel): the Standard week takes the whole date, and undo restores it', () => {
  const s = state();
  s.days[WED]!.slots = s.days[WED]!.slots.filter((x) => !(x.vertical === 'explainers' && x.startMinute === 930)).concat(slot('explainers', 720, { feedMode: 'main', origin: 'override' }));
  const p = planCopyDay(s, WED);
  assert.ok(p.ok && !p.noop);
  assert.deepEqual(p.changes, [
    { scope: 'template', op: 'delete', weekday: 3, vertical: 'explainers', startMinute: 930, series: null },
    { scope: 'template', op: 'put', weekday: 3, vertical: 'explainers', startMinute: 720, series: null, feedMode: 'main' },
  ]);
  assert.deepEqual(p.inverse, [
    { scope: 'template', op: 'delete', weekday: 3, vertical: 'explainers', startMinute: 720, series: null },
    { scope: 'template', op: 'put', weekday: 3, vertical: 'explainers', startMinute: 930, series: null, feedMode: 'main' },
  ]);
  assert.equal(p.label, 'Saved: every Wednesday now looks like Wed Oct 21');
  assert.ok(p.ok && planCopyDay({ ...s, standard: p.standard }, WED).ok && (planCopyDay({ ...s, standard: p.standard }, WED) as { noop: boolean }).noop);
});

test('standardByWeekday keys each weekday (0 = Sunday) to its template slots', () => {
  const by = standardByWeekday(tpl);
  assert.deepEqual(Object.keys(by).map(Number).sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(by[2]!.some((s) => s.vertical === 'last_few_days'), 'Tuesday is an LFD day');
  assert.ok(!by[1]!.some((s) => s.vertical === 'last_few_days'));
});

test('a Standard week card says which run makes it each week (the approved prototype copy)', () => {
  const days = week().map((d) => ({ ...d, nyDate: null }));
  const m = boardModel({ mode: 'template', days, posts: [], now: NOW, caps: DEFAULT_CAPS });
  const c = m.cards.find((x) => x.day === 2 && x.vertical === 'explainers' && x.startMinute === 780)!;
  assert.equal(c.statusText, 'Every Wednesday. Each week the 2 AM run makes this post on the day.');
});

test('place picker: today offers only times after now and defaults to the next open mark', () => {
  const s = state();
  const today = dayCtx(s, 1, { today: '2026-10-20', nowMinute: 900 }); // Tue 3:00 PM
  const open = openMinutes(today);
  assert.equal(open[0], 915);
  assert.equal(open[open.length - 1], 1245);
  assert.equal(defaultPlaceMinute(today, 'stories'), 915);
  assert.equal(defaultPlaceMinute(dayCtx(s, 1, { today: '2026-10-20', nowMinute: 1250 }), 'reels'), null, 'no time left today');
});

test('place picker: another day defaults to the type’s usual start; a past day has no times', () => {
  const s = state();
  const wed = dayCtx(s, WED, { today: '2026-10-20', nowMinute: 900 });
  assert.equal(openMinutes(wed)[0], 480);
  assert.equal(defaultPlaceMinute(wed, 'explainers'), 780);
  assert.equal(defaultPlaceMinute(wed, 'stories'), 510);
  assert.deepEqual(openMinutes(dayCtx(s, 0, { today: '2026-10-20', nowMinute: 900 })), []);
  const t: BoardState = { mode: 'template', days: week().map((d) => ({ ...d, nyDate: null })), standard: standardOf(), posts: [] };
  assert.equal(defaultPlaceMinute(dayCtx(t, 1, { today: '2026-10-20', nowMinute: 900 }), 'carousels'), 540, 'the Standard week has no now');
});

test('place picker: a Ready Story is offered only its series’ open slots on the day', () => {
  const s = state();
  const wed = dayCtx(s, WED, CLOCK);
  assert.deepEqual(readyMinutes(wed, 'stories', 'morning_download'), [510]);
  assert.deepEqual(readyMinutes(wed, 'stories', 'free_vs_paid'), [], 'no Free vs. Paid on Wednesday');
  assert.deepEqual(readyMinutes(dayCtx(s, 1, CLOCK), 'stories', 'morning_download'), [], 'today’s 8:30 has started');
  assert.deepEqual(readyMinutes(wed, 'explainers', null), openMinutes(wed), 'other types take any open time');
  const off = dropState({ ctx: wed, vertical: 'stories', series: 'morning_download', raw: 720, caps: DEFAULT_CAPS, ready: { taken: () => false } });
  assert.equal(off.reason, '12:00 PM isn’t a Morning Download slot.');
});
