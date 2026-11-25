import test from 'node:test';
import assert from 'node:assert/strict';

import { sourcedPronounce } from '../lib/reel-ai-drama/reporting/validate';
import { factTimeline } from '../lib/reel-ai-drama/writing/timeline';
import type { FactSheet } from '../lib/reel-ai-drama/types';

type Member = FactSheet['cast'][number];
const member = (pronounce: Member['pronounce']): Member => ({
  name: 'Ilya Sutskever', role: 'researcher', kind: 'person', player_id: null, qid: null, want: 'x', pronounce,
});

test('sourcedPronounce keeps only sourced words of the name', () => {
  const problems: string[] = [];
  const m = sourcedPronounce(member([
    { word: 'Sutskever', say: 'soots-KEV-er', source_id: 'S1' },
    { word: 'Ilya', say: 'ILL-yuh', source_id: 'S9' },
    { word: 'Hinton', say: 'HIN-tun', source_id: 'S1' },
    { word: 'sutskever', say: 'other', source_id: 'S1' },
  ]), new Set(['S1']), problems);
  assert.deepEqual(m.pronounce, [{ word: 'Sutskever', say: 'soots-KEV-er', source_id: 'S1' }]);
  assert.equal(problems.length, 2);
});

test('sourcedPronounce leaves older sheets alone', () => {
  const old = member(undefined);
  assert.equal(sourcedPronounce(old, new Set(), []), old);
});

test("Who's who never passes a respelling to the writer (no respellings, 2026-11-24)", () => {
  const sheet = { summary: '', timeline: [], facts: [], sources: [], quotes: [], artifacts: [], places: [], verdict: { holds: true, reason: '' },
    cast: [member([{ word: 'Sutskever', say: 'soots-KEV-er', source_id: 'S1' }])] } as unknown as FactSheet;
  assert.doesNotMatch(factTimeline(sheet), /Said:|soots-KEV-er/);
});
