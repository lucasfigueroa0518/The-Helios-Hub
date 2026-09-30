import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  checkCaption,
  checkCoverNamesPicturedPerson,
  checkNumberTrace,
  checkOutlineMatch,
  checkPost,
  checkQuotes,
  classifySlideType,
  countCoverChars,
  partitionErrors,
  renderLengthsBlock,
  validateOutline,
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

  test('boundary: exactly 5 story slides passes (min)', () => {
    const slides = Array.from({ length: 5 }).map((_, i) => ({ body: `Body ${i}.`, highlight: `Body ${i}` }));
    const post = buildPost({ slides });
    // Cover + 5 story slides + follow = 7 total, 5 story = at min.
    const r = checkPost(post, goodBrief);
    assert.ok(!r.errors.some((e) => e.kind === 'slide_count'), '5 story slides must pass');
  });

  test('boundary: exactly 8 story slides passes (max)', () => {
    const slides = Array.from({ length: 8 }).map((_, i) => ({ body: `Body ${i}.`, highlight: `Body ${i}` }));
    const post = buildPost({ slides });
    // Cover + 8 story slides + follow = 10 total, 8 story = at max.
    const r = checkPost(post, goodBrief);
    assert.ok(!r.errors.some((e) => e.kind === 'slide_count'), '8 story slides must pass');
  });

  test('boundary: 4 story slides fails (under min)', () => {
    const slides = Array.from({ length: 4 }).map((_, i) => ({ body: `Body ${i}.`, highlight: `Body ${i}` }));
    const post = buildPost({ slides });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'slide_count');
    assert.ok(err, '4 story slides must fail');
    assert.match(err!.message, /minimum is 5/);
  });

  test('boundary: 9 story slides fails (over max)', () => {
    const slides = Array.from({ length: 9 }).map((_, i) => ({ body: `Body ${i}.`, highlight: `Body ${i}` }));
    const post = buildPost({ slides });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'slide_count');
    assert.ok(err, '9 story slides must fail');
    assert.match(err!.message, /maximum is 8/);
  });
});

describe('countCoverChars — canonical single counter for the cover', () => {
  // 2026-09-29 late: the "cover length" figure drifted across three
  // reports (summary 90, replay 108 which was a visual guess, and an
  // off-the-cuff 118 that was the DIFFERENT Suleyman run). One counter,
  // one number. This test locks it in with the actual FINAL cover from
  // runs/2026-09-29T16-40-07-763Z so future edits can't drift.
  const SULEYMAN_16_40_07_COVER = "Suleyman says Anthropic's AI consciousness training could make advanced AI uncontrollable.";

  test('Suleyman 16-40-07 FINAL cover counts to 90 chars, passes the HARD 90-char limit', () => {
    const post = buildPost({ coverText: SULEYMAN_16_40_07_COVER, coverHighlight: 'could make advanced AI uncontrollable' });
    // Canonical counter.
    assert.equal(countCoverChars(post.cover), 90);
    // 90 is exactly at the limit; check must NOT flag it (`> 90`).
    const r = checkPost(post, goodBrief);
    const cover = r.errors.find((e) => e.kind === 'char_limit' && e.target === 'cover');
    assert.equal(cover, undefined, 'exact-90-char cover must pass the char_limit check');
  });

  test('91 chars fails (strict > LIMITS.cover)', () => {
    const post = buildPost({ coverText: `${SULEYMAN_16_40_07_COVER}x`, coverHighlight: 'x' });
    assert.equal(countCoverChars(post.cover), 91);
    const r = checkPost(post, goodBrief);
    const cover = r.errors.find((e) => e.kind === 'char_limit' && e.target === 'cover');
    assert.ok(cover, '91-char cover must fail');
  });

  test('counter is a pure function of cover.text — no markup or highlight tags counted', () => {
    // Highlight is a separate field; it does NOT inflate the count.
    const post = buildPost({ coverText: 'A short cover.', coverHighlight: 'short' });
    assert.equal(countCoverChars(post.cover), 'A short cover.'.length);
  });
});

describe('checkPost — char limits', () => {
  test('flags cover over 100 chars', () => {
    const post = buildPost({ coverText: 'x'.repeat(101), coverHighlight: 'xxxxx' });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'char_limit' && e.target === 'cover');
    assert.ok(err, 'should flag cover length');
  });

  test('cover char_limit is HARD (2026-09-29 late: no soft-repair on cover overflow)', () => {
    // A very long single word ("SUPERCALIFRAGILISTICEXPIALIDOCIOUSNESS") — 39
    // chars, plus surrounding sentence — pushes the cover past 90 chars. The
    // check must fire AND the error must partition as HARD so the pipeline
    // rejects it at the code-check gate, not soft-repair.
    const longWord = 'SUPERCALIFRAGILISTICEXPIALIDOCIOUSNESS'; // 38 chars
    const post = buildPost({
      coverText: `Norland Labs announced ${longWord} — its new AI framework, launching in October.`,
      coverHighlight: longWord,
    });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'char_limit' && e.target === 'cover');
    assert.ok(err);
    const { hard, soft } = partitionErrors([err!]);
    assert.equal(hard.length, 1, 'cover char_limit must be HARD');
    assert.equal(soft.length, 0);
  });

  test('non-cover char_limit stays SOFT (existing behavior)', () => {
    const post = buildPost({ slides: [{ body: 'x'.repeat(292), highlight: 'x' }] });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'char_limit' && e.target === 'slide');
    assert.ok(err);
    const { hard, soft } = partitionErrors([err!]);
    assert.equal(hard.length, 0);
    assert.equal(soft.length, 1);
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
    // 2026-09-30: message now points at kinds of words to remove first —
    // filler, glosses already made elsewhere, restated context. If a fact
    // must go, it goes into EDIT NOTES so the Fact-checker sees the trade.
    assert.match(err!.message, /Cut words, not facts: remove filler, glosses already explained elsewhere, and restated context first\. If a fact must go, say which one in EDIT NOTES\./);
  });
  test('caption over-length message uses length-inline format with total including credits', () => {
    // 2100 chars caption + 200 chars credits = 2300 total > 2200 → over by 100.
    const caption = 'x'.repeat(2100) + '\n\nSource: X';
    const r = checkCaption(caption, 200);
    const err = r.errors.find((e) => e.kind === 'caption_length');
    assert.ok(err);
    assert.match(err!.message, /2111 characters \+ 200 appended image credits = 2311 total, limit 2200/);
    assert.match(err!.message, /cut at least 111 characters/);
    assert.match(err!.message, /Cut words, not facts: remove filler, glosses already explained on a slide, and restated context first\. If a fact must go, say which one in EDIT NOTES\./);
  });
  test('banned-voice errors on a slide include the field length prefix', () => {
    // Slide with "moving forward" — banned_always fires — message must show BODY length + limit.
    // (Was em dash, but em/en dashes are now mechanically swapped at parse
    //  so never reach the code check.)
    const post = buildPost({ slides: [{ body: 'Moving forward, this is banned.', highlight: 'this' }] });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'banned_always' && e.field === 'BODY');
    assert.ok(err);
    assert.match(err!.message, /^SLIDE 2 BODY \(\d+ characters, limit 220\)/);
    assert.match(err!.message, /moving forward/);
  });
  test('highlight_substring error lists the non-empty visible fields with their lengths', () => {
    // Message format updated 2026-09-29 late to include BIG NUMBER / NUMBER NOTE
    // fields for stat slides (Suleyman SLIDE 9 had HIGHLIGHT="~1,200" matching
    // its BIG NUMBER — the old check only scanned HEADLINE/BODY/QUOTE/NOTE
    // and false-flagged it).
    const post = buildPost({ slides: [{ headline: 'Some headline text.', body: 'Some body text of moderate length.', highlight: 'not present anywhere' }] });
    const r = checkPost(post, goodBrief);
    const err = r.errors.find((e) => e.kind === 'highlight_substring' && e.target === 'slide');
    assert.ok(err);
    assert.match(err!.message, /SLIDE 2 HIGHLIGHT/);
    assert.match(err!.message, /HEADLINE \(19 chars\)/);
    assert.match(err!.message, /BODY \(34 chars\)/);
  });

  test('stat slide: HIGHLIGHT matches BIG NUMBER → no error (2026-09-29 fix)', () => {
    const post = buildPost({ slides: [
      { headline: 'A headline for the stat.', bigNumber: '~1,200', highlight: '~1,200' },
      { body: 'A second slide.', highlight: 'second' },
    ] });
    const r = checkPost(post, goodBrief);
    const hl = r.errors.filter((e) => e.kind === 'highlight_substring' && e.slidePosition === 2);
    assert.equal(hl.length, 0);
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
  // Em/en dashes and " -- " are mechanically swapped in parse.ts (see
  // swapBannedPunctuation) so they never reach the code check. These
  // three tests assert the SWAP happens — the check finds no dash error
  // and the parsed text has the compliant form.
  test('em dash is swapped to comma at parse (never reaches the check)', () => {
    const post = buildPost({ slides: [{ body: 'This is bold — dramatic and wrong.', highlight: 'bold' }] });
    const r = checkPost(post, goodBrief);
    assert.equal(r.errors.filter((e) => e.kind === 'banned_always' && /em dash/.test(e.message)).length, 0);
    assert.doesNotMatch(post.slides[0]!.body ?? '', /—/);
    assert.match(post.slides[0]!.body ?? '', /bold, dramatic/);
  });
  test('en dash is swapped to hyphen at parse (never reaches the check)', () => {
    const post = buildPost({ slides: [{ body: 'A range – dramatic and wrong.', highlight: 'range' }] });
    const r = checkPost(post, goodBrief);
    assert.equal(r.errors.filter((e) => e.kind === 'banned_always' && /en dash/.test(e.message)).length, 0);
    assert.doesNotMatch(post.slides[0]!.body ?? '', /–/);
  });
  test('spaced " -- " is swapped to comma at parse (never reaches the check)', () => {
    const post = buildPost({ slides: [{ body: 'Anthropic said -- and this is banned.', highlight: 'Anthropic said' }] });
    const r = checkPost(post, goodBrief);
    assert.equal(r.errors.filter((e) => e.kind === 'banned_always' && /double hyphen/.test(e.message)).length, 0);
    assert.doesNotMatch(post.slides[0]!.body ?? '', /\s--\s/);
    assert.match(post.slides[0]!.body ?? '', /said, and/);
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
  test('flags "not X, it\'s Y" invented-contrast framing', () => {
    const post = buildPost({ slides: [{
      body: "This is not a chatbot, it's an AI agent that takes action.",
      highlight: 'takes action',
    }] });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'banned_always' && /not X, it's Y/.test(e.message)));
  });

  test('flags "not X but Y" invented-contrast framing', () => {
    const post = buildPost({ slides: [{
      body: 'CC does not just organize but acts on the family\'s behalf.',
      highlight: 'acts on',
    }] });
    const r = checkPost(post, goodBrief);
    assert.ok(r.errors.some((e) => e.kind === 'banned_always' && /"not just X but Y"/.test(e.message)));
  });

  test('flags "not just X, Y" invented-contrast framing', () => {
    const post = buildPost({ slides: [{
      body: 'CC is not just a chatbot, it acts on your family\'s behalf.',
      highlight: 'acts on your',
    }] });
    const r = checkPost(post, goodBrief);
    assert.ok(
      r.errors.some((e) => e.kind === 'banned_always' && /not just X/.test(e.message)),
      `expected a "not just X" ban; got: ${r.errors.map((e) => e.message).join(' | ')}`,
    );
  });

  test('flags "X, not Y" mirror-form invented contrast ("designed in, not discovered")', () => {
    const post = buildPost({ slides: [{
      body: 'The ambiguity was designed in, not discovered.',
      highlight: 'ambiguity was designed',
    }] });
    const r = checkPost(post, goodBrief);
    assert.ok(
      r.errors.some((e) => e.kind === 'banned_always' && /"X, not Y"/.test(e.message)),
      `expected an "X, not Y" ban; got: ${r.errors.map((e) => e.message).join(' | ')}`,
    );
  });

  test('flags "Unlike X, Y" invented-contrast framing', () => {
    // The exact fabrication that survived the Google CC run's fact-check loop.
    const post = buildPost({ slides: [{
      body: 'Unlike an AI that just answers questions, CC takes actions on your behalf.',
      highlight: 'takes actions on your behalf',
    }] });
    const r = checkPost(post, goodBrief);
    assert.ok(
      r.errors.some((e) => e.kind === 'banned_always' && /Unlike X, Y/.test(e.message)),
      `expected an "Unlike X, Y" banned_always error; got: ${r.errors.map((e) => e.message).join(' | ')}`,
    );
  });
  test('does NOT flag "unlike" mid-sentence without a following comma', () => {
    // "unlike" appears legitimately in comparative descriptions that don't
    // set up an invented contrast (e.g., "prices moved unlike anything else"
    // — no contrast, no banned framing).
    const post = buildPost({ slides: [{ body: 'It moved unlike anything before it.', highlight: 'unlike anything' }] });
    const r = checkPost(post, goodBrief);
    assert.equal(r.errors.filter((e) => e.kind === 'banned_always' && /Unlike/.test(e.message)).length, 0);
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
    assert.match(block, /- COVER: 80 characters \(limit 90\)$/m);
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

describe('checkPost — rhythm HARD check (no two consecutive same-type)', () => {
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

  test('rhythm errors partition as SOFT (flag but let the pipeline continue past the code-check gate)', () => {
    // Demoted back to SOFT 2026-09-30 (copy-audit rec-set): a rhythm
    // violation on two distinct-beat slides is preferable to a clean
    // rhythm bought with a repeated fact. slide_repeats +
    // cover_claim_uniqueness now carry the "no repetition" load rhythm
    // used to proxy for. The final gate can still surface it, but rhythm
    // no longer hard-blocks the run at the code-check gate.
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

describe('checkPost — variety soft check (6+ middle slides need 3+ kinds)', () => {
  // Six text slides in a row: violates variety, also violates rhythm.
  const sixTextRaw = `COVER: Cover.
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

SLIDE 4
HEADLINE: C
BODY: Three.
IMAGE: type only

SLIDE 5
HEADLINE: D
BODY: Four.
IMAGE: type only

SLIDE 6
HEADLINE: E
BODY: Five.
IMAGE: type only

SLIDE 7
HEADLINE: F
BODY: Six.
IMAGE: type only

FOLLOW: Follow.`;

  test('6 middle text slides → variety error', () => {
    const post = parseEditedPost(sixTextRaw);
    const report = checkPost(post, goodBrief);
    const variety = report.errors.filter((e) => e.kind === 'variety');
    assert.equal(variety.length, 1);
    assert.match(variety[0]!.message, /only 1 distinct kind/);
    assert.match(variety[0]!.message, /at least 3 different kinds/);
  });

  test('variety error partitions as soft', () => {
    const post = parseEditedPost(sixTextRaw);
    const { errors } = checkPost(post, goodBrief);
    const { soft, hard } = partitionErrors(errors);
    assert.ok(soft.some((e) => e.kind === 'variety'));
    assert.equal(hard.filter((e) => e.kind === 'variety').length, 0);
  });

  test('under 6 middle slides skips the variety check', () => {
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

SLIDE 4
HEADLINE: C
BODY: Three.
IMAGE: type only

SLIDE 5
HEADLINE: D
BODY: Four.
IMAGE: type only

SLIDE 6
HEADLINE: E
BODY: Five.
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    assert.equal(report.errors.filter((e) => e.kind === 'variety').length, 0);
  });

  test('6 middle slides with 3 kinds passes variety', () => {
    const raw = `COVER: Cover.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
HEADLINE: A
BODY: One.
IMAGE: type only

SLIDE 3
HEADLINE: Landing
IMAGE: type only

SLIDE 4
HEADLINE: Stat
BIG NUMBER: 26%
NUMBER NOTE: of X
IMAGE: type only

SLIDE 5
HEADLINE: B
BODY: Two.
IMAGE: type only

SLIDE 6
HEADLINE: Another landing
IMAGE: type only

SLIDE 7
HEADLINE: C
BODY: Three.
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    assert.equal(report.errors.filter((e) => e.kind === 'variety').length, 0);
  });
});

describe('checkPost — cover_photo soft check (type-only cover when person is central)', () => {
  const briefWithGovernor = parseBrief(`SINGLE STORY: yes
THE NEWS: California Governor Gavin Newsom signed an executive order on AI.
THE STORY: Newsom signed on 2026-09-18.
TERMS:
- Gavin Newsom: Governor of California
IMAGES: None found
SOURCES:
- CalMatters, 2026-09-18, https://calmatters.example/x
`);
  const briefNoPerson = parseBrief(`SINGLE STORY: yes
THE NEWS: A generic tech event happened last week.
THE STORY: Details of the event.
TERMS:
IMAGES: None found
SOURCES:
- Outlet, 2026-01-01, https://x.example.com
`);
  test('type-only cover + person in THE NEWS → cover_photo soft error', () => {
    const raw = `COVER: Newsom signs the order.
COVER HIGHLIGHT: Newsom
COVER IMAGE: type only

SLIDE 2
HEADLINE: A
BODY: One.
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, briefWithGovernor);
    const errs = report.errors.filter((e) => e.kind === 'cover_photo');
    assert.equal(errs.length, 1);
    assert.match(errs[0]!.message, /Gavin Newsom/);
  });
  test('photo cover + person in THE NEWS → no cover_photo error', () => {
    const raw = `COVER: Newsom signs the order.
COVER HIGHLIGHT: Newsom
COVER IMAGE: photo of Gavin Newsom

SLIDE 2
HEADLINE: A
BODY: One.
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, briefWithGovernor);
    assert.equal(report.errors.filter((e) => e.kind === 'cover_photo').length, 0);
  });
  test('type-only cover + no person in THE NEWS → no cover_photo error', () => {
    const raw = `COVER: A generic tech event happened.
COVER HIGHLIGHT: tech event
COVER IMAGE: type only

SLIDE 2
HEADLINE: A
BODY: One.
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, briefNoPerson);
    assert.equal(report.errors.filter((e) => e.kind === 'cover_photo').length, 0);
  });
  test('cover_photo partitions as soft (Editor gets it, does not block ship at cap)', () => {
    const raw = `COVER: Newsom signs.
COVER HIGHLIGHT: Newsom
COVER IMAGE: type only

SLIDE 2
HEADLINE: A
BODY: One.
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const { errors } = checkPost(post, briefWithGovernor);
    const { soft, hard } = partitionErrors(errors);
    assert.ok(soft.some((e) => e.kind === 'cover_photo'));
    assert.equal(hard.filter((e) => e.kind === 'cover_photo').length, 0);
  });
});

describe('checkQuotes — slide QUOTE must keep exact source punctuation (dash/comma NOT equivalent)', () => {
  // 2026-09-29 late: brief-integrity (STORY-time) keeps dash/comma
  // equivalence for the reporter-vs-essay match. checkQuotes (slide-time)
  // does NOT. If the essay writes "believes X - that Y" (spaced hyphens)
  // and the slide writes "believes X, that Y", the check must fail so
  // the Writer restores the exact source punctuation.
  const essaySource = 'He wrote: "controlling something that believes it may be conscious - that it\'s entitled to our welfare and has rights of its own - may well be impossible" in his warning.';

  test('slide with COMMAS where source has SPACED HYPHENS fails (no equivalence normalization)', () => {
    const raw = `COVER: X.
COVER HIGHLIGHT: X
COVER IMAGE: type only

SLIDE 2
QUOTE: controlling something that believes it may be conscious, that it's entitled to our welfare and has rights of its own, may well be impossible
QUOTE BY: Suleyman
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkQuotes(post, [essaySource]);
    assert.equal(report.ok, false);
    assert.match(report.errors[0]!.message, /does not appear word-for-word/);
  });

  test('slide with EXACT spaced hyphens passes', () => {
    const raw = `COVER: X.
COVER HIGHLIGHT: X
COVER IMAGE: type only

SLIDE 2
QUOTE: controlling something that believes it may be conscious - that it's entitled to our welfare and has rights of its own - may well be impossible
QUOTE BY: Suleyman
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkQuotes(post, [essaySource]);
    assert.equal(report.ok, true);
  });
});

describe('checkQuotes — trailing-punctuation tolerance (Harms quote from California run)', () => {
  // The California AI executive-order article (e045bc07) blocked at the
  // quote_verbatim gate because the source ends the sentence with a
  // comma inside the quote marks ("…serve a customer in Colorado,")
  // while the Writer quoted it with a period ("…serve a customer in
  // Colorado."). The words are identical; only the terminal punctuation
  // differs. This should pass.
  const source = [
    'A related concern is jurisdictional overreach. As Ted Harms of Stanford Law told the SF Standard,',
    '"California has only a limited capacity to control what a company incorporated in Delaware does with a data center in Oregon to serve a customer in Colorado," and that comma matters for follow-up litigation.',
  ].join('\n');

  test('period-vs-comma at the very end of the quote passes', () => {
    const raw = `COVER: X.
COVER HIGHLIGHT: X
COVER IMAGE: type only

SLIDE 2
QUOTE: California has only a limited capacity to control what a company incorporated in Delaware does with a data center in Oregon to serve a customer in Colorado.
QUOTE BY: Ted Harms, Stanford Law
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkQuotes(post, [source]);
    assert.equal(report.ok, true);
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

  test('QUOTE over 140 chars → char_limit (tightened from 200 for render fit)', () => {
    const raw = `COVER: Cover.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
QUOTE: ${'q'.repeat(160)}
QUOTE BY: CEO
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    const overs = report.errors.filter((e) => e.kind === 'char_limit' && e.field === 'QUOTE');
    assert.equal(overs.length, 1);
  });

  test('BIG NUMBER without NUMBER NOTE → stat_missing_note HARD', () => {
    const raw = `COVER: Cover.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
HEADLINE: The scale of it
BIG NUMBER: 1,200
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    const errs = report.errors.filter((e) => e.kind === 'stat_missing_note' && e.field === 'NUMBER NOTE');
    assert.equal(errs.length, 1);
  });

  test('BIG NUMBER without HEADLINE → stat_missing_note HARD', () => {
    const raw = `COVER: Cover.
COVER HIGHLIGHT: Cover
COVER IMAGE: type only

SLIDE 2
BIG NUMBER: 1,200
NUMBER NOTE: agents in the incident
IMAGE: type only

FOLLOW: Follow.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, goodBrief);
    const errs = report.errors.filter((e) => e.kind === 'stat_missing_note' && e.field === 'HEADLINE');
    assert.equal(errs.length, 1);
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

describe('checkPost — terms explained (any TERM used must be glossed on that slide or next)', () => {
  const briefWithJargon = parseBrief(`SINGLE STORY: yes
THE NEWS: A company shipped Antigravity.
THE STORY: They shipped it on 2026-09-01.
TERMS:
- Antigravity: an internal agentic-harness framework that runs Google Labs models in a sandboxed container.
- Google Labs: Google's internal team for early-stage experimental products.
IMAGES:
None found
SOURCES:
- Ledger, 2026-09-01, https://ledger.example.com/x
`);

  test('slide uses "Antigravity" but neither that slide nor next explains it → term_unexplained', () => {
    const raw = `COVER: Google Labs shipped Antigravity.
COVER HIGHLIGHT: Antigravity
COVER IMAGE: type only

SLIDE 2
HEADLINE: Google Labs shipped Antigravity today
BODY: Google Labs, Google's internal team for early-stage experimental products, unveiled it Tuesday.
HIGHLIGHT: Google Labs
IMAGE: type only

SLIDE 3
HEADLINE: Users react
BODY: Reviewers are testing the new release across enterprise workloads.
HIGHLIGHT: testing
IMAGE: type only

SLIDE 4
HEADLINE: Free launch
BODY: The launch is available at no charge.
HIGHLIGHT: no charge
IMAGE: type only

SLIDE 5
HEADLINE: Bigger picture
BODY: This is part of an ongoing wave of releases.
HIGHLIGHT: ongoing wave
IMAGE: type only

SLIDE 6
HEADLINE: Wrapping up
BODY: Watch this space for more updates coming soon.
HIGHLIGHT: this space
IMAGE: type only

FOLLOW: Follow Helios.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, briefWithJargon);
    const unexplained = report.errors.filter((e) => e.kind === 'term_unexplained');
    assert.ok(unexplained.some((e) => /Antigravity/.test(e.message)));
  });

  test('slide uses "Antigravity" and next slide explains it → no error', () => {
    const raw = `COVER: Google Labs shipped Antigravity.
COVER HIGHLIGHT: Antigravity
COVER IMAGE: type only

SLIDE 2
HEADLINE: Google Labs shipped Antigravity today
BODY: The company unveiled the release on Tuesday.
HIGHLIGHT: Google Labs
IMAGE: type only

SLIDE 3
HEADLINE: What Antigravity is
BODY: Antigravity is Google's internal agentic-harness framework that runs Google Labs models in a sandboxed container.
HIGHLIGHT: framework
IMAGE: type only

SLIDE 4
HEADLINE: Users react
BODY: Reviewers are testing the new release across enterprise workloads.
HIGHLIGHT: testing
IMAGE: type only

SLIDE 5
HEADLINE: Free launch
BODY: The launch is available at no charge for now.
HIGHLIGHT: no charge
IMAGE: type only

SLIDE 6
HEADLINE: Bigger picture
BODY: This is part of an ongoing wave of releases.
HIGHLIGHT: ongoing wave
IMAGE: type only

FOLLOW: Follow Helios.`;
    const post = parseEditedPost(raw);
    const report = checkPost(post, briefWithJargon);
    const unexplained = report.errors.filter((e) => e.kind === 'term_unexplained' && /Antigravity/.test(e.message));
    assert.equal(unexplained.length, 0);
  });
});

describe('checkNumberTrace — parser handles commas, ~, dates', () => {
  test('preserves comma-grouped thousands (1,200 stays whole, not split into "200")', () => {
    const post = buildPost({
      coverText: 'Norland Labs shipped a feature.',
      coverHighlight: 'shipped a feature',
      slides: [
        { headline: 'Agents involved', body: 'Roughly 1,200 agents were scored by the benchmark.', highlight: '1,200 agents' },
        { body: 'a second slide with no numbers.', highlight: 'no numbers' },
      ],
      followText: 'Follow Helios.',
    });
    const sourceTexts = ['The paper reports that roughly 1,200 AI agents were counted in the run.'];
    const report = checkNumberTrace(post, 'A caption with no numbers.\n\nSource: X, 2026', sourceTexts);
    // Old parser split "1,200" into "1" and "200"; both would miss the source
    // and the check emitted "200" as a false positive. Correct behavior: no
    // number_trace on this post.
    const badNums = report.errors.filter((e) => e.kind === 'number_trace');
    assert.equal(badNums.length, 0, `expected no number_trace, got: ${badNums.map((e) => e.message).join('; ')}`);
  });

  test('checks dates as dates (flags "September 16" when sources say "September 14")', () => {
    const post = buildPost({
      slides: [
        { body: 'On September 16, Suleyman published his essay.', highlight: 'September 16' },
        { body: 'A second slide with no dates.', highlight: 'second slide' },
      ],
    });
    // 2026-09-29 late: dates are matched as dates, not skipped. Sources
    // mention "September 14" but NOT "September 16" — the Writer invented
    // the date, and number_trace flags it.
    const sourceTexts = ['The essay was published on September 14, 2026.'];
    const report = checkNumberTrace(post, 'Caption.\n\nSource: X', sourceTexts);
    const dateFlag = report.errors.find((e) => e.kind === 'number_trace' && /September 16/.test(e.message));
    assert.ok(dateFlag, `expected number_trace on "September 16"; got: ${JSON.stringify(report.errors.map((e) => e.message))}`);
  });

  test('date passes when source has the same date verbatim', () => {
    const post = buildPost({
      coverText: 'Norland Labs shipped a feature.',
      coverHighlight: 'shipped a feature',
      slides: [
        { body: 'On September 14, the company shipped it.', highlight: 'September 14' },
        { body: 'a second slide with no dates.', highlight: 'no dates' },
      ],
      followText: 'Follow Helios.',
    });
    const sourceTexts = ['The company published its release on September 14, 2026, per the official page.'];
    const report = checkNumberTrace(post, 'Caption with no numbers.\n\nSource: X', sourceTexts);
    const dateFlag = report.errors.find((e) => e.kind === 'number_trace' && /September 14/.test(e.message));
    assert.equal(dateFlag, undefined, 'date matching the source must pass');
  });

  test('still catches a real invented number', () => {
    const post = buildPost({
      slides: [
        { body: 'The company sampled 4,721 users in the trial.', highlight: '4,721 users' },
        { body: 'a second slide.', highlight: 'second slide' },
      ],
    });
    // Source doesn't mention 4,721 anywhere.
    const sourceTexts = ['The company ran a trial. It had users.'];
    const report = checkNumberTrace(post, 'Caption.\n\nSource: X', sourceTexts);
    const invented = report.errors.filter((e) => e.kind === 'number_trace' && /4,721/.test(e.message));
    assert.equal(invented.length, 1, 'expected number_trace to flag 4,721 as unsourced');
  });

  test('preserves "$21 billion" and matches "$21B" (existing behavior)', () => {
    const post = buildPost({
      slides: [
        { body: 'The round raised $21 billion in fresh capital.', highlight: '$21 billion' },
        { body: 'a second slide.', highlight: 'second slide' },
      ],
    });
    const sourceTexts = ['The round was worth $21B in total.'];
    const report = checkNumberTrace(post, 'Caption.\n\nSource: X', sourceTexts);
    const nums = report.errors.filter((e) => e.kind === 'number_trace' && /\$21/.test(e.message));
    assert.equal(nums.length, 0, 'expected currency normalization to hold');
  });

  test('day of "16 September" (day-before-month) also skipped', () => {
    const post = buildPost({
      slides: [
        { body: 'On 16 September the paper appeared.', highlight: '16 September' },
        { body: 'a second slide.', highlight: 'second slide' },
      ],
    });
    const sourceTexts = ['The paper was published in autumn.'];
    const report = checkNumberTrace(post, 'Caption.\n\nSource: X', sourceTexts);
    const badNums = report.errors.filter((e) => e.kind === 'number_trace' && e.message.includes('"16"'));
    assert.equal(badNums.length, 0);
  });
});

describe('checkPost — past-statement references (main-story-only rule)', () => {
  test('flags "earlier writing" clause in a slide body', () => {
    const post = buildPost({
      slides: [
        { headline: 'Anthropic has not responded', body: 'Its public position is Claude\'s constitution and its earlier writing on model welfare.', highlight: 'earlier writing' },
        { body: 'Neutral filler body.', highlight: 'filler' },
      ],
    });
    const report = checkPost(post, goodBrief);
    const past = report.errors.filter((e) => e.kind === 'past_statement_reference');
    assert.ok(past.length >= 1, 'expected past_statement_reference');
    assert.match(past[0]!.message, /earlier writing/i);
  });

  test('flags "has long argued" in a slide body', () => {
    const post = buildPost({
      slides: [
        { headline: 'On safety', body: 'Newsom has long argued that state action beats waiting for Washington.', highlight: 'state action' },
        { body: 'Second slide.', highlight: 'Second slide' },
      ],
    });
    const report = checkPost(post, goodBrief);
    assert.ok(report.errors.some((e) => e.kind === 'past_statement_reference'));
  });

  test('flags "in an earlier essay" in the cover text', () => {
    const post = buildPost({
      coverText: 'Suleyman, in an earlier essay, warned about model welfare.',
      coverHighlight: 'model welfare',
    });
    const report = checkPost(post, goodBrief);
    assert.ok(report.errors.some((e) => e.kind === 'past_statement_reference' && e.target === 'cover'));
  });

  test('does NOT flag "earlier" used with a non-citation noun', () => {
    const post = buildPost({
      slides: [
        { headline: 'A first look', body: 'An earlier version of the draft included stricter thresholds.', highlight: 'stricter thresholds' },
        { body: 'Second slide.', highlight: 'Second slide' },
      ],
    });
    const report = checkPost(post, goodBrief);
    assert.equal(report.errors.filter((e) => e.kind === 'past_statement_reference').length, 0);
  });

  // 2026-09-29 late: 3 additional regexes for reworded prior-work refs
  // ("its public position is X", "its constitution says Y") were reverted.
  // The fact-checker (LLM, full sources) handles reworded prior-work as a
  // main-story violation without the false-positive risk regex has.
  test('does NOT flag "Its public position is X" via regex (fact-checker handles it)', () => {
    const post = buildPost({
      slides: [
        { headline: 'Anthropic has not responded', body: 'Its public position is Claude\'s constitution.', highlight: 'has not responded' },
        { body: 'A second slide.', highlight: 'Second slide' },
      ],
    });
    const report = checkPost(post, goodBrief);
    const past = report.errors.filter((e) => e.kind === 'past_statement_reference' && /public position/.test(e.message));
    assert.equal(past.length, 0, 'reverted pattern must not fire');
  });

  test('past_statement_reference is HARD (not soft)', () => {
    const post = buildPost({
      slides: [
        { body: 'The company previously warned about the pace of releases.', highlight: 'pace of releases' },
        { body: 'Second slide filler.', highlight: 'filler' },
      ],
    });
    const report = checkPost(post, goodBrief);
    const past = report.errors.find((e) => e.kind === 'past_statement_reference');
    assert.ok(past);
    const { hard, soft } = partitionErrors([past!]);
    assert.equal(hard.length, 1, 'past_statement_reference must be HARD');
    assert.equal(soft.length, 0);
  });
});

describe('checkPost — numbered-sequence integrity', () => {
  test('flags first + third with no second', () => {
    const post = buildPost({
      slides: [
        { headline: 'His first objection: circular reasoning', body: 'Circular body content.', highlight: 'circular' },
        { body: 'Just a middle slide with no ordinal.', highlight: 'middle' },
        { headline: 'His third objection: biological', body: 'Biological body content.', highlight: 'biological' },
      ],
    });
    const report = checkPost(post, goodBrief);
    const seq = report.errors.find((e) => e.kind === 'sequence_incomplete' && /objection/i.test(e.message));
    assert.ok(seq, 'expected sequence_incomplete on objection');
    assert.match(seq!.message, /missing second/i);
  });

  test('flags out-of-order sequence (second appears after third)', () => {
    const post = buildPost({
      slides: [
        { headline: 'His first objection: A', body: 'a body content.', highlight: 'A body' },
        { headline: 'His third objection: C', body: 'c body content.', highlight: 'C body' },
        { headline: 'His second objection: B', body: 'b body content.', highlight: 'B body' },
      ],
    });
    const report = checkPost(post, goodBrief);
    const seq = report.errors.find((e) => e.kind === 'sequence_incomplete' && /out of order/i.test(e.message));
    assert.ok(seq, 'expected out-of-order sequence_incomplete');
  });

  test('passes when first + second + third are all present in order', () => {
    const post = buildPost({
      slides: [
        { headline: 'His first objection: A', body: 'a body.', highlight: 'A body' },
        { headline: 'His second objection: B', body: 'b body.', highlight: 'B body' },
        { headline: 'His third objection: C', body: 'c body.', highlight: 'C body' },
      ],
    });
    const report = checkPost(post, goodBrief);
    assert.equal(report.errors.filter((e) => e.kind === 'sequence_incomplete').length, 0);
  });

  test('single ordinal mention is not a sequence', () => {
    const post = buildPost({
      slides: [
        { body: 'The first sentence of the paper explains the goal.', highlight: 'first sentence' },
        { body: 'A follow-up slide.', highlight: 'follow-up' },
      ],
    });
    const report = checkPost(post, goodBrief);
    assert.equal(report.errors.filter((e) => e.kind === 'sequence_incomplete').length, 0);
  });

  test('ignores common non-sequence nouns (time, place, half)', () => {
    const post = buildPost({
      slides: [
        { body: 'For the first time in a decade, the company posted a profit.', highlight: 'first time' },
        { body: 'It reached second place in the market rankings this quarter.', highlight: 'second place' },
      ],
    });
    const report = checkPost(post, goodBrief);
    assert.equal(report.errors.filter((e) => e.kind === 'sequence_incomplete').length, 0);
  });

  test('flags "Objection one" + "Objection three" — cardinal-after-noun form (Suleyman)', () => {
    const post = buildPost({
      slides: [
        { headline: 'Objection one: circular reasoning', body: 'A body about the first objection here.', highlight: 'circular reasoning' },
        { body: 'A middle slide with no ordinal.', highlight: 'middle slide' },
        { headline: 'Objection three: biological', body: 'A body about the third objection here.', highlight: 'biological' },
      ],
    });
    const report = checkPost(post, goodBrief);
    const seq = report.errors.find((e) => e.kind === 'sequence_incomplete' && /objection/i.test(e.message));
    assert.ok(seq, `expected sequence_incomplete on "objection" (cardinal form); got: ${JSON.stringify(report.errors.map((e) => e.message))}`);
    assert.match(seq!.message, /missing second/i);
  });

  test('flags "phase 1" + "phase 3" — noun-then-digit form', () => {
    const post = buildPost({
      slides: [
        { headline: 'Phase 1', body: 'Body about phase 1.', highlight: 'phase 1' },
        { body: 'middle', highlight: 'middle' },
        { headline: 'Phase 3', body: 'Body about phase 3.', highlight: 'phase 3' },
      ],
    });
    const report = checkPost(post, goodBrief);
    assert.ok(report.errors.some((e) => e.kind === 'sequence_incomplete' && /phase/i.test(e.message)));
  });

  test('sequence_incomplete is HARD (not soft)', () => {
    const post = buildPost({
      slides: [
        { headline: 'His first objection: A', body: 'a body.', highlight: 'A body' },
        { body: 'middle', highlight: 'middle' },
        { headline: 'His third objection: C', body: 'c body.', highlight: 'C body' },
      ],
    });
    const report = checkPost(post, goodBrief);
    const seq = report.errors.find((e) => e.kind === 'sequence_incomplete');
    assert.ok(seq);
    const { hard, soft } = partitionErrors([seq!]);
    assert.equal(hard.length, 1, 'sequence_incomplete must be HARD');
    assert.equal(soft.length, 0);
  });
});


describe('checkOutlineMatch — flag Editor kind changes from the approved outline', () => {
  test('kind swap (text → stat) on a surviving position → outline_kind_mismatch', () => {
    // Approved: two text slides. Final: slide 3 is a stat (BIG NUMBER).
    const post = buildPost({
      slides: [
        { headline: 'H2', body: 'a body sentence.', highlight: 'body' },
        { headline: 'H3', bigNumber: '42', highlight: '42' },
      ],
    });
    const approved = [
      { position: 2, kind: 'text' },
      { position: 3, kind: 'text' },
    ];
    const r = checkOutlineMatch(post, approved);
    const mismatch = r.errors.find((e) => e.kind === 'outline_kind_mismatch' && e.slidePosition === 3);
    assert.ok(mismatch, `expected outline_kind_mismatch on SLIDE 3; got ${JSON.stringify(r.errors.map((e) => e.message))}`);
    assert.match(mismatch!.message, /from "text".*to "stat"/);
  });

  test('same kinds on every surviving position → no error', () => {
    const post = buildPost({
      slides: [
        { headline: 'H2', body: 'a body sentence.', highlight: 'body' },
        { headline: 'H3', body: 'another body sentence.', highlight: 'body' },
      ],
    });
    const approved = [
      { position: 2, kind: 'text' },
      { position: 3, kind: 'text' },
    ];
    const r = checkOutlineMatch(post, approved);
    assert.equal(r.errors.length, 0);
  });

  test('slide count changed → outline_kind_mismatch with COUNT field', () => {
    const post = buildPost({
      slides: [
        { headline: 'H2', body: 'a body.', highlight: 'body' },
        { headline: 'H3', body: 'another body.', highlight: 'body' },
      ],
    });
    const approved = [
      { position: 2, kind: 'text' },
      { position: 3, kind: 'text' },
      { position: 4, kind: 'text' },
    ];
    const r = checkOutlineMatch(post, approved);
    const count = r.errors.find((e) => e.kind === 'outline_kind_mismatch' && e.field === 'COUNT');
    assert.ok(count);
    assert.match(count!.message, /3.*2|2.*3/);
  });

  test('undefined approved outline → no errors (older transcripts)', () => {
    const post = buildPost({
      slides: [{ headline: 'H2', body: 'a body.', highlight: 'body' }, { headline: 'H3', body: 'b.', highlight: 'b' }],
    });
    assert.equal(checkOutlineMatch(post, undefined).errors.length, 0);
  });

  test('outline_kind_mismatch is HARD (2026-09-29 late second pass: kind lock)', () => {
    // Once the Writer's OUTLINE is approved, no stage may change a
    // slide's kind. Length errors on prose are fixed by cutting words,
    // never by demoting the kind. Prior version was soft — the Editor
    // silently converted landings to text to fit, breaking rhythm.
    const post = buildPost({
      slides: [
        { headline: 'H2', body: 'a body.', highlight: 'body' },
        { headline: 'H3', bigNumber: '99', highlight: '99' },
      ],
    });
    const approved = [{ position: 2, kind: 'text' }, { position: 3, kind: 'text' }];
    const r = checkOutlineMatch(post, approved);
    const mismatch = r.errors.find((e) => e.kind === 'outline_kind_mismatch');
    assert.ok(mismatch);
    const { hard, soft } = partitionErrors([mismatch!]);
    assert.equal(hard.length, 1, 'outline_kind_mismatch must now be HARD');
    assert.equal(soft.length, 0);
  });
});


describe('validateOutline — content-aware fit (2026-09-29 late second pass)', () => {
  test('landing NOTE over 60 chars fails validation (Gottheimer regression)', () => {
    // Gottheimer run: three landings had NOTE fields at 97, 119, 97 chars.
    // Editor converted them to text to fit, breaking rhythm. Now the
    // OUTLINE itself fails; Writer must cut or pick a different kind.
    const outline = [
      { position: 2, kind: 'landing', beat: 'x', headline: 'Bipartisan bills would set NSA-led safety review before release.', note: 'The proposal comes as safety experts warn AI is advancing faster than oversight can catch up with any of it' },
      { position: 3, kind: 'text', beat: 'x'.repeat(10) },
      { position: 4, kind: 'landing', beat: 'y', headline: 'Focus on the most powerful frontier models only' },
      { position: 5, kind: 'text', beat: 'y'.repeat(10) },
      { position: 6, kind: 'landing', beat: 'z', headline: 'Debate could shape future rules for the whole industry.' },
    ];
    const r = validateOutline(outline);
    const noteErr = r.errors.find((e) => /SLIDE 2.*NOTE is \d+ chars, limit 60/.test(e.message));
    assert.ok(noteErr, `expected NOTE overflow flag on SLIDE 2; got ${JSON.stringify(r.errors.map((e) => e.message))}`);
  });

  test('quote over 140 chars fails validation', () => {
    const outline = [
      { position: 2, kind: 'text', beat: 'x'.repeat(10) },
      { position: 3, kind: 'quote', beat: 'x', quote: 'x'.repeat(200), quoteBy: 'Somebody' },
      { position: 4, kind: 'text', beat: 'y'.repeat(10) },
      { position: 5, kind: 'landing', beat: 'z', headline: 'Some landing headline that fits' },
      { position: 6, kind: 'text', beat: 'w'.repeat(10) },
    ];
    const r = validateOutline(outline);
    assert.ok(r.errors.some((e) => /SLIDE 3 OUTLINE quote QUOTE is 200 chars, limit 140/.test(e.message)));
  });

  test('stat missing NOTE fails validation', () => {
    const outline = [
      { position: 2, kind: 'text', beat: 'x'.repeat(10) },
      { position: 3, kind: 'stat', beat: 'x', headline: 'Bill introduced', bigNumber: '30 days' },
      { position: 4, kind: 'text', beat: 'y'.repeat(10) },
      { position: 5, kind: 'landing', beat: 'z', headline: 'A landing' },
      { position: 6, kind: 'text', beat: 'w'.repeat(10) },
    ];
    const r = validateOutline(outline);
    assert.ok(r.errors.some((e) => /SLIDE 3 OUTLINE stat is missing required NOTE/.test(e.message)));
  });

  test('valid content-aware OUTLINE passes', () => {
    const outline = [
      { position: 2, kind: 'text', beat: 'x'.repeat(10) },
      { position: 3, kind: 'landing', beat: 'x', headline: 'A short landing headline' },
      { position: 4, kind: 'quote', beat: 'x', quote: 'A short verbatim quote from a source.', quoteBy: 'Somebody' },
      { position: 5, kind: 'stat', beat: 'x', headline: 'Bill introduced Friday', bigNumber: '30 days', numberNote: 'review window per bill' },
      { position: 6, kind: 'text', beat: 'z'.repeat(10) },
    ];
    const r = validateOutline(outline);
    assert.equal(r.ok, true, `expected ok; got ${JSON.stringify(r.errors.map((e) => e.message))}`);
  });
});


describe('checkCoverNamesPicturedPerson — cover must name the pictured person (2026-09-29 late second pass)', () => {
  function coverFrom(text: string) {
    return { kind: 'edited' as const, text, highlight: '', image: '' };
  }

  test('Gottheimer cover WITHOUT his name fails', () => {
    const r = checkCoverNamesPicturedPerson(
      coverFrom('No law requires testing AI before release. Two new bills would change that.'),
      'Josh Gottheimer',
    );
    assert.equal(r.ok, false);
    assert.match(r.errors[0]!.message, /does not name the pictured person/);
    assert.match(r.errors[0]!.message, /Gottheimer/);
  });

  test('"Rep. Josh Gottheimer wants the NSA to test AI before it\'s released" passes', () => {
    const r = checkCoverNamesPicturedPerson(
      coverFrom("Rep. Josh Gottheimer wants the NSA to test AI before it's released"),
      'Josh Gottheimer',
    );
    assert.equal(r.ok, true);
  });

  test('surname alone in the cover text passes ("Gottheimer wants…")', () => {
    const r = checkCoverNamesPicturedPerson(
      coverFrom('Gottheimer wants NSA reviews of the most powerful AI models before release.'),
      'Josh Gottheimer',
    );
    assert.equal(r.ok, true);
  });

  test('no picked cover subject → no check', () => {
    const r = checkCoverNamesPicturedPerson(
      coverFrom('An unrelated cover text with no person.'),
      undefined,
    );
    assert.equal(r.ok, true);
  });

  test('single-token subject → no check (org-like)', () => {
    const r = checkCoverNamesPicturedPerson(
      coverFrom('An unrelated cover text.'),
      'Anthropic',
    );
    assert.equal(r.ok, true);
  });

  test('surname of a titled name is extracted correctly ("Dr. Fei-Fei Li")', () => {
    const r = checkCoverNamesPicturedPerson(
      coverFrom("Li's group says its new model beats every prior benchmark."),
      'Dr. Fei-Fei Li',
    );
    assert.equal(r.ok, true);
  });

  test('cover_photo_unnamed partitions as HARD', () => {
    const r = checkCoverNamesPicturedPerson(
      coverFrom('No person named here.'),
      'Sam Altman',
    );
    assert.ok(!r.ok);
    const { hard, soft } = partitionErrors(r.errors);
    assert.equal(hard.length, 1);
    assert.equal(soft.length, 0);
  });
});
