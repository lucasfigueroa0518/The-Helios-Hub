/**
 * Instagram Stories M1: templates and renderer plumbing (offline; no browser,
 * no model). The browser checks run in `npm run stories:mockups`.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { BACKDROPS, FREE_VS_PAID, GUESS_THE_NUMBER, MORNING_DOWNLOAD, MORNING_DOWNLOAD_TYPE, asSet } from '@/lib/stories/render/fixtures/m1';
import { fadeAlpha, fadeMask, fadeStops } from '@/lib/stories/render/fades';
import { framesHtml, toStoryJpeg } from '@/lib/stories/render/render';
import { splitLead } from '@/lib/stories/render/StoryFrame';
import { MAX_JPEG_BYTES, SAFE_BOTTOM, SAFE_TOP, framePhoto, type Backdrop, type Frame, type FrameData } from '@/lib/stories/render/types';

const ALL: FrameData[] = [...MORNING_DOWNLOAD, ...MORNING_DOWNLOAD_TYPE, ...Object.values(GUESS_THE_NUMBER).flat(), ...FREE_VS_PAID];

/** Every fixture frame, each under its own series. */
const allFrames = (b: Backdrop): Frame[] => [
  ...asSet('morning_download', b, MORNING_DOWNLOAD),
  ...asSet('morning_download', b, MORNING_DOWNLOAD_TYPE),
  ...Object.values(GUESS_THE_NUMBER).flatMap((set) => asSet('guess_the_number', b, set)),
  ...asSet('free_vs_paid', b, FREE_VS_PAID),
];

test('splitLead: the first sentence is the lead, abbreviations and acronyms do not end it', () => {
  assert.deepEqual(splitLead('California Gov. Gavin Newsom signed an order on Sept. 18. A group has two months.'), [
    'California Gov. Gavin Newsom signed an order on Sept. 18.',
    'A group has two months.',
  ]);
  assert.deepEqual(splitLead('The U.S. Senate passed it. Next is the House.'), ['The U.S. Senate passed it.', 'Next is the House.']);
  assert.deepEqual(splitLead('Crusoe raised $3.9 billion. OpenAI rents a site.'), ['Crusoe raised $3.9 billion.', 'OpenAI rents a site.']);
  assert.deepEqual(splitLead('One sentence only.'), ['One sentence only.', '']);
});

test('fixtures: every placed photo has a credit and a file on disk (S-23)', () => {
  for (const d of ALL) {
    const p = framePhoto(d);
    if (!p) continue;
    assert.ok(p.credit.length > 10, `${d.role} credit`);
    assert.ok(existsSync(p.src), `${d.role} photo ${p.src}`);
  }
});

test('safe zones match Instagram (plan §6)', () => {
  assert.equal(SAFE_TOP, 250);
  assert.equal(SAFE_BOTTOM, 340);
});

test('framesHtml: every role on every backdrop renders, with fonts and no model output', async () => {
  for (const b of BACKDROPS) {
    const html = await framesHtml(allFrames(b));
    assert.equal((html.match(/class="st-host"/g) ?? []).length, ALL.length);
    for (const role of ['opener', 'story', 'closer', 'intro', 'question', 'answer', 'paid', 'free']) assert.match(html, new RegExp(`st-role-${role}`));
    // Both intros (S-49, S-50) and the closer line (no "every morning").
    assert.match(html, /st-gtn--intro/);
    assert.match(html, /Difficulty/);
    assert.match(html, /How many people use ChatGPT/);
    assert.match(html, /st-fvp--intro/);
    assert.match(html, /Free Vs\. Paid is our series where we give you guys open source or free tools/);
    assert.match(html, /Follow for AI news, updates and lessons\./);
    assert.doesNotMatch(html, /every morning/);
    // No hints on Guess the Number (S-51).
    assert.doesNotMatch(html, /Hint/);
    assert.match(html, new RegExp(`st-bd-${b}`));
    assert.match(html, /font-family: 'Pragmatica Extended'; src: url\('http:\/\/stories\.local\/__assets\/PragmaticaExtended-Bold\.otf'\)/);
    // Local photos are served from the private origin, never as file paths.
    assert.doesNotMatch(html, /src="lib\/stories/);
    assert.match(html, /heliosgroup\.ai/);
  }
});

test('toStoryJpeg: sRGB JPEG under 8 MB', async () => {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#FF5E1A' } }).png().toBuffer();
  const jpeg = await toStoryJpeg(png);
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.equal(meta.space, 'srgb');
  assert.ok(meta.icc, 'sRGB profile embedded');
  assert.ok(jpeg.length < MAX_JPEG_BYTES);
});

test('fades: one source for the mask and the check; text-safe points are faded', () => {
  for (const b of BACKDROPS) {
    const top = fadeStops('top', b);
    assert.equal(fadeAlpha(top, 0), 1);
    assert.equal(fadeAlpha(top, 1), 0);
    assert.ok(fadeAlpha(top, 0.95) < 0.3, `${b} top fade clears by 95%`);
  }
  const win = fadeStops('window', 'black');
  assert.equal(fadeAlpha(win, 0), 0);
  assert.equal(fadeAlpha(win, 0.5), 1);
  assert.equal(fadeAlpha(win, 1), 0);
  assert.equal(fadeAlpha([[0, 1], [1, 0]], 0.25), 0.75);
  assert.match(fadeMask([[0, 1], [0.5, 0]]), /^linear-gradient\(180deg, rgba\(0, 0, 0, 1\) 0%, rgba\(0, 0, 0, 0\) 50%\)$/);
});

test('every photo is a bleed fade (S-44), and no frame draws a pill cue (S-47)', async () => {
  const html = await framesHtml(allFrames('orange'));
  const photos = ALL.filter((d) => framePhoto(d) && d.role !== 'paid' && d.role !== 'free').length;
  assert.equal((html.match(/data-fade=/g) ?? []).length, photos);
  assert.doesNotMatch(html, /st-card/);
  assert.ok((html.match(/class="st-cue /g) ?? []).length >= 4);
  // A cue is type and an arrow, right-aligned: no background, no rounded shape.
  const css = readFileSync('lib/stories/render/stories.css', 'utf8');
  const cue = /\n\.st-cue \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(cue, /justify-content: flex-end/);
  assert.doesNotMatch(cue, /border-radius|background/);
});

test('an intro frame on Morning Download fails loudly (its opener is the intro)', async () => {
  await assert.rejects(framesHtml(asSet('morning_download', 'black', [{ role: 'intro' }])), /no intro frame/);
});

test('homemade style (S-53): same data, Instagram-editor look; every line on a full photo is boxed', async () => {
  const frames = [
    ...Object.values(GUESS_THE_NUMBER).flatMap((set) => asSet('guess_the_number', 'black', set, 'homemade')),
    ...asSet('free_vs_paid', 'black', FREE_VS_PAID, 'homemade'),
  ];
  const html = await framesHtml(frames);
  assert.equal((html.match(/class="hm-frame /g) ?? []).length, frames.length);
  assert.doesNotMatch(html, /class="st-frame /);
  assert.match(html, /font-family: 'Inter'; src: url\('http:\/\/stories\.local\/__assets\/Inter-Medium\.ttf'\)/);
  // Instagram's highlight boxes, pen arrows, stickers, emoji.
  assert.match(html, /hm-hl hm-box--white/);
  assert.match(html, /class="hm-pen"/);
  assert.match(html, /data-sticker="true"/);
  assert.match(html, /🤔/);
  // No logo or masthead in the homemade look.
  assert.doesNotMatch(html, /helios-logo\.png/);
  // Lines over a full-screen photo carry a box.
  const photoFrame = /<div class="hm-frame[^"]*hm-role-question"[\s\S]*?data-boxed-only="true"[\s\S]*?(?=<div class="st-host"|$)/.exec(html)?.[0] ?? '';
  assert.ok(photoFrame.includes("Can you guess"), "found the full-photo question frame");
  for (const line of photoFrame.match(/<div class="hm-line[^>]*>/g) ?? []) assert.match(line, /data-boxed="true"/);
});

test('pen strokes are seeded: same text, same stroke', async () => {
  const { arrowPaths, seedOf, strikePath } = await import('@/lib/stories/render/pen');
  assert.deepEqual(arrowPaths(170, 90, seedOf('tap to play')), arrowPaths(170, 90, seedOf('tap to play')));
  assert.notDeepEqual(arrowPaths(170, 90, seedOf('tap to play')), arrowPaths(170, 90, seedOf('tap for the free one')));
  assert.match(strikePath(200, 60, 7), /^M/);
});
