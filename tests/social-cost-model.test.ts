import assert from 'node:assert/strict';
import test from 'node:test';

import { cacheSavings } from '@/lib/social-hub/cost-page/caching';
import { costModel, dailySeries, hoverCompare, pace, spikeDrivers } from '@/lib/social-hub/cost-page/model';
import { stageOf, vendorOf } from '@/lib/social-hub/cost-page/normalize';
import type { CostRow } from '@/lib/social-hub/cost-page/rows';
import { classifyWaste } from '@/lib/social-hub/cost-page/waste';

import { previewCost } from './fixtures/social-hub/cost-fixture';

const row = (nyDate: string, micros: number, over: Partial<CostRow> = {}): CostRow => ({
  nyDate, vertical: 'explainers', vendor: 'claude', stage: 'writing', micros, mode: 'production', unknown: false, runId: null, ...over,
});

test('components map to stages and vendors; unknown labels go to Other', () => {
  assert.equal(stageOf('reels', 'copy-caption'), 'writing');
  assert.equal(stageOf('reels', 'reel-background'), 'visuals');
  assert.equal(stageOf('reels', 'Kling clip'), 'video');
  assert.equal(stageOf('explainers', 'tts+bgm+sfx'), 'video');
  assert.equal(stageOf('stories', 'search'), 'research');
  assert.equal(stageOf('stories', 'zzz'), 'other');
  assert.equal(vendorOf('anthropic'), 'claude');
  assert.equal(vendorOf('kling'), 'video');
  assert.equal(vendorOf('openai'), 'images');
  assert.equal(vendorOf('web_search'), 'jev-search');
});

test('hover compares each series to its own previous-7-day average; zero history reads as new', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
  const rows = [
    ...days.slice(0, 7).map((d) => row(d, 3_000_000)),
    row('2026-10-08', 9_000_000),
    row('2026-10-08', 1_000_000, { vertical: 'stories' }),
  ];
  const h = hoverCompare(dailySeries(rows, days, 'type'), 7);
  const exp = h.parts.find((p) => p.label === 'Explainer Reels')!;
  assert.equal(exp.change, 'up');
  assert.equal(exp.pct, 200);
  assert.equal(h.parts.find((p) => p.label === 'IG Stories')!.change, 'new');
  const flat = hoverCompare(dailySeries([...days.map((d) => row(d, 3_000_000))], days, 'type'), 7);
  assert.equal(flat.parts.find((p) => p.label === 'Explainer Reels')!.change, 'same');
});

test('spike drivers rank type·stage lines by spend and ratio to their usual', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03'];
  const d = spikeDrivers([row('2026-10-01', 1e6, { stage: 'video' }), row('2026-10-02', 1e6, { stage: 'video' }), row('2026-10-03', 6e6, { stage: 'video' })], '2026-10-03', days);
  assert.equal(d[0]!.label, 'Explainer Reels · Video + render');
  assert.equal(d[0]!.ratio, 6);
});

test('pace projects the month linearly', () => {
  const p = pace(142_000_000, new Date('2026-10-13T16:00:00Z'), 360_000_000);
  // 12:00 NY on Oct 13 → 12.5 days elapsed; 142 / 12.5 × 31 = 352.16
  assert.equal(Math.round(p.projectedMicros / 1e6), 352);
  assert.equal(p.underWatch, true);
});

test('waste splits unshipped item cost into rejected, failed, expired; filtered is selection', () => {
  const w = classifyWaste({
    itemMicros: new Map([['a', 5e6], ['b', 3e6], ['c', 2e6], ['d', 4e6], ['e', 1e6]]),
    firstDay: new Map([['a', '2026-10-01'], ['b', '2026-10-01'], ['c', '2026-09-20'], ['d', '2026-10-12'], ['e', '2026-10-01']]),
    published: new Set(['e']), rejected: new Set(['a']), failed: new Set(['b']), inFlight: new Set(['d']), filtered: new Set(),
    unattributedMicros: 7e5, now: new Date('2026-10-13T16:00:00Z'), spendMicros: 20e6,
  });
  assert.deepEqual([w.rejected, w.failed, w.expired, w.selection], [5e6, 3e6, 2e6, 7e5]);
});

test('caching savings: reads saved minus the write premium, per model', () => {
  const s = cacheSavings([{ vertical: 'stories', model: 'claude-sonnet-5-5', readTokens: 1_000_000, writeTokens: 100_000 }]);
  // sonnet-5-5 input $2/Mtok: reads would cost $2, cost $0.20 → saved $1.80; writes premium 0.25 × $0.20 = $0.05
  assert.equal(Math.round(s.savedMicros), 1_750_000);
});

test('model: unknown-cost calls are surfaced, never priced as $0 savings', () => {
  const m = costModel(previewCost());
  assert.ok(m.unknownCalls > 0);
  assert.match(m.headline, /On pace for \$\d+/);
  assert.equal(m.series.type.keys.map((k) => k.label).join(','), 'Text on Screen,Explainer Reels,Carousels,IG Stories');
  assert.equal(m.budget.length, 4);
});

test('wasteSets SQL runs against the real schema: rejected stories set and failed reels job are keyed', async () => {
  const { wasteSets } = await import('@/lib/social-hub/cost-page/waste');
  const { openHubTestDb } = await import('./fixtures/social-hub/pglite');
  const { IDS, seedHubFixture } = await import('./fixtures/social-hub/seed');
  const { pg, query } = await openHubTestDb();
  await seedHubFixture(pg);
  const storySet = (await pg.query<{ id: string }>(
    `INSERT INTO stories.sets (series, ny_date, status, trigger, style) VALUES ('morning_download', '2026-10-10', 'rejected', 'auto', 'polished') RETURNING id::text`,
  )).rows[0]!.id;
  await pg.query(`UPDATE reels.video_jobs SET status = 'failed' WHERE id = $1`, [IDS.video2]);
  const w = await wasteSets(query, null);
  assert.ok(w.rejected.has(`stories:${storySet}`));
  assert.ok(w.failed.has(`reels:${IDS.idea2}:${IDS.slate}`));
});
