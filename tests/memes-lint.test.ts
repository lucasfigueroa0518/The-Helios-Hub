/**
 * Meme lab upgrade U0 (planning/Memes/UPGRADE_PLAN.md): the plain-code lints
 * and the graded-set measures. Pure; no model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { baseline, lintSplits, slateConcordance, type EvalMeme, type EvalSet } from '@/lib/memes/eval';
import type { SlotFill } from '@/lib/memes/fill';
import { lintFills, nameContext, obscureNames, writtenChars } from '@/lib/memes/lint';
import type { Brief } from '@/lib/social/reporter/brief';

const txt = (slot: string, text: string): SlotFill => ({ slot, kind: 'text', text, factIds: ['F1'] });
const brief = { subjects: [{ id: 'S1', name: 'Kenjiro Tsuda', role: null, type: 'person' }, { id: 'S2', name: 'Flock Safety', role: null, type: 'organization' }], quotes: [] } as unknown as Brief;

test('lint: hedges and narrated speech are hits, plain lines are not', () => {
  const hits = lintFills([txt('a', 'Meta says Muse Wonder is good'), txt('b', 'Rate hikes may not work'), txt('c', 'Tell dinner a court ruled'), txt('d', 'Hire people from Apple')]);
  assert.deepEqual(hits.map((h) => [h.kind, h.slot, h.match]), [['hedge', 'a', 'says'], ['hedge', 'b', 'may'], ['narration', 'c', 'Tell'], ['length', null, '99 > 90']]);
  assert.deepEqual(lintFills([txt('a', 'Tell dinner a court ruled')], { narrationSlots: new Set(['b']) }), [], 'narration only where the card says');
});

test('lint: a slot over its cap and a meme over its budget', () => {
  const long = 'x'.repeat(51);
  assert.deepEqual(lintFills([txt('a', long)]).map((h) => [h.kind, h.slot]), [['length', 'a']]);
  assert.equal(writtenChars([txt('a', 'abc'), { slot: 'b', kind: 'entity', playerId: 'openai' }]), 3);
});

test('lint: names a casual follower would not know', () => {
  const ctx = nameContext('Cops Not Happy When Man Creates Flock-Style Camera', brief);
  assert.deepEqual(obscureNames('Get angry about Flock Safety', ctx), [], 'a known name continues');
  assert.deepEqual(obscureNames('Tsuda says: that AI voice imitates me', ctx), ['Tsuda'], 'a person the story introduces, even first in the line');
  assert.deepEqual(obscureNames('Why does Apple see xtool v1.22.2 on blumify.io?', ctx), ['v1.22.2', 'blumify.io']);
  assert.deepEqual(obscureNames('AISI cannot stop a release', ctx), ['AISI'], 'an unknown acronym');
  assert.deepEqual(obscureNames('Claude Opus 5.5 Max or Character.AI in Chapter 11', ctx), []);
  assert.deepEqual(obscureNames('Watermelon', ctx), [], 'a sentence-initial word');
  const police = nameContext('A model sent a false tip', { subjects: [{ id: 'S1', name: 'Philadelphia Police Department', role: null, type: 'organization' }], quotes: [] } as unknown as Brief);
  assert.deepEqual(obscureNames('A fake tip to the Police', police), [], 'a word inside a longer organization name is ordinary');
});

const meme = (id: string, runId: string, rating: 1 | 2 | 3 | 4 | null, judges: Record<string, unknown>, text = 'Short line', rank: number | null = 1): EvalMeme => ({
  id, runId, kind: 'single', pipeline: 'v2', storyIds: ['s1'], headline: 'A headline', templateId: 'drake', situationId: null, turnId: null, turnType: null, pattern: null,
  inSlate: rating != null, rank, relation: '', fills: [txt('rejected', text)], why: {}, judges, dropped: rating == null ? 'judges: not accurate (0.5)' : null,
  belowBar: null, imagePath: null, rating, tags: [], note: null,
});

test('eval: within-slate agreement, the baseline, and lint splits', () => {
  const set: EvalSet = {
    version: 1, exportedAt: 'now', stories: [],
    runs: [{ id: 'r1', kind: 'single', status: 'ok', requestedAt: '', costUsd: 0.1, storyIds: ['s1'], pipeline: 'v2', shape: null },
      { id: 'r2', kind: 'single', status: 'ok', requestedAt: '', costUsd: 0.2, storyIds: ['s2'], pipeline: 'v2', shape: null }],
    memes: [
      meme('a', 'r1', 4, { funny: 0.2 }, 'Short line', 1), meme('b', 'r1', 2, { funny: 0.8 }, 'Meta says it is the best model of the year by far', 2),
      meme('c', 'r2', 3, { funny: 0.6 }, 'Short line', 1), meme('d', 'r2', 1, { funny: 0.4 }, 'Short line', 2), meme('e', 'r2', null, {}),
    ],
  };
  assert.deepEqual(slateConcordance(set.memes.filter((m): m is EvalMeme & { rating: 1 | 2 | 3 | 4 } => m.rating != null), (m) => m.judges.funny as number), { agree: 1, pairs: 2 });
  const b = baseline(set);
  assert.equal(b.rated, 4);
  assert.equal(b.good.rate, 0.5);
  assert.equal(b.slatesWithGood, 2);
  assert.equal(b.slatesWithAwesome, 1);
  assert.equal(b.byRank['1']!.rate, 1);
  assert.equal(b.meanCostUsd.toFixed(2), '0.15');
  const hedge = lintSplits(set).find((l) => l.kind === 'hedge')!;
  assert.deepEqual([hedge.hit.n, hedge.hit.good, hedge.clean.n, hedge.clean.good], [1, 0, 3, 2]);
});
