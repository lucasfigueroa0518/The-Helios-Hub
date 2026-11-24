/**
 * The curriculum (lib/explainers/ideas/curriculum.ts, 2026-11-21), pure: the flattened syllabus, term lookup, what
 * the night assigns next, and the generator's ideas held to their assignment. No database, no model.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRICULUM,
  MAX_FAILED_TRIES,
  POOL_TARGET,
  levelOfRank,
  matchAssigned,
  nextSyllabusTopics,
  refillCount,
  syllabusEntry,
  syllabusRank,
} from '@/lib/explainers/ideas/curriculum';
import { SYLLABUS } from '@/lib/explainers/ideas/syllabus';
import { explainerIdeas } from '@/lib/social-hub/adapters/explainers';
import type { ExplainerTopicRow } from '@/lib/social-hub/queries/explainers';

const fileOrder = SYLLABUS.flatMap((l) => l.units.flatMap((u) => u.topics.map((t) => t.term)));

test('the curriculum is every syllabus topic in teaching order: prerequisites first, CS woven through, ranked from 0', () => {
  assert.deepEqual([...CURRICULUM.map((t) => t.term)].sort(), [...fileOrder].sort());
  assert.deepEqual(CURRICULUM.map((t) => t.rank), fileOrder.map((_, i) => i));
  const seen = new Set<string>();
  for (const t of CURRICULUM) {
    for (const r of t.requires) assert.ok(seen.has(r.toLowerCase()), `${t.term} comes before ${r}`);
    seen.add(t.term.toLowerCase());
  }
  // CS comes evenly through the run (the file groups it), never a long stretch of either kind
  let run = 0;
  for (const t of CURRICULUM) {
    run = t.kind === 'cs' ? run + 1 : 0;
    assert.ok(run < 5, `five CS topics in a row, up to ${t.term}`);
  }
  const share = CURRICULUM.filter((t) => t.kind === 'cs').length / CURRICULUM.length;
  for (let i = 0; i + 30 <= CURRICULUM.length; i += 10) {
    const cs = CURRICULUM.slice(i, i + 30).filter((t) => t.kind === 'cs').length;
    assert.ok(Math.abs(cs / 30 - share) <= 0.2, `topics ${i}..${i + 29}: ${cs} of 30 are CS`);
  }
  const first = CURRICULUM[0]!;
  assert.deepEqual([first.level, first.levelName, first.unitName], [SYLLABUS[0]!.level, SYLLABUS[0]!.name, SYLLABUS[0]!.units[0]!.name]);
  assert.equal(CURRICULUM.at(-1)!.level, SYLLABUS.at(-1)!.level);
  assert.equal(levelOfRank(0), 1);
  assert.equal(levelOfRank(null), null);
  assert.equal(levelOfRank(100_000), null);
});

test('syllabusEntry matches the term or any aka, ignoring case and spacing; null off the syllabus', () => {
  const withAka = CURRICULUM.find((t) => t.aka?.length)!;
  assert.equal(syllabusEntry(withAka.term)?.rank, withAka.rank);
  assert.equal(syllabusEntry(`  ${withAka.aka![0]!.toUpperCase()} `)?.rank, withAka.rank);
  const multi = CURRICULUM.find((t) => t.term.includes(' '))!;
  assert.equal(syllabusEntry(multi.term.replace(' ', '   ').toUpperCase())?.term, multi.term);
  assert.equal(syllabusEntry('definitely not a syllabus topic'), null);
  assert.equal(syllabusEntry(null), null);
  assert.equal(syllabusEntry(''), null);
  assert.equal(syllabusRank(CURRICULUM[5]!.term), 5);
  assert.equal(syllabusRank('nope'), null);
});

test('nextSyllabusTopics: the first untaken in file order; a term is passed over after two failed tries', () => {
  const [t0, t1, t2, t3, t4, t5] = CURRICULUM;
  assert.deepEqual(nextSyllabusTopics([], 3).topics.map((t) => t.rank), [0, 1, 2]);
  const { topics, skipped } = nextSyllabusTopics(
    [
      { term: t0!.aka?.[0] ?? t0!.term, status: 'rendered' }, // taken, by its aka
      { term: t1!.term, status: 'rejected', syllabusRank: t1!.rank },
      { term: t1!.term, status: 'displaced', duplicateOf: 'x', syllabusRank: t1!.rank }, // two failed tries: passed over
      { term: t2!.term, status: 'rejected', syllabusRank: t2!.rank }, // one failed try: still assigned
      { term: t3!.term, status: 'archived', syllabusRank: t3!.rank }, // a person archived it: taken
      { term: t4!.term, status: 'displaced', duplicateOf: null, syllabusRank: t4!.rank }, // only the pool cut: free again, and not a failure
      { term: t4!.term, status: 'displaced', duplicateOf: null, syllabusRank: t4!.rank },
      { term: 'off the syllabus', status: 'pool' },
    ],
    3,
  );
  assert.equal(MAX_FAILED_TRIES, 2);
  assert.deepEqual(topics.map((t) => t.rank), [t2!.rank, t4!.rank, t5!.rank]);
  assert.deepEqual(skipped.map((t) => t.term), [t1!.term]);
  // A term held by a live topic is taken whatever its failures.
  assert.deepEqual(nextSyllabusTopics([{ term: t0!.term, status: 'rejected', syllabusRank: 0 }, { term: t0!.term, status: 'pool', syllabusRank: 0 }], 1).topics.map((t) => t.rank), [1]);
  // Every status but rejected and displaced takes the term, for a syllabus idea.
  for (const status of ['proposed', 'pool', 'promoted', 'queued', 'rendered', 'retired', 'archived']) {
    assert.equal(nextSyllabusTopics([{ term: t0!.term, status, syllabusRank: 0 }], 1).topics[0]!.rank, 1, status);
  }
  // An idea from before the curriculum (no rank) takes nothing unless it was made; nor do its old failures count.
  for (const status of ['proposed', 'pool', 'queued', 'archived', 'rejected']) {
    assert.equal(nextSyllabusTopics([{ term: t0!.term, status }, { term: t0!.term, status: 'rejected' }], 1).topics[0]!.rank, 0, status);
  }
  assert.equal(nextSyllabusTopics([{ term: t0!.term, status: 'rendered' }], 1).topics[0]!.rank, 1);
  // The end of the syllabus: fewer than n, then none.
  const all = CURRICULUM.map((t) => ({ term: t.term, status: 'rendered' }));
  assert.deepEqual(nextSyllabusTopics(all.slice(0, -1), 3).topics.map((t) => t.rank), [CURRICULUM.length - 1]);
  assert.deepEqual(nextSyllabusTopics(all, 3).topics, []);
});

test('matchAssigned keeps one idea per assigned topic with its exact term and drops the rest', () => {
  const assigned = nextSyllabusTopics([], 3).topics;
  const withAka = [assigned[0]!, assigned[2]!].find((t) => t.aka?.length); // not assigned[1], which the first idea takes
  const ideas = [
    { term: assigned[1]!.term.toUpperCase(), n: 1 },
    { term: withAka ? withAka.aka![0]! : assigned[0]!.term, n: 2 },
    { term: assigned[1]!.term, n: 3 }, // second idea for the same topic
    { term: CURRICULUM[50]!.term, n: 4 }, // on the syllabus, not assigned tonight
    { term: 'blockchain', n: 5 },
  ];
  const { kept, dropped } = matchAssigned(ideas, assigned);
  assert.deepEqual(kept.map((i) => [i.n, i.term]), [[1, assigned[1]!.term], [2, withAka?.term ?? assigned[0]!.term]]);
  assert.deepEqual(dropped.map((i) => i.n), [3, 4, 5]);
});

test('the hub shows a syllabus topic\'s level; topics off the syllabus show none', () => {
  const row = (rank: number | null) =>
    ({ topic_id: 't', title: 'Q?', term: 'x', scope: 'Explain x.', status: 'pool', origin: 'generated', weighted_score: 80, syllabus_rank: rank, ok_jobs: 0 }) as unknown as ExplainerTopicRow;
  const last = CURRICULUM.at(-1)!;
  assert.match(explainerIdeas([row(last.rank)])[0]!.detail ?? '', new RegExp(`· Level ${last.level} ·`));
  assert.doesNotMatch(explainerIdeas([row(null)])[0]!.detail ?? '', /Level/);
});

test('refillCount tops the pool up to ten, never below zero', () => {
  assert.equal(POOL_TARGET, 10);
  assert.deepEqual([0, 1, 4, 9, 10, 14].map((waiting) => refillCount(waiting)), [10, 9, 6, 1, 0, 0]);
  assert.equal(refillCount(0, 3), 3);
});
