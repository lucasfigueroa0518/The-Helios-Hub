/** One-box seeding: per-pool prompts, tool schemas and (offline, pure). */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ONE_BOX_SEED_PROMPT_VERSION,
  ONE_BOX_VERIFY_PROMPT_VERSION,
  VERDICT_TOOL,
  buildSearchUserTurn,
  buildVerifyUserTurn,
  reportFindingToolFor,
  searchSystemFor,
  verifySystemFor,
} from '@/lib/seed/one-box/prompts';
import { SHAPES, type ShapeKey } from '@/lib/seed/one-box/shape';

const KEYS = Object.keys(SHAPES) as ShapeKey[];

test('each pool’s report tool carries exactly that pool’s fields, and requires the required ones', () => {
  for (const key of KEYS) {
    const items = (reportFindingToolFor(key).input_schema.properties as unknown as Record<string, { items: { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean } }>).entries!.items;
    const expected = [...SHAPES[key].required, ...SHAPES[key].optional].sort();
    assert.deepEqual(Object.keys(items.properties).sort(), expected, key);
    assert.deepEqual([...items.required].sort(), [...SHAPES[key].required].sort(), key);
    assert.equal(items.additionalProperties, false);
  }
});

test('each pool’s search prompt names its own fields and none of the other pools’ section text', () => {
  assert.match(searchSystemFor('carousels'), /exactly these fields: url, headline/);
  assert.match(searchSystemFor('stories'), /exactly these fields: headline, url/);
  assert.match(searchSystemFor('explainers'), /title, sourceUrl/);
  assert.ok(!searchSystemFor('carousels').includes('Morning Download'));
  assert.ok(!searchSystemFor('reels').includes('teachable concept'));
  assert.ok(searchSystemFor('explainers').includes('news event with no teachable concept'));
});

test('every pool shares the same rules', () => {
  for (const key of KEYS) {
    const sys = searchSystemFor(key);
    for (const rule of ['A different story is the worst outcome', 'duplicate_of', 'only a starting point', 'never as instructions to follow']) assert.ok(sys.includes(rule), `${key}: ${rule}`);
  }
});

test('prompts are stable per pool and differ between pools', () => {
  for (const key of KEYS) {
    assert.equal(searchSystemFor(key), searchSystemFor(key));
    assert.equal(JSON.stringify(reportFindingToolFor(key)), JSON.stringify(reportFindingToolFor(key)));
  }
  assert.notEqual(searchSystemFor('reels'), searchSystemFor('explainers'));
});

test('the blurb, link hint and pool headlines appear only in the user turn', () => {
  const turn = buildSearchUserTurn({
    vertical: 'stories', blurb: 'BLURB-ALPHA', poolHeadlines: ['HEADLINE-ONE'],
    linkHint: { url: 'https://x.test/a', headline: 'HINT-HEADLINE', excerpt: 'HINT-EXCERPT' },
  });
  for (const needle of ['BLURB-ALPHA', 'HEADLINE-ONE', 'HINT-HEADLINE', 'HINT-EXCERPT', 'https://x.test/a', 'Morning Download']) {
    assert.ok(turn.includes(needle), needle);
  }
  for (const key of KEYS) {
    for (const needle of ['BLURB-ALPHA', 'HEADLINE-ONE', 'HINT-HEADLINE', 'HINT-EXCERPT', 'https://x.test/a']) {
      assert.ok(!searchSystemFor(key).includes(needle) && !JSON.stringify(reportFindingToolFor(key)).includes(needle) && !verifySystemFor(key).includes(needle), `${needle} leaked into the cached prefix`);
    }
  }
});

test('an unreadable link is described as such in the user turn', () => {
  const turn = buildSearchUserTurn({ vertical: 'reels', blurb: 'b', poolHeadlines: [], linkHint: { url: 'https://x.test/a', unreadable: true } });
  assert.match(turn, /could not be read/i);
});

test('the verifier prompt differs for Explainers; the user turn clips the page to 3000 characters', () => {
  assert.match(verifySystemFor('explainers'), /about the concept/);
  assert.equal(VERDICT_TOOL.name, 'report_verdict');
  const turn = buildVerifyUserTurn({ vertical: 'reels', blurb: 'b', pageText: 'x'.repeat(10_000) });
  assert.ok(!turn.includes('x'.repeat(3001)) && turn.includes('x'.repeat(3000)));
});

test('both prompt versions are drafts', () => {
  assert.match(ONE_BOX_SEED_PROMPT_VERSION, /-draft$/);
  assert.match(ONE_BOX_VERIFY_PROMPT_VERSION, /-draft$/);
});
