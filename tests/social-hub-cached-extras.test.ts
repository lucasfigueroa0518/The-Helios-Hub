import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('content caches libraries, progress, and misses for a minute on the dataset tags', () => {
  const cache = readFileSync('lib/social-hub/views/cached-extras.ts', 'utf8');
  const page = readFileSync('app/social/(hub)/page.tsx', 'utf8');
  assert.match(cache, /revalidate: 60, tags/);
  assert.match(cache, /const tags = \[HUB_DATA_TAG, \.\.\.VERTICAL_IDS\.map\(hubDataTag\)\]/);
  assert.match(cache, /loadLibraries\(liveHubQuery\)/);
  assert.match(cache, /readAllProgress\(\)/);
  assert.match(cache, /readRunMisses\(liveHubQuery\)/);
  assert.match(page, /loadCachedLibraries\(\)/);
  assert.match(page, /readCachedProgress\(\)/);
  assert.match(page, /readCachedMisses\(\)\.catch\(\(\) => NO_MISSES\)/);
  assert.match(page, /readRefresh\(session\.email\)/);
  assert.doesNotMatch(page, /loadLibraries\(/);
  assert.doesNotMatch(cache, /signVisibleStoryFrames|createSignedUrl/);
});
