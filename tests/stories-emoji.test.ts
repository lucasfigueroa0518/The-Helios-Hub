/**
 * Apple emoji in rendered Stories frames (offline; no browser). The worker
 * renders on Linux, whose only emoji font is Noto, so the homemade frames draw
 * each emoji as Apple's own 160px image instead of a font glyph.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { EMOJI_RUN, appleEmoji, emojiFile, emojiKey } from '@/lib/stories/render/emoji';
import { framesHtml } from '@/lib/stories/render/render';
import type { Frame } from '@/lib/stories/render/types';

const O = 'http://stories.local';

test('emojiKey: lower-case code points, variation selectors dropped', () => {
  assert.equal(emojiKey('🎯'), '1f3af');
  assert.equal(emojiKey('🌶️'), '1f336');
  assert.equal(emojiKey('✅'), '2705');
});

test('appleEmoji: emoji in text become Apple images; tags and attributes are left alone', () => {
  const html = '<p class="hm-line" title="🎯">Guess the Number 🎯</p><span>🌶️🌶️</span>';
  const out = appleEmoji(html, O);
  assert.match(out, /<p class="hm-line" title="🎯">Guess the Number <img class="hm-emoji" src="http:\/\/stories\.local\/__assets\/emoji-1f3af\.png" alt=""\/><\/p>/);
  assert.equal(out.match(/emoji-1f336\.png/g)?.length, 2);
});

test('appleEmoji: an emoji with no bundled image stays as text (the font draws it)', () => {
  assert.equal(appleEmoji('<p>🦄</p>', O), '<p>🦄</p>');
});

test('every emoji in the frame copy has a bundled Apple image', () => {
  const copy = readFileSync(path.join(process.cwd(), 'lib/stories/render/copy.ts'), 'utf8');
  const found = new Set([...copy.matchAll(EMOJI_RUN)].map((m) => emojiKey(m[0])));
  assert.ok(found.size >= 10, `found ${found.size}`);
  for (const key of found) assert.ok(existsSync(emojiFile(key)), `missing lib/stories/render/assets/emoji-${key}.png`);
});

test('framesHtml: a homemade frame carries Apple emoji images, not raw emoji', async () => {
  const frame: Frame = { series: 'guess_the_number', backdrop: 'black', style: 'homemade', index: 1, total: 3, data: { role: 'intro', difficulty: 'high', topic: 'How many people use ChatGPT' } };
  const html = await framesHtml([frame]);
  assert.match(html, /class="hm-emoji" src="[^"]*emoji-1f336\.png"/);
  const body = html.slice(html.indexOf('<body>'));
  assert.equal(/>[^<]*\p{Extended_Pictographic}/u.test(body.replace(/<img[^>]*>/g, '')), false);
});
