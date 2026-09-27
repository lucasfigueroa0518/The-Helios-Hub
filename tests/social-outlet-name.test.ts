import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanOutletName } from '@/lib/social/render/outlet-name';

describe('cleanOutletName', () => {
  it('strips RSS category prefix + pipe + outlet form', () => {
    assert.equal(
      cleanOutletName('AI News & Artificial Intelligence | TechCrunch'),
      'TechCrunch'
    );
  });

  it('strips short "AI |" prefix', () => {
    assert.equal(cleanOutletName('AI | The Next Web'), 'The Next Web');
  });

  it('passes clean outlet names through', () => {
    assert.equal(cleanOutletName('Bloomberg'), 'Bloomberg');
    assert.equal(cleanOutletName('The New York Times'), 'The New York Times');
  });

  it('trims whitespace + trailing punctuation', () => {
    assert.equal(cleanOutletName('  Fortune - '), 'Fortune');
    assert.equal(cleanOutletName('Reuters.com'), 'Reuters');
  });
});
