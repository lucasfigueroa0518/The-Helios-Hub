// tests/social-health-view.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefFor } from '@/lib/social-hub/health/brief';
import { healthModel, nightRecurrence, ordinal } from '@/lib/social-hub/health/view';
import { emptyReport } from '@/lib/social-hub/health/reporters/shared';
import { historyNights, nightsEnding } from '@/lib/social-hub/health/time';
import type { StoredReport } from '@/lib/social-hub/health/types';
import { nightVerdict } from '@/lib/social-hub/health/verdict';
import type { Vertical } from '@/lib/social-hub/types';

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
  assert.deepEqual(m.rows.map((r) => r.label), ['Text on Screen', 'Explainer Reels', 'Carousels', 'IG Stories', 'Last Few Days', 'AI Events This Week', 'Publisher']);
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

test('date formats: eyebrow has no year; card titles are short', () => {
  const m = healthModel({ ...previewHealth(), windowNights: 14 });
  assert.equal(m.eyebrow, 'Morning report · Thursday, October 8 · 7:30 AM');
  assert.equal(m.rows[2]!.blocks.at(-1)!.card.title, 'Carousels · Thu Oct 8');
  assert.equal(m.rows.at(-1)!.blocks.at(-1)!.card.title, 'Publisher · Thu Oct 8');
});

test('publisher-only failure names the publisher', () => {
  const h = previewHealth();
  const stored = h.stored.slice(0, -1).map((r, i, a) => (i === a.length - 1 ? { ...r, verdict: { ...r.verdict, publisher: 'failed' as const } } : r));
  const m = healthModel({ ...h, stored, now: new Date('2026-10-07T19:00:00Z'), windowNights: 14 });
  assert.equal(m.headline.emphasis, 'The publisher stopped.');
  assert.equal(m.lede, "Posts can't go out until the publisher is running again.");
});

test('ordinals past seventh are correct English', () => {
  assert.equal(ordinal(21), '21st');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(22), '22nd');
  assert.equal(ordinal(3), 'third');
});

// ── History beyond the visible window (month count, New best) ────────────────

function storedNights(last: string, n: number, failedNights: readonly string[]): StoredReport[] {
  return nightsEnding(last, n).map((night) => {
    const bad = failedNights.includes(night);
    const reports = (['reels', 'explainers', 'carousels', 'stories'] as Vertical[]).map((v) => ({
      ...emptyReport(v, night), due: true, ran: true, target: 1, made: bad && v === 'carousels' ? 0 : 1, needed: 1, ready: 1,
    }));
    return { night, builtAt: `${night}T11:30:00Z`, verdict: nightVerdict(night, reports, 'worked'), reports, failures: [] };
  });
}

test('history: loads at least 30 nights and back to the 1st of the month', () => {
  assert.equal(historyNights('2026-10-08'), 30);
  assert.equal(historyNights('2026-10-31'), 31);
});

test('month count uses loaded nights beyond the 14-night window', () => {
  const stored = storedNights('2026-10-20', 30, ['2026-10-02']);
  const m = healthModel({ stored, live: null, readiness: [], now: new Date('2026-10-20T12:00:00Z'), windowNights: 14 });
  assert.ok(m.rows.every((r) => r.blocks.length === 14));
  assert.deepEqual(m.monthClean, { clean: 19, nights: 20 }); // Oct 1–20, Oct 2 failed (outside the window)
  assert.ok(m.chips.some((c) => c.text === 'Clean nights this month 19 of 20'));
});

test('New best does not fire when an older, longer streak sits outside the window', () => {
  // 09-11..09-25 clean (15), 09-26 and 09-27 failed, 09-28..10-10 clean (13).
  const stored = storedNights('2026-10-10', 30, ['2026-09-26', '2026-09-27']);
  const now = new Date('2026-10-10T12:00:00Z');
  const m = healthModel({ stored, live: null, readiness: [], now, windowNights: 14 });
  assert.equal(m.chips.some((c) => c.id === 'best'), false);
  // Only the 14 visible nights would have wrongly called 13 a new best.
  const narrow = healthModel({ stored: stored.slice(-14), live: null, readiness: [], now, windowNights: 14 });
  assert.equal(narrow.chips.some((c) => c.id === 'best'), true);
});

test('night detail: a failure says how often it was seen in 14 nights and links the others', () => {
  const { stored } = previewHealth();
  const seen = nightRecurrence('2026-10-08', stored); // 30 nights passed; only the 14 ending 10-08 count
  const writer = seen.get('carousels|writer|too_long')!;
  assert.equal(writer.count, 3);
  assert.deepEqual(writer.others, ['2026-09-28', '2026-10-03']);
  for (const n of ['2026-09-28', '2026-10-03', '2026-10-08', 'slide 3 over 40 words']) assert.ok(writer.brief.includes(n), n);
  assert.equal(seen.get('explainers|publish|service_5xx')!.count, 1);
  // Viewed from 10-03, the 10-08 occurrence is in the future and not counted.
  assert.deepEqual(nightRecurrence('2026-10-03', stored).get('carousels|writer|too_long')!.others, ['2026-09-28']);
});
