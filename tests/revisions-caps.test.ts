/** Targeted Revisions task 2: caps config, cost meter, registry (offline). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CeilingReached, capFor, createCostMeter, resetCapsForTest, setCapsForTest } from '@/lib/revisions/caps';
import { clearRegistryForTest, descriptionFor, registerDescription, restoreRegistryForTest } from '@/lib/revisions/registry';
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

test('CostMeter rejects NaN, Infinity and negative spend with a RangeError and leaves spent unchanged', () => {
  const meter = createCostMeter(1);
  meter.spend(0.25);
  for (const bad of [NaN, Infinity, -Infinity, -0.1]) {
    assert.throws(() => meter.spend(bad), RangeError);
    assert.equal(meter.spent, 0.25);
  }
});

test('a ceiling of 0 allows spend(0) and refuses spend(0.01)', () => {
  const meter = createCostMeter(0);
  meter.spend(0);
  assert.equal(meter.spent, 0);
  assert.throws(() => meter.spend(0.01), CeilingReached);
});

test('after CeilingReached the meter keeps throwing and keeps the crossing amount', () => {
  const meter = createCostMeter(0.1);
  assert.throws(() => meter.spend(0.15), CeilingReached);
  assert.equal(meter.spent, 0.15);
  assert.throws(() => meter.spend(0.01), CeilingReached);
  assert.ok(Math.abs(meter.spent - 0.16) < 1e-9);
});

test('descriptionFor returns null for a type with no description yet', () => {
  clearRegistryForTest();
  try {
    for (const v of VERTICALS) assert.equal(descriptionFor(v), null);
  } finally {
    restoreRegistryForTest();
  }
});

test('registerDescription makes descriptionFor return it until cleared', () => {
  const fake = { vertical: 'reels', label: 'text on screen' } as ContentTypeDescription;
  try {
    registerDescription(fake);
    assert.equal(descriptionFor('reels'), fake);
    clearRegistryForTest();
    assert.equal(descriptionFor('reels'), null);
  } finally {
    restoreRegistryForTest();
  }
});

test('hasAnyCap: true only with at least one fix kind approved; follows setCapsForTest and resetCapsForTest', async () => {
  const { hasAnyCap, noCapNote } = await import('@/lib/revisions/caps');
  for (const v of VERTICALS) assert.equal(hasAnyCap(v), true, `${v} ships with approved caps`);
  setCapsForTest({ reels: { motion: { capUsd: 1, ceilingUsd: 2 } }, carousels: {}, stories: null });
  try {
    assert.equal(hasAnyCap('reels'), true);
    assert.equal(hasAnyCap('carousels'), false, 'an empty config approves nothing');
    assert.equal(hasAnyCap('stories'), false);
    assert.equal(hasAnyCap('explainers'), false, 'the override replaces the shipped caps');
  } finally {
    resetCapsForTest();
  }
  assert.equal(hasAnyCap('reels'), true, 'reset goes back to the shipped caps');
  assert.equal(noCapNote('reels'), 'There is no approved cap for text on screen yet, so nothing was run.');
  assert.equal(noCapNote('carousels', 'photo'), 'There is no approved cap for carousels (photo fixes) yet, so nothing was run.');
});
