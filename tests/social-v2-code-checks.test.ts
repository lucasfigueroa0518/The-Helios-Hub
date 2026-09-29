import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  checkCaption,
  checkNumberTrace,
  checkPost,
  checkQuotes,
  classifySlideType,
  partitionErrors,
  renderLengthsBlock,
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

  test('boundary: exactly 4 slides (cover + 2 beats + follow) passes', () => {
    const slides = [
      { body: 'Body one.', highlight: 'Body one' },
      { body: 'Body two.', highlight: 'Body two' },
    ];
    const post = buildPost({ slides });
    // 1 cover + 2 beats + 1 follow = 4. Under limit.
    const r = checkPost(post, goodBrief);
    assert.ok(!r.errors.some((e) => e.kind === 'slide_count'), 'exactly 4 must pass');
  });

  test('boundary: exactly 11 slides (cover + 9 beats + follow) passes', () => {
    const slides = Array.from({ length: 9 }).map((_, i) => ({ body: `Body ${i}.`, highlight: `Body ${i}` }));
    const post = buildPost({ slides });
    // 1 cover + 9 beats + 1 follow = 11. At limit.
    const r = checkPost(post, goodBrief);
    assert.ok(!r.errors.some((e) => e.kind === 'slide_count'), 'exactly 11 must pass');
  });

  test('boundary: 12 slides (cover + 10 beats + follow) fails', () => {
    const slides = Array.from({ length: 10 }).map((_, i) => ({ body: `Body ${i}.`, highlight: `Body ${i}` }));
    const post = buildPost({ slides });
    // 1 cover + 10 beats + 1 follow = 12. Over limit.
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'slide_count'), 'exactly 12 must fail');
  });

  test('boundary: 3 slides (cover + 1 beat + follow) fails', () => {
    const slides = [{ body: 'Body one.', highlight: 'Body one' }];
    const post = buildPost({ slides });
    // 1 cover + 1 beat + 1 follow = 3. Under min.
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'slide_count'), '3 must fail');
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
  test('char-limit message uses "SLIDE N BODY (X characters, limit Y): cut …" format', () => {
    const post = buildPost({ slides: [{ body: 'x'.repeat(292), highlight: 'x' }] });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'char_limit' && e.field === 'BODY');
    assert.ok(err);
    // Exact user-facing format: SLIDE 2 BODY (292 characters, limit 220): cut at least 72 characters (about 12 words).
    assert.match(err!.message, /^SLIDE 2 BODY \(292 characters, limit 220\)/);
    assert.match(err!.message, /cut at least 72 characters/);
    assert.match(err!.message, /about 12 words/);
    // Runs 3-4 showed the Editor was rewording sentences and inching down
    // a few chars per pass. The message tells it to cut whole clauses.
    assert.match(err!.message, /Cut a whole clause or sentence rather than rewording\./);
  });
  test('caption over-length message uses length-inline format with total including credits', () => {
    // 2100 chars caption + 200 chars credits = 2300 total > 2200 → over by 100.
    const caption = 'x'.repeat(2100) + '\n\nSource: X';
    const r = checkCaption(caption, 200);
    const err = r.errors.find((e) => e.kind === 'caption_length');
    assert.ok(err);
    assert.match(err!.message, /2111 characters \+ 200 appended image credits = 2311 total, limit 2200/);
    assert.match(err!.message, /cut at least 111 characters/);
    assert.match(err!.message, /Cut a whole clause or sentence rather than rewording\./);
  });
  test('banned-voice errors on a slide include the field length prefix', () => {
    // Slide with em dash — banned_always fires — message must show BODY length + limit.
    const post = buildPost({ slides: [{ body: 'This — is banned.', highlight: 'This' }] });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'banned_always' && e.field === 'BODY');
    assert.ok(err);
    assert.match(err!.message, /^SLIDE 2 BODY \(\d+ characters, limit 220\)/);
    assert.match(err!.message, /banned em dash/);
  });
  test('highlight_substring error shows HEADLINE and BODY lengths so the Editor can pick which to update', () => {
    const post = buildPost({ slides: [{ headline: 'Some headline text.', body: 'Some body text of moderate length.', highlight: 'not present anywhere' }] });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'highlight_substring' && e.target === 'slide');
    assert.ok(err);
    assert.match(err!.message, /SLIDE 2 HIGHLIGHT/);
    assert.match(err!.message, /HEADLINE \(19 characters\)/);
    assert.match(err!.message, /BODY \(34 characters\)/);
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
    assert.ok(r.errors.some((e) => e.kind === 'banned_always' && /em dash/.test(e.message)));
  });
  test('flags en dash as banned_always', () => {
    const post = buildPost({ slides: [{ body: 'A range – dramatic and wrong.', highlight: 'range' }] });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'banned_always' && /en dash/.test(e.message)));
  });
  test('flags "--" (double hyphen) as banned_always', () => {
    const post = buildPost({ slides: [{ body: 'Anthropic said -- and this is banned.', highlight: 'Anthropic said' }] });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'banned_always' && /double hyphen/.test(e.message)));
  });
  test('does NOT flag single hyphens in normal hyphenated words', () => {
    // Common tech-writing hyphens that must pass unchanged: compound modifiers,
    // "AI-driven"-style constructions, ranges without an en dash, etc.
    const post = buildPost({ slides: [{
      body: 'The high-level architecture is AI-driven and open-source, spanning 2020-2026.',
      highlight: 'high-level architecture',
    }] });
    const r = checkPost(post, goodBrief);
    const dashErrors = r.errors.filter((e) => e.kind === 'banned_always' && /dash|hyphen/i.test(e.message));
    assert.equal(dashErrors.length, 0, `single hyphens must never trigger a dash ban; got: ${dashErrors.map((e) => e.message).join(' | ')}`);
  });
  test('does NOT flag a single hyphen followed by a word (e.g., "-driven")', () => {
    const post = buildPost({ slides: [{ body: 'The chart shows year-over-year growth.', highlight: 'year-over-year' }] });
    const r = checkPost(post, goodBrief);
    assert.equal(r.errors.filter((e) => e.kind === 'banned_always' && /dash|hyphen/i.test(e.message)).length, 0);
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
  test('no minimum: a very short caption passes the length check', () => {
    const caption = 'Short.\n\nSource: X, 2026';
    const r = checkCaption(caption);
    // Old rule flagged this. New rule has no minimum.
    assert.ok(!r.errors.some((e) => e.kind === 'caption_length'));
  });
  test('cap is 2200 total incl. Source + appended credits', () => {
    // Caption text 2000 chars + "\n\nSource: X" (11 chars) = 2011.
    // Credits estimate 300 → total 2311 > 2200 → over by 111.
    const caption = 'x'.repeat(2000) + '\n\nSource: X';
    const r = checkCaption(caption, 300);
    const err = r.errors.find((e) => e.kind === 'caption_length');
    assert.ok(err);
    assert.match(err!.message, /2011 characters \+ 300 appended image credits = 2311 total, limit 2200/);
    assert.match(err!.message, /cut at least 111 characters/);
  });
  test('a caption within cap passes even with credits added', () => {
    const caption = 'x'.repeat(1800) + '\n\nSource: X';
    const r = checkCaption(caption, 300); // total = 1811 + 300 = 2111 ≤ 2200
    assert.ok(!r.errors.some((e) => e.kind === 'caption_length'));
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

describe('renderLengthsBlock', () => {
  test("renders a LENGTHS: header with every field's current length and marks overs", () => {
    const post = buildPost({
      coverText: 'x'.repeat(80),
      coverHighlight: 'x',
      slides: [
        { headline: 'y'.repeat(45), body: 'z'.repeat(300), highlight: 'z' }, // body over 220
      ],
      followText: 'f'.repeat(90),
    });
    const block = renderLengthsBlock(post, 'x'.repeat(1000), 200);
    assert.match(block, /^LENGTHS:$/m);
    assert.match(block, /- COVER: 80 characters \(limit 100\)$/m);
    assert.match(block, /- SLIDE 2 HEADLINE: 45 characters \(limit 60\)$/m);
    // Body is 300 > 220 → must be flagged as OVER.
    assert.match(block, /- SLIDE 2 BODY: 300 characters \(limit 220\) — OVER$/m);
    assert.match(block, /- FOLLOW: 90 characters \(limit 100\)$/m);
    // Caption 1000 + 200 credits = 1200 total, under 2200 → no OVER.
    assert.match(block, /- CAPTION: 1000 characters \+ 200 appended credits = 1200 total \(limit 2200\)$/m);
  });
  test('CAPTION over cap gets — OVER', () => {
    const post = buildPost({ slides: [{ body: 'ok', highlight: 'ok' }] });
    const block = renderLengthsBlock(post, 'x'.repeat(2100), 200);
    assert.match(block, /- CAPTION: 2100 characters \+ 200 appended credits = 2300 total \(limit 2200\) — OVER$/m);
  });
  test('omits CAPTION row when caption is null', () => {
    const post = buildPost({ slides: [{ body: 'ok', highlight: 'ok' }] });
    const block = renderLengthsBlock(post, null, 0);
    assert.doesNotMatch(block, /CAPTION/);
  });
});

describe('classifySlideType — design v1 field-driven types', () => {
  test('QUOTE wins first', () => {
    assert.equal(classifySlideType({ position: 2, quote: 'X', bigNumber: '$1' }), 'quote');
  });
  test('SECOND NUMBER → split_stat', () => {
    assert.equal(classifySlideType({ position: 2, bigNumber: '$1', secondNumber: '$2' }), 'split_stat');
  });
  test('BIG NUMBER alone → stat', () => {
    assert.equal(classifySlideType({ position: 2, bigNumber: '$1' }), 'stat');
  });
  test('brief-image IMAGE + HEADLINE only (no body) → image', () => {
    assert.equal(classifySlideType({ position: 2, headline: 'H', image: 'brief image 2' }), 'image');
  });
  test('brief-image IMAGE + HEADLINE + BODY → text (text-with-photo layout)', () => {
    assert.equal(classifySlideType({ position: 2, headline: 'H', body: 'B', image: 'brief image 2' }), 'text');
  });
  test('HEADLINE only (no BODY) → landing', () => {
    assert.equal(classifySlideType({ position: 2, headline: 'H' }), 'landing');
  });
  test('HEADLINE + BODY → text', () => {
    assert.equal(classifySlideType({ position: 2, headline: 'H', body: 'B' }), 'text');
  });
});

describe('checkPost — rhythm soft check (no two consecutive same-type)', () => {
  test('two text slides in a row emits a rhythm error', () => {
    const raw = `COVER: Cover text ok.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
HEADLINE: Chapter one
BODY: Body one.
HIGHLIGHT: Chapter one
IMAGE: type only

SLIDE 3
HEADLINE: Chapter two
BODY: Body two.
HIGHLIGHT: Chapter two
IMAGE: type only

FOLLOW: Follow Helios.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    const rhythm = report.errors.filter((e) => e.kind === 'rhythm');
    assert.equal(rhythm.length, 1);
    assert.match(rhythm[0]!.message, /SLIDE 3 and SLIDE 2 are both "text"/);
  });

  test('mixed types in a row do not trigger rhythm', () => {
    const raw = `COVER: Cover.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
HEADLINE: Chapter
BODY: Body one.
IMAGE: type only

SLIDE 3
HEADLINE: Landing statement
IMAGE: type only

SLIDE 4
HEADLINE: The number
BIG NUMBER: $100M
NUMBER NOTE: raised so far
IMAGE: type only

FOLLOW: Follow Helios.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    assert.equal(report.errors.filter((e) => e.kind === 'rhythm').length, 0);
  });

  test('rhythm errors partition as soft (do not block fact-checker)', () => {
    const raw = `COVER: Cover.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
HEADLINE: A
BODY: One.
IMAGE: type only

SLIDE 3
HEADLINE: B
BODY: Two.
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const { errors } = checkPost(post, goodBrief);
    const { soft, hard } = partitionErrors(errors);
    assert.ok(soft.some((e) => e.kind === 'rhythm'));
    assert.equal(hard.filter((e) => e.kind === 'rhythm').length, 0);
  });
});

describe('checkQuotes — hard check that QUOTE appears in a fetched source', () => {
  const sourceTexts = [
    'The company published a statement. The CEO said: "Training is paused until further notice." More text follows.',
  ];

  test('exact quote match passes', () => {
    const raw = `COVER: X.
COVER HIGHLIGHT: X
COVER IMAGE: type only

SLIDE 2
QUOTE: Training is paused until further notice.
QUOTE BY: CEO, The Ledger
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkQuotes(post, sourceTexts);
    assert.equal(report.ok, true);
  });

  test('curly-quote / whitespace normalization still matches', () => {
    const raw = `COVER: X.
COVER HIGHLIGHT: X
COVER IMAGE: type only

SLIDE 2
QUOTE: "Training is  paused until further notice."
QUOTE BY: CEO
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkQuotes(post, sourceTexts);
    // Straight → curly, double space → single; normalization should
    // still find the substring.
    assert.equal(report.ok, true);
  });

  test('fabricated quote (not in any source) → hard error', () => {
    const raw = `COVER: X.
COVER HIGHLIGHT: X
COVER IMAGE: type only

SLIDE 2
QUOTE: We plan to double revenue by 2028.
QUOTE BY: CEO
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkQuotes(post, sourceTexts);
    assert.equal(report.ok, false);
    const err = report.errors[0]!;
    assert.equal(err.kind, 'quote_verbatim');
    // quote_verbatim is a HARD error per partitionErrors.
    const { hard } = partitionErrors(report.errors);
    assert.equal(hard.length, 1);
  });
});

describe('checkPost — design v1 length limits (per new fields)', () => {
  test('NOTE over 60 chars → char_limit', () => {
    const raw = `COVER: Cover text.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
HEADLINE: Landing
NOTE: ${'x'.repeat(80)}
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    const overs = report.errors.filter((e) => e.kind === 'char_limit' && e.field === 'NOTE');
    assert.equal(overs.length, 1);
  });

  test('QUOTE over 200 chars → char_limit', () => {
    const raw = `COVER: Cover.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
QUOTE: ${'q'.repeat(220)}
QUOTE BY: CEO
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    const overs = report.errors.filter((e) => e.kind === 'char_limit' && e.field === 'QUOTE');
    assert.equal(overs.length, 1);
  });

  test('SECOND NUMBER over 12 chars → char_limit', () => {
    const raw = `COVER: Cover.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
HEADLINE: Split
BIG NUMBER: $100M
NUMBER NOTE: from A
SECOND NUMBER: ${'x'.repeat(20)}
SECOND NOTE: from B
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    const overs = report.errors.filter((e) => e.kind === 'char_limit' && e.field === 'SECOND NUMBER');
    assert.equal(overs.length, 1);
  });

  test('HIGHLIGHT accepts phrases from QUOTE', () => {
    const raw = `COVER: Cover.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
QUOTE: The training is paused until further notice.
QUOTE BY: CEO
HIGHLIGHT: training is paused
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    const bad = report.errors.filter((e) => e.kind === 'highlight_substring');
    assert.equal(bad.length, 0);
  });

  test('HIGHLIGHT accepts phrases from NOTE', () => {
    const raw = `COVER: Cover.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
HEADLINE: Landing
NOTE: The context sits here.
HIGHLIGHT: context sits
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    const bad = report.errors.filter((e) => e.kind === 'highlight_substring');
    assert.equal(bad.length, 0);
  });
});
