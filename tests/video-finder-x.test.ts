/** Video finder, X posts: result parsing only. Offline: no Serper, no yt-dlp. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { xPostsFromResults } from '@/lib/video-finder/x-search';

test('xPostsFromResults keeps status posts, normalises them and drops duplicates and profiles', () => {
  const got = xPostsFromResults([
    { link: 'https://x.com/acme/status/111?s=20', title: 'Acme on X', snippet: 'Watch the launch' },
    { link: 'https://twitter.com/acme/status/111', title: 'dup' },
    { link: 'https://x.com/acme', title: 'profile page' },
    { link: 'https://mobile.twitter.com/Bob_2/status/222/photo/1', title: 'Bob' },
    { link: 'https://example.com/x.com/acme/status/333' },
  ]);
  assert.deepEqual(got.map((p) => p.url), ['https://x.com/acme/status/111', 'https://x.com/Bob_2/status/222']);
  assert.equal(got[0]!.handle, 'acme');
  assert.equal(got[0]!.text, 'Acme on X — Watch the launch');
});
