import assert from 'node:assert/strict';
import test from 'node:test';

import {
  comparePosts,
  hrefWith,
  pageOf,
  filterOptions,
  formatBlocks,
  groupsFor,
  headlines,
  metricChoices,
  parseAnalyticsQuery,
  postsInView,
  queryParams,
  rankPosts,
  sideBySide,
  topPerformers,
} from '@/lib/social-hub/analytics';
import { costOfPosts, formatUsd } from '@/lib/social-hub/cost';
import { compareIds } from '@/lib/social-hub/links';
import { factorsFor } from '@/lib/social-hub/factors';
import { formatMetricKey, metricsFor, postMetric } from '@/lib/social-hub/metrics';

import { FIXTURE_NOW, previewDataset } from './fixtures/social-hub/preview-dataset';

const d = previewDataset();
const q = (params: Record<string, string | undefined>, cmp: string[] = []) => parseAnalyticsQuery(params, cmp, FIXTURE_NOW);

test('defaults: content tab, 30 days, all verticals, views, no filters', () => {
  const query = q({});
  assert.equal(query.tab, 'content');
  assert.equal(query.range.id, '30d');
  assert.equal(query.vertical, null);
  assert.equal(query.metric, 'views');
  assert.deepEqual(query.filters, {});
  assert.deepEqual(Object.values(queryParams(query)).filter(Boolean), []);
});

test('ranges filter by posting day; only published posts count', () => {
  const week = postsInView(d.posts, q({ range: '7d' }));
  const all = postsInView(d.posts, q({ range: 'all' }));
  assert.ok(week.length > 0 && week.length < all.length);
  assert.ok(week.every((p) => p.status === 'published' && p.nyDate! >= '2026-10-02' && p.nyDate! <= '2026-10-08'));
  const custom = postsInView(d.posts, q({ range: 'custom', from: '2026-09-10', to: '2026-09-12' }));
  assert.ok(custom.length > 0 && custom.every((p) => p.nyDate! >= '2026-09-10' && p.nyDate! <= '2026-09-12'));
});

test('vertical first: the mixed view offers shared filters and shared metrics only (SH-05)', () => {
  const mixed = q({ metric: 'skipRate', 'f.psychology': 'curiosity', 'f.format': 'story' });
  assert.equal(mixed.metric, 'views', 'a format-only metric falls back in a mixed view');
  assert.deepEqual(mixed.filters, { format: 'story' }, 'native filters are ignored without a vertical; shared ones work');
  assert.deepEqual(filterOptions(d.posts, mixed).map((o) => o.factor.id), ['format', 'slot']);
  assert.ok(postsInView(d.posts, mixed).every((p) => p.format === 'story'));
  // Shared slot filter keys are per vertical in a mixed view.
  const slot = q({ 'f.slot': 'reels:morning', range: 'all' });
  const inSlot = postsInView(d.posts, slot);
  assert.ok(inSlot.length > 0 && inSlot.every((p) => p.vertical === 'reels' && p.slot?.id === 'morning'));
  assert.deepEqual(factorsFor(null).map((f) => f.id), ['vertical', 'format', 'slot']);
  assert.ok(metricChoices({ vertical: null }).every((m) => ['reel', 'feed', 'story'].every((f) => m.formats.includes(f as never))));
});

test('one vertical unlocks its native filters and metrics', () => {
  const reels = q({ v: 'reels', metric: 'skipRate', 'f.psychology': 'curiosity', 'f.nonsense': 'x' });
  assert.equal(reels.metric, 'skipRate');
  assert.deepEqual(reels.filters, { psychology: 'curiosity' });
  const inView = postsInView(d.posts, reels);
  assert.ok(inView.length > 0);
  assert.ok(inView.every((p) => p.vertical === 'reels' && p.factorValues.psychology?.kind === 'category' && p.factorValues.psychology.key === 'curiosity'));
  const options = filterOptions(d.posts, reels);
  assert.ok(options.some((o) => o.factor.id === 'psychology'));
  assert.ok(options.every((o) => o.values.length > 1 || reels.filters[o.factor.id]));
  assert.ok(!options.some((o) => o.factor.id === 'vertical'));
  // Tags filter: an Explainer post matches when it carries the tag.
  const tag = filterOptions(d.posts, q({ v: 'explainers', range: 'all' })).find((o) => o.factor.id === 'reviewTags')?.values.find((v) => v.key !== '__none');
  assert.ok(tag);
  const tagged = postsInView(d.posts, q({ v: 'explainers', range: 'all', 'f.reviewTags': tag.key }));
  assert.ok(tagged.length > 0 && tagged.every((p) => p.factorValues.reviewTags?.kind === 'tags' && p.factorValues.reviewTags.values.some((v) => v.key === tag.key)));
  assert.equal(queryParams(reels)['f.psychology'], 'curiosity');
});

test('headlines sum or average by metric; per-format blocks; cost counted once', () => {
  const posts = postsInView(d.posts, q({ range: 'all' }));
  const h = headlines(posts, metricsFor(['reel', 'feed', 'story']));
  const views = h.find((x) => x.key === 'views')!;
  assert.equal(views.value, posts.reduce((s, p) => s + (postMetric(p, 'views') ?? 0), 0));
  const blocks = formatBlocks(posts);
  assert.deepEqual(blocks.map((b) => b.format), ['reel', 'feed', 'story']);
  assert.equal(blocks.reduce((s, b) => s + b.count, 0), posts.length);
  assert.ok(blocks.find((b) => b.format === 'story')!.headlines.some((x) => x.key === 'completion'));
  assert.equal(blocks.reduce((s, b) => s + b.costMicros, 0), costOfPosts(posts).micros);
});

test('table ranks by the selected metric; top 5 mixes verticals (SH-30)', () => {
  const posts = postsInView(d.posts, q({ range: 'all' }));
  const ranked = rankPosts(posts, 'shares');
  for (let i = 1; i < ranked.length; i++) {
    const a = postMetric(ranked[i - 1]!, 'shares');
    const b = postMetric(ranked[i]!, 'shares');
    if (a != null && b != null) assert.ok(a >= b);
  }
  const top = topPerformers(posts, 'views');
  assert.equal(top.length, 5);
  assert.equal(top[0], rankPosts(posts, 'views')[0]);
});

test('side by side: 2–6 posts, mixed rows blank where a field does not apply, differing rows flagged', () => {
  const posts = postsInView(d.posts, q({ range: 'all' }));
  const reel = posts.find((p) => p.vertical === 'reels')!;
  const story = posts.find((p) => p.vertical === 'stories')!;
  const query = q({ tab: 'compare' }, [`${reel.id},${story.id}`, reel.id, 'nope', 'a', 'b', 'c', 'd', 'e']);
  assert.equal(query.compare.length, 6, 'deduped and capped at 6');
  const chosen = comparePosts(d.posts, query.compare);
  assert.deepEqual(chosen.map((p) => p.id), [reel.id, story.id]);
  const rows = sideBySide(chosen, formatMetricKey, formatUsd);
  assert.ok(!rows.some((r) => r.label === 'Skip rate'), 'reel-only metrics stay out of a mixed compare');
  assert.equal(rows.find((r) => r.label === 'Vertical')!.differs, true);
  const series = rows.find((r) => r.label === 'Series')!;
  assert.equal(series.values[0], '', 'blank where the field does not apply');
  assert.ok(rows.findIndex((r) => r.group === 'cost') > rows.findIndex((r) => r.group === 'metric'));
  assert.ok(rows.findIndex((r) => r.group === 'meta') > rows.findIndex((r) => r.group === 'cost'));
  const same = sideBySide([reel, reel], formatMetricKey, formatUsd);
  assert.ok(same.every((r) => !r.differs));
});

test('group vs group: shared factor in a mixed view, native factor with one vertical, sorted by metric', () => {
  const mixed = q({ tab: 'compare', mode: 'groups', factor: 'psychology', range: 'all' });
  assert.equal(mixed.factor, 'vertical', 'a native factor is not offered in a mixed view');
  const groups = groupsFor(postsInView(d.posts, mixed), mixed);
  assert.deepEqual(groups.map((g) => g.key).sort(), ['carousels', 'explainers', 'reels', 'stories']);
  for (let i = 1; i < groups.length; i++) assert.ok((groups[i - 1]!.means.views ?? -1) >= (groups[i]!.means.views ?? -1));
  const reels = q({ tab: 'compare', mode: 'groups', v: 'reels', factor: 'bucket', metric: 'skipRate', range: 'all' });
  const rg = groupsFor(postsInView(d.posts, reels), reels);
  assert.ok(rg.length > 1);
  for (let i = 1; i < rg.length; i++) {
    const a = rg[i - 1]!.means.skipRate;
    const b = rg[i]!.means.skipRate;
    if (a != null && b != null) assert.ok(a <= b, 'lower skip rate ranks first');
  }
  assert.equal(formatMetricKey(rg[0]!.means.skipRate ?? null, 'skipRate').endsWith('%'), true);
});

test('posts table pages at 25, clamped', () => {
  const items = Array.from({ length: 60 }, (_, i) => i);
  assert.deepEqual(pageOf(items, 1).items.length, 25);
  assert.deepEqual(pageOf(items, 3), { page: 3, pageCount: 3, items: items.slice(50) });
  assert.equal(pageOf(items, 99).page, 3);
  assert.equal(pageOf([], 1).pageCount, 1);
  assert.equal(q({ page: 'x' }).page, 1);
  assert.equal(q({ page: '2' }).page, 2);
});

test('every control keeps the rest of the state; a vertical change clears its filters and factor; page resets', () => {
  const A = '/a';
  const base = q({ tab: 'compare', mode: 'groups', factor: 'psychology', v: 'reels', range: '7d', metric: 'shares', 'f.bucket': 'the_saga', page: '3' }, ['x,y']);
  const parse = (href: string) => Object.fromEntries(new URL(href, 'http://h').searchParams);
  // range link keeps vertical, metric, filters, tab, mode, factor, cmp; drops page
  assert.deepEqual(parse(hrefWith(A, base, { range: '90d' })), { tab: 'compare', range: '90d', v: 'reels', metric: 'shares', mode: 'groups', factor: 'psychology', cmp: 'x,y', 'f.bucket': 'the_saga' });
  // vertical change clears native filters and factor, keeps metric (it falls back if it doesn't fit)
  assert.deepEqual(parse(hrefWith(A, base, { v: 'stories' })), { tab: 'compare', range: '7d', v: 'stories', metric: 'shares', mode: 'groups', cmp: 'x,y' });
  // tab change keeps compare picks
  assert.equal(parse(hrefWith(A, base, { tab: null })).cmp, 'x,y');
  // custom range keeps filters; switching back to a preset drops from/to
  const custom = q({ range: 'custom', from: '2026-09-01', to: '2026-09-05', v: 'reels', 'f.bucket': 'the_saga' });
  assert.equal(parse(hrefWith(A, custom, { metric: 'reach' }))['f.bucket'], 'the_saga');
  assert.deepEqual(['from', 'to'].map((k) => parse(hrefWith(A, custom, { range: '7d' }))[k]), [undefined, undefined]);
  assert.equal(parse(hrefWith(A, base, { page: '2' })).page, '2');
});

test('compare picks: repeated cmp params (table form) and comma lists (links); unpublished ids dropped', () => {
  assert.deepEqual(compareIds({ cmp: ['a', 'b,c'] }), ['a', 'b', 'c']);
  assert.deepEqual(compareIds({ cmp: 'a,b' }), ['a', 'b']);
  assert.deepEqual(compareIds({}), []);
  const scheduled = d.posts.find((p) => p.status === 'scheduled')!;
  const published = d.posts.find((p) => p.status === 'published')!;
  assert.deepEqual(comparePosts(d.posts, [scheduled.id, published.id]).map((p) => p.id), [published.id]);
});

test('an active filter with no matching values can still be cleared', () => {
  const stale = q({ v: 'reels', 'f.bucket': 'not_a_bucket' });
  const opt = filterOptions(d.posts, stale).find((o) => o.factor.id === 'bucket')!;
  assert.ok(opt.values.some((v) => v.key === 'not_a_bucket' && v.count === 0));
  assert.equal(postsInView(d.posts, stale).length, 0);
});
