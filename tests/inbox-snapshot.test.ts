/**
 * Nightly warmup snapshot skips without an API key, independent of the send flag.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { runHealthSnapshot } from '@/lib/inboxes/snapshot';

test('health snapshot skips when the Smartlead API key is missing', async () => {
  const previous = process.env.SMARTLEAD_API_KEY;
  delete process.env.SMARTLEAD_API_KEY;
  try {
    const report = await runHealthSnapshot('2026-09-17');
    assert.equal(report.skipped, 'smartlead_unconfigured');
    assert.equal(report.warmupRows, 0);
    assert.equal(report.forecastRows, 0);
  } finally {
    if (previous === undefined) delete process.env.SMARTLEAD_API_KEY;
    else process.env.SMARTLEAD_API_KEY = previous;
  }
});
