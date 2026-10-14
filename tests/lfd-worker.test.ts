// tests/lfd-worker.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { threeAmQueue } from '@/lib/lfd/clock';
import type { LfdRunDeps } from '@/lib/lfd/run';
import { parseLfdSettings } from '@/lib/lfd/settings';
import { claimRun, finishRun, requestRun, type ClaimedRun } from '@/lib/lfd/store';
import { carryOutLfdRun, type CarryOutDeps } from '@/lib/lfd/worker';
import { bookSlot, ensureContentItem, type SpineQuery } from '@/lib/social-hub/spine';
import type { HubQuery } from '@/lib/social-hub/db';

import { seedLfdPost } from './fixtures/lfd/seed';
import { openHubTestDb } from './fixtures/social-hub/pglite';

/** Tuesday 2026-10-13, 3:00 AM New York. */
const TUE_3 = new Date('2026-10-13T07:00:00Z');

test('the 3:00 slot: Last Few Days on its days while its auto_run is on, else the carousel rule', () => {
  const on = parseLfdSettings([{ key: 'auto_run', value: true }]);
  const off = parseLfdSettings([]);
  assert.equal(threeAmQueue('2026-10-13', on, true).queue, 'last_few_days', 'Tuesday: LFD, and no carousel run');
  assert.equal(threeAmQueue('2026-10-16', on, false).queue, 'last_few_days', 'Friday');
  assert.equal(threeAmQueue('2026-10-14', on, true).queue, 'carousels', 'Wednesday is a carousel day');
  assert.equal(threeAmQueue('2026-10-14', on, false).queue, 'none');
  assert.equal(threeAmQueue('2026-10-13', off, true).queue, 'carousels', 'LFD off: Tuesday is a carousel day');
  assert.equal(threeAmQueue('2026-10-13', null, true).queue, 'carousels', 'unreadable lfd settings change nothing');
  const badCap = threeAmQueue('2026-10-13', parseLfdSettings([{ key: 'auto_run', value: true }, { key: 'run_cap_usd', value: 'abc' }]), true);
  assert.equal(badCap.queue, 'none', 'its day stays its own: no carousel run either');
  assert.match(badCap.reason, /run_cap_usd/);
});

async function claimed(query: HubQuery, trigger: 'scheduled' | 'manual'): Promise<ClaimedRun> {
  await requestRun(query, trigger, 1);
  return (await claimRun(query, TUE_3))!;
}

function worker(query: HubQuery, over: Partial<CarryOutDeps> = {}) {
  const logs: string[] = [];
  const ran: Array<{ runId?: string; capUsd: number; trigger: string }> = [];
  const w: CarryOutDeps = {
    query,
    now: () => TUE_3,
    log: (message) => { logs.push(message); },
    engine: async () => ({ query }) as unknown as LfdRunDeps,
    run: async (d) => {
      ran.push({ runId: d.runId, capUsd: d.capUsd, trigger: d.trigger });
      const postId = await seedLfdPost(query, { nyDate: '2026-10-13' });
      await finishRun(query, d.runId!, { status: 'ok', claudeUsd: 0.2, jevUsd: 0.05, record: {} });
      return { ok: true as const, runId: d.runId!, postId, stories: 6, short: false };
    },
    ...over,
  };
  return { w, logs, ran };
}

test('a claimed run is carried out with the settings cap; its post joins the spine and, when live, takes today’s window', async () => {
  const { query } = await openHubTestDb();
  await query(`UPDATE lfd.settings SET value = 'true'::jsonb WHERE key = 'publishing_live'`);
  await query(`UPDATE lfd.settings SET value = '0.8'::jsonb WHERE key = 'run_cap_usd'`);
  const run = await claimed(query, 'manual');
  const { w, ran } = worker(query);
  const out = await carryOutLfdRun(w, run);
  assert.equal(out.status, 'ok');
  assert.deepEqual(ran, [{ runId: run.id, capUsd: 0.8, trigger: 'manual' }]);
  const item = (await query<{ native_ref: string; format: string; idea_ref: string | null }>(`SELECT native_ref, format, idea_ref FROM social_hub.content_items WHERE vertical = 'last_few_days'`)).rows[0]!;
  assert.deepEqual([item.native_ref, item.format, item.idea_ref], [out.postId, 'feed', null]);
  const slot = (await query<{ d: string; slot: string; source: string }>(`SELECT ny_date::text AS d, slot, source FROM social_hub.schedule`)).rows[0]!;
  assert.deepEqual([slot.d, slot.slot, slot.source], ['2026-10-13', 'morning', 'auto']);
});

test('publishing off: the post joins the spine but books nothing', async () => {
  const { query } = await openHubTestDb();
  const { w } = worker(query);
  const out = await carryOutLfdRun(w, await claimed(query, 'manual'));
  assert.equal(out.status, 'ok');
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.content_items WHERE vertical = 'last_few_days'`)).rows[0]!.n, 1);
  assert.equal((await query<{ n: number }>(`SELECT count(*)::int AS n FROM social_hub.schedule`)).rows[0]!.n, 0);
});

test('daily fill: a scheduled run on a day a person already placed a post is skipped; a manual run is not', async () => {
  const { query } = await openHubTestDb();
  const placed = await seedLfdPost(query, { slug: 'lfd-placed' });
  const item = await ensureContentItem(query as SpineQuery, { vertical: 'last_few_days', format: 'feed', nativeRef: placed, ideaRef: null });
  await bookSlot(query as SpineQuery, { vertical: 'last_few_days', itemId: item, nyDate: '2026-10-13', slot: 'morning', publishAt: new Date('2026-10-13T13:30:00Z'), source: 'user' });
  const scheduled = await claimed(query, 'scheduled');
  const a = worker(query);
  const out = await carryOutLfdRun(a.w, scheduled);
  assert.equal(out.status, 'skipped');
  assert.deepEqual(a.ran, []);
  const row = (await query<{ status: string; stop_reason: string }>(`SELECT status, stop_reason FROM lfd.runs WHERE id = $1`, [scheduled.id])).rows[0]!;
  assert.equal(row.status, 'skipped');
  assert.match(row.stop_reason, /^quota-filled: Daily fill: people placed 1 Last Few Days post for 2026-10-13/);
  const b = worker(query, { run: async (d) => { await finishRun(query, d.runId!, { status: 'ok', claudeUsd: 0, jevUsd: 0, record: {} }); return { ok: true as const, runId: d.runId!, postId: placed, stories: 6, short: false }; } });
  assert.equal((await carryOutLfdRun(b.w, await claimed(query, 'manual'))).status, 'ok');
});

test('a bad cap or a throwing engine fails the run before any spend, and the worker goes on', async () => {
  const { query } = await openHubTestDb();
  await query(`UPDATE lfd.settings SET value = '"abc"'::jsonb WHERE key = 'run_cap_usd'`);
  const bad = worker(query);
  const run = await claimed(query, 'manual');
  const out = await carryOutLfdRun(bad.w, run);
  assert.equal(out.status, 'failed');
  assert.deepEqual(bad.ran, []);
  assert.match((await query<{ error: string }>(`SELECT error FROM lfd.runs WHERE id = $1`, [run.id])).rows[0]!.error, /run_cap_usd is not a positive number/);

  await query(`UPDATE lfd.settings SET value = '1'::jsonb WHERE key = 'run_cap_usd'`);
  const boom = worker(query, { engine: async () => { throw new Error('ANTHROPIC_API_KEY is not set'); } });
  const second = await claimed(query, 'manual');
  assert.equal((await carryOutLfdRun(boom.w, second)).status, 'failed');
  const row = (await query<{ status: string; error: string }>(`SELECT status, error FROM lfd.runs WHERE id = $1`, [second.id])).rows[0]!;
  assert.deepEqual([row.status, row.error], ['failed', 'ANTHROPIC_API_KEY is not set']);
});
