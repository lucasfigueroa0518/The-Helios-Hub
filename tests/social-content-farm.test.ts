/**
 * Content-farm filter (code-filters.ts, 2026-10-12): offline, no model, no network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { A1 } from '@/fixtures/social/ingest/day';
import { applyCodeFilters, contentFarmReason } from '@/lib/social/ingest/select/code-filters';

const farm = (over: Record<string, string>) => ({ ...A1, ...over });

test('a year in square brackets drops the article, whatever the site', () => {
  assert.equal(contentFarmReason(farm({ headline: 'Codex CLI 0.162 vs Claude Code 2.1.296 [2026]' })), 'content-farm');
  assert.equal(contentFarmReason(farm({ headline: 'Something new [ 2027 ] - example.com' })), 'content-farm');
});

test('the known farms are dropped by site, in the outlet name, the Google News suffix or the URL', () => {
  assert.equal(contentFarmReason(farm({ source: 'https://tech-insider.org/' })), 'content-farm');
  assert.equal(contentFarmReason(farm({ headline: 'AI bet hits 86% - shattered.io' })), 'content-farm');
  assert.equal(contentFarmReason(farm({ sourceUrl: 'https://www.tech-insider.org/a/b' })), 'content-farm');
});

test('real headlines and years in prose are kept', () => {
  assert.equal(contentFarmReason(A1), null);
  assert.equal(contentFarmReason(farm({ headline: 'OpenAI plans a 2026 launch of its first device' })), null);
  assert.equal(contentFarmReason(farm({ headline: 'Anthropic launches Haiku 5.5 at a much lower price', source: 'The Verge' })), null);
});

test('applyCodeFilters logs the farm reason and keeps the rest', () => {
  const bad = farm({ headline: 'Grok 4.7 Release: Pricing, Benchmarks [2026]', sourceUrl: 'https://tech-insider.org/grok' });
  const { kept, skipped } = applyCodeFilters([A1, bad]);
  assert.deepEqual(kept, [A1]);
  assert.deepEqual(skipped, [{ id: bad.sourceUrl, reason: 'content-farm', stage: 'code-filter' }]);
});
