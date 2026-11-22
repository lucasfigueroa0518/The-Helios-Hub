/**
 * The Explainer Reels syllabus (lib/explainers/ideas/syllabus.ts), offline: unique terms and akas,
 * prerequisites that resolve and come earlier in file order, levels numbered 1..n, no empty units,
 * 350 to 420 topics, a computer-science share of 25% to 35%, and a distinct angle on every topic.
 * Pure data checks; no model, no database.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SYLLABUS, type SyllabusTopic } from '@/lib/explainers/ideas/syllabus';

const norm = (s: string) => s.trim().toLowerCase();
const topics: SyllabusTopic[] = SYLLABUS.flatMap((l) => l.units.flatMap((u) => [...u.topics]));

test('terms and akas are unique case-insensitively', () => {
  const seen = new Map<string, string>();
  for (const t of topics) {
    for (const name of [t.term, ...(t.aka ?? [])]) {
      const key = norm(name);
      assert.ok(!seen.has(key), `"${name}" (on "${t.term}") duplicates "${seen.get(key)}"`);
      seen.set(key, t.term);
    }
  }
});

test('every prerequisite resolves to a term that appears earlier in file order', () => {
  const index = new Map(topics.map((t, i) => [t.term, i]));
  topics.forEach((t, i) => {
    for (const req of t.requires) {
      const at = index.get(req);
      assert.ok(at !== undefined, `"${t.term}" requires unknown term "${req}"`);
      assert.ok(at < i, `"${t.term}" requires "${req}", which comes later`);
    }
  });
});

test('levels are numbered 1..n in order', () => {
  assert.deepEqual(
    SYLLABUS.map((l) => l.level),
    SYLLABUS.map((_, i) => i + 1),
  );
});

test('every unit has topics, and unit ids are unique', () => {
  const ids = new Set<string>();
  for (const l of SYLLABUS) {
    assert.ok(l.units.length > 0, `level ${l.level} has no units`);
    for (const u of l.units) {
      assert.ok(u.topics.length > 0, `unit ${u.id} has no topics`);
      assert.ok(!ids.has(u.id), `unit id ${u.id} repeats`);
      ids.add(u.id);
    }
  }
});

test('the syllabus has 350 to 420 topics', () => {
  assert.ok(topics.length >= 350 && topics.length <= 420, `${topics.length} topics`);
});

test('computer-science topics are 25% to 35% of the syllabus', () => {
  const share = topics.filter((t) => t.kind === 'cs').length / topics.length;
  assert.ok(share >= 0.25 && share <= 0.35, `cs share ${(share * 100).toFixed(1)}%`);
});

test('every topic has a non-empty angle, and no two angles are the same', () => {
  const seen = new Map<string, string>();
  for (const t of topics) {
    assert.equal(typeof t.angle, 'string', `"${t.term}" has no angle`);
    assert.ok(t.angle.trim().length > 0, `"${t.term}" has an empty angle`);
    const key = norm(t.angle);
    assert.ok(!seen.has(key), `"${t.term}" repeats the angle of "${seen.get(key)}"`);
    seen.set(key, t.term);
  }
});
