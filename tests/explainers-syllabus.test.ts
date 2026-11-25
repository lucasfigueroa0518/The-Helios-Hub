/**
 * The Explainer Reels syllabus (lib/explainers/ideas/syllabus.ts), offline: unique terms and akas,
 * prerequisites that resolve and come earlier in file order, levels numbered 1..n, no empty units,
 * 350 to 420 topics, a computer-science share of 25% to 35%, a distinct angle on every topic, and the reel framing
 * (one short question per angle, a plain takeaway per topic).
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

// Framing for the reel (Lucas, 2026-11-24): the angle asks about one thing that happens, never a category, comparison,
// debate or double question; the takeaway says what the thing does in 15 words or fewer, never what it is not.
const words = (s: string) => s.trim().split(/\s+/).length;
const BANNED_ANGLE = /\brather than\b|\binstead of\b|\bcounts? as\b|\bversus\b|\bvs\.?\b|\bdifference between\b|\bdisagree\b|,\s*and (why|how|what|when|where|who)\b/i;
const BANNED_TAKEAWAY = /\brather than\b|\binstead of\b|\bunlike\b|,\s*not\b/i;

test('every angle is one short question about one thing, never a comparison or a boundary', () => {
  for (const t of topics) {
    assert.ok(t.angle.endsWith('?') && t.angle.split('?').length === 2, `"${t.term}": the angle is one question: ${t.angle}`);
    assert.ok(words(t.angle) <= 16, `"${t.term}": the angle runs ${words(t.angle)} words (16 at most)`);
    assert.ok(!BANNED_ANGLE.test(t.angle), `"${t.term}": the angle compares or draws a boundary: ${t.angle}`);
  }
});

test('every topic has a distinct takeaway of 15 words or fewer that says what the thing does', () => {
  const seen = new Map<string, string>();
  for (const t of topics) {
    assert.equal(typeof t.takeaway, 'string', `"${t.term}" has no takeaway`);
    assert.ok(/[.!]$/.test(t.takeaway), `"${t.term}": the takeaway is one sentence: ${t.takeaway}`);
    assert.ok(words(t.takeaway) <= 15, `"${t.term}": the takeaway runs ${words(t.takeaway)} words (15 at most)`);
    assert.ok(!BANNED_TAKEAWAY.test(t.takeaway), `"${t.term}": the takeaway says what it is not: ${t.takeaway}`);
    const key = norm(t.takeaway);
    assert.ok(!seen.has(key), `"${t.term}" repeats the takeaway of "${seen.get(key)}"`);
    seen.set(key, t.term);
  }
});
