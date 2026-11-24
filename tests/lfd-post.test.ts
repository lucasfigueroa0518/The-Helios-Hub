import assert from 'node:assert/strict';
import test from 'node:test';

import { markRuns } from '@/lib/lfd/marks';
import { arrangeMemes, buildPost, captionFor, composeCaption, coverMemeOf, creditsFor, LFD_HOOK_LINES, lfdHeliosLine, nextLfdCanvas, outletOf, recreditCaption } from '@/lib/lfd/post';
import type { Ready } from '@/lib/lfd/types';
import { heliosLines } from '@/lib/social/captions/helios-line';

const ready = (i: number): Ready => ({
  pick: { key: `k${i}`, refs: [`r${i}`], origin: 'reels', headline: `H${i}`, sourceName: `Outlet ${i}`, url: `https://o${i}.com/a`, body: '', publishedAt: '2026-10-12T00:00:00Z', net: 1, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, builder: null, eventDate: null, lane: i === 0 ? 'major' : 'rundown' },
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

test('the template caption opens with the hook, lists each headline, ends with the Helios line + credits, no hashtags', () => {
  const items = [0, 1].map(ready);
  const caption = captionFor(items);
  assert.match(caption, /^Do you realize what just happened in AI in the last few days\? Swipe ⬅️ to catch up\./);
  assert.match(caption, /Story 0 Just Dropped/);
  assert.ok(caption.includes(`\n\n${lfdHeliosLine(items)}\n\nSources:`), 'the Helios line sits right before the credits');
  assert.doesNotMatch(caption, /Follow Helios/);
  assert.match(caption, /Sources: Outlet 0, Outlet 1/);
  assert.match(caption, /Photos: Credit 0; Credit 1/);
  assert.doesNotMatch(caption, /#/);
  assert.ok(caption.length <= 2200);
});

test('an over-long caption drops lowest-ranked headlines and keeps hook, Helios line and credits whole', () => {
  const items = [0, 1, 2, 3, 4, 5].map(ready);
  for (const r of items) r.copy.headline = `${'Very Long Headline '.repeat(20)}${r.copy.key}`;
  const caption = captionFor(items);
  assert.ok(caption.length <= 2200);
  assert.match(caption, /^Do you realize what just happened/);
  assert.ok(caption.includes(lfdHeliosLine(items)));
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
  opener: '⬅️ Swipe for a laundry robot and a new Claude model.',
  body: 'A robot folded a full load of laundry this week.\nAnthropic put out a new Claude model.',
  question: 'Which one caught your attention? 👇',
};

test('captionFor with lines: opener, recap lines, question, the code Helios line, credits', () => {
  const items = [0, 1].map(ready);
  const caption = captionFor(items, LINES);
  assert.equal(
    caption,
    [LINES.opener, LINES.body, LINES.question, lfdHeliosLine(items), 'Sources: Outlet 0, Outlet 1\nPhotos: Credit 0; Credit 1'].join('\n\n'),
  );
  assert.doesNotMatch(caption, /Do you realize what just happened/);
  assert.doesNotMatch(caption, /Follow Helios/);
  assert.doesNotMatch(caption, /– Story 0/);
});

test('lfdHeliosLine is one of the 16 LFD lines and ignores story order', () => {
  const items = [0, 1, 2].map(ready);
  assert.ok(heliosLines('lfd').includes(lfdHeliosLine(items)));
  assert.equal(lfdHeliosLine(items), lfdHeliosLine([...items].reverse()));
});

test('falls back to template when lines is null', () => {
  const items = [0, 1].map(ready);
  assert.equal(captionFor(items, null), captionFor(items));
  assert.match(captionFor(items, null), /^Do you realize what just happened in AI in the last few days\?/);
  assert.equal(buildPost(items, new Date('2026-10-13T07:00:00Z'), null).caption, captionFor(items));
  assert.equal(buildPost(items, new Date('2026-10-13T07:00:00Z'), LINES).caption, captionFor(items, LINES));
});

test('an over-long model caption drops recap lines from the end, never the question or the Helios line', () => {
  const items = [0, 1, 2].map(ready);
  const line = (n: number) => `Recap ${n} ${'word '.repeat(150)}`.trim();
  const lines = { ...LINES, body: [line(1), line(2), line(3)].join('\n') };
  const caption = captionFor(items, lines);
  assert.ok(caption.length <= 2200, String(caption.length));
  assert.match(caption, /Recap 1/);
  assert.doesNotMatch(caption, /Recap 3/);
  assert.ok(caption.includes(`${LINES.question}\n\n${lfdHeliosLine(items)}\n\nSources:`));
});

test('a model caption that cannot fit even with one recap line falls back to the template', () => {
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

test('outletOf: a "Feed" source name is replaced by the link host without www', () => {
  const r = ready(0);
  assert.equal(outletOf(r), 'Outlet 0');
  r.pick.sourceName = 'Feed: AI headlines';
  r.pick.url = 'https://www.theverge.com/ai/1';
  assert.equal(outletOf(r), 'theverge.com');
  r.pick.sourceName = 'Feedly Weekly';
  assert.equal(outletOf(r), 'Feedly Weekly', 'only the word Feed, not a name starting with it');
  r.pick.sourceName = '';
  assert.equal(outletOf(r), 'theverge.com');
  assert.match(creditsFor([r, ready(1)]), /^Sources: theverge\.com, Outlet 1$/m);
});

test('recreditCaption: a model caption keeps its head and swaps only the credits', () => {
  const from = [0, 1].map(ready);
  const to = [ready(1), { ...ready(0), photo: { src: 'data:image/png;base64,m', credit: 'Meme', kind: 'scene' as const } }];
  const caption = captionFor(from, LINES);
  const next = recreditCaption(caption, from, to);
  const head = caption.slice(0, -(creditsFor(from).length + 2));
  assert.equal(next, `${head}\n\n${creditsFor(to)}`);
  assert.match(next!, /Photos: Credit 1; Meme$/);
  assert.ok(next!.startsWith(LINES.opener));
  assert.equal(recreditCaption(caption, from, from), caption, 'same credits: unchanged');
});

test('recreditCaption: null when the caption does not end with its credits', () => {
  const from = [0, 1].map(ready);
  const to = [ready(0), { ...ready(1), photo: { src: 'x', credit: 'Other', kind: 'scene' as const } }];
  assert.equal(recreditCaption(`${captionFor(from, LINES)}\n\nAn edit after the credits.`, from, to), null);
  assert.equal(recreditCaption('A hand-written caption with no credits.', from, to), null);
});

test('recreditCaption: the template caption is rebuilt whole for the new order', () => {
  const from = [0, 1, 2].map(ready);
  const to = [from[2]!, from[0]!, from[1]!];
  assert.equal(recreditCaption(captionFor(from), from, to), captionFor(to));
  assert.match(recreditCaption(captionFor(from), from, to)!, /– Story 2 Just Dropped\n– Story 0 Just Dropped/);
});

test('design profiles rotate evenly from black, and every slide carries the post profile', () => {
  assert.equal(nextLfdCanvas(null, false), 'black');
  assert.equal(nextLfdCanvas(null, true), 'green'); // a post from before profiles counts as black
  assert.deepEqual(['black', 'green', 'orange', 'white'].map((c) => nextLfdCanvas(c, true)), ['green', 'orange', 'white', 'black']);
  const post = buildPost([0, 1].map(ready), new Date('2026-10-13T07:00:00Z'), null, { canvas: 'orange' });
  assert.ok(post.slides.every((s) => s.canvas === 'orange'));
  assert.ok(buildPost([0].map(ready), new Date('2026-10-13T07:00:00Z')).slides.every((s) => s.canvas === undefined));
});

test('cover hooks rotate through the library and fill in the story count', async () => {
  const { LFD_COVER_HOOKS, nextLfdCoverHook } = await import('@/lib/lfd/post');
  assert.equal(LFD_COVER_HOOKS.length, 7);
  for (const h of LFD_COVER_HOOKS) assert.ok(h.text.includes(h.accent), h.text);
  assert.equal(nextLfdCoverHook(null, 5).text, LFD_COVER_HOOKS[0]!.text);
  const second = nextLfdCoverHook(LFD_COVER_HOOKS[0]!.text, 6);
  assert.deepEqual(second, { text: '6 things happened in AI you need to know.', accent: '6 things' });
  assert.equal(nextLfdCoverHook(second.text, 6).text, LFD_COVER_HOOKS[2]!.text);
  assert.equal(nextLfdCoverHook(LFD_COVER_HOOKS[6]!.text, 4).text, LFD_COVER_HOOKS[0]!.text);
});
