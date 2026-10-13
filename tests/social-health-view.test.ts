// tests/social-health-view.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefFor } from '@/lib/social-hub/health/brief';
import { healthModel } from '@/lib/social-hub/health/view';

import { previewHealth } from './fixtures/social-hub/health-fixture';

test('headline names the type that failed and how often', () => {
  const m = healthModel({ ...previewHealth(), windowNights: 14 });
  assert.equal(m.reportNight, '2026-10-08');
  assert.equal(m.headline.lead, 'Last night, 3 of 4 worked.');
  assert.equal(m.headline.emphasis, "Carousels didn't.");
  assert.match(m.lede, /Writer/);
  assert.match(m.lede, /third time in 14 nights/);
  assert.equal(m.clean, false);
});

test('rows: one per type plus publisher, labels from VERTICALS, 14 blocks each', () => {
  const m = healthModel({ ...previewHealth(), windowNights: 14 });
  assert.deepEqual(m.rows.map((r) => r.label), ['Text on Screen', 'Explainer Reels', 'Carousels', 'IG Stories', 'Publisher']);
  assert.ok(m.rows.every((r) => r.blocks.length === 14));
  const car = m.rows[2]!;
  assert.equal(car.blocks.at(-1)!.tone, 'failed');
  assert.equal(car.blocks.at(-1)!.card.status, 'Failed');
  assert.deepEqual(car.blocks.at(-1)!.card.lines[0], ['Made', '0 of 1']);
  assert.match(car.blocks.at(-1)!.card.why ?? '', /Writer/);
  assert.equal(m.rows[0]!.blocks.at(-1)!.card.why, 'Clean night ✓');
});

test('problems: writer problem current and back again; fixed list empty in this window', () => {
  const m = healthModel({ ...previewHealth(), windowNights: 14 });
  const writer = m.problems.find((p) => p.key === 'carousels|writer|too_long')!;
  assert.equal(writer.tone, 'current');
  assert.equal(writer.count, 3); // 09-28, 10-03 and 10-08 all fall inside 09-25..10-08
  assert.equal(writer.backAgain, true);
  assert.equal(m.fixed.length, 0);
});

test('a clean night reads as clean and gets streak chips', () => {
  const h = previewHealth();
  const stored = h.stored.slice(0, -1); // drop 10-08 → 10-07 is newest and clean
  const m = healthModel({ ...h, stored, now: new Date('2026-10-07T19:00:00Z'), windowNights: 14 });
  assert.equal(m.clean, true);
  assert.equal(m.headline.lead, 'Clean night.');
  assert.ok(m.chips.some((c) => /clean nights/.test(c.text)));
});

test('no reports yet → empty model with a first-report note', () => {
  const m = healthModel({ stored: [], live: null, readiness: [], now: new Date('2026-10-13T12:00:00Z'), windowNights: 14 });
  assert.equal(m.empty, true);
});

test('brief carries type, stage, reason, raw error, nights and files', () => {
  const m = healthModel({ ...previewHealth(), windowNights: 14 });
  const brief = briefFor(m.problems.find((p) => p.key === 'carousels|writer|too_long')!);
  for (const s of ['Carousels', 'Writer', 'too_long', 'slide 3 over 40 words', '2026-10-03', 'lib/social/']) assert.ok(brief.includes(s), s);
});
