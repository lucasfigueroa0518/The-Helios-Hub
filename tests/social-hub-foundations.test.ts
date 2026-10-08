import assert from 'node:assert/strict';
import test from 'node:test';

import { hubId, parseHubId, postHref } from '@/lib/social-hub/ids';
import { hubBaseOf, hubHref, withParams } from '@/lib/social-hub/links';
import { byMetric, formatMetric, formatMetricKey, metricsFor, topPerformers } from '@/lib/social-hub/metrics';
import { addDays, inRange, isDayKey, monthGrid, monthOf, nyDateOf, parseRange, rangeBounds, shiftMonth } from '@/lib/social-hub/time';
import type { HubPost } from '@/lib/social-hub/types';

const U = '0b7f2c4e-1111-4a5b-9c9d-0123456789ab';

test('hub ids round-trip for every vertical and kind', () => {
  const cases: Array<[Parameters<typeof hubId>[0], Parameters<typeof hubId>[1]]> = [
    ['reels', 'attempt'], ['reels', 'schedule'],
    ['explainers', 'attempt'], ['explainers', 'schedule'], ['explainers', 'job'],
    ['carousels', 'attempt'], ['carousels', 'schedule'], ['carousels', 'post'],
    ['stories', 'set'],
  ];
  // Two-part ids are content ids (D46); an older attempt or set id has the same shape and parses as content.
  const twoPart = new Set(['attempt', 'set', 'content']);
  for (const [vertical, kind] of [...cases, ['reels', 'content'], ['carousels', 'content'], ['explainers', 'content'], ['stories', 'content'], ['reels', 'idea']] as typeof cases) {
    const id = hubId(vertical, kind, U);
    const parsedKind = twoPart.has(kind) ? 'content' : kind;
    assert.deepEqual(parseHubId(id), { vertical, kind: parsedKind, ref: U }, id);
    assert.deepEqual(parseHubId(encodeURIComponent(id)), { vertical, kind: parsedKind, ref: U });
  }
  assert.equal(hubId('reels', 'content', U), `reels:${U}`);
  assert.equal(hubId('reels', 'idea', U), `reels:idea:${U}`);
  assert.equal(hubId('stories', 'set', U), `stories:${U}`);
});

test('malformed and mismatched ids are rejected', () => {
  for (const bad of ['', 'reels', `nope:${U}`, `reels:job:${U}`, `stories:post:${U}`, `reels:schedule:`, '%E0%A4%A', `reels:attempt:${U}`, `reels:${U}:x`]) {
    assert.equal(parseHubId(bad), null, bad);
  }
  assert.throws(() => hubId('reels', 'job', U));
  assert.throws(() => hubId('reels', 'attempt', 'a:b'));
  assert.equal(postHref('/social', `reels:${U}`), `/social/post/reels%3A${U}`);
});

test('links keep the preview base and drop empty params', () => {
  assert.equal(hubBaseOf('/social/preview/house'), '/social/preview');
  assert.equal(hubBaseOf('/social/house'), '/social');
  assert.equal(hubBaseOf('/social/previewer'), '/social');
  assert.equal(hubHref('/social', '/analytics', { range: '7d', v: '' }), '/social/analytics?range=7d');
  assert.equal(withParams('/social', '', { range: '7d', tab: 'x' }, { tab: null, metric: 'shares' }), '/social?range=7d&metric=shares');
});

test('ranges: default 30 days, known ids, custom clamps, junk never crashes', () => {
  const now = new Date('2026-10-08T16:00:00Z');
  assert.deepEqual(parseRange({}, now), { id: '30d', from: '2026-09-09', to: '2026-10-08' });
  assert.deepEqual(parseRange({ range: '7d' }, now), { id: '7d', from: '2026-10-02', to: '2026-10-08' });
  assert.deepEqual(parseRange({ range: '90d' }, now).from, '2026-07-11');
  assert.deepEqual(parseRange({ range: 'all' }, now), { id: 'all', from: null, to: '2026-10-08' });
  assert.deepEqual(parseRange({ range: 'custom', from: '2026-09-01', to: '2026-09-15' }, now), { id: 'custom', from: '2026-09-01', to: '2026-09-15' });
  assert.deepEqual(parseRange({ range: 'custom', from: '2026-12-01' }, now), { id: 'custom', from: '2026-10-08', to: '2026-10-08' });
  assert.deepEqual(parseRange({ range: 'custom', from: '2026-09-10', to: '2026-09-01' }, now).to, '2026-10-08');
  for (const junk of ['toString', 'constructor', '__proto__', 'hasOwnProperty', '9999d']) {
    assert.equal(parseRange({ range: junk }, now).id, '30d', junk);
  }
  assert.equal(inRange('2026-09-09', parseRange({}, now)), true);
  assert.equal(inRange('2026-09-08', parseRange({}, now)), false);
  assert.equal(inRange(null, parseRange({}, now)), false);
});

test('New York days across DST and month edges', () => {
  // 2026-11-01 is the fall-back day; 1:30 AM EDT and EST both belong to Nov 1.
  assert.equal(nyDateOf('2026-11-01T05:30:00Z'), '2026-11-01');
  assert.equal(nyDateOf('2026-11-01T06:30:00Z'), '2026-11-01');
  assert.equal(nyDateOf('2026-10-09T03:59:00Z'), '2026-10-08');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  const { start, end } = rangeBounds({ id: 'custom', from: '2026-11-01', to: '2026-11-01' });
  assert.equal(end.getTime() - start!.getTime(), 25 * 3_600_000); // the long day
  assert.equal(isDayKey('2026-02-30'), false);
  assert.equal(isDayKey('0099-01-01'), false);
  assert.equal(monthOf('0099-05'), monthOf(undefined, new Date('2026-10-08T12:00:00Z')));
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('month grid starts Sunday and covers whole weeks', () => {
  const weeks = monthGrid('2026-10');
  assert.equal(weeks[0]![0]!.day, '2026-09-27');
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(weeks.flat().filter((c) => c.inMonth).length, 31);
  assert.equal(monthGrid('2026-02').length, 4 + (new Date(Date.UTC(2026, 1, 1)).getUTCDay() === 0 ? 0 : 1));
});

test('metric formatting: rates are 0–1 shares, durations and counts round cleanly', () => {
  assert.equal(formatMetric(0.234, 'rate'), '23.4%');
  assert.equal(formatMetric(1.2, 'rate'), '120.0%');
  assert.equal(formatMetric(59_960, 'duration'), '1m 0s');
  assert.equal(formatMetric(59_940, 'duration'), '59.9s');
  assert.equal(formatMetric(119_700, 'duration'), '2m 0s');
  assert.equal(formatMetric(999_950, 'count'), '1.0M');
  assert.equal(formatMetric(12_345, 'count'), '12.3K');
  assert.equal(formatMetric(null, 'count'), '—');
  assert.equal(formatMetricKey(0.5, 'skipRate'), '50.0%');
});

test('metric choice per format mix uses shared metrics only (SH-05)', () => {
  const mixed = metricsFor(['reel', 'feed', 'story']).map((m) => m.key);
  assert.ok(mixed.includes('views') && mixed.includes('reach') && mixed.includes('shares'));
  assert.ok(!mixed.includes('skipRate') && !mixed.includes('saved') && !mixed.includes('completion'));
  assert.ok(metricsFor(['reel']).some((m) => m.key === 'skipRate'));
});

function post(id: string, metrics: HubPost['metrics'], postedAt = '2026-10-01T12:00:00Z'): HubPost {
  return { id, metrics, postedAt } as HubPost;
}

test('ranking: best first, lower-is-better metrics invert, blanks last; top 5 skips blanks', () => {
  const posts = [post('a', { views: 10, skipRate: 0.5 }), post('b', { views: 30, skipRate: 0.2 }), post('c', {}), post('d', { views: 20 })];
  assert.deepEqual([...posts].sort(byMetric('views')).map((p) => p.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual([...posts].sort(byMetric('skipRate')).map((p) => p.id).slice(0, 2), ['b', 'a']);
  assert.deepEqual(topPerformers(posts, 'views', 2).map((p) => p.id), ['b', 'd']);
  assert.equal(topPerformers(posts, 'views').length, 3);
});

import { CHIPS_PER_DAY, metricLine, onCalendar, postsByDay, statusLabel } from '@/lib/social-hub/calendar';

function cal(p: Partial<HubPost>): HubPost {
  return { id: 'x', vertical: 'reels', format: 'reel', name: 'A reel', status: 'published', nyDate: '2026-10-01', postedAt: null, publishAt: null, metrics: {}, approval: { required: false, approvedAt: null, note: null }, statusNote: null, media: { kind: 'none', note: '' }, ...p } as HubPost;
}

test('calendar: content without a day stays off; days sort by time; labels per status', () => {
  const posts = [
    cal({ id: 'b', postedAt: '2026-10-01T15:00:00Z' }),
    cal({ id: 'a', publishAt: '2026-10-01T12:00:00Z', status: 'scheduled', approval: { required: true, approvedAt: null, note: null } }),
    cal({ id: 'r', status: 'ready', nyDate: null }),
    cal({ id: 'c', status: 'cancelled', statusNote: 'Not approved before its slot' }),
  ];
  assert.equal(onCalendar(posts[2]!), false);
  assert.deepEqual(postsByDay(posts).get('2026-10-01')!.map((p) => p.id), ['a', 'b', 'c']);
  assert.equal(statusLabel(posts[1]!), 'Scheduled · needs approval');
  assert.equal(statusLabel(posts[3]!), 'Not approved before its slot');
  assert.equal(CHIPS_PER_DAY, 3);
  assert.equal(metricLine(cal({ metrics: { views: 1200, shares: 4, saved: 2 } })), '1,200 views · 4 shares · 2 saves');
  assert.equal(metricLine(cal({ metrics: {} })), 'No numbers yet');
  assert.equal(metricLine(cal({ status: 'scheduled' })), null);
});
