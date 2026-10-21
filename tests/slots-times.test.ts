/** Free-time helpers: usual windows, snap, now, feed slots, slot ids (calendar week board spec). Pure, offline. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CAPS, DEFAULT_TIMES, DRIFT, FEED_GAP, GRID, LAST_START, DAY_START, MAGNET, RUN_HOUR_LABEL, USUAL,
  isFeedSlot, isUsual, nextOpenMinute, snapMinute,
} from '@/lib/social-hub/slots/times';
import { parseSlotId, slotId } from '@/lib/social-hub/slots/types';

test('constants carry the spec values', () => {
  assert.equal(GRID, 15); assert.equal(MAGNET, 20); assert.equal(DRIFT, 15); assert.equal(FEED_GAP, 30);
  assert.equal(DAY_START, 480); assert.equal(LAST_START, 1245);
  assert.deepEqual(DEFAULT_TIMES, { reels: [525, 675, 1080], explainers: [780, 930], carousels: [540, 870], last_few_days: [540], stories: [510] });
  assert.deepEqual(DEFAULT_CAPS, { reels: 5, explainers: 3, carousels: 3, last_few_days: 1, stories: 2 });
  assert.deepEqual(RUN_HOUR_LABEL, { reels: '1 AM', explainers: '2 AM', carousels: '3 AM', last_few_days: '3 AM', stories: '4 AM' });
  assert.deepEqual(USUAL.reels.map((w) => [w.start, w.end]), [[525, 600], [675, 750], [1080, 1260]]);
  assert.deepEqual(USUAL.explainers.map((w) => [w.start, w.end]), [[780, 870], [930, 1020]]);
  assert.deepEqual(USUAL.carousels.map((w) => [w.start, w.end]), [[540, 600], [870, 930]]);
  assert.deepEqual(USUAL.last_few_days.map((w) => [w.start, w.end]), [[540, 600]]);
  assert.deepEqual(USUAL.stories.map((w) => [w.start, w.end]), [[510, 600]]);
});

test('snap: magnet to a usual start, grid otherwise, every 15-minute mark reachable', () => {
  assert.deepEqual(snapMinute(785, 'explainers'), { minute: 780, snappedTo: 'Afternoon' });
  assert.deepEqual(snapMinute(720, 'explainers'), { minute: 720, snappedTo: null });
  assert.equal(snapMinute(510, 'reels').minute, 510); // 15 from 8:45, still reachable
  assert.deepEqual(snapMinute(805, 'explainers'), { minute: 810, snappedTo: null });
  assert.deepEqual(snapMinute(780, 'explainers'), { minute: 780, snappedTo: 'Afternoon' });
  for (let m = DAY_START; m <= LAST_START; m += GRID) {
    for (const v of ['reels', 'explainers', 'carousels', 'last_few_days', 'stories'] as const) assert.equal(snapMinute(m, v).minute, m, `${v}@${m}`);
  }
  // Stays on the timeline.
  assert.equal(snapMinute(100, 'reels').minute, DAY_START);
  assert.equal(snapMinute(1300, 'reels').minute, LAST_START);
});

test('isUsual and nextOpenMinute', () => {
  assert.equal(isUsual('explainers', 780), true);
  assert.equal(isUsual('explainers', 855), true);
  assert.equal(isUsual('explainers', 870), false);
  assert.equal(isUsual('explainers', 720), false);
  assert.equal(nextOpenMinute(600), 615);
  assert.equal(nextOpenMinute(601), 615);
  assert.equal(nextOpenMinute(614), 615);
  assert.equal(nextOpenMinute(1250), 1260);
});

test('isFeedSlot: Main reels, Carousels and LFD count; Stories and Trial reels are exempt', () => {
  assert.equal(isFeedSlot({ vertical: 'explainers', feedMode: 'main' }), true);
  assert.equal(isFeedSlot({ vertical: 'reels', feedMode: 'trial' }), false);
  assert.equal(isFeedSlot({ vertical: 'carousels', feedMode: null }), true);
  assert.equal(isFeedSlot({ vertical: 'last_few_days', feedMode: null }), true);
  assert.equal(isFeedSlot({ vertical: 'stories', feedMode: null }), false);
});

test('slot ids round-trip and match the schedule.slot check', () => {
  assert.equal(slotId(780, null), 't0780');
  assert.equal(slotId(510, 'morning_download'), 't0510:morning_download');
  assert.deepEqual(parseSlotId('t0780'), { startMinute: 780, series: null });
  assert.deepEqual(parseSlotId('t0510:morning_download'), { startMinute: 510, series: 'morning_download' });
  assert.equal(parseSlotId('morning'), null);
  assert.equal(parseSlotId('t1440'), null);
  assert.equal(parseSlotId('t0781'), null);
  assert.equal(parseSlotId('t0510:breakfast'), null);
  for (const id of [slotId(0, null), slotId(1425, 'free_vs_paid')]) assert.match(id, /^t[0-9]{4}(:[a-z_]+)?$/);
});
