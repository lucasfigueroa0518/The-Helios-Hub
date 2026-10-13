import assert from 'node:assert/strict';
import test from 'node:test';

import { grounded, slideText } from '@/lib/lfd/ground';
import type { StoryCopy } from '@/lib/lfd/types';
import type { JevAsk } from '@/lib/social/jev/client';

const copy: StoryCopy = { key: 'a', setup: 'Big week:', headline: 'Claude Haiku 5.5 Is Here', highlight: '', names: [], body: 'It is cheaper. Anthropic says so', photo: { kind: 'logo', query: 'Anthropic', subjects: [], alts: [] } };

test('the grounding check judges setup, headline and body together against the source', async () => {
  let seen: unknown = null;
  const jev: JevAsk = async (req, meta) => {
    seen = req.state;
    assert.equal(meta.version, 'md-grounding@1');
    return { answers: { supported: { noul: 0.61 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: 'stub' };
  };
  assert.equal(await grounded(jev, copy, 'source text'), true);
  assert.equal((seen as { headline: string }).headline, slideText(copy));
  assert.match(slideText(copy), /^Big week: Claude Haiku 5\.5 Is Here\. It is cheaper/);
});

test('below the 0.6 bar is not grounded', async () => {
  const jev: JevAsk = async () => ({ answers: { supported: { noul: 0.59 } }, usage: { input_tokens: 1, output_tokens: 0 }, model: 'stub' });
  assert.equal(await grounded(jev, copy, 'source'), false);
});
