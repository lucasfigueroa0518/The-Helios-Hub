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
import { boardModel, lanes, minuteForY, yForMinute } from '@/lib/social-hub/views/week';

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

test('three cards at 510/525/540 share three lanes; a far card is alone', () => {
  const cards = [510, 525, 540, 900].map((startMinute) => ({ key: `2|reels|${startMinute}`, day: 2, startMinute }));
  const l = lanes(cards);
  assert.deepEqual([510, 525, 540].map((m) => l.get(`2|reels|${m}`)), [{ lane: 0, of: 3 }, { lane: 1, of: 3 }, { lane: 2, of: 3 }]);
  assert.deepEqual(l.get('2|reels|900'), { lane: 0, of: 1 });
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
