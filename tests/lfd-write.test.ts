import assert from 'node:assert/strict';
import test from 'node:test';

import { FORMATS } from '@/lib/news-writer/prompts';
import { LIMITS, normalize, ordinalKey } from '@/lib/lfd/write';
import type { StoryCopy } from '@/lib/lfd/types';

const photo = { kind: 'company', query: 'Anthropic logo', subjects: [{ name: 'Anthropic', type: 'organization' as const }], alts: [] };
const copy = (o: Partial<StoryCopy> & { key: string }): StoryCopy => ({ setup: '', headline: 'Claude Haiku 5.5 Is Here', highlight: '', names: ['Claude'], body: 'Prices drop sharply. Anthropic says most requests get cheaper', photo, ...o });

test('normalize strips a leading dash and a final period, drops a non-substring highlight, keeps 2 setups by rank', () => {
  const out = normalize([
    copy({ key: 'c', setup: 'Third setup:', headline: '– Third Story', highlight: 'Not In Headline', body: 'Ends with a period.' }),
    copy({ key: 'a', setup: 'First setup:', headline: 'First Story', highlight: 'First' }),
    copy({ key: 'b', setup: 'Second setup:', headline: 'Second Story' }),
  ], ['a', 'b', 'c']);
  const byKey = Object.fromEntries(out.map((s) => [s.key, s]));
  assert.equal(byKey.c!.headline, 'Third Story');
  assert.equal(byKey.c!.highlight, '');
  assert.equal(byKey.c!.body, 'Ends with a period');
  assert.equal(byKey.c!.setup, '', 'the third setup by rank is removed');
  assert.equal(byKey.a!.highlight, 'First');
  assert.equal(byKey.b!.setup, 'Second setup:');
});

test('a person\'s edit is held to the news writer\'s Last Few Days caps; the model sees ordinal keys', () => {
  assert.equal(LIMITS.headline, FORMATS.lfd.caps.headline);
  assert.equal(LIMITS.body, FORMATS.lfd.caps.body);
  assert.equal(ordinalKey(0), 's1');
});
