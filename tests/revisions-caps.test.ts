/** Targeted Revisions task 2: caps config, cost meter, registry (offline). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CeilingReached, capFor, createCostMeter, resetCapsForTest, setCapsForTest } from '@/lib/revisions/caps';
import { clearRegistryForTest, descriptionFor, registerDescription } from '@/lib/revisions/registry';
import type { ContentTypeDescription, FixKind, Vertical } from '@/lib/revisions/types';

const VERTICALS: Vertical[] = ['reels', 'explainers', 'carousels', 'stories', 'last_few_days', 'ai_events'];
const FIXES: FixKind[] = ['photo', 'wording', 'color', 'layout', 'motion'];

test('capFor returns null for every type until values are approved', () => {
  setCapsForTest({});
  try {
    for (const v of VERTICALS) for (const f of FIXES) assert.equal(capFor(v, f), null);
  } finally {
    resetCapsForTest();
  }
});

test('capFor returns overridden values in tests', () => {
  setCapsForTest({ reels: { photo: { capUsd: 1, ceilingUsd: 2 } } });
  try {
    assert.deepEqual(capFor('reels', 'photo'), { capUsd: 1, ceilingUsd: 2 });
    assert.equal(capFor('reels', 'wording'), null);
  } finally {
    resetCapsForTest();
  }
});

test('a CostMeter throws CeilingReached once spent exceeds the ceiling and records the partial spend', () => {
  const meter = createCostMeter(0.1);
  meter.spend(0.06);
  assert.throws(() => meter.spend(0.06), CeilingReached);
  assert.ok(Math.abs(meter.spent - 0.12) < 1e-9);
});

test('descriptionFor returns null for a type with no description yet', () => {
  clearRegistryForTest();
  for (const v of VERTICALS) assert.equal(descriptionFor(v), null);
});

test('registerDescription makes descriptionFor return it until cleared', () => {
  const fake = { vertical: 'reels', label: 'text on screen' } as ContentTypeDescription;
  registerDescription(fake);
  assert.equal(descriptionFor('reels'), fake);
  clearRegistryForTest();
  assert.equal(descriptionFor('reels'), null);
});
