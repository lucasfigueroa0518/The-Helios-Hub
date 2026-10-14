import assert from 'node:assert/strict';
import test from 'node:test';

import { busyFeedTimes } from '@/lib/instagram/feed-spacing';
import { placementRules, planPlacement } from '@/lib/social-hub/placement';
import { bookSlot, ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';
import { schedulePost } from '@/lib/social/overnight/schedule';
import type { Query } from '@/lib/social/store/pg';

import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Tuesday 2026-10-13, 8:00 AM New York. */
const TUE = new Date('2026-10-13T12:00:00Z');

test('placement: Last Few Days has one morning window on its days, spaced from other feed posts', async () => {
  const { query } = await openHubTestDb();
  const q = query as SpineQuery;
  const rules = await placementRules(q, 'last_few_days');
  assert.deepEqual(rules.windows.map((w) => [w.id, w.startMinute, w.endMinute, w.days]), [['morning', 540, 600, [2, 5]]]);
  assert.equal(rules.spaced, true);
  const wed = await planPlacement(q, { vertical: 'last_few_days', nyDate: '2026-10-14', slot: 'morning', now: TUE, rng: () => 0 });
  assert.equal(wed.ok, false);
  assert.match(wed.ok ? '' : wed.note, /doesn’t post on Wednesdays/);
  assert.equal((await planPlacement(q, { vertical: 'last_few_days', nyDate: '2026-10-13', slot: 'morning', now: TUE, rng: () => 0 })).ok, true);
  assert.equal((await planPlacement(q, { vertical: 'last_few_days', nyDate: '2026-10-13', slot: 'afternoon', now: TUE })).ok, false);
});

test('placement: carousels give up Tuesday and Friday only while Last Few Days auto_run is on', async () => {
  const { query } = await openHubTestDb();
  const q = query as SpineQuery;
  assert.deepEqual((await placementRules(q, 'carousels')).windows.map((w) => w.days), [undefined, undefined]);
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  assert.deepEqual((await placementRules(q, 'carousels')).windows.map((w) => w.days), [[0, 1, 3, 4, 6], [0, 1, 3, 4, 6]]);
});

test('a carousel approved on a Tuesday is booked Tuesday, or Wednesday while Last Few Days is on', async () => {
  const { query } = await openHubTestDb();
  const insert = async (slug: string) =>
    (await query<{ id: string }>(
      `INSERT INTO social.posts (slug, title, status, render, origin, slide_objects) VALUES ($1, 't', 'review', '{}'::jsonb, 'pipeline', '["a","b"]'::jsonb) RETURNING id::text AS id`,
      [slug],
    )).rows[0]!.id;
  const q = query as unknown as Query;
  const before = await schedulePost(q, await insert('c-1'), 'user', TUE, undefined, () => 0);
  assert.equal(before.scheduled, true);
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'auto_run'`);
  const after = await schedulePost(q, await insert('c-2'), 'user', TUE, undefined, () => 0);
  assert.equal(after.scheduled, true);
  const days = (await query<{ d: string }>(`SELECT ny_date::text AS d FROM social_hub.schedule ORDER BY created_at`)).rows.map((r) => r.d);
  assert.deepEqual(days, ['2026-10-13', '2026-10-14']);
});

test('feed spacing counts a booked Last Few Days post', async () => {
  const { query } = await openHubTestDb();
  const q = query as SpineQuery;
  const item = await ensureContentItem(q, { vertical: 'last_few_days', format: 'feed', nativeRef: 'p1', ideaRef: null });
  await bookSlot(q, { vertical: 'last_few_days', itemId: item, nyDate: '2026-10-13', slot: 'morning', publishAt: new Date('2026-10-13T13:20:00Z'), source: 'auto' });
  assert.ok((await busyFeedTimes(q, TUE)).some((b) => b.toISOString() === '2026-10-13T13:20:00.000Z'));
  assert.equal((await busyFeedTimes(q, TUE, 'lfd')).length, 0);
});
