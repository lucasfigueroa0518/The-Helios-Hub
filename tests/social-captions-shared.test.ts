import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLineInstruction, ceilingAllows, decideBuildLine, recentClosingsBlock, type RecentClosing } from '@/lib/social/captions/build-line';
import { CAPTION_SHARED_RULES, HELIOS_CONTEXT } from '@/lib/social/captions/helios-context';

const row = (buildLine: boolean, i = 0): RecentClosing => ({ closing: `closing ${i}`, buildLine, createdAt: new Date(2026, 9, 19 - i) });

test('HELIOS_CONTEXT names the four readers and excludes training', () => {
  for (const re of [/forward-deployed/, /agentic marketing and sales/, /Founder/, /Operator/, /Technical lead/]) assert.match(HELIOS_CONTEXT, re);
  assert.doesNotMatch(HELIOS_CONTEXT, /train|upskill/i);
});

test('CAPTION_SHARED_RULES bans pitches', () => {
  assert.match(CAPTION_SHARED_RULES, /DM us/);
  assert.match(CAPTION_SHARED_RULES, /Helios once/);
});

test('ceilingAllows counts only the 6 most recent closings', () => {
  assert.equal(ceilingAllows([]), true);
  assert.equal(ceilingAllows([row(true, 0), row(false, 1), row(true, 2), row(false, 3)]), false);
  const beyond = [...Array.from({ length: 6 }, (_, i) => row(false, i)), row(true, 6), row(true, 7)];
  assert.equal(ceilingAllows(beyond), true);
});

test('decideBuildLine applies threshold and ceiling', () => {
  assert.equal(decideBuildLine(0.59, []), false);
  assert.equal(decideBuildLine(0.6, []), true);
  assert.equal(decideBuildLine(null, []), false);
  assert.equal(decideBuildLine(0.9, [row(true, 0), row(true, 1), row(false, 2)]), false);
});

test('recentClosingsBlock lists closings and tells the model not to reuse them', () => {
  assert.equal(recentClosingsBlock([]), '');
  const block = recentClosingsBlock([row(false, 0), row(true, 1)]);
  assert.match(block, /closing 0/);
  assert.match(block, /closing 1/);
  assert.match(block, /do not reuse/i);
});

test('buildLineInstruction switches on include', () => {
  assert.match(buildLineInstruction(true), /what Helios builds/);
  assert.match(buildLineInstruction(false), /do not describe what Helios builds/i);
});
