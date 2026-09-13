import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addUtcDays,
  countryDisplayName,
  csvEscape,
  deviceDisplayName,
  dimensionLabel,
  formatCompactNumber,
  formatCtr,
  formatPosition,
  parsePeriod,
  parseSearchType,
  propertyLabel,
  resolveSeoRange,
  weightedMetrics,
} from '@/lib/seo/format';

test('resolveSeoRange uses latest available day as the window end', () => {
  assert.deepEqual(
    resolveSeoRange({ period: '24h', latestAvailable: '2026-09-11' }),
    { from: '2026-09-11', to: '2026-09-11' },
  );
  assert.deepEqual(
    resolveSeoRange({ period: '7d', latestAvailable: '2026-09-11' }),
    { from: '2026-09-05', to: '2026-09-11' },
  );
  assert.deepEqual(
    resolveSeoRange({ period: '3m', latestAvailable: '2026-09-11' }),
    { from: addUtcDays('2026-09-11', -89), to: '2026-09-11' },
  );
});

test('parse helpers default to web and 3 months', () => {
  assert.equal(parseSearchType(null), 'web');
  assert.equal(parseSearchType('discover'), 'discover');
  assert.equal(parsePeriod(null), '3m');
  assert.equal(parsePeriod('7d'), '7d');
});

test('weighted metrics match Search Console rollups', () => {
  const totals = weightedMetrics([
    { clicks: 10, impressions: 100, position: 10 },
    { clicks: 0, impressions: 50, position: 20 },
  ]);
  assert.equal(totals.clicks, 10);
  assert.equal(totals.impressions, 150);
  assert.equal(totals.ctr, 10 / 150);
  assert.equal(totals.position, ((10 * 100) + (20 * 50)) / 150);
});

test('display helpers', () => {
  assert.equal(countryDisplayName('USA'), 'United States');
  assert.equal(deviceDisplayName('MOBILE'), 'Mobile');
  assert.equal(dimensionLabel('search_appearance', 'AMP_BLUE_LINK'), 'Amp Blue Link');
  assert.equal(propertyLabel('sc-domain:heliosgroup.ai'), 'heliosgroup.ai');
  assert.equal(formatCompactNumber(1220), '1.22K');
  assert.equal(formatCtr(0.011), '1.1%');
  assert.equal(formatPosition(22.4), '22.4');
  assert.equal(csvEscape('helios, marketing'), '"helios, marketing"');
});
