import assert from 'node:assert/strict';
import test from 'node:test';

import { markRuns } from '@/lib/lfd/marks';
import { buildPost, captionFor, LFD_HOOK_LINES } from '@/lib/lfd/post';
import type { Ready } from '@/lib/lfd/types';

const ready = (i: number): Ready => ({
  pick: { key: `k${i}`, refs: [`r${i}`], origin: 'reels', headline: `H${i}`, sourceName: `Outlet ${i}`, url: `https://o${i}.com/a`, body: '', publishedAt: '2026-10-12T00:00:00Z', net: 1, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, lane: i === 0 ? 'major' : 'rundown' },
  copy: { key: `k${i}`, setup: i === 1 ? 'Setup line:' : '', headline: `Story ${i} Just Dropped`, highlight: i === 0 ? 'Just Dropped' : '', names: [], body: `Body ${i} sentence one. Two`, photo: { kind: 'logo', query: 'q', subjects: [], alts: [] } },
  photo: { src: `https://img/${i}.jpg`, credit: `Credit ${i}`, kind: 'scene', focus: { x: 0.5, y: 0.3 } },
});

test('markRuns marks the highlight once and each name', () => {
  assert.deepEqual(markRuns('OpenAI Ships GPT-6 Today', 'GPT-6', ['OpenAI']), [
    { text: 'OpenAI', mark: 'name' },
    { text: ' Ships ', mark: null },
    { text: 'GPT-6', mark: 'hl' },
    { text: ' Today', mark: null },
  ]);
});

test('the post is cover, one story slide per story, then Follow', () => {
  const post = buildPost([0, 1, 2, 3, 4].map(ready), new Date('2026-10-13T07:00:00Z'));
  assert.deepEqual(post.slides.map((s) => s.layoutVariant), ['lfd_cover', 'lfd_story', 'lfd_story', 'lfd_story', 'lfd_story', 'lfd_story', 'follow']);
  assert.equal(post.slides[0]!.lfdCover!.photos.length, 5);
  assert.equal(post.slides[0]!.lfdCover!.photos[0]!.url, 'https://img/0.jpg');
  assert.equal(post.slides[1]!.lfdStory!.highlight, 'Just Dropped');
  assert.equal(post.slides[1]!.photoUrl, 'https://img/0.jpg');
  assert.deepEqual(post.slides.map((s) => s.position), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(LFD_HOOK_LINES.join(' ').toUpperCase(), 'DO YOU REALIZE WHAT JUST HAPPENED IN AI IN THE LAST FEW DAYS?');
});

test('the caption opens with the hook, lists each headline, ends with follow + credits, no hashtags', () => {
  const caption = captionFor([0, 1].map(ready));
  assert.match(caption, /^Do you realize what just happened in AI in the last few days\? Swipe ⬅️ to catch up\./);
  assert.match(caption, /Story 0 Just Dropped/);
  assert.match(caption, /Follow Helios/);
  assert.match(caption, /Sources: Outlet 0, Outlet 1/);
  assert.match(caption, /Photos: Credit 0; Credit 1/);
  assert.doesNotMatch(caption, /#/);
  assert.ok(caption.length <= 2200);
});

test('an over-long caption drops lowest-ranked headlines and keeps hook, follow and credits whole', () => {
  const items = [0, 1, 2, 3, 4, 5].map(ready);
  for (const r of items) r.copy.headline = `${'Very Long Headline '.repeat(20)}${r.copy.key}`;
  const caption = captionFor(items);
  assert.ok(caption.length <= 2200);
  assert.match(caption, /^Do you realize what just happened/);
  assert.match(caption, /Follow Helios/);
  assert.match(caption, /Photos: Credit 0; Credit 1; Credit 2; Credit 3; Credit 4; Credit 5$/);
  assert.match(caption, /k0/);
  assert.doesNotMatch(caption, /k5/);
});
