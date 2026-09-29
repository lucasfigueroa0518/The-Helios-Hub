import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { adaptToPost, colorSpans, pickStoryType, shouldColorGreen } from '@/lib/social/editorial/v2/adapter';
import { parseBrief, parseEditedPost } from '@/lib/social/editorial/v2/parse';
import type { Brief } from '@/lib/social/editorial/v2/parse';

function makeBrief(imagesBlock = 'IMAGES: None found\n\n', termsBlock?: string) {
  const terms = termsBlock ?? `TERMS:
- Norland Labs: a coding-software company.
- Sequoia: a venture capital firm.
- Dana Reyes: Norland Labs' CEO.
`;
  const raw = `SINGLE STORY: yes
THE NEWS: Norland Labs raised a Series C.
THE STORY: Norland Labs, a coding-software company, raised a $200M Series C led by Sequoia on September 12 2026.
${terms}${imagesBlock}SOURCES:
- The Ledger, 2026-09-12, https://ledger.example.com/norland-series-c
`;
  return parseBrief(raw);
}

type SlideSpec = {
  headline?: string;
  body?: string;
  note?: string;
  bigNumber?: string;
  numberNote?: string;
  secondNumber?: string;
  secondNote?: string;
  quote?: string;
  quoteBy?: string;
  highlight?: string;
  image?: string;
};

function makeEditedPost(spec: {
  coverText?: string;
  coverHighlight?: string;
  coverImage?: string;
  slides?: SlideSpec[];
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
      if (s.note) lines.push(`NOTE: ${s.note}`);
      if (s.bigNumber) lines.push(`BIG NUMBER: ${s.bigNumber}`);
      if (s.numberNote) lines.push(`NUMBER NOTE: ${s.numberNote}`);
      if (s.secondNumber) lines.push(`SECOND NUMBER: ${s.secondNumber}`);
      if (s.secondNote) lines.push(`SECOND NOTE: ${s.secondNote}`);
      if (s.quote) lines.push(`QUOTE: ${s.quote}`);
      if (s.quoteBy) lines.push(`QUOTE BY: ${s.quoteBy}`);
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

describe('adaptToPost — design v1 field-driven mapping', () => {
  test('COVER + type only → cover / C3', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({ coverImage: 'type only', slides: [{ headline: 'A', body: 'Body text.', highlight: 'Body text' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    assert.equal(post.slides[0]!.layoutVariant, 'cover');
    assert.equal(post.slides[0]!.variant, 'C3');
    assert.equal(post.slides[0]!.photoUrl, undefined);
  });

  test('COVER + brief image describing named subject → cover / C1', () => {
    const brief = makeBrief('IMAGES:\nIMAGE 1: Dana Reyes at the office. Credit: Norland Press. Link: https://x.example.com/reyes.jpg\n\n');
    const parsed = makeEditedPost({ coverImage: 'brief image 1', slides: [{ headline: 'A', body: 'x'.repeat(30), highlight: 'x' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    assert.equal(post.slides[0]!.variant, 'C1');
    assert.equal(post.slides[0]!.photoUrl, 'https://x.example.com/reyes.jpg');
  });

  test('COVER + brief image not describing anyone → cover / C2', () => {
    const brief = makeBrief('IMAGES:\nIMAGE 1: A row of servers in a data center. Credit: Wikimedia Commons. Link: https://x.example.com/servers.jpg\n\n');
    const parsed = makeEditedPost({ coverImage: 'brief image 1', slides: [{ headline: 'A', body: 'x'.repeat(30), highlight: 'x' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    assert.equal(post.slides[0]!.variant, 'C2');
  });

  test('QUOTE → quote', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({
      slides: [{ quote: 'Training is paused.', quoteBy: 'Dana Reyes, The Ledger' }],
    });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'quote');
    assert.ok(beat.quoteText);
    assert.equal(beat.quoteBy, 'Dana Reyes, The Ledger');
  });

  test('SECOND NUMBER → split_stat', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({
      slides: [{
        headline: 'Two numbers',
        bigNumber: '$200M',
        numberNote: 'raised to date',
        secondNumber: '$50M',
        secondNote: 'earmarked for chips',
      }],
    });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'split_stat');
    assert.equal(beat.secondNumber, '$50M');
    assert.equal(beat.numberNote, 'raised to date');
    assert.equal(beat.secondNote, 'earmarked for chips');
  });

  test('BIG NUMBER (no SECOND) → stat', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({
      slides: [{ bigNumber: '$200M', numberNote: 'from Sequoia', headline: 'THE RAISE', body: 'Sequoia led.', highlight: 'Sequoia' }],
    });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'stat');
    assert.equal(beat.title?.[0]?.text, '$200M');
    assert.equal(beat.headline?.[0]?.text, 'THE RAISE');
    assert.equal(beat.numberNote, 'from Sequoia');
  });

  test('IMAGE = brief image N (no numbers/quote) + HEADLINE → image', () => {
    const brief = makeBrief('IMAGES:\nIMAGE 1: The office at night. Credit: Norland Press. Link: https://x.example.com/office.jpg\n\n');
    const parsed = makeEditedPost({
      slides: [{ headline: 'The office at night', image: 'brief image 1', highlight: 'office' }],
    });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'image');
    assert.equal(beat.photoUrl, 'https://x.example.com/office.jpg');
  });

  test('HEADLINE only (no BODY, no IMAGE) → landing', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({ slides: [{ headline: 'The story turned here.', note: 'One-line context.', highlight: 'turned here' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'landing');
    assert.ok(beat.headline);
    assert.equal(beat.note, 'One-line context.');
    assert.equal(beat.body, undefined);
  });

  test('HEADLINE + BODY (no numbers/quote/image) → text', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({ slides: [{ headline: 'Chapter title', body: 'Chapter body.', highlight: 'Chapter body' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'text');
    assert.equal(beat.headline?.[0]?.text, 'Chapter title');
    assert.ok(beat.body);
  });

  test('BODY only fallback → text (no headline)', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({ slides: [{ body: 'A body-only slide.', highlight: 'body-only' }] });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.layoutVariant, 'text');
    assert.equal(beat.headline, undefined);
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

describe('adaptToPost — at most one orange span per slide (spec §Color)', () => {
  test('HIGHLIGHT that appears in both HEADLINE and BODY paints headline only', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({
      slides: [{
        headline: 'From under 1% to 26% in six months',
        body: 'In February it was under 1%. Now it is 26%.',
        highlight: 'under 1%',
      }],
    });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    const headlineHook = beat.headline!.find((s) => s.role === 'hook');
    const bodyHook = beat.body!.find((s) => s.role === 'hook');
    assert.ok(headlineHook, 'headline must carry the orange highlight');
    assert.equal(bodyHook, undefined, 'body must NOT carry a second orange span');
  });

  test('HIGHLIGHT only in BODY paints body (headline is empty target)', () => {
    const brief = makeBrief();
    const parsed = makeEditedPost({
      slides: [{
        headline: 'Timing matters',
        body: 'The escape is the first reported since the security overhaul.',
        highlight: 'first reported since',
      }],
    });
    const post = adaptToPost({ brief, post: parsed, caption: 'x'.repeat(500), articlePublishedAt: '2026-09-12', issueNumber: 1 });
    const beat = post.slides[1]!;
    assert.equal(beat.headline!.find((s) => s.role === 'hook'), undefined);
    assert.ok(beat.body!.find((s) => s.role === 'hook'));
  });
});

describe('shouldColorGreen — proper-name filter (design v1 §Color)', () => {
  test('OpenAI (single proper noun) → green', () => {
    assert.equal(shouldColorGreen('OpenAI', 'OpenAI'), true);
  });
  test('Hugging Face (multi-word proper) → green', () => {
    assert.equal(shouldColorGreen('Hugging Face', 'Hugging Face'), true);
  });
  test('sandbox (lowercase, technical) → white', () => {
    assert.equal(shouldColorGreen('sandbox', 'sandbox'), false);
  });
  test('inference (lowercase, technical) → white', () => {
    assert.equal(shouldColorGreen('inference', 'inference'), false);
  });
  test('DNS resolver ("resolver" lowercase) → white', () => {
    assert.equal(shouldColorGreen('DNS resolver', 'DNS resolver'), false);
  });
  test('openai (all-lowercase match) → white even though the term is proper', () => {
    assert.equal(shouldColorGreen('OpenAI', 'openai'), false);
  });
  test('Sandbox (capitalized start-of-sentence, tech deny-list wins) → white', () => {
    assert.equal(shouldColorGreen('Sandbox', 'Sandbox'), false);
  });
});

describe('colorSpans — highlight + green-name integration', () => {
  const brief: Brief = {
    singleStory: { yes: true, sourceNote: '' },
    news: '',
    story: '',
    terms: [
      { name: 'OpenAI', description: 'a company' },
      { name: 'sandbox', description: 'an isolated runtime' },
    ],
    images: [],
    sources: [],
  };

  test('HIGHLIGHT paints hook (orange) span', () => {
    const spans = colorSpans('OpenAI writes 26% of code', '26% of code', [], brief, true);
    const hook = spans.find((s) => s.role === 'hook');
    assert.ok(hook);
    assert.equal(hook?.text, '26% of code');
  });

  test('proper-name term paints pivot (green) when allowGreen=true', () => {
    const spans = colorSpans('OpenAI said the number changed.', '', [], brief, true);
    const pivot = spans.find((s) => s.role === 'pivot' && s.text === 'OpenAI');
    assert.ok(pivot);
  });

  test('technical term "sandbox" stays narrative even when allowGreen=true', () => {
    const spans = colorSpans('The sandbox held.', '', [], brief, true);
    assert.equal(spans.find((s) => s.role === 'pivot'), undefined);
  });

  test('allowGreen=false suppresses all green (used on Cover + Stat number)', () => {
    const spans = colorSpans('OpenAI writes code', '', [], brief, false);
    assert.equal(spans.find((s) => s.role === 'pivot'), undefined);
  });

  test('non-highlighted text stays narrative', () => {
    const spans = colorSpans('Plain sentence, no highlight.', '', [], brief, false);
    assert.equal(spans.length, 1);
    assert.equal(spans[0]!.role, 'narrative');
  });
});

describe('pickStoryType', () => {
  test('routes AI funding stories to ai_funding', () => {
    const brief = makeBrief();
    assert.equal(pickStoryType(brief), 'ai_funding');
  });

  test('falls back to tech when nothing matches', () => {
    const brief = parseBrief(`SINGLE STORY: yes\nTHE NEWS: Something happened.\nTHE STORY: A generic something occurred with no domain keywords.\nTERMS:\nIMAGES: None found\nSOURCES:\n- Outlet, 2026, https://x.example.com`);
    assert.equal(pickStoryType(brief), 'tech');
  });
});
