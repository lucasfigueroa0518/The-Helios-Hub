/**
 * P1-M3 cost model (§8a): reconciliation properties to the micro-dollar,
 * no double counting, reused posts add $0, plus the real ledger SQL on PGlite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocate,
  costOfPosts,
  costStats,
  formatUsd,
  itemTotals,
  largestRemainder,
  perDollar,
  summarize,
  toMicros,
  withCosts,
  type LedgerRow,
  type Pool,
} from '@/lib/social-hub/cost';
import { buildDataset, findPost } from '@/lib/social-hub/dataset';
import { hubId } from '@/lib/social-hub/ids';
import { readAll } from '@/lib/social-hub/load';
import { agreement, buildLedger, readCosts, reelItem } from '@/lib/social-hub/queries/costs';
import type { HubPost, Vertical } from '@/lib/social-hub/types';
import { KLING_USD_PER_CLIP } from '@/lib/reels/insights';

import { openHubTestDb } from './fixtures/social-hub/pglite';
import { IDS, SEEDED_LEDGER_MICROS, seedHubFixture } from './fixtures/social-hub/seed';

const VERTICALS: Vertical[] = ['reels', 'explainers', 'carousels', 'stories'];

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function randomLedger(seed: number): { rows: LedgerRow[]; pools: Pool[] } {
  const r = lcg(seed);
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
  const pools: Pool[] = [];
  for (const v of VERTICALS) {
    for (const d of days) {
      const n = Math.floor(r() * 4); // 0 items = a night with no output
      pools.push({
        key: `${v}:${d}`,
        items: Array.from({ length: n }, (_, i) => ({ item: `${v}:${d}:${i}`, weight: r() < 0.3 ? 0 : Math.round(r() * 1000) / 7 })),
      });
    }
  }
  const rows: LedgerRow[] = [];
  for (let i = 0; i < 300; i++) {
    const v = VERTICALS[Math.floor(r() * 4)]!;
    const d = days[Math.floor(r() * days.length)]!;
    const micros = Math.floor(r() * 5_000_000) + (r() < 0.1 ? 1 : 0);
    rows.push(r() < 0.5
      ? { id: `r${i}`, vertical: v, nyDate: d, micros, target: { kind: 'item', item: `${v}:${d}:${Math.floor(r() * 3)}` }, label: 'direct' }
      : { id: `r${i}`, vertical: v, nyDate: d, micros, target: { kind: 'pool', pool: `${v}:${d}` }, label: 'shared' });
  }
  return { rows, pools };
}

test('largest remainder: parts sum exactly, stay within one micro of exact, ignore bad weights', () => {
  for (let seed = 1; seed < 60; seed++) {
    const r = lcg(seed);
    const amount = Math.floor(r() * 10_000_000) - (seed % 5 === 0 ? 5_000_000 : 0);
    const weights = Array.from({ length: 1 + Math.floor(r() * 7) }, () => (r() < 0.2 ? 0 : r() * 100));
    const parts = largestRemainder(amount, weights);
    assert.equal(parts.reduce((a, b) => a + b, 0), amount, `seed ${seed}`);
    assert.ok(parts.every(Number.isInteger));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total > 0) weights.forEach((w, i) => assert.ok(Math.abs(parts[i]! - (amount * w) / total) < 1));
  }
  assert.deepEqual(largestRemainder(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(largestRemainder(10, [0, 0]), [5, 5], 'all-zero weights split equally');
  assert.deepEqual(largestRemainder(10, [Number.NaN, 1]), [0, 10]);
  assert.throws(() => largestRemainder(1.5, [1]));
});

test('Σ items + Unattributed = Σ ledger, for every window and vertical, to the micro-dollar', () => {
  for (const seed of [3, 11, 97, 2026]) {
    const { rows, pools } = randomLedger(seed);
    const ledger = allocate(rows, pools);
    const windows = [
      { from: null, to: '2026-10-31' },
      { from: '2026-10-02', to: '2026-10-03' },
      { from: '2026-10-04', to: '2026-10-04' },
      { from: '2026-11-01', to: '2026-11-30' },
    ];
    for (const w of windows) {
      for (const vertical of [null, ...VERTICALS]) {
        const s = summarize(ledger, { ...w, vertical });
        assert.equal(s.itemMicros + s.unattributedMicros, s.ledgerMicros, `seed ${seed} ${w.from}..${w.to} ${vertical}`);
        const byV = Object.values(s.byVertical);
        assert.equal(byV.reduce((a, v) => a + v.ledger, 0), s.ledgerMicros, 'Σ verticals = hub total');
        for (const v of byV) assert.equal(v.items + v.unattributed, v.ledger);
      }
    }
  }
});

test('nothing is counted twice: each row allocates exactly its own amount once', () => {
  const { rows, pools } = randomLedger(7);
  const ledger = allocate(rows, pools);
  const byRow = new Map<string, number>();
  for (const a of ledger.allocations) byRow.set(a.rowId, (byRow.get(a.rowId) ?? 0) + a.micros);
  for (const u of ledger.unattributed) {
    assert.equal(byRow.has(u.rowId), false, 'an unattributed row is not also allocated');
    byRow.set(u.rowId, u.micros);
  }
  for (const row of rows) assert.equal(byRow.get(row.id), row.micros, row.id);
  const totals = itemTotals(ledger);
  assert.equal([...totals.values()].reduce((a, b) => a + b, 0), ledger.allocations.reduce((a, b) => a + b.micros, 0));
});

test('a shared cost with no item stays Unattributed on its own day, never spread to other days', () => {
  const rows: LedgerRow[] = [
    { id: 'a', vertical: 'reels', nyDate: '2026-10-01', micros: 700_000, target: { kind: 'pool', pool: 'night-1' }, label: 'scoring' },
    { id: 'b', vertical: 'reels', nyDate: '2026-10-02', micros: 300_000, target: { kind: 'pool', pool: 'night-2' }, label: 'scoring' },
  ];
  const ledger = allocate(rows, [{ key: 'night-1', items: [] }, { key: 'night-2', items: [{ item: 'x' }] }]);
  assert.deepEqual(ledger.unattributed.map((u) => [u.rowId, u.nyDate, u.micros]), [['a', '2026-10-01', 700_000]]);
  assert.deepEqual(ledger.allocations.map((a) => [a.item, a.micros]), [['x', 300_000]]);
  assert.equal(summarize(ledger, { from: '2026-10-02', to: '2026-10-02' }).unattributedMicros, 0);
});

function post(p: Partial<HubPost>): HubPost {
  return { id: 'p', vertical: 'carousels', status: 'published', costItemKey: null, costMicros: null, nyDate: '2026-10-01', ...p } as HubPost;
}

test('a reused post adds $0 when it posts later and says when it was generated', () => {
  const rows: LedgerRow[] = [{ id: 'gen', vertical: 'carousels', nyDate: '2026-10-01', micros: 900_000, target: { kind: 'item', item: 'story-9' }, label: 'stages' }];
  const ledger = allocate(rows, []);
  const [reused] = withCosts([post({ id: 'later', costItemKey: 'story-9', nyDate: '2026-10-05' })], ledger);
  assert.equal(reused!.costMicros, 900_000);
  assert.equal(reused!.costNote, 'generated 2026-10-01');
  // The posting day carries no spend.
  assert.equal(summarize(ledger, { from: '2026-10-05', to: '2026-10-05' }).ledgerMicros, 0);
});

test('an item under several posts or groupings is counted once in totals', () => {
  const posts = [
    post({ id: 'a', costItemKey: 'i1', costMicros: 500 }),
    post({ id: 'b', costItemKey: 'i1', costMicros: 500 }),
    post({ id: 'c', costItemKey: 'i2', costMicros: 200 }),
    post({ id: 'd', costItemKey: null }),
  ];
  assert.deepEqual(costOfPosts(posts), { micros: 700, items: 2, unknown: 1 });
});

test('cost stats are numerator ÷ denominator; per-dollar values; money formatting', () => {
  const rows: LedgerRow[] = [
    { id: '1', vertical: 'explainers', nyDate: '2026-10-01', micros: 3_000_000, target: { kind: 'item', item: 'shipped' }, label: 'render' },
    { id: '2', vertical: 'explainers', nyDate: '2026-10-01', micros: 1_000_000, target: { kind: 'item', item: 'unshipped' }, label: 'render' },
    { id: '3', vertical: 'explainers', nyDate: '2026-10-01', micros: 500_000, target: { kind: 'pool', pool: 'none' }, label: 'ideas' },
  ];
  const ledger = allocate(rows, []);
  const stats = costStats(ledger, [post({ vertical: 'explainers', costItemKey: 'shipped' })], { from: '2026-10-01', to: '2026-10-01' });
  assert.deepEqual(stats.perPublishedPost, { numerator: 3_000_000, denominator: 1, value: 3_000_000 });
  assert.deepEqual(stats.perGeneratedItem, { numerator: 4_000_000, denominator: 2, value: 2_000_000 });
  assert.equal(stats.yield.numerator, 3_000_000);
  assert.equal(stats.yield.denominator, 4_500_000);
  assert.equal(stats.unshippedMicros, 1_000_000);
  assert.equal(stats.unattributedMicros, 500_000);
  assert.equal(perDollar(300, 1_500_000), 200);
  assert.equal(perDollar(300, 0), null);
  assert.equal(toMicros('0.0000005'), 1);
  assert.equal(formatUsd(1_234_567), '$1.23');
  assert.equal(formatUsd(1_234), '$0.0012');
  assert.equal(formatUsd(null), '—');
});

// ── Real ledger SQL on PGlite ────────────────────────────────────────────────

test('the real ledgers reconcile end to end, with the expected attribution per vertical', async () => {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  const costs = await readCosts(query);
  assert.deepEqual(agreement(costs), [], 'denormalized totals agree with their rows');

  const { rows, pools } = buildLedger(costs);
  const ledger = allocate(rows, pools);
  const perRow = new Map<string, number>();
  for (const a of ledger.allocations) perRow.set(a.rowId, (perRow.get(a.rowId) ?? 0) + a.micros);
  for (const u of ledger.unattributed) perRow.set(u.rowId, (perRow.get(u.rowId) ?? 0) + u.micros);
  for (const row of rows) assert.equal(perRow.get(row.id), row.micros, `row ${row.id} counted exactly once`);
  assert.equal(new Set(rows.map((x) => x.id)).size, rows.length, 'row ids are unique');
  const kling = toMicros(KLING_USD_PER_CLIP);
  const all = summarize(ledger, { from: null, to: '2026-12-31' });
  assert.equal(all.byVertical.reels.ledger, SEEDED_LEDGER_MICROS.reelsEvents + kling);
  assert.equal(all.byVertical.explainers.ledger, SEEDED_LEDGER_MICROS.explainers);
  assert.equal(all.byVertical.carousels.ledger, SEEDED_LEDGER_MICROS.carousels);
  assert.equal(all.byVertical.stories.ledger, SEEDED_LEDGER_MICROS.stories);
  assert.equal(all.itemMicros + all.unattributedMicros, all.ledgerMicros);

  const totals = itemTotals(ledger);
  // Direct rows split 1:2 by job spend (0.3 vs 0.6): 0.2 → 66,667 / 133,333; 0.0001 → 33 / 67.
  // Night rows and the no-run day row split equally across the two reels made.
  assert.equal(totals.get(reelItem(IDS.idea1, IDS.slate)), 66_667 + 33 + 250_000 + 166_650 + 25_000 + kling);
  assert.equal(totals.get(reelItem(IDS.idea2, IDS.slate)), 133_333 + 67 + 250_000 + 166_650 + 25_000);
  assert.equal(totals.get(`explainers:${IDS.job1}`), 3_530_000, 'job spend + that day\'s idea cycle');
  assert.equal(totals.get(`explainers:${IDS.job2}`), 2_900_000);
  assert.equal(totals.get('carousels:story:story-1'), 750_000 + 300_000, 'every run that touched the story (SH-56)');
  assert.equal(totals.get('carousels:story:story-2'), 550_000, 'the preview run stays off the shipped post');
  assert.equal(totals.get(`carousels:preview:${IDS.socRunPreview}:story-2`), 200_000, 'preview spend is unshipped');
  assert.equal(totals.get(`stories:${IDS.set1}`), 210_000, 'set rows + the day\'s set-less rows');
  assert.deepEqual(
    ledger.unattributed.map((u) => [u.vertical, u.nyDate, u.micros]).sort(),
    [['carousels', '2026-10-07', 400_000], ['reels', '2026-10-07', 700_000], ['stories', '2026-10-09', 10_000]].sort(),
  );

  const d = buildDataset(await readAll(query), costs, new Date('2026-10-08T12:00:00Z'));
  assert.deepEqual(d.costNotes, []);
  const cost = (id: string) => findPost(d, id)?.costMicros;
  const reelCost = 66_667 + 33 + 250_000 + 166_650 + 25_000 + kling;
  assert.equal(cost(hubId('reels', 'attempt', IDS.reelAttempt)), reelCost);
  assert.equal(cost(hubId('reels', 'attempt', IDS.reelAttemptFailed)), reelCost, 'a second try shows the same content cost');
  // Both tries are one post now (D46): the failed try folded into the published reel.
  assert.equal(findPost(d, hubId('reels', 'attempt', IDS.reelAttempt)), findPost(d, hubId('reels', 'attempt', IDS.reelAttemptFailed)));
  assert.equal(costOfPosts([findPost(d, hubId('reels', 'attempt', IDS.reelAttempt))!]).micros, reelCost, 'counted once');
  assert.equal(cost(hubId('carousels', 'attempt', IDS.socAttempt)), 1_050_000);
  // Reused content adds $0 when it posts: the published carousel's cost is the sum of the runs that made it,
  // and no row exists on any posting day beyond those runs.
  const posted = findPost(d, hubId('carousels', 'attempt', IDS.socAttempt))!;
  assert.equal(posted.costNote, null, 'made 10-06, posted 10-06');
  assert.equal(cost(hubId('carousels', 'post', IDS.socPost2)), 550_000);
  assert.equal(cost(hubId('stories', 'set', IDS.set1)), 210_000);
  assert.equal(cost(hubId('explainers', 'job', IDS.job2)), 2_900_000);
  assert.equal(cost(hubId('reels', 'schedule', IDS.reelSched2)), null, 'no render yet, no cost');
});

test('a disagreement between a denormalized total and its rows is reported, not added', async () => {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  await pg.exec(`UPDATE explainers.jobs SET spend_usd = 9 WHERE id = '${IDS.job2}'`);
  const costs = await readCosts(query);
  const notes = agreement(costs);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /spend_usd 9/);
  const { rows, pools } = buildLedger(costs);
  assert.equal(itemTotals(allocate(rows, pools)).get(`explainers:${IDS.job2}`), 2_900_000, 'the rows win; the total is only checked');
});

test('carousel run story costs above total_usd are reported, never allocated as negative money', async () => {
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  await pg.exec(`UPDATE social.runs SET total_usd = 0, status = 'failed' WHERE id = '${IDS.socRunRerun}'`);
  const costs = await readCosts(query);
  assert.ok(agreement(costs).some((n) => /story costs 0.25 exceed total_usd 0/.test(n)));
  const ledger = allocate(...Object.values(buildLedger(costs)) as [LedgerRow[], Pool[]]);
  assert.ok(ledger.allocations.every((a) => a.micros >= 0));
  assert.ok(ledger.unattributed.every((u) => u.micros >= 0));
});
