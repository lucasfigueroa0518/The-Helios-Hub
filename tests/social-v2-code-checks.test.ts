import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  checkCaption,
  checkNumberTrace,
  checkPost,
} from '@/lib/social/editorial/v2/code-checks';
import { parseBrief, parseEditedPost } from '@/lib/social/editorial/v2/parse';

const goodBrief = parseBrief(`SINGLE STORY: yes
THE NEWS: A company shipped a feature.
THE STORY: The company shipped it on 2026-09-01.
TERMS:
- Norland Labs: a coding-software company.
IMAGES:
IMAGE 1: Norland Labs office. Credit: Norland Labs. Link: https://x.example.com/1.jpg
SOURCES:
- The Ledger, 2026-09-01, https://ledger.example.com/norland
`);

function buildPost(over: Partial<{
  coverText: string;
  coverHighlight: string;
  slides: Array<{ headline?: string; body?: string; bigNumber?: string; highlight?: string; image?: string }>;
  followText: string;
  coverImage: string;
}> = {}) {
  const cover = over.coverText ?? 'Norland Labs shipped a feature that runs 40% of its own code review.';
  const highlight = over.coverHighlight ?? '40% of its own code review';
  const coverImage = over.coverImage ?? 'brief image 1';
  const slides = over.slides ?? [
    { headline: 'From 2% to 40% in six months', body: 'The company said 40% of code review runs on the tool.', highlight: '40% of code review', image: 'brief image 1' },
    { body: 'Some more body content that ends in period.', highlight: 'more body content', image: 'type only' },
  ];
  const followText = over.followText ?? 'Follow Helios for how AI companies use their own tools.';

  const raw = [
    `COVER: ${cover}`,
    `COVER HIGHLIGHT: ${highlight}`,
    `COVER IMAGE: ${coverImage}`,
    '',
    ...slides.flatMap((s, i) => {
      const lines = [`SLIDE ${i + 2}`];
      if (s.headline) lines.push(`HEADLINE: ${s.headline}`);
      if (s.body) lines.push(`BODY: ${s.body}`);
      if (s.bigNumber) lines.push(`BIG NUMBER: ${s.bigNumber}`);
      if (s.highlight) lines.push(`HIGHLIGHT: ${s.highlight}`);
      if (s.image) lines.push(`IMAGE: ${s.image}`);
      lines.push('');
      return lines;
    }),
    `FOLLOW: ${followText}`,
    '',
    'EDIT NOTES:',
    'None',
  ].join('\n');
  return parseEditedPost(raw);
}

describe('checkPost — slide count', () => {
  test('flags fewer than 4 total slides (cover+1+follow=3)', () => {
    const post = buildPost({ slides: [{ headline: 'Only one beat', body: 'x'.repeat(20), highlight: 'Only one beat' }] });
    const r = checkPost(post, goodBrief);
    // Cover=1, beat=1, follow=1 → total 3
    assert.ok(r.errors.some((e) => e.kind === 'slide_count'), 'should flag slide_count');
  });

  test('flags more than 11 total slides', () => {
    const slides = Array.from({ length: 12 }).map((_, i) => ({ body: `Body ${i} content.`, highlight: `Body ${i}` }));
    const post = buildPost({ slides });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'slide_count'), 'should flag slide_count');
  });
});

describe('checkPost — char limits', () => {
  test('flags cover over 100 chars', () => {
    const post = buildPost({ coverText: 'x'.repeat(101), coverHighlight: 'xxxxx' });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'char_limit' && e.target === 'cover');
    assert.ok(err, 'should flag cover length');
  });
  test('flags follow over 100 chars', () => {
    const post = buildPost({ followText: 'x'.repeat(101) });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'char_limit' && e.target === 'follow'));
  });
});

describe('checkPost — HIGHLIGHT must be substring', () => {
  test('flags cover highlight not in cover text', () => {
    const post = buildPost({ coverText: 'A short cover.', coverHighlight: 'not present anywhere' });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'highlight_substring' && e.target === 'cover'));
  });
});

describe('checkPost — image refs', () => {
  test('flags brief image N that does not exist', () => {
    const post = buildPost({ coverImage: 'brief image 99' });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'image_ref' && e.target === 'cover'));
  });
  test('allows "type only" and free-text descriptions', () => {
    const post = buildPost({ coverImage: 'type only' });
    const r = checkPost(post, goodBrief);
    assert.ok(!r.errors.some((e) => e.kind === 'image_ref'));
  });
});

describe('checkPost — banned voice', () => {
  test('flags em dash as banned_always', () => {
    const post = buildPost({ slides: [{ body: 'This is bold — dramatic and wrong.', highlight: 'bold' }] });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'banned_always'));
  });
  test('flags "unprecedented" as banned_always (clear hype, no normal use in Helios voice)', () => {
    const post = buildPost({ slides: [{ body: 'The rise is unprecedented for the industry.', highlight: 'The rise' }] });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'banned_always' && e.message.includes('unprecedented')));
    assert.ok(!r.errors.some((e) => e.kind === 'banned_judgment' && e.word === 'unprecedented'));
  });
  test('flags "features" as banned_judgment (has genuine normal uses)', () => {
    const post = buildPost({ slides: [{ body: 'The tool features a keyboard shortcut for saving.', highlight: 'keyboard shortcut' }] });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'banned_judgment' && e.word === 'features'));
  });
  test('flags "serves as" as banned_always (multi-word phrase)', () => {
    const post = buildPost({ slides: [{ body: 'The API serves as a bridge between services.', highlight: 'bridge between services' }] });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'banned_always' && e.message.includes('serves as')));
  });
});

describe('checkCaption', () => {
  test('flags too-short caption ex-Source', () => {
    const caption = 'Short.\n\nSource: X, 2026';
    const r = checkCaption(caption);
    assert.ok(r.errors.some((e) => e.kind === 'caption_length'));
  });
  test('flags hashtags', () => {
    const caption = ['Body paragraph. '.repeat(35), '#AI', 'Source: X, 2026'].join('\n');
    const r = checkCaption(caption);
    assert.ok(r.errors.some((e) => e.kind === 'caption_hashtag'));
  });
});

describe('checkNumberTrace', () => {
  test('accepts $21 billion when source has $21B', () => {
    const post = buildPost({ slides: [{ body: 'Company raised nearly $21 billion in September 2026.', highlight: '$21 billion' }] });
    const sources = ['The company raised $21B this quarter and now employs 40,000 engineers.'];
    const r = checkNumberTrace(post, 'body caption. Source: X, 2026-09-01', sources);
    assert.ok(!r.errors.some((e) => e.kind === 'number_trace' && String(e.message).includes('$21')), 'should accept $21B ↔ $21 billion');
  });
  test('flags a number the sources never mention', () => {
    const post = buildPost({ slides: [{ body: 'The bogus figure was 987654 units.', highlight: '987654 units' }] });
    const sources = ['No matching number here at all.'];
    const r = checkNumberTrace(post, 'body caption. Source: X, 2026-09-01', sources);
    assert.ok(r.errors.some((e) => e.kind === 'number_trace' && String(e.message).includes('987654')));
  });
  test('accepts 26% when source has 26 percent', () => {
    const post = buildPost({ slides: [{ body: 'Claude wrote 26% of code.', highlight: '26% of code' }] });
    const sources = ['Claude wrote 26 percent of the R&D code.'];
    const r = checkNumberTrace(post, 'body. Source: X, 2026-09-01', sources);
    assert.ok(!r.errors.some((e) => e.kind === 'number_trace' && String(e.message).includes('26%')));
  });
});
