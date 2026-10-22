/** The week board's model and its undo history (spec 2026-10-20-calendar-week-board-redesign). Pure, offline. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createHistory, undoChunks, type Command } from '@/components/social-hub/calendar/history';
import { reelPosts } from '@/lib/social-hub/adapters/reels';
import { storyPosts } from '@/lib/social-hub/adapters/stories';
import type { ReelAttemptRow, ReelsRead } from '@/lib/social-hub/queries/reels';
import type { StoriesRead, StorySetRow } from '@/lib/social-hub/queries/stories';
import { resolveDay } from '@/lib/social-hub/slots/resolve';
import { DEFAULT_SEED_INPUTS, seedTemplate } from '@/lib/social-hub/slots/seed';
import { DEFAULT_CAPS } from '@/lib/social-hub/slots/times';
import type { ResolvedSlot, SlotKey } from '@/lib/social-hub/slots/types';
import { addDays, weekdayOf } from '@/lib/social-hub/time';
import type { HubPost } from '@/lib/social-hub/types';
import { boardModel, cardHeight, laterNote, minuteForY, stackOffsets, standardByWeekday, yForMinute, type BoardPost } from '@/lib/social-hub/views/week';
import * as weekEdit from '@/lib/social-hub/views/week-edit';
import { bookedHits, dayCtx, defaultPlaceMinute, dropState, openMinutes, readyMinutes, readyTakenAt, dropKey, planEdit, planReady, planReset, toastText, type BoardState } from '@/lib/social-hub/views/week-edit';

const tpl = seedTemplate(DEFAULT_SEED_INPUTS);
const NOW = new Date('2026-10-20T14:00:00Z'); // Tue Oct 20, 10:00 AM New York
const MON = '2026-10-19';
const week = () => Array.from({ length: 7 }, (_, i) => {
  const nyDate = addDays(MON, i);
  return { nyDate, weekday: weekdayOf(nyDate), slots: resolveDay(tpl, [], nyDate), personKeys: [] as SlotKey[] };
});
const slot = (vertical: ResolvedSlot['vertical'], startMinute: number, extra: Partial<ResolvedSlot> = {}): ResolvedSlot =>
  ({ vertical, startMinute, series: null, feedMode: null, origin: 'template', ...extra });
const key = (vertical: ResolvedSlot['vertical'], startMinute: number, series: ResolvedSlot['series'] = null): SlotKey => ({ vertical, startMinute, series });
const standardOf = () => Object.fromEntries(Array.from({ length: 7 }, (_, i) => [weekdayOf(addDays(MON, i)), resolveDay(tpl, [], addDays(MON, i))]));
const post = (o: Partial<HubPost> & { slotId: string }): HubPost => ({
  id: 'p', vertical: 'explainers', nyDate: '2026-10-21', status: 'scheduled', slot: { id: o.slotId, label: '' },
  approval: { required: true, approvedAt: '2026-10-20T00:00:00Z', note: null }, ...o,
}) as unknown as HubPost;

test('an empty Wed explainer says which run makes it and on which day', () => {
  const m = boardModel({ days: week(), posts: [], now: NOW, caps: DEFAULT_CAPS });
  const c = m.cards.find((x) => x.day === 2 && x.vertical === 'explainers' && x.startMinute === 780)!;
  assert.equal(c.status, 'empty');
  assert.equal(c.statusText, 'Empty for now. The 2 AM run makes it on Wed Oct 21.');
  assert.equal(c.locked, false);
});

/* Real adapter rows, not hand-built BoardPosts (final review #3): what the board gets on the live page. */
const storySet = (o: Partial<StorySetRow> = {}): StorySetRow => ({
  set_id: 's1', series: 'morning_download', ny_date: '2026-10-21', status: 'approved', trigger: 'auto', style: 'polished', payload: {},
  publish_at: '2026-10-21T12:35:00Z', slot_minute: 510, flagged: false, error: null, spend_usd: 0, approved_at: '2026-10-20T13:00:00Z',
  published_at: null, built_at: '2026-10-20T09:00:00Z', created_at: '2026-10-20T08:00:00Z', feedback_verdict: null, feedback_tags: null, chosen_origins: null, ...o,
});
const storiesRead = (sets: StorySetRow[]): StoriesRead => ({ sets, frames: [], insights: [], pool: [] });
const reelAttempt = (o: Partial<ReelAttemptRow> = {}): ReelAttemptRow => ({
  attempt_id: 'a1', status: 'published', trigger: 'auto', media_id: null, post_idea_id: 'idea-1', video_job_id: null,
  requested_at: '2026-10-19T15:15:00Z', finished_at: '2026-10-19T15:20:00Z', permalink: null, error: null, caption: null,
  song_title: null, song_artist: null, graduation_strategy: null, motion_prompt: null, video_storage_path: null, video_finished_at: null,
  video_slate_id: null, visual_render: null, audio_type: null, genre: null, schedule_id: 'sch-1', schedule_slot: 't0675',
  schedule_publish_at: '2026-10-19T15:20:00Z', approved_at: '2026-10-19T02:00:00Z', chosen_framework: null, chosen_bucket: null,
  blockbuster: null, net: null, origin: null, on_screen_copy: 'Copy', full_story_below: null, headline: 'Headline', ...o,
});
const reelsRead = (attempts: ReelAttemptRow[]): ReelsRead => ({ attempts, schedules: [], made: [], insights: [], ideas: [], sources: [], requireApproval: false });

test('adapter → board: a Stories set booked at 8:30 AM shows on its Morning Download card, with its status', () => {
  const posts = storyPosts(storiesRead([storySet()]));
  assert.equal(posts[0]!.slot?.id, 't0510:morning_download');
  const m = boardModel({ days: week(), posts, now: NOW, caps: DEFAULT_CAPS });
  const c = m.cards.find((x) => x.day === 2 && x.vertical === 'stories' && x.series === 'morning_download' && x.startMinute === 510)!;
  assert.equal(c.booked?.id, posts[0]!.id);
  assert.equal(c.status, 'approved');
  const waiting = storyPosts(storiesRead([storySet({ status: 'ready', approved_at: null })]));
  const w = boardModel({ days: week(), posts: waiting, now: NOW, caps: DEFAULT_CAPS }).cards.find((x) => x.day === 2 && x.vertical === 'stories' && x.startMinute === 510)!;
  assert.equal(w.status, 'waiting');
});

test('adapter → board: a window-era Stories set (no slot minute) keeps its window id', () => {
  assert.equal(storyPosts(storiesRead([storySet({ slot_minute: null })]))[0]!.slot?.id, 'story-window');
  assert.equal(storyPosts(storiesRead([storySet({ slot_minute: undefined })]))[0]!.slot?.id, 'story-window');
});

test('adapter → board: a posted reel booked at 11:15 AM reads "Posted" and counts on its folded past day', () => {
  const posts = reelPosts(reelsRead([reelAttempt()]));
  assert.equal(posts[0]!.slot?.id, 't0675');
  assert.equal(posts[0]!.slot?.label, '11:15 AM');
  const m = boardModel({ days: week(), posts, now: NOW, caps: DEFAULT_CAPS });
  const c = m.cards.find((x) => x.day === 0 && x.vertical === 'reels' && x.startMinute === 675)!;
  assert.equal(c.status, 'posted');
  assert.equal(c.statusText, 'Posted');
  assert.equal(m.columns[0]!.count, 1, 'Mon folds to "1 posted"');
  const legacy = reelPosts(reelsRead([reelAttempt({ schedule_slot: 'midday' })]));
  assert.equal(legacy[0]!.slot?.id, 'midday', 'a window booking reads as before');
});

test('the details say when the feed gap pushed a post past its slot (spec §Backend, final review #4)', () => {
  const at = (publishAt: string, status: HubPost['status'] = 'scheduled') => {
    const m = boardModel({ days: week(), posts: [post({ slotId: 't0780', publishAt, status })], now: NOW, caps: DEFAULT_CAPS });
    return laterNote(m.cards.find((x) => x.day === 2 && x.vertical === 'explainers' && x.startMinute === 780)!);
  };
  assert.equal(at('2026-10-21T17:52:00Z'), 'Posts at 1:52 PM, later than the slot, to keep 30 minutes from another feed post.');
  assert.equal(at('2026-10-21T17:15:00Z'), null, '1:15 PM is inside [1:00, 1:15]');
  assert.equal(at('2026-10-21T17:52:00Z', 'published'), null, 'a posted post says Posted');
  const story = storyPosts(storiesRead([storySet({ publish_at: '2026-10-21T13:10:00Z' })]));
  const m = boardModel({ days: week(), posts: story, now: NOW, caps: DEFAULT_CAPS });
  assert.equal(laterNote(m.cards.find((x) => x.day === 2 && x.vertical === 'stories' && x.startMinute === 510)!), 'Posts at 9:10 AM, later than the slot.');
});

test('a posted card is locked with status posted', () => {
  const m = boardModel({ days: week(), posts: [post({ slotId: 't0780', status: 'published' })], now: NOW, caps: DEFAULT_CAPS });
  const c = m.cards.find((x) => x.day === 2 && x.vertical === 'explainers' && x.startMinute === 780)!;
  assert.equal(c.status, 'posted');
  assert.equal(c.statusText, 'Posted');
  assert.equal(c.locked, true);
  assert.equal(c.booked?.id, 'p');
});

test('waiting and approved posts read as such', () => {
  const waiting = post({ slotId: 't0780', status: 'ready', approval: { required: true, approvedAt: null, note: null } });
  const approved = post({ id: 'q', slotId: 't0930' });
  const m = boardModel({ days: week(), posts: [waiting, approved], now: NOW, caps: DEFAULT_CAPS });
  const at = (min: number) => m.cards.find((x) => x.day === 2 && x.vertical === 'explainers' && x.startMinute === min)!;
  assert.equal(at(780).statusText, 'Made, waiting for your approval.');
  assert.equal(at(930).statusText, 'Ready and approved.');
});

test('today\'s 9:00 card at 10:00 has started and is locked', () => {
  const m = boardModel({ days: week(), posts: [], now: NOW, caps: DEFAULT_CAPS });
  const c = m.cards.find((x) => x.day === 1 && x.vertical === 'last_few_days' && x.startMinute === 540)!;
  assert.equal(c.status, 'started');
  assert.equal(c.statusText, 'Already started.');
  assert.equal(c.locked, true);
  const later = m.cards.find((x) => x.day === 1 && x.vertical === 'reels' && x.startMinute === 1080)!;
  assert.equal(later.locked, false);
});

test('past days fold; today does not', () => {
  const m = boardModel({ days: week(), posts: [], now: NOW, caps: DEFAULT_CAPS });
  assert.deepEqual(m.columns.map((c) => c.folded), [true, false, false, false, false, false, false]);
  assert.equal(m.columns[0]!.past, true);
  assert.equal(m.columns[1]!.isToday, true);
});

test('a folded column counts the posts that went out', () => {
  const monExplainer = post({ slotId: 't0780', nyDate: MON, status: 'published' });
  const m = boardModel({ days: week(), posts: [monExplainer], now: NOW, caps: DEFAULT_CAPS });
  assert.equal(m.columns[0]!.count, 1);
  assert.equal(m.columns[2]!.count, m.cards.filter((c) => c.day === 2).length);
});

test('edited is true only when the date has a person\'s own edit; a system pin or a differing slot alone does not mark it', () => {
  const plain = boardModel({ days: week(), posts: [], now: NOW, caps: DEFAULT_CAPS });
  assert.ok(plain.columns.every((c) => !c.edited));
  const days = week();
  // A system pin (today's started slot held, an override the system wrote): the slots differ, but nobody edited the date.
  days[2]!.slots = [...days[2]!.slots, slot('explainers', 1000, { feedMode: 'main', origin: 'override' })];
  assert.equal(boardModel({ days, posts: [], now: NOW, caps: DEFAULT_CAPS }).columns[2]!.edited, false, 'system override');
  // A person's pin back at the standard time: the slots match, but the person set it.
  const pinned = week();
  pinned[3]!.personKeys = [key('explainers', 780)];
  const m = boardModel({ days: pinned, posts: [], now: NOW, caps: DEFAULT_CAPS });
  assert.equal(m.columns[3]!.edited, true, 'person pin');
  assert.equal(m.columns[2]!.edited, false);
  assert.equal(m.cards.find((c) => c.day === 3 && c.vertical === 'explainers' && c.startMinute === 780)!.mine, true, 'the card says it is theirs');
  assert.ok(m.cards.filter((c) => c.day !== 3).every((c) => !c.mine));
});

test('a 4th explainer is over the daily cap; each Stories series counts on its own', () => {
  const days = week();
  days[2]!.slots = [slot('explainers', 780), slot('explainers', 840), slot('explainers', 930), slot('explainers', 1000)];
  const m = boardModel({ days, posts: [], now: NOW, caps: DEFAULT_CAPS });
  assert.deepEqual(m.cards.filter((c) => c.day === 2).map((c) => c.overCap), [false, false, false, true]);
  assert.equal(m.cards.find((c) => c.day === 2 && c.overCap)!.statusText, 'Over today’s limit, so nothing is made for this slot.');
  days[3]!.slots = [
    slot('stories', 510, { series: 'morning_download' }), slot('stories', 540, { series: 'guess_the_number' }),
    slot('stories', 600, { series: 'morning_download' }), slot('stories', 630, { series: 'morning_download' }),
  ];
  const s = boardModel({ days, posts: [], now: NOW, caps: DEFAULT_CAPS }).cards.filter((c) => c.day === 3);
  assert.deepEqual(s.map((c) => c.overCap), [false, false, false, true]);
});

test('outsideUsual flags a time away from the usual windows', () => {
  const days = week();
  days[2]!.slots = [slot('explainers', 780), slot('explainers', 660)];
  const m = boardModel({ days, posts: [], now: NOW, caps: DEFAULT_CAPS });
  assert.deepEqual(m.cards.filter((c) => c.day === 2).map((c) => c.outsideUsual), [true, false]);
});

/** Tops rounded to 1e-6: y is a float. */
const near = (n: number | undefined) => Math.round(n! * 1e6) / 1e6;

test('stack: 510/510/525/540 stack in time order, tops never go up and never overlap', () => {
  const H = 780; // one unit per minute
  const cards = [540, 525, 510, 510].map((startMinute, i) => ({ key: `2|reels|${startMinute}|${i}`, day: 2, startMinute }));
  const tops = stackOffsets(cards, H);
  const order = [...cards].sort((a, b) => a.startMinute - b.startMinute || a.key.localeCompare(b.key)).map((c) => near(tops.get(c.key)));
  assert.deepEqual(order, [30, 60, 90, 120], 'four rows from 8:30 down');
  for (let i = 1; i < order.length; i++) assert.ok(order[i]! >= near(order[i - 1]! + cardHeight(H)), `row ${i} clears row ${i - 1}`);
});

test('stack: a lone card keeps its true top', () => {
  const tops = stackOffsets([{ key: 'a', day: 1, startMinute: 900 }, { key: 'b', day: 1, startMinute: 510 }], 780);
  assert.equal(tops.get('a'), yForMinute(900, 780));
  assert.equal(tops.get('b'), yForMinute(510, 780));
});

test('stack: a pushed card pushes the next; a card past the stack is left alone; days are separate', () => {
  const tops = stackOffsets([
    { key: 'a', day: 1, startMinute: 510 }, { key: 'b', day: 1, startMinute: 530 }, { key: 'c', day: 1, startMinute: 560 },
    { key: 'd', day: 1, startMinute: 600 }, { key: 'e', day: 2, startMinute: 530 },
  ], 780);
  assert.deepEqual(['a', 'b', 'c', 'd'].map((k) => near(tops.get(k))), [30, 60, 90, 120], 'b pushed to 60, which pushes c to 90, which reaches d');
  assert.equal(near(tops.get('e')), 50, 'another day is not pushed');
});

test('stack: Stories at one minute in different series stack in stable key order', () => {
  const cards = [
    { key: '1|stories|t0510:morning_download', day: 1, startMinute: 510 },
    { key: '1|stories|t0510:free_vs_paid', day: 1, startMinute: 510 },
  ];
  for (const list of [cards, [...cards].reverse()]) {
    const tops = stackOffsets(list, 780);
    assert.equal(near(tops.get('1|stories|t0510:free_vs_paid')), 30);
    assert.equal(near(tops.get('1|stories|t0510:morning_download')), 60);
  }
});

test('time and y round-trip over 8 AM to 9 PM', () => {
  for (const H of [520, 780, 1000]) {
    assert.equal(minuteForY(yForMinute(780, H), H), 780);
    assert.equal(yForMinute(480, H), 0);
    assert.equal(yForMinute(1260, H), H);
  }
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
    const days = [{ nyDate: date, weekday: 0, slots: [slot('carousels', 540), slot('carousels', 660)], personKeys: [] }];
    const m = boardModel({ days, posts: [], now: new Date(iso), caps: DEFAULT_CAPS });
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
  h.push(cmd('next week edit', 'week:2026-10-26'));
  assert.equal(h.undo('week'), w);
  assert.equal(h.canUndo('week'), false);
  assert.equal(h.canUndo('week:2026-10-26'), true);
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
const state = (posts: BoardPost[] = []): BoardState => ({ days: week(), standard: standardOf(), posts });
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

test('booked hits: removing or flipping a booked slot asks; moving a booked Story cannot', () => {
  const [set] = storyPosts(storiesRead([storySet()]));
  const s = state([booked({ slotId: 't0780' }), booked({ id: 'r1', vertical: 'reels', slotId: 't0525' }), set!]);
  const rm = planEdit(s, { op: 'remove', day: WED, key: key('explainers', 780) }, CLOCK);
  assert.ok(rm.ok);
  assert.deepEqual(bookedHits(s, rm.next).map((h) => [h.post.id, h.why]), [['b1', 'removed']]);
  const flip = planEdit(s, { op: 'mode', day: WED, key: key('reels', 525), feedMode: 'main' }, CLOCK);
  assert.ok(flip.ok);
  assert.deepEqual(bookedHits(s, flip.next).map((h) => [h.post.id, h.why]), [['r1', 'feed-mode']]);
  const story = planEdit(s, { op: 'move', day: WED, key: key('stories', 510, 'morning_download'), to: WED, minute: 720 }, CLOCK);
  assert.ok(story.ok);
  assert.deepEqual(bookedHits(s, story.next).map((h) => [h.post.id, h.why]), [[set!.id, 'cannot-move']]);
});

test('reset day: only the person\'s own keys go back to the schedule; system pins and locked keys stay; the inverse rebuilds them', () => {
  const s = state();
  // Wed: the person moved the 3:30 PM Explainer to 5:00 PM (a remove + an add, both theirs); the system pinned an extra 7 PM Explainer.
  s.days[WED]!.slots = s.days[WED]!.slots.filter((x) => !(x.vertical === 'explainers' && x.startMinute === 930))
    .concat(slot('explainers', 1020, { feedMode: 'main', origin: 'override' }), slot('explainers', 1140, { feedMode: 'main', origin: 'override' }));
  s.days[WED]!.personKeys = [key('explainers', 930), key('explainers', 1020)];
  const r = planReset(s, WED, CLOCK);
  assert.ok(r.ok && !r.noop);
  assert.deepEqual(r.changes, [
    { scope: 'date', op: 'delete', nyDate: '2026-10-21', vertical: 'explainers', startMinute: 1020, series: null },
    { scope: 'date', op: 'delete', nyDate: '2026-10-21', vertical: 'explainers', startMinute: 930, series: null },
  ]);
  assert.deepEqual(r.inverse, [
    { scope: 'date', op: 'put', nyDate: '2026-10-21', action: 'remove', vertical: 'explainers', startMinute: 930, series: null },
    { scope: 'date', op: 'put', nyDate: '2026-10-21', action: 'add', vertical: 'explainers', startMinute: 1020, series: null, feedMode: 'main' },
  ]);
  const after = r.next.days[WED]!;
  assert.ok(after.slots.some((x) => x.vertical === 'explainers' && x.startMinute === 930), 'the scheduled 3:30 PM is back');
  assert.ok(!after.slots.some((x) => x.startMinute === 1020), 'the person\'s 5:00 PM is gone');
  assert.ok(after.slots.some((x) => x.startMinute === 1140), 'the system pin stays');
  assert.deepEqual(after.personKeys, []);
  assert.equal(r.label, 'Wed Oct 21 is back to its schedule');
  assert.ok(r.ok && planReset(r.next, WED, CLOCK).ok && (planReset(r.next, WED, CLOCK) as { noop: boolean }).noop, 'nothing of theirs is left');

  // Today: the person removed the 9:00 LFD, which has started: it stays removed and stays theirs.
  const t = state();
  t.days[1]!.slots = t.days[1]!.slots.filter((x) => x.vertical !== 'last_few_days');
  t.days[1]!.personKeys = [key('last_few_days', 540)];
  const today = planReset(t, 1, CLOCK);
  assert.ok(today.ok && today.noop, 'a started key is never reset');
});

test('reset day: a date with only system pins has nothing to reset, even though it differs from the schedule', () => {
  const s = state();
  s.days[WED]!.slots.push(slot('explainers', 1140, { feedMode: 'main', origin: 'override' }));
  const r = planReset(s, WED, CLOCK);
  assert.ok(r.ok && r.noop);
});

test('board edits mark their keys as the person\'s, so the date reads Edited', () => {
  const s = state();
  const moved = planEdit(s, { op: 'move', day: WED, key: key('explainers', 930), to: 3, minute: 720 }, CLOCK);
  assert.ok(moved.ok);
  assert.deepEqual(moved.next.days[WED]!.personKeys, [key('explainers', 930)]);
  assert.deepEqual(moved.next.days[3]!.personKeys, [key('explainers', 720)]);
  const m = boardModel({ days: moved.next.days, posts: [], now: NOW, caps: DEFAULT_CAPS });
  assert.deepEqual(m.columns.map((c) => c.edited), [false, false, true, true, false, false, false]);
  const flip = planEdit(moved.next, { op: 'mode', day: 3, key: key('explainers', 720), feedMode: 'trial' }, CLOCK);
  assert.ok(flip.ok);
  assert.deepEqual(flip.next.days[3]!.personKeys, [key('explainers', 720)], 'a key is marked once');
  const r = planReady(s, { id: 'n1', vertical: 'explainers', nyDate: null, status: 'ready', slot: null, approval: { required: true, approvedAt: null }, name: 'N' }, null, 4, 720, CLOCK);
  assert.ok(r.ok);
  assert.deepEqual(r.next.days[4]!.personKeys, [key('explainers', 720)], 'a placement is the person\'s');
});

test('ready: a placed post books the slot, still needing approval', () => {
  const r = planReady(state(), { id: 'n1', vertical: 'explainers', nyDate: null, status: 'ready', slot: null, approval: { required: true, approvedAt: null }, name: 'Why GPUs cost so much' }, null, WED, 720, CLOCK);
  assert.ok(r.ok);
  assert.equal(r.slot, 't0720');
  assert.equal(r.label, '“Why GPUs cost so much” placed on Wed Oct 21 at 12:00 PM. It still needs approval.');
  const m = boardModel({ days: r.next.days, posts: r.next.posts, now: NOW, caps: DEFAULT_CAPS });
  assert.equal(m.cards.find((c) => c.day === WED && c.startMinute === 720)!.status, 'waiting');
});

test('toast copy: a board edit is just this date, and no edit offers "Make it every" (schedules replace it)', () => {
  assert.equal(toastText('Explainer moved to 12:00 PM on Wed Oct 21'), 'Explainer moved to 12:00 PM on Wed Oct 21. Just this date.');
  assert.equal('everyFor' in weekEdit, false, 'no "Make it every" plan');
  assert.equal('planCopyDay' in weekEdit, false, 'no Copy day plan');
  const board = readFileSync('components/social-hub/calendar/WeekBoard.tsx', 'utf8');
  const card = readFileSync('components/social-hub/calendar/SlotCard.tsx', 'utf8');
  for (const src of [board, card]) {
    assert.ok(!/Make (it|this) every/.test(src), 'no Make it every button');
    assert.ok(!/Standard week/.test(src), 'no Standard week tab copy');
  }
});

test('standardByWeekday keys each weekday (0 = Sunday) to its template slots', () => {
  const by = standardByWeekday(tpl);
  assert.deepEqual(Object.keys(by).map(Number).sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(by[2]!.some((s) => s.vertical === 'last_few_days'), 'Tuesday is an LFD day');
  assert.ok(!by[1]!.some((s) => s.vertical === 'last_few_days'));
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

/* ── Fix round 3 (review) ── */

test('ready: the ghost and Place share one rule for a taken slot', () => {
  const at = (status: BoardPost['status']) => state([booked({ id: 'x', status, slotId: 't0720' })]);
  const item = { id: 'n1', vertical: 'explainers' as const, nyDate: null, status: 'ready' as const, slot: null, approval: { required: true, approvedAt: null }, name: 'N' };
  for (const status of ['scheduled', 'publishing', 'published', 'ready'] as const) {
    assert.equal(readyTakenAt(at(status), item, null, '2026-10-21')(720), true, status);
    const r = planReady(at(status), item, null, WED, 720, CLOCK);
    assert.ok(!r.ok, status);
  }
  for (const status of ['failed', 'cancelled', 'skipped'] as const) {
    assert.equal(readyTakenAt(at(status), item, null, '2026-10-21')(720), false, status);
  }
});

test('drag: the preview runs again only when the day, the snapped minute or the hold changes', () => {
  const held = { minute: 780, snappedTo: 'Afternoon' };
  assert.equal(dropKey(2, 790, 'explainers', held), dropKey(2, 788, 'explainers', held), 'same snap, still held');
  assert.notEqual(dropKey(2, 790, 'explainers', held), dropKey(2, 791, 'explainers', held), 'the hold lets go past 10 minutes');
  assert.equal(dropKey(2, 721, 'explainers', null), dropKey(2, 724, 'explainers', null));
  assert.notEqual(dropKey(2, 721, 'explainers', null), dropKey(3, 721, 'explainers', null));
});

test('reset day leaves a posted slot as it is', () => {
  const s = state([booked({ id: 'p1', vertical: 'explainers', nyDate: '2026-10-21', status: 'published', slotId: 't1020' })]);
  s.days[WED]!.slots.push(slot('explainers', 1020, { feedMode: 'main', origin: 'override' }));
  s.days[WED]!.personKeys = [key('explainers', 1020)];
  const r = planReset(s, WED, CLOCK);
  assert.ok(r.ok && r.noop, 'the posted override is not reset');
  assert.ok(r.ok && r.next.days[WED]!.slots.some((x) => x.startMinute === 1020));
});

test('reset day that deletes a booked override slot asks first', () => {
  const s = state([booked({ id: 'b9', vertical: 'explainers', nyDate: '2026-10-21', status: 'scheduled', slotId: 't1020' })]);
  s.days[WED]!.slots.push(slot('explainers', 1020, { feedMode: 'main', origin: 'override' }));
  s.days[WED]!.personKeys = [key('explainers', 1020)];
  const r = planReset(s, WED, CLOCK);
  assert.ok(r.ok && !r.noop);
  assert.deepEqual(bookedHits(s, r.next).map((h) => [h.post.id, h.why]), [['b9', 'removed']]);
});

// ── Batch select (spec 2026-10-21 §2) ──

const SAT = 5;
const THU = 3;
const sel = (day: number, k: SlotKey) => ({ day, key: k });
type DateMove = { from: { nyDate: string; vertical: string; startMinute: number; series: null }; to: { nyDate: string; startMinute: number } };

test('batch: Set time 11:30 on three Carousels sends three date moves and shows 11:30 on each', () => {
  const s = state();
  const b = weekEdit.planBatch(s, [sel(WED, key('carousels', 540)), sel(THU, key('carousels', 540)), sel(SAT, key('carousels', 540))], { op: 'time', minute: 690 }, CLOCK);
  assert.deepEqual(b.skipped, []);
  assert.equal(b.chunks.length, 1);
  assert.equal(b.chunks[0]!.length, 3);
  assert.ok(b.chunks.flat().every((c) => c.scope === 'date' && c.op === 'move'));
  for (const d of [WED, THU, SAT]) {
    assert.ok(b.next.days[d]!.slots.some((x) => x.vertical === 'carousels' && x.startMinute === 690));
    assert.ok(!b.next.days[d]!.slots.some((x) => x.vertical === 'carousels' && x.startMinute === 540));
    assert.ok(b.next.days[d]!.personKeys.some((k) => k.vertical === 'carousels' && k.startMinute === 690), 'the date reads Edited');
  }
  assert.equal(b.label, '3 slots moved to 11:30 AM');
  // Undo: the inverse chunks, sent last chunk first, move each card back, newest first.
  const back = [...b.inverse].reverse().flat();
  assert.deepEqual(back, b.chunks.flat().map((c) => {
    const m = c as unknown as DateMove;
    return { scope: 'date', op: 'move', from: { nyDate: m.to.nyDate, vertical: m.from.vertical, startMinute: m.to.startMinute, series: m.from.series }, to: { nyDate: m.from.nyDate, startMinute: m.from.startMinute } };
  }).reverse());
});

test('batch: Trial / Main on a mixed selection changes the reel and skips the Carousel, saying why', () => {
  const b = weekEdit.planBatch(state(), [sel(WED, key('reels', 525)), sel(WED, key('carousels', 540))], { op: 'mode', feedMode: 'main' }, CLOCK);
  assert.equal(b.chunks.flat().length, 1);
  assert.equal((b.chunks[0]![0] as { feedMode: string }).feedMode, 'main');
  assert.deepEqual(b.skipped.map((x) => x.reason), ['No Trial / Main for Carousels.']);
  assert.equal(b.next.days[WED]!.slots.find((x) => x.vertical === 'reels' && x.startMinute === 525)!.feedMode, 'main');
  assert.equal(weekEdit.batchToast(b), '1 slot now posts to the main feed. Just these dates. 1 skipped: No Trial / Main for Carousels.');
});

test('batch: Remove with a booked card lists it in booked', () => {
  const s = state([booked({ slotId: 't0780' })]);
  const b = weekEdit.planBatch(s, [sel(WED, key('explainers', 780)), sel(WED, key('carousels', 540))], { op: 'remove' }, CLOCK);
  assert.equal(b.chunks.flat().length, 2);
  assert.deepEqual(b.booked.map((h) => [h.post.id, h.why]), [['b1', 'removed']]);
  assert.equal(b.label, '2 slots removed');
});

test('batch: a locked card is skipped as already started', () => {
  const b = weekEdit.planBatch(state(), [sel(1, key('reels', 525)), sel(WED, key('reels', 525))], { op: 'remove' }, CLOCK);
  assert.deepEqual(b.skipped, [{ day: 1, key: key('reels', 525), reason: 'Already started.' }]);
  assert.equal(b.chunks.flat().length, 1);
});

test('batch: Set time keeps each card on its date; a duplicate minute is skipped with the rules\' reason', () => {
  const b = weekEdit.planBatch(state(), [sel(WED, key('carousels', 540)), sel(WED, key('carousels', 870))], { op: 'time', minute: 690 }, CLOCK);
  assert.equal(b.chunks.flat().length, 1);
  assert.deepEqual(b.skipped.map((x) => [x.key.startMinute, x.reason]), [[870, 'Carousel already has a slot at 11:30 AM.']]);
  const m = b.chunks[0]![0] as unknown as DateMove;
  assert.equal(m.from.nyDate, m.to.nyDate);
});

test('batch: 25 changes go as a save of 20 and a save of 5', () => {
  const s = state();
  const keys = [2, 3, 4, 5, 6].flatMap((d) => s.days[d]!.slots.map((x) => sel(d, key(x.vertical, x.startMinute, x.series)))).slice(0, 25);
  assert.equal(keys.length, 25);
  const b = weekEdit.planBatch(s, keys, { op: 'remove' }, CLOCK);
  assert.deepEqual(b.chunks.map((c) => c.length), [20, 5]);
  assert.deepEqual(b.inverse.map((c) => c.length), [20, 5]);
  assert.deepEqual(weekEdit.chunked([1, 2, 3], 2), [[1, 2], [3]]);
});

test('history: a batch command undoes as its inverse chunks, last chunk first', () => {
  const h = createHistory();
  const a = { scope: 'date', op: 'delete', nyDate: '2026-10-21', vertical: 'carousels', startMinute: 540, series: null } as const;
  const c: Command = { label: 'x', changes: [], inverse: [], chunks: [[a], [a]], inverseChunks: [[{ ...a, startMinute: 1 }], [{ ...a, startMinute: 2 }]], tab: 't', undoable: true };
  h.push(c);
  assert.deepEqual(undoChunks(h.undo('t')!).map((x) => x.map((y) => (y as { startMinute: number }).startMinute)), [[2], [1]]);
  assert.deepEqual(undoChunks({ ...c, chunks: undefined, inverseChunks: undefined, inverse: [a] }), [[a]]);
});

// ── Final fix wave (final review I1, I2, M1) ──

test('batch: Set time at a minute already passed today skips that card with a reason and never moves it elsewhere', () => {
  const s = state();
  const b = weekEdit.planBatch(s, [sel(1, key('reels', 675)), sel(WED, key('reels', 675))], { op: 'time', minute: 585 }, CLOCK);
  assert.deepEqual(b.skipped, [{ day: 1, key: key('reels', 675), reason: weekEdit.TIME_PASSED }]);
  assert.equal(weekEdit.TIME_PASSED, 'That time has passed today.');
  assert.ok(b.next.days[1]!.slots.some((x) => x.vertical === 'reels' && x.startMinute === 675), 'today\'s card stays where it was');
  assert.ok(!b.next.days[1]!.slots.some((x) => x.vertical === 'reels' && x.startMinute === 615), 'never snapped to the next open time');
  assert.equal(b.chunks.flat().length, 1, 'only Wed moves');
  assert.equal(b.label, '1 slot moved to 9:45 AM');
  // A picked minute at now has passed too; a card whose own minute it is would otherwise snap back silently.
  const atNow = weekEdit.planBatch(s, [sel(1, key('reels', 675))], { op: 'time', minute: 600 }, CLOCK);
  assert.deepEqual(atNow.skipped.map((x) => x.reason), [weekEdit.TIME_PASSED]);
  assert.equal(weekEdit.batchToast(atNow), 'Nothing changed. 1 skipped: That time has passed today.');
});

test('select: a new week clears the selection and leaves select mode; Undo and refresh keep only cards still on the board', () => {
  const cards = [{ key: '2|reels|t0525' }, { key: '3|carousels|t0540' }];
  const sel0 = { monday: MON, on: true, picked: ['2|reels|t0525', '3|carousels|t0540'] };
  assert.equal(weekEdit.syncSelection(sel0, MON, cards), sel0, 'nothing changed: the same selection');
  assert.deepEqual(weekEdit.syncSelection(sel0, '2026-10-26', cards), { monday: '2026-10-26', on: false, picked: [] });
  // After Cmd+Z the 11:30 card went back to 9:00: its key is gone, so it can't come back selected later.
  const afterUndo = weekEdit.syncSelection({ ...sel0, picked: ['2|reels|t0525', '3|carousels|t0690'] }, MON, cards);
  assert.deepEqual(afterUndo, { monday: MON, on: true, picked: ['2|reels|t0525'] });
});

/** Tue Oct 20 (today, now 10:00 AM): the schedule moved the 8:45 reel to 11:30, and a person-held 9:30 reel kept its time, tied to the 11:30. */
const tiedToday = (day: number) => {
  const s = state();
  const weekday = s.days[day]!.weekday;
  s.standard = { ...s.standard, [weekday]: s.standard[weekday]!.filter((x) => !(x.vertical === 'reels' && x.startMinute === 525)).concat(slot('reels', 690, { feedMode: 'trial' })) };
  s.days[day]!.slots = s.days[day]!.slots.filter((x) => !(x.vertical === 'reels' && x.startMinute === 525)).concat(slot('reels', 570, { feedMode: 'trial', origin: 'override' }));
  s.days[day]!.personKeys = [key('reels', 570), key('reels', 690)];
  return s;
};

test('reset day never deletes a tie whose hand-set partner has already started today', () => {
  const r = planReset(tiedToday(1), 1, CLOCK);
  assert.ok(r.ok && r.noop, 'the 9:30 has started, so its 11:30 tie stays: no second reel today');
  // Before the partner starts, Reset takes both back to the schedule.
  const early = planReset(tiedToday(1), 1, { today: '2026-10-20', nowMinute: 500 });
  assert.ok(early.ok && !early.noop);
  assert.deepEqual(early.changes.map((c) => (c as { startMinute: number }).startMinute).sort(), [570, 690]);
});
