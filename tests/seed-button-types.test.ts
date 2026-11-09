/**
 * The one shared "Seed an idea" button: which idea pools have a seed path. Every pool does except AI Events (decided
 * 2026-11-02: its seed is not built; see docs/superpowers/specs/2026-10-30-seeding-paths-by-content-type.md) and AI Drama
 * Reels (its pitches come from development sessions; a seed path is not built).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SEED_BUTTON, isSeedable, seedableVerticals } from '@/lib/content-type/seed-verticals';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

test('every idea pool has the seed button except AI Events and AI Drama Reels', () => {
  const all = [...VERTICAL_IDS];
  const unseeded = (v: string) => v === 'ai_events' || v === 'reel_ai_drama';
  assert.deepEqual(seedableVerticals().sort(), all.filter((v) => !unseeded(v)).sort());
  assert.equal(isSeedable('ai_events'), false);
  assert.equal(isSeedable('reel_ai_drama'), false);
  for (const v of all) assert.equal(isSeedable(v), !unseeded(v), v);
});

test('the button reads the same on every pool', () => {
  assert.deepEqual(SEED_BUTTON, { label: 'Seed an idea', title: 'Seed an idea' });
});
