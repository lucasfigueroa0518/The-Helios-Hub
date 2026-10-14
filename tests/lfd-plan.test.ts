import assert from 'node:assert/strict';
import test from 'node:test';

import { readDayQuotas } from '@/lib/social-hub/queries/day';
import type { Vertical } from '@/lib/social-hub/types';
import { daySlots } from '@/lib/social-hub/views/calendar';
import { quotaCandidates } from '@/lib/social-hub/views/day-rank';
import { windowsOn } from '@/lib/social-hub/views/plan';
import { slotsForDay } from '@/lib/social-hub/views/today';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const TUE_8 = new Date('2026-10-13T12:00:00Z');

test('carousel windows close on Last Few Days days only when asked', () => {
  assert.equal(windowsOn('carousels', '2026-10-13').length, 2);
  assert.equal(windowsOn('carousels', '2026-10-13', [2, 5]).length, 0);
  assert.equal(windowsOn('carousels', '2026-10-14', [2, 5]).length, 2);
  assert.equal(windowsOn('last_few_days', '2026-10-13').length, 1);
  assert.equal(windowsOn('last_few_days', '2026-10-14').length, 0);
});

test('a Tuesday’s slots: one Last Few Days post instead of two carousels while it is on', () => {
  const quotas = { reels: 0, carousels: 2, explainers: 0, last_few_days: 1, lfdDays: [2, 5] };
  // Tuesday: Morning Download (1) + Free vs. Paid (1) + Last Few Days (1); no carousels.
  assert.deepEqual(slotsForDay([], '2026-10-13', quotas), { slots: 3, filled: 0 });
  assert.deepEqual(slotsForDay([], '2026-10-13', { ...quotas, lfdDays: [] }), { slots: 5, filled: 0 });
  assert.deepEqual(quotaCandidates({ posts: [], ideas: [], dayQuotas: quotas }, 'carousels', TUE_8), []);
  assert.equal(quotaCandidates({ posts: [], ideas: [], dayQuotas: { ...quotas, lfdDays: [] } }, 'carousels', TUE_8).length, 2);
});

test('the calendar’s open slots on a Tuesday follow the same rule', () => {
  const types = new Set<Vertical>(['carousels', 'last_few_days']);
  const open = (off: number[]) => daySlots([], '2026-10-13', types, new Date('2026-10-13T11:00:00Z'), off)
    .map((s) => (s.kind === 'open' ? `${s.vertical}:${s.window.id}` : 'post'))
    .sort();
  assert.deepEqual(open([2, 5]), ['last_few_days:morning']);
  assert.deepEqual(open([]), ['carousels:afternoon', 'carousels:morning', 'last_few_days:morning']);
});

test('readDayQuotas carries the carousel days off from lfd.settings', async () => {
  const { query } = await openHubTestDb();
  const offQ = await readDayQuotas(query, Promise.resolve(query));
  assert.deepEqual([offQ.lfdDays, offQ.last_few_days], [[], 0], 'Last Few Days off: no carousel days off, no LFD quota');
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  const q = await readDayQuotas(query, Promise.resolve(query));
  assert.deepEqual([q.lfdDays, q.last_few_days], [[2, 5], 1]);
});

// Closing Carousels on Last Few Days days only removes OPEN capacity; content already on a day keeps its place.
import { typeHubModel } from '@/lib/content-type/model';
import type { HubDataset } from '@/lib/social-hub/dataset';
import type { HubPost } from '@/lib/social-hub/types';
import { monthModel } from '@/lib/social-hub/views/calendar';
import { slotChoices } from '@/lib/social-hub/views/offer';
import { contentModel } from '@/lib/social-hub/views/today';
import { previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

const NOW = new Date('2026-10-13T15:00:00Z'); // Tuesday 11:00 AM New York

function lfdOn(carousels: Array<[string, string, string, string]>): HubDataset {
  const d = previewDataset();
  const tpl = d.posts.find((p) => p.vertical === 'carousels' && p.idea && p.generatedAt && p.status === 'published')!;
  const mk = ([id, nyDate, status, at]: [string, string, string, string]): HubPost =>
    ({ ...tpl, id, nyDate, status, idea: { ...tpl.idea!, id: `idea-${id}` }, media: { kind: 'slides', slides: (tpl.media as { slides: Array<{ src: string | null }> }).slides.map((x) => ({ ...x, src: '/s.png' })) } as HubPost['media'], publishAt: at, postedAt: status === 'published' ? at : null, slot: { id: 'afternoon', label: 'Afternoon' } }) as HubPost;
  return {
    ...d,
    posts: [...d.posts.filter((p) => p.vertical !== 'carousels' && p.vertical !== 'last_few_days'), ...carousels.map(mk)],
    dayQuotas: { reels: 3, carousels: 2, explainers: 2, last_few_days: 1, lfdDays: [2, 5] },
    adjustments: [],
  } as HubDataset;
}
const cardIds = (d: HubDataset, date: string) => typeHubModel(d, 'carousels', NOW).days.find((x) => x.date === date)?.cards.map((c) => c.post.id) ?? [];

test('with auto_run on, a published carousel from last Tuesday and a booked one next Friday keep their days', () => {
  const d = lfdOn([
    ['last-tue', '2026-10-06', 'published', '2026-10-06T19:00:00Z'],
    ['next-fri', '2026-10-16', 'scheduled', '2026-10-16T19:00:00Z'],
  ]);
  assert.deepEqual(cardIds(d, '2026-10-06'), ['last-tue']);
  assert.deepEqual(cardIds(d, '2026-10-16'), ['next-fri']);
  const m = monthModel(d.posts, '2026-10', NOW, 'views' as never, new Set<Vertical>(['carousels']), () => true, [2, 5]);
  const cell = (day: string) => m.weeks.flat().find((c) => c.day === day)!;
  assert.equal(cell('2026-10-06').posts, 1);
  assert.equal(cell('2026-10-16').posts, 1);
  assert.deepEqual(daySlots(d.posts, '2026-10-16', new Set<Vertical>(['carousels']), NOW, [2, 5]).map((s) => s.kind), ['post']);
});

test('with auto_run on, a carousel placed today (Tuesday) stays in the plan and takes no second slot', () => {
  const d = lfdOn([['today', '2026-10-13', 'scheduled', '2026-10-13T19:00:00Z']]);
  assert.deepEqual(cardIds(d, '2026-10-13'), ['today']);
  const plan = contentModel(d, NOW).plan;
  const car = plan.types.find((t) => t.vertical === 'carousels')!;
  assert.equal(car.placed.length, 1);
  assert.equal(car.open.length, 0);
  assert.equal(quotaCandidates(d, 'carousels', NOW).length, 1);
  assert.equal(quotaCandidates(d, 'carousels', NOW)[0].post?.id, 'today');
});

test('with auto_run on, a Tuesday with no carousel offers and shows no carousel slot', () => {
  const d = lfdOn([]);
  assert.deepEqual(quotaCandidates(d, 'carousels', NOW), []);
  assert.equal(contentModel(d, NOW).plan.types.find((t) => t.vertical === 'carousels')!.windows.length, 0);
  assert.deepEqual(daySlots(d.posts, '2026-10-13', new Set<Vertical>(['carousels']), NOW, [2, 5]), []);
  // A Tuesday carousel gets no slot choices.
  const ready = { ...d.posts[0], vertical: 'carousels' } as HubPost;
  assert.deepEqual(slotChoices(d, ready, NOW), []);
  // Wednesday still offers both.
  assert.equal(slotChoices(d, ready, new Date('2026-10-14T12:00:00Z')).length, 2);
});

test('a Tuesday with Last Few Days off has no LFD card, slot or Run now step; with it on, all three', async () => {
  const { query } = await openHubTestDb();
  const { lfdDueOn, readLfdSettings } = await import('@/lib/lfd/settings');
  const { planFrom } = await import('@/lib/social-hub/run-today');
  const base = {
    today: '2026-10-13',
    reels: { quota: 0, held: 0, missing: [], slateToday: true },
    carousels: { quota: 0, held: 0, missing: [] },
    explainers: { quota: 0, held: 0, missing: [] },
    series: [],
    inFlight: { reelsRun: false, reelsBuilding: [], carouselRun: false, explainerTopics: [] },
    cost: { reelsNight: 2.5, reelBuild: 1, carouselCap: 2, explainerCap: 5, storySet: 0.45, lfdCap: 1 },
  };
  const look = async () => {
    const dayQuotas = await readDayQuotas(query, Promise.resolve(query));
    const s = await readLfdSettings(query);
    const step = planFrom({ ...base, lastFewDays: { due: lfdDueOn(s, '2026-10-13'), made: false } }).steps.find((x) => x.vertical === 'last_few_days');
    return {
      cards: quotaCandidates({ posts: [], ideas: [], dayQuotas }, 'last_few_days', TUE_8).length,
      slots: slotsForDay([], '2026-10-13', { ...dayQuotas, reels: 0, explainers: 0, carousels: 0 }).slots,
      step: step?.action,
      makeNow: planFrom({ ...base, lastFewDays: { due: lfdDueOn(s, '2026-10-13', true), made: false } }).steps.find((x) => x.vertical === 'last_few_days')?.action,
    };
  };
  // Tuesday: Morning Download + Free vs. Paid series are the 2 Stories slots.
  assert.deepEqual(await look(), { cards: 0, slots: 2, step: 'none', makeNow: 'lfd_run' }, 'off: no card, no slot, no run step; the page button still makes one');
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  assert.deepEqual(await look(), { cards: 1, slots: 3, step: 'lfd_run', makeNow: 'lfd_run' });
});
