import assert from 'node:assert/strict';
import test from 'node:test';

import { legacyAnalyticsRedirect, legacyHouseRedirect, legacyRootRedirect } from '@/lib/social-hub/views/legacy-routes';
import { activeHubTab, crumbsFor, HUB_TABS, postCrumbs, safeFrom, sectionOf } from '@/lib/social-hub/views/nav';

const B = '/social';

test('the active tab follows the path, and a post follows where it was opened from (REVISIONS G10)', () => {
  assert.equal(activeHubTab(B, '/social', null), 'content');
  assert.equal(activeHubTab(B, '/social/content/pools/reels', null), 'content');
  assert.equal(activeHubTab(B, '/social/calendar', null), 'calendar');
  assert.equal(activeHubTab(B, '/social/analytics/reels', null), 'analytics');
  assert.equal(activeHubTab(B, '/social/post/reels:abc', '/social/analytics/reels?range=7d'), 'analytics');
  assert.equal(activeHubTab(B, '/social/post/reels:abc', '/social/calendar?day=2026-10-09'), 'calendar');
  assert.equal(activeHubTab(B, '/social/post/reels:abc', null), 'content');
  assert.equal(activeHubTab('/social/preview', '/social/preview/analytics', null), 'analytics');
});

test('from is trusted only as a hub path under the same base', () => {
  assert.equal(safeFrom(B, '/social/analytics/reels?range=7d'), '/social/analytics/reels?range=7d');
  assert.equal(safeFrom(B, '/social'), '/social');
  assert.equal(safeFrom(B, '//evil.example/social'), null);
  assert.equal(safeFrom(B, 'https://evil.example/social'), null);
  assert.equal(safeFrom(B, '/socialx'), null);
  assert.equal(safeFrom(B, '/social//evil.example'), null);
  assert.equal(safeFrom(B, '/social\\evil'), null);
  assert.equal(safeFrom(B, '/social/post/reels:abc'), null, 'a post is never a place to go back to');
  assert.equal(safeFrom(B, `/social/${'a'.repeat(600)}`), null);
  assert.equal(safeFrom('/social/preview', '/social/analytics'), null, 'live and preview never mix');
  assert.equal(safeFrom(B, '/social/analytics/compare?ids=reels:a,stories:b'), '/social/analytics/compare?ids=reels:a,stories:b', 'colons in the query are fine');
});

test('breadcrumbs name each level; the last is the current page', () => {
  assert.deepEqual(crumbsFor(B, '/social/analytics/reels').map((c) => c.label), ['Analytics', 'Text on Screen']);
  assert.equal(crumbsFor(B, '/social/analytics/reels').at(-1)!.href, null);
  assert.deepEqual(crumbsFor(B, '/social/content/pools/carousels').map((c) => c.label), ['Content', 'Carousels pool']);
  assert.deepEqual(crumbsFor(B, '/social/content/library/music').map((c) => c.label), ['Content', 'Music pool']);
  const post = postCrumbs(B, '/social/analytics/reels?range=7d', 'A post');
  assert.deepEqual(post.map((c) => c.label), ['Analytics', 'Text on Screen', 'A post']);
  assert.equal(post[1]!.href, '/social/analytics/reels?range=7d', 'the origin crumb goes back to the exact list');
  assert.equal(post[2]!.href, null);
});

test('old hub URLs redirect to their new places', () => {
  assert.equal(legacyRootRedirect(B, {}), null);
  assert.equal(legacyRootRedirect(B, { month: '2026-10' }), '/social/calendar?month=2026-10');
  assert.equal(legacyRootRedirect(B, { post: 'reels:abc', day: '2026-10-08' }), `/social/post/reels%3Aabc?from=${encodeURIComponent('/social/calendar?day=2026-10-08')}`);
  assert.equal(legacyHouseRedirect(B, {}), '/social');
  assert.equal(legacyHouseRedirect(B, { tab: 'ideas', v: 'stories' }), '/social/content/pools/stories');
  assert.equal(legacyHouseRedirect(B, { tab: 'types' }), '/social/analytics');
  assert.equal(legacyHouseRedirect(B, { tab: 'all', v: 'carousels' }), '/social/analytics/carousels');
  assert.equal(legacyAnalyticsRedirect(B, {}), null);
  assert.equal(legacyAnalyticsRedirect(B, { v: 'reels', range: '7d', 'f.slot': 'morning' }), '/social/analytics/reels?range=7d&f.slot=morning');
  assert.equal(legacyAnalyticsRedirect(B, { tab: 'compare', cmp: 'a,b' }), '/social/analytics/compare?ids=a%2Cb');
  assert.equal(legacyAnalyticsRedirect(B, { tab: 'profile', metric: 'shares' }), '/social/analytics?metric=shares');
});

test('Health is the fourth hub tab with its own section and crumb', () => {
  assert.deepEqual(HUB_TABS.map((t) => t.label), ['Content', 'Calendar', 'Analytics', 'Health']);
  assert.equal(sectionOf('/health'), 'health');
  assert.equal(sectionOf('/health/night/2026-10-13'), 'health');
  assert.deepEqual(crumbsFor('/social', '/social/health/night/2026-10-13').map((c) => c.label), ['Health', 'Night of Oct 13']);
  assert.deepEqual(crumbsFor('/social', '/social/analytics/cost').map((c) => c.label), ['Analytics', 'Cost']);
});

test('hub tabs use automatic prefetch so a loading shell is enough', async () => {
  const { readFileSync } = await import('node:fs');
  const tabs = readFileSync('components/social-hub/nav/HubTabs.tsx', 'utf8');
  assert.doesNotMatch(tabs, /<Link[^>]*\sprefetch/);
});

test('links into force-dynamic Health night pages and the Cost page never prefetch', async () => {
  const { readFileSync } = await import('node:fs');
  const rows = readFileSync('components/social-hub/health/NightRows.tsx', 'utf8');
  assert.match(rows, /href=\{`\$\{base\}\/health\/night\/\$\{b\.night\}`\}\s*\n(?:\s*\/\/.*\n)?\s*prefetch=\{false\}/);
  const subnav = readFileSync('components/social-hub/cost/AnalyticsSubnav.tsx', 'utf8');
  assert.match(subnav, /analytics\/cost`\}[^>]*prefetch=\{false\}>Cost</);
  const detail = readFileSync('components/social-hub/health/NightDetail.tsx', 'utf8');
  assert.match(detail, /health\/night\/\$\{n\}`\} prefetch=\{false\}/);
});
