import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { adaptToPost, colorSpans, pickStoryType } from '@/lib/social/editorial/v2/adapter';
import { parseBrief, parseEditedPost } from '@/lib/social/editorial/v2/parse';

function makeBrief(imagesBlock = 'IMAGES: None found\n\n') {
  const raw = `SINGLE STORY: yes
THE NEWS: Norland Labs raised a Series C.
THE STORY: Norland Labs, a coding-software company, raised a $200M Series C led by Sequoia on September 12 2026.
TERMS:
- Norland Labs: a coding-software company.
- Sequoia: a venture capital firm.
- Dana Reyes: Norland Labs' CEO.
${imagesBlock}SOURCES:
- The Ledger, 2026-09-12, https://ledger.example.com/norland-series-c
`;
  return parseBrief(raw);
}

function makeEditedPost(spec: {
  coverText?: string;
  coverHighlight?: string;
  coverImage?: string;
  slides?: Array<{ headline?: string; body?: string; bigNumber?: string; highlight?: string; image?: string }>;
  followText?: string;
}) {
  const coverText = spec.coverText ?? 'Norland Labs raised $200M led by Sequoia.';
  const coverHighlight = spec.coverHighlight ?? '$200M';
  const coverImage = spec.coverImage ?? 'type only';
  const slides = spec.slides ?? [];
  const followText = spec.followText ?? 'Follow Helios for the funding stories that shape AI tools.';
  const raw = [
    `COVER: ${coverText}`,
    `COVER HIGHLIGHT: ${coverHighlight}`,
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

describe('adaptToPost — layout mapping (Change 3 table)', () => {
  test('COVER + type only → cover / C3', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({ coverImage: 'type only', slides: [{ body: 'Body text.', highlight: 'Body text' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    assert.equal(post.slides[0]!.layoutVariant, 'cover');
    assert.equal(post.slides[0]!.variant, 'C3');
    assert.equal(post.slides[0]!.photoUrl, undefined);
  });

  test('COVER + brief image describing named subject → cover / C1', () => {
    const brief = makeBrief('IMAGES:\nIMAGE 1: Dana Reyes at the office. Credit: Norland Press. Link: https://x.example.com/reyes.jpg\n\n');
    const parsed = makeEditedPost({ coverImage: 'brief image 1', slides: [{ body: 'x'.repeat(30), highlight: 'x' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    assert.equal(post.slides[0]!.layoutVariant, 'cover');
    assert.equal(post.slides[0]!.variant, 'C1');
    assert.equal(post.slides[0]!.photoUrl, 'https://x.example.com/reyes.jpg');
    assert.equal(post.slides[0]!.photoCredit, 'NORLAND PRESS');
  });

  test('COVER + brief image not describing anyone → cover / C2', () => {
    const brief = makeBrief('IMAGES:\nIMAGE 1: A row of servers in a data center. Credit: Wikimedia Commons. Link: https://x.example.com/servers.jpg\n\n');
    const parsed = makeEditedPost({ coverImage: 'brief image 1', slides: [{ body: 'x'.repeat(30), highlight: 'x' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    assert.equal(post.slides[0]!.variant, 'C2');
  });

  test('BIG NUMBER → data_block / D1', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({
      slides: [{ bigNumber: '$200M', headline: 'THE RAISE', body: 'Sequoia led the round.', highlight: 'Sequoia' }],
    });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'data_block');
    assert.equal(beat.variant, 'D1');
    assert.ok(beat.title);
    assert.equal(beat.title?.[0]?.text, '$200M');
    assert.equal(beat.headline?.[0]?.text, 'THE RAISE');
    assert.match(beat.body?.map((s) => s.text).join('') ?? '', /Sequoia led the round/);
  });

  test('HEADLINE only → story_beat / B5 (landing)', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({ slides: [{ headline: 'The story turned here.', highlight: 'turned here' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'story_beat');
    assert.equal(beat.variant, 'B5');
    assert.ok(beat.headline);
    assert.equal(beat.body, undefined);
  });

  test('BODY only → story_beat / B1 (default: body-top only)', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({ slides: [{ body: 'A body-only slide.', highlight: 'body-only' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'story_beat');
    assert.equal(beat.variant, 'B1');
    assert.equal(beat.title, undefined);
    assert.ok(beat.body);
  });

  test('HEADLINE + BODY → story_beat / B1 (title + body chapter-mark stack)', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({ slides: [{ headline: 'Chapter title', body: 'Chapter body.', highlight: 'Chapter body' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'story_beat');
    assert.equal(beat.variant, 'B1');
    assert.equal(beat.title?.[0]?.text, 'Chapter title');
    assert.ok(beat.body);
  });

  test('FOLLOW → follow / F1 with storySpecificLine', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({ followText: 'Follow Helios for how funding rounds shape AI tools.' });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const follow = post.slides[post.slides.length - 1]!;
    assert.equal(follow.layoutVariant, 'follow');
    assert.equal(follow.variant, 'F1');
    assert.equal(follow.storySpecificLine, 'Follow Helios for how funding rounds shape AI tools.');
  });
});

describe('colorSpans', () => {
  test('marks HIGHLIGHT phrase as hook role', () => {
    const spans = colorSpans('Anthropic writes 26% of code', '26% of code', [], []);
    const hook = spans.find((s) => s.role === 'hook');
    assert.ok(hook);
    assert.equal(hook?.text, '26% of code');
  });

  test('marks pivot words (company names) as pivot role', () => {
    const spans = colorSpans('Anthropic said the number changed.', '', ['Anthropic'], []);
    const pivot = spans.find((s) => s.role === 'pivot');
    assert.ok(pivot);
    assert.equal(pivot?.text, 'Anthropic');
  });

  test('detects year as pivot role', () => {
    const spans = colorSpans('Started in 2026 by three engineers.', '', [], []);
    assert.ok(spans.find((s) => s.role === 'pivot' && s.text === '2026'));
  });

  test('non-highlighted text stays narrative', () => {
    const spans = colorSpans('Plain sentence, no highlight.', '', [], []);
    assert.equal(spans.length, 1);
    assert.equal(spans[0]!.role, 'narrative');
  });
});

describe('pickStoryType', () => {
  test('routes AI funding stories to ai_funding', () => {
    const brief = makeBrief();
    // brief.story mentions "Series C" — should map to ai_funding
    assert.equal(pickStoryType(brief), 'ai_funding');
  });

  test('falls back to tech when nothing matches', () => {
    const brief = parseBrief(`SINGLE STORY: yes\nTHE NEWS: Something happened.\nTHE STORY: A generic something occurred with no domain keywords.\nTERMS:\nIMAGES: None found\nSOURCES:\n- Outlet, 2026, https://x.example.com`);
    assert.equal(pickStoryType(brief), 'tech');
  });
});
