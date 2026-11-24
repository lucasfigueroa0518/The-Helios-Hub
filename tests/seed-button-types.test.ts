/**
 * The one shared "Seed an idea" button: which idea pools have a seed path. Every pool does except AI Events (decided
 * 2026-11-02: its seed is not built; see docs/superpowers/specs/2026-10-30-seeding-paths-by-content-type.md) Every other pool takes a seed through the one box.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SEED_BUTTON, isSeedable, seedableVerticals } from '@/lib/content-type/seed-verticals';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

test('every idea pool has the seed button except AI Events', () => {
  const all = [...VERTICAL_IDS];
  const unseeded = (v: string) => v === 'ai_events';
  assert.deepEqual(seedableVerticals().sort(), all.filter((v) => !unseeded(v)).sort());
  assert.equal(isSeedable('ai_events'), false);
  for (const v of ['reel_ai_drama', 'ai_trivia', 'real_or_ai']) assert.equal(isSeedable(v as never), true, v);
  for (const v of all) assert.equal(isSeedable(v), !unseeded(v), v);
});

test('the button reads the same on every pool', () => {
  assert.deepEqual(SEED_BUTTON, { label: 'Seed an idea', title: 'Seed an idea' });
});
