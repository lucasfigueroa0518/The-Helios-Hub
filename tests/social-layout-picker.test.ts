/**
 * Task 1.3 — body-only story-beat slides promote to B5 landing.
 *
 * Tests the promotion pass added to pickLayouts. Fixtures are minimal
 * inline BeatCopy objects — only the fields the promotion code inspects.
 * No live Claude API calls; no DB access.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickLayouts } from '@/lib/social/render/layout-picker';
import type { LayoutPickerInput } from '@/lib/social/render/layout-picker';
import type { BeatCopy } from '@/lib/social/editorial/copy';

// ---------------------------------------------------------------------------
// Minimal fixture helpers
// ---------------------------------------------------------------------------

/** A bare BeatCopy with only the fields the promotion code reads. */
function makeBeat(
  override: Partial<BeatCopy> & Pick<BeatCopy, 'beat'>,
): BeatCopy {
  return {
    position: 1,
    headline: null,
    body: null,
    bodyBottom: null,
    title: null,
    sides: null,
    altText: 'slide alt',
    swipe_reason: '',
    asset_needs: [],
    facts: [],
    ...override,
  };
}

/** A minimal LayoutPickerInput. factSheet + storyPlan are stubbed. */
function makeInput(slides: BeatCopy[]): LayoutPickerInput {
  return {
    editorialPost: {
      slides,
      caption: 'x'.repeat(500),
    },
    factSheet: {
      story_type: 'tech',
      players: [],
      assets: [],
      five_ws: { who: '', what: '', when: '', where: '', why: '' },
      stats: [],
      quotes: [],
      timeline: [],
      tensions: [],
    } as any,
    storyPlan: { slides: [] } as any,
    article: {
      source: 'Test Source',
      sourceUrl: 'https://example.com',
      publishedAt: '2026-09-27T00:00:00Z',
      issueNumber: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pickLayouts — body-only promotion to B5', () => {
  it('promotes a body-only STAKES slide from B4 to B5', () => {
    // HOOK is slide 0 (cover) so it gets its own cover variant; STAKES is slide 1.
    const hookSlide = makeBeat({
      position: 0,
      beat: 'HOOK',
      headline: [{ text: 'Big headline', role: 'hook' }],
    });
    const stakesSlide = makeBeat({
      position: 1,
      beat: 'STAKES',
      // body-only: no headline, no title, no bodyBottom, no sides, no asset_needs
      body: [{ text: 'The stakes are high.', role: 'narrative' }],
    });

    const input = makeInput([hookSlide, stakesSlide]);
    const post = pickLayouts(input);

    // slide index 1 is the STAKES slide
    const rendered = post.slides[1]!;
    assert.equal(rendered.variant, 'B5', 'body-only STAKES should be promoted to B5');
  });

  it('leaves a STAKES slide with photo asset_need on B4 (not promoted)', () => {
    const hookSlide = makeBeat({
      position: 0,
      beat: 'HOOK',
      headline: [{ text: 'Big headline', role: 'hook' }],
    });
    const stakesSlide = makeBeat({
      position: 1,
      beat: 'STAKES',
      body: [{ text: 'The stakes are high.', role: 'narrative' }],
      asset_needs: ['photo of the CEO'],
    });

    const input = makeInput([hookSlide, stakesSlide]);
    const post = pickLayouts(input);

    const rendered = post.slides[1]!;
    assert.notEqual(rendered.variant, 'B5', 'STAKES with photo asset_need should NOT be promoted to B5');
    assert.equal(rendered.variant, 'B4', 'STAKES with photo asset_need should stay on B4');
  });

  it('does NOT promote a body-only HOOK slide (HOOK is in the skip-beats set)', () => {
    const hookSlide = makeBeat({
      position: 0,
      beat: 'HOOK',
      // body-only — no headline, no title, no bodyBottom
      body: [{ text: 'Some hook text.', role: 'narrative' }],
    });

    const input = makeInput([hookSlide]);
    const post = pickLayouts(input);

    const rendered = post.slides[0]!;
    // HOOK maps to cover family; it should never become B5
    assert.notEqual(
      rendered.variant,
      'B5',
      'HOOK should never be promoted to B5 (already has hero treatment)',
    );
  });
});

describe('pickLayouts — B5 body→headline promotion in convertSlide', () => {
  it('moves body into headline when promoted STAKES slide lands on B5', () => {
    const hookSlide = makeBeat({
      position: 0,
      beat: 'HOOK',
      headline: [{ text: 'Big headline', role: 'hook' }],
    });
    const bodyText = 'The stakes are extremely high for everyone involved.';
    const stakesSlide = makeBeat({
      position: 1,
      beat: 'STAKES',
      body: [{ text: bodyText, role: 'narrative' }],
    });

    const input = makeInput([hookSlide, stakesSlide]);
    const post = pickLayouts(input);

    const rendered = post.slides[1]!;
    assert.equal(rendered.variant, 'B5');
    // After promotion: headline should carry the body text; body should be gone
    assert.ok(rendered.headline, 'promoted B5 slide should have a headline');
    const headlineText = rendered.headline!.map((s) => s.text).join('');
    assert.equal(headlineText, bodyText, 'headline should equal the original body text');
    assert.equal(rendered.body, undefined, 'body should be cleared after promotion to B5');
  });
});
