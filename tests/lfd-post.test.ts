import assert from 'node:assert/strict';
import test from 'node:test';

import { markRuns } from '@/lib/lfd/marks';
import { arrangeMemes, buildPost, captionFor, composeCaption, coverMemeOf, LFD_HOOK_LINES } from '@/lib/lfd/post';
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

test('buildPost passes the photo kind through: logos render as logos on the story slide and in the cover mosaic', () => {
  const items = [0, 1, 2, 3, 4].map(ready);
  items[1]!.photo = { src: 'https://img/logo.png', credit: 'Logo', kind: 'logo' };
  const post = buildPost(items, new Date('2026-10-13T07:00:00Z'));
  assert.equal(post.slides[2]!.photoKind, 'logo');
  assert.equal(post.slides[1]!.photoKind, undefined, 'a scene photo stays the default');
  assert.deepEqual(post.slides[0]!.lfdCover!.photos.map((p) => p.kind), ['scene', 'logo', 'scene', 'scene', 'scene']);
});

test('a meme-as-photo story is marked photoKind meme so the slide uses the meme well', () => {
  const items = [0, 1, 2, 3, 4].map(ready);
  items[2]!.photoSource = 'meme';
  items[2]!.photo = { src: 'data:image/png;base64,xx', credit: 'meme', kind: 'scene' };
  const post = buildPost(items, new Date('2026-10-13T07:00:00Z'));
  assert.equal(post.slides[3]!.photoKind, 'meme');
  assert.equal(post.slides[3]!.photoUrl, 'data:image/png;base64,xx');
});

test('the cover collage never includes a meme photo; it is a single meme or non-meme tiles', () => {
  const items = [0, 1, 2, 3, 4].map(ready);
  items[2]!.photoSource = 'meme';
  items[2]!.photo = { src: 'data:image/png;base64,meme', credit: 'meme', kind: 'scene' };
  const mosaic = buildPost(items, new Date('2026-10-13T07:00:00Z'));
  assert.deepEqual(mosaic.slides[0]!.lfdCover!.photos.map((p) => p.url), ['https://img/0.jpg', 'https://img/1.jpg', 'https://img/3.jpg', 'https://img/4.jpg']);
  assert.equal(mosaic.slides[0]!.lfdCover!.meme, undefined);
  const one = buildPost(items, new Date('2026-10-13T07:00:00Z'), null, { coverMeme: { url: 'data:image/png;base64,meme' } });
  assert.deepEqual(one.slides[0]!.lfdCover!.meme, { url: 'data:image/png;base64,meme' });
  assert.ok(!one.slides[0]!.lfdCover!.photos.some((p) => p.url.includes('meme')));
});

test('arrangeMemes: a top-3 meme is the cover; a weaker one becomes the second slide', () => {
  const items = [0, 1, 2, 3, 4].map(ready);
  items[2]!.photoSource = 'meme';
  items[2]!.meme = { templateId: 't', memeId: 'm2', rank: 1, role: 'slide', position: 0, object: 'x', text: [] };
  items[2]!.photo = { src: 'data:image/png;base64,m2', credit: 'meme', kind: 'scene' };
  const top = arrangeMemes(items);
  assert.deepEqual(top.ready.map((r) => r.pick.key), ['k2', 'k0', 'k1', 'k3', 'k4']);
  assert.deepEqual(top.placement.cover, { kind: 'meme', memeId: 'm2', storyKey: 'k2' });
  assert.deepEqual(coverMemeOf(top.ready, top.placement), { url: 'data:image/png;base64,m2' });
  items[2]!.photoSource = 'finder';
  items[2]!.meme = undefined;
  items[2]!.photo = { src: 'https://img/2.jpg', credit: 'Credit 2', kind: 'scene' };
  items[4]!.photoSource = 'meme';
  items[4]!.meme = { templateId: 't', memeId: 'm4', rank: 1, role: 'slide', position: 0, object: 'x', text: [] };
  items[4]!.photo = { src: 'data:image/png;base64,m4', credit: 'meme', kind: 'scene' };
  const late = arrangeMemes(items);
  assert.deepEqual(late.ready.map((r) => r.pick.key), ['k0', 'k4', 'k1', 'k2', 'k3']);
  assert.deepEqual(late.placement.cover, { kind: 'mosaic' });
  assert.equal(coverMemeOf(late.ready, late.placement), undefined);
});

test('the cover mosaic has a layout for every story count from 1 to 6', async () => {
  const fs = await import('node:fs/promises');
  const css = await fs.readFile('app/social/render/preview/preview.css', 'utf8');
  for (let count = 1; count <= 6; count++) {
    for (let tile = 1; tile <= count; tile++) {
      assert.match(css, new RegExp(`\\.lfd-mosaic\\[data-count="${count}"\\] \\.lfd-tile:nth-child\\(${tile}\\)`), `count ${count} tile ${tile}`);
    }
  }
});

const LINES = {
  opener: '⬅️ Swipe for a laundry robot, a new Claude model and a chip fight.',
  body: 'A robot folded a full load of laundry this week.\n\nAnthropic put out a new Claude model.\n\nAnd two chip makers went to court.',
  question: 'Which one caught your attention? 👇',
  heliosLine: 'For a med spa, faster replies to booking questions is the part we at Helios would build first.',
};

test('captionFor with lines uses opener and heliosLine, not the template hook or FOLLOW_LINE', () => {
  const caption = captionFor([0, 1].map(ready), LINES);
  assert.equal(
    caption,
    [LINES.opener, LINES.body, LINES.question, LINES.heliosLine, 'Sources: Outlet 0, Outlet 1\nPhotos: Credit 0; Credit 1'].join('\n\n'),
  );
  assert.doesNotMatch(caption, /Do you realize what just happened/);
  assert.doesNotMatch(caption, /Follow Helios/);
  assert.doesNotMatch(caption, /– Story 0/);
});

test('falls back to template when lines is null', () => {
  const items = [0, 1].map(ready);
  assert.equal(captionFor(items, null), captionFor(items));
  assert.match(captionFor(items, null), /^Do you realize what just happened in AI in the last few days\?/);
  assert.equal(buildPost(items, new Date('2026-10-13T07:00:00Z'), null).caption, captionFor(items));
  assert.equal(buildPost(items, new Date('2026-10-13T07:00:00Z'), LINES).caption, captionFor(items, LINES));
});

test('an over-long model caption trims body paragraphs from the end, never the question or the Helios line', () => {
  const items = [0, 1].map(ready);
  const para = (n: number) => `Paragraph ${n} ${'word '.repeat(150)}`.trim();
  const lines = { ...LINES, body: [para(1), para(2), para(3)].join('\n\n') };
  const caption = captionFor(items, lines);
  assert.ok(caption.length <= 2200, String(caption.length));
  assert.match(caption, /Paragraph 1/);
  assert.doesNotMatch(caption, /Paragraph 3/);
  assert.ok(caption.includes(`${LINES.question}\n\n${LINES.heliosLine}\n\nSources:`));
});

test('a model caption that cannot fit even with one body paragraph falls back to the template', () => {
  const items = [0, 1].map(ready);
  const caption = captionFor(items, { ...LINES, body: 'x'.repeat(2200) });
  assert.equal(caption, captionFor(items));
});

test('composeCaption reports the path that shipped', () => {
  const items = [0, 1].map(ready);
  assert.equal(composeCaption(items, LINES).by, 'model');
  assert.equal(composeCaption(items, null).by, 'template');
  const tooLong = composeCaption(items, { ...LINES, body: 'x'.repeat(2200) });
  assert.equal(tooLong.by, 'template');
  assert.equal(tooLong.caption, captionFor(items));
});
