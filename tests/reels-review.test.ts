import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { reviewDateLabel, reviewDates, reviewTokenShape, tokensMatch } from '@/lib/reels/review';

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
});
