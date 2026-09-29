import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reviewDateLabel, reviewDates, reviewTokenShape, tokensMatch } from '@/lib/reels/review';
import { reviewSlideIndex } from '@/lib/reels/review-scroll';

describe('reel review link', () => {
  it('uses the New York calendar day, and the day before it', () => {
    const at = new Date('2026-09-29T00:30:00Z');
    assert.deepEqual(reviewDates(at), { today: '2026-09-28', yesterday: '2026-09-27' });
  });

  it('labels today and yesterday from the slate date', () => {
    assert.equal(reviewDateLabel('2026-09-28', '2026-09-28'), 'Today · Mon, Sep 28');
    assert.equal(reviewDateLabel('2026-09-27', '2026-09-28'), 'Yesterday · Sun, Sep 27');
  });

  it('accepts only a full unguessable token, and only an exact match', () => {
    const token = 'a'.repeat(43);
    assert.equal(reviewTokenShape(token), true);
    assert.equal(reviewTokenShape('short'), false);
    assert.equal(reviewTokenShape(`${token}x`), false);
    assert.equal(tokensMatch(token, token), true);
    assert.equal(tokensMatch(token, 'b'.repeat(43)), false);
    assert.equal(tokensMatch(token, 'short'), false);
    assert.equal(tokensMatch(null, token), false);
  });

  it('keeps a small drag on the current reel and follows a flick that lands further down', () => {
    const height = 800;
    assert.equal(reviewSlideIndex(0, height, 6, 0), 0);
    assert.equal(reviewSlideIndex(height * 0.3, height, 6, 0), 0);
    assert.equal(reviewSlideIndex(height * 0.43, height, 6, 0), 1);
    assert.equal(reviewSlideIndex(height * 3.2, height, 6, 0), 3);
    assert.equal(reviewSlideIndex(height * 0.9, height, 6, 1), 1);
    assert.equal(reviewSlideIndex(height * 0.57, height, 6, 1), 0);
    assert.equal(reviewSlideIndex(100, 0, 6, 2), 0);
    assert.equal(reviewSlideIndex(100, height, 1, 0), 0);
  });
});
