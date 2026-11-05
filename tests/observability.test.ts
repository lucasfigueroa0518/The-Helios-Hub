import assert from 'node:assert/strict';
import test from 'node:test';

import { flightKind, logPathname } from '@/lib/observability/log-event';

test('log paths collapse ids for cardinality', () => {
  assert.equal(logPathname('/social/post/reels%3Aabc'), '/social/post/:id');
  assert.equal(logPathname('/dashboards/projects/uuid-here'), '/dashboards/projects/:id');
  assert.equal(logPathname('/social?_rsc=token'), '/social');
});

test('flight kind separates document, full rsc, and prefetches', () => {
  assert.equal(flightKind({}), 'document');
  assert.equal(flightKind({ rsc: '1' }), 'rsc_full');
  assert.equal(flightKind({ prefetch: '1' }), 'rsc_prefetch');
  assert.equal(flightKind({ segmentPrefetch: '1' }), 'rsc_segment_prefetch');
  assert.equal(flightKind({ accept: 'text/x-component' }), 'rsc_full');
});
