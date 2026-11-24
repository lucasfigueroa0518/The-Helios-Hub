import assert from 'node:assert/strict';
import test from 'node:test';

import { HELIOS_LINE_BASES, HELIOS_LINE_VALUES, heliosLine, heliosLines, longestHeliosLine, type HeliosLineType } from '@/lib/social/captions/helios-line';

const TYPES: HeliosLineType[] = ['lfd', 'field_notes', 'ai_drama', 'explainers'];

test('heliosLine is deterministic: the same type and seed always give the same line', () => {
  for (const type of TYPES) {
    for (const seed of ['', 'job-1', 'k0|k1|k2', '9b2f6c1e-0000-4000-8000-000000000000']) {
      assert.equal(heliosLine(type, seed), heliosLine(type, seed), `${type} ${seed}`);
      assert.ok(heliosLines(type).includes(heliosLine(type, seed)), `${type} ${seed}`);
    }
  }
  // Seeds spread over the lines rather than all landing on one.
  const picked = new Set(Array.from({ length: 200 }, (_, i) => heliosLine('lfd', `seed-${i}`)));
  assert.ok(picked.size > 8, `${picked.size} distinct lines for 200 seeds`);
});

test('every type has 16 distinct lines (8 bases x 2 values)', () => {
  assert.equal(HELIOS_LINE_BASES.length, 8);
  for (const type of TYPES) {
    assert.equal(HELIOS_LINE_VALUES[type].length, 2, type);
    const lines = heliosLines(type);
    assert.equal(lines.length, 16, type);
    assert.equal(new Set(lines).size, 16, `${type}: no duplicates`);
  }
});

test('every line has its value filled in: no {value} placeholder left, and no dashes', () => {
  for (const type of TYPES) {
    for (const line of heliosLines(type)) {
      assert.ok(!line.includes('{value}') && !/[{}]/.test(line), line);
      assert.ok(HELIOS_LINE_VALUES[type].some((v) => line.includes(v)), line);
      assert.doesNotMatch(line, /[–—]/, `${line}: no en or em dash`);
    }
  }
});

test('longestHeliosLine is the longest line of its type', () => {
  for (const type of TYPES) {
    const max = Math.max(...heliosLines(type).map((l) => l.length));
    assert.equal(longestHeliosLine(type).length, max, type);
    assert.ok(heliosLines(type).includes(longestHeliosLine(type)), type);
  }
});
