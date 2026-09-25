import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addUtcDays,
  combineOdata,
  countryDisplayName,
  dimensionLabel,
  environmentFilter,
  formatDeltaPercent,
  formatPagesPerVisitor,
  odataEq,
  pagesPerVisitor,
  parseEnvironment,
  parseFiltersParam,
  parsePeriod,
  percentDelta,
  previousRange,
  resolveTrafficRange,
} from '@/lib/traffic/format';

test('resolveTrafficRange uses today as the window end', () => {
  assert.deepEqual(
    resolveTrafficRange({ period: '24h', latestAvailable: '2026-09-14' }),
    { from: '2026-09-14', to: '2026-09-14' },
  );
  assert.deepEqual(
    resolveTrafficRange({ period: '7d', latestAvailable: '2026-09-14' }),
    { from: '2026-09-08', to: '2026-09-14' },
  );
  assert.deepEqual(
    resolveTrafficRange({ period: '62d', latestAvailable: '2026-09-14' }),
    { from: addUtcDays('2026-09-14', -61), to: '2026-09-14' },
  );
  assert.deepEqual(
    resolveTrafficRange({
      period: 'custom',
      from: '2026-01-01',
      to: '2026-09-14',
      latestAvailable: '2026-09-14',
    }),
    { from: addUtcDays('2026-09-14', -61), to: '2026-09-14' },
  );
});

test('parse helpers default to 7 days and production', () => {
  assert.equal(parsePeriod(null), '7d');
  assert.equal(parsePeriod('28d'), '28d');
  assert.equal(parsePeriod('62d'), '62d');
  assert.equal(parsePeriod('3m'), '62d');
  assert.equal(parseEnvironment(null), 'production');
  assert.equal(parseEnvironment('preview'), 'preview');
});

test('previousRange is the same-length window immediately before', () => {
  assert.deepEqual(
    previousRange({ from: '2026-09-08', to: '2026-09-14' }),
    { from: '2026-09-01', to: '2026-09-07' },
  );
  assert.deepEqual(
    previousRange({ from: '2026-09-14', to: '2026-09-14' }),
    { from: '2026-09-13', to: '2026-09-13' },
  );
});

test('percentDelta and pagesPerVisitor', () => {
  assert.equal(percentDelta(122, 108), ((122 - 108) / 108) * 100);
  assert.equal(percentDelta(0, 0), 0);
  assert.equal(percentDelta(10, 0), null);
  assert.equal(pagesPerVisitor(187, 122), 187 / 122);
  assert.equal(pagesPerVisitor(10, 0), 0);
  assert.equal(formatDeltaPercent(13.4), '+13%');
  assert.equal(formatDeltaPercent(-7), '-7%');
  assert.equal(formatPagesPerVisitor(1.532), '1.53');
});

test('OData filters', () => {
  assert.equal(odataEq('requestPath', "/case-studies/marty"), "requestPath eq '/case-studies/marty'");
  assert.equal(odataEq('utmSource', "O'Reilly"), "utmSource eq 'O''Reilly'");
  assert.equal(environmentFilter('production'), "environment eq 'production'");
  assert.equal(environmentFilter('all'), null);
  assert.equal(
    combineOdata([environmentFilter('production'), odataEq('country', 'US')]),
    "environment eq 'production' and country eq 'US'",
  );
});

test('parseFiltersParam ignores junk and Others', () => {
  assert.deepEqual(parseFiltersParam(null), []);
  assert.deepEqual(parseFiltersParam('not-json'), []);
  assert.deepEqual(
    parseFiltersParam(JSON.stringify([
      { dimension: 'requestPath', value: '/about' },
      { dimension: 'country', value: 'Others' },
      { dimension: 'nope', value: 'x' },
    ])),
    [{ dimension: 'requestPath', value: '/about' }],
  );
});

test('display helpers', () => {
  assert.equal(countryDisplayName('US'), 'United States');
  assert.equal(dimensionLabel('deviceType', 'mobile'), 'Mobile');
  assert.equal(dimensionLabel('osName', 'linux'), 'GNU/Linux');
  assert.equal(dimensionLabel('referrerHostname', 'direct'), 'Direct');
  assert.equal(dimensionLabel('requestPath', '/blog'), '/blog');
});
