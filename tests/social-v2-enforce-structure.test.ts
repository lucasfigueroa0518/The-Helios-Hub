import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { enforceStructure } from '@/lib/social/editorial/v2/enforce-structure';
import { classifySlideType } from '@/lib/social/editorial/v2/code-checks';
import { parseEditedPost } from '@/lib/social/editorial/v2/parse';

function makePost(slideBlocks: string[]) {
  const raw = [
    'COVER: Cover text.',
    'COVER HIGHLIGHT: Cover',
    'COVER IMAGE: type only',
    '',
    ...slideBlocks,
    'FOLLOW: Follow Helios.',
  ].join('\n');
  return parseEditedPost(raw);
}

describe('enforceStructure — slide count > max: merges shortest adjacent same-topic text pair', () => {
  test('11 text slides collapse to 10 by merging the shortest adjacent same-topic pair', () => {
    // Slides 2+3 share Google Labs / CC / agent topic. Others are on
    // deliberately distinct topics with no vocabulary overlap so they
    // don't cascade-merge.
    const slides: string[] = [];
    const uniqueBodies = [
      'The Federal Reserve raised interest rates last week.',
      'Boeing delivered fewer commercial jets this quarter.',
      'Netflix cancelled its ad-tier bundle offering.',
      'Shell announced a five-year drilling pause.',
      'Toyota reopened its Kentucky assembly plant.',
      'Spotify signed an exclusive podcast deal.',
      'JPMorgan updated its trading floor security policy.',
      'Nvidia expanded its Taiwan chip supply.',
      'Amazon shuttered eight physical bookstores.',
    ];
    for (let i = 2; i <= 12; i++) {
      const body = (i === 2 || i === 3)
        ? 'Google Labs shipped CC, the agent that plans family schedules.'
        : uniqueBodies[i - 4]!;
      slides.push(`SLIDE ${i}`, `HEADLINE: Slide ${i}`, `BODY: ${body}`, `HIGHLIGHT: Slide ${i}`, '');
    }
    const post = makePost(slides);
    const result = enforceStructure(post);
    assert.equal(result.post.slides.length, 10, 'should merge one adjacent same-topic text pair');
    assert.ok(result.log.some((l) => /merged SLIDE 2 . SLIDE 3/.test(l)));
  });

  test('11 slides where no adjacent same-topic pair exists → cannot merge mechanically', () => {
    const slides: string[] = [];
    const uniqueBodies = [
      'The Federal Reserve raised interest rates last week.',
      'Boeing delivered fewer commercial jets this quarter.',
      'Netflix cancelled its ad-tier bundle offering.',
      'Shell announced a five-year drilling pause.',
      'Toyota reopened its Kentucky assembly plant.',
      'Spotify signed an exclusive podcast deal.',
      'JPMorgan updated its trading floor security policy.',
      'Nvidia expanded its Taiwan chip supply.',
      'Amazon shuttered eight physical bookstores.',
      'Google Labs shipped a new AI agent.',
      'Microsoft launched a new productivity suite.',
    ];
    for (let i = 2; i <= 12; i++) {
      slides.push(`SLIDE ${i}`, `HEADLINE: Slide ${i}`, `BODY: ${uniqueBodies[i - 2]!}`, `HIGHLIGHT: Slide ${i}`, '');
    }
    const post = makePost(slides);
    const result = enforceStructure(post);
    // No merge because sameTopic returns false for all adjacent pairs.
    assert.equal(result.post.slides.length, 11);
  });
});

describe('enforceStructure — rhythm: merges same-topic adjacent text', () => {
  test('adjacent same-topic text pair with combined body ≤ 220 merges cleanly', () => {
    const post = makePost([
      'SLIDE 2',
      'HEADLINE: Anthropic Docs',
      'BODY: Anthropic launched Claude Docs on September 16.',
      'HIGHLIGHT: Anthropic',
      '',
      'SLIDE 3',
      'HEADLINE: Anthropic Slides',
      'BODY: Anthropic also launched Claude Slides on September 16.',
      'HIGHLIGHT: Anthropic',
      '',
    ]);
    const result = enforceStructure(post);
    assert.equal(result.post.slides.length, 1, 'the pair merges into one slide');
    assert.equal(result.needsEditor, null, 'rhythm cleared mechanically → no follow-up Editor');
    assert.ok(result.log.some((l) => /rhythm-merged/.test(l)));
    // Merged body must be ≤ 220.
    assert.ok((result.post.slides[0]!.body ?? '').length <= 220);
  });

  test('adjacent same-kind pair with combined body > 220 → cannot merge → follow-up to Editor', () => {
    const long = 'x'.repeat(180);
    const post = makePost([
      'SLIDE 2',
      'HEADLINE: A one', 'BODY: ' + long, 'HIGHLIGHT: A',
      '',
      'SLIDE 3',
      'HEADLINE: A two', 'BODY: ' + long, 'HIGHLIGHT: A',
      '',
    ]);
    const result = enforceStructure(post);
    assert.equal(result.post.slides.length, 2, 'both slides survive (merge would exceed 220 chars)');
    assert.ok(result.needsEditor && result.needsEditor.kind === 'rhythm');
    if (result.needsEditor?.kind === 'rhythm') {
      assert.deepEqual(result.needsEditor.violatingPairs, [[2, 3]]);
    }
  });

  test('adjacent same-topic text pair — does NOT merge when topics differ (fake-same-kind cover)', () => {
    const post = makePost([
      'SLIDE 2',
      'HEADLINE: Anthropic', 'BODY: Anthropic launched Claude Docs on September 16 for teams.', 'HIGHLIGHT: Anthropic',
      '',
      'SLIDE 3',
      'HEADLINE: Different topic', 'BODY: The Federal Reserve cut interest rates by twenty-five basis points last week.', 'HIGHLIGHT: Federal',
      '',
    ]);
    const result = enforceStructure(post);
    assert.equal(result.post.slides.length, 2, 'unrelated topics never merge');
    assert.ok(result.needsEditor && result.needsEditor.kind === 'rhythm');
  });

  test('adjacent landing slides → shorter is dropped', () => {
    const post = makePost([
      'SLIDE 2', 'HEADLINE: Short landing', '',
      'SLIDE 3', 'HEADLINE: A much longer landing line here', '',
      'SLIDE 4', 'HEADLINE: Text', 'BODY: Text body content for slide four.', '',
    ]);
    const result = enforceStructure(post);
    // Dropped one of the two adjacent landing slides.
    const kinds = result.post.slides.map(classifySlideType);
    assert.equal(result.post.slides.length, 2, 'dropped one landing');
    assert.ok(result.log.some((l) => /dropped consecutive landing/.test(l)));
    assert.equal(kinds.filter((k) => k === 'landing').length, 1);
  });
});

describe('enforceStructure — variety: 6+ slides need at least 3 kinds', () => {
  test('6 text slides that cannot merge (bodies too long) → variety violation → follow-up', () => {
    // Each body is 190 chars so no pair can combine under 220. sameTopic
    // is false across slides (unique bodies), so the rhythm loop can't
    // touch them. Result: 6 text slides, all rhythm-violating, variety
    // gap. Rhythm gets reported first because there ARE rhythm pairs.
    const bodies = [
      'The Federal Reserve raised interest rates by twenty-five basis points last week following concerns about persistent inflation and elevated energy prices affecting consumer spending patterns nationwide overall.',
      'Boeing delivered fewer commercial jets this quarter than analysts expected after supply-chain issues in the Kansas plant delayed the final assembly of two dozen 737 units bound for European carrier delivery.',
      'Netflix cancelled its ad-supported bundle tier offering after a review found subscriber uptake below internal targets and advertiser demand less enthusiastic than projected at the time of the launch announcement.',
      'Shell announced a five-year drilling pause for its North Sea platform to allow decommissioning work and environmental remediation of the seabed around the aging installation before regulatory review.',
      'Toyota reopened its Kentucky assembly plant after a two-month closure for hybrid drivetrain retooling that required custom robotics and new welding fixtures installed over the shutdown window.',
      'Spotify signed an exclusive podcast deal with three top independent creators to lock in original content bundles for its premium subscription tier ahead of the November holiday listening season globally.',
    ];
    const slides: string[] = [];
    for (let i = 2; i <= 7; i++) {
      slides.push(`SLIDE ${i}`, `HEADLINE: Slide ${i}`, `BODY: ${bodies[i - 2]!}`, `HIGHLIGHT: Slide`, '');
    }
    const post = makePost(slides);
    const result = enforceStructure(post);
    assert.equal(result.post.slides.length, 6, 'no merges — all bodies too long to combine');
    // Rhythm is reported first (there are 5 consecutive same-kind pairs).
    assert.ok(result.needsEditor && result.needsEditor.kind === 'rhythm');
    if (result.needsEditor?.kind === 'rhythm') {
      assert.ok(result.needsEditor.violatingPairs.length >= 1);
    }
  });
});
