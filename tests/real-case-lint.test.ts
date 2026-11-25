import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  artifactIds,
  claimIds,
  factProblems,
  lintRealCase,
  numbersIn,
  parseArtifacts,
  parseFacts,
  shownWordsAreArtifacts,
  termCount,
} from '../explainers/real-case/lint/lint-real-case.mjs';

const DIR = path.join(process.cwd(), 'explainers', 'real-case', 'lint', 'fixtures', 'good');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const GOOD = { storyboard: read('STORYBOARD.md'), script: read('SCRIPT.md'), brief: read('BRIEF.md') };

type V = { rule: string; frame: number | null; severity: string; detail: string };
const errors = (input: Partial<typeof GOOD>) =>
  (lintRealCase({ ...GOOD, ...input }).violations as V[]).filter((v) => v.severity === 'error');
const has = (vs: V[], rule: string, frame: number | null, re: RegExp) =>
  vs.some((v) => v.rule === rule && v.frame === frame && re.test(v.detail));
const swap = (text: string, from: string, to: string) => {
  assert.ok(text.includes(from), `fixture has "${from}"`);
  return text.replace(from, to);
};

test('the good fixture is clean', () => {
  assert.deepEqual(lintRealCase(GOOD).violations, []);
});

test('facts and artifacts: parsing, ids, numbers', () => {
  const facts = parseFacts(GOOD.brief);
  assert.deepEqual([...facts.keys()], ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
  const artifacts = parseArtifacts(GOOD.brief);
  assert.deepEqual([...artifacts.keys()], ['a1', 'a2']);
  assert.equal(artifacts.get('a1')?.fact, 'c4');
  assert.deepEqual(claimIds('c1, C3'), ['c1', 'c3']);
  assert.deepEqual(claimIds('none'), []);
  assert.equal(claimIds(undefined), null);
  assert.deepEqual(artifactIds('a1, a2'), ['a1', 'a2']);
  assert.deepEqual(numbersIn('In June 2025, $1,200 and 2.5 hours.'), ['2025', '1200', '2.5']);
  assert.deepEqual(factProblems('About 2,300 riders.', ['c5'], facts), []);
  assert.match(factProblems('About 2,400 riders.', ['c5'], facts)[0][1], /the number 2400 is in no fact/);
  assert.match(factProblems('It happened.', ['c9'], facts)[0][1], /c9 is not in BRIEF/);
  assert.match(factProblems('According to the agency, it happened.', ['c5'], facts)[0][1], /attribution phrasing "According to"/);
  // A number in a cited artifact may be said.
  assert.deepEqual(factProblems('Line 7.', [], facts, 'Take Line 7 home.'), []);
});

test('artifact words on screen are the artifact\'s own, cut only with …', () => {
  const text = 'We are pausing the trip assistant while we fix its station list.';
  assert.ok(shownWordsAreArtifacts('We are pausing the trip assistant…', text));
  assert.ok(shownWordsAreArtifacts('We are pausing … its station list.', text));
  assert.equal(shownWordsAreArtifacts('We are stopping the trip assistant', text), false);
  assert.equal(shownWordsAreArtifacts('its station list … We are pausing', text), false);
  const reworded = swap(GOOD.storyboard, '"We are pausing the trip assistant…"', '"We have paused the assistant"');
  assert.ok(has(errors({ storyboard: reworded }), 'case_file', null, /not its own words/));
  const unknown = swap(GOOD.storyboard, '- artifacts: a2', '- artifacts: a7');
  assert.ok(has(errors({ storyboard: unknown }), 'artifacts', 4, /a7 not in BRIEF/));
});

test('a number the cited facts do not contain is an error, in the voice and in the stamp', () => {
  const script = swap(GOOD.script, 'About 2,300 riders walk', 'About 2,500 riders walk');
  assert.ok(has(errors({ script }), 'claims', 4, /the number 2500/));
  const stamp = swap(GOOD.storyboard, 'SEPTEMBER 14, 2026', 'SEPTEMBER 15, 2026');
  assert.ok(has(errors({ storyboard: stamp }), 'stamp', 2, /15 is in no fact/));
});

test('citing a fact that does not exist, or no claims on an event act, is an error', () => {
  assert.ok(has(errors({ storyboard: swap(GOOD.storyboard, '- claims: c8', '- claims: c12') }), 'claims', 6, /c12 is not in BRIEF/));
  assert.ok(has(errors({ storyboard: swap(GOOD.storyboard, '- claims: c8', '- claims: none') }), 'claims', 6, /cite the facts/));
});

test('attribution phrasing is an error (RC-05)', () => {
  const script = swap(GOOD.script, 'Two days in, the assistant goes dark.', 'Reportedly, the assistant goes dark two days in.');
  assert.ok(has(errors({ script }), 'attribution', 4, /Reportedly/));
});

test('the term waits for the reveal, which says it exactly; frame 4 ends on its question', () => {
  const early = swap(GOOD.script, 'Pier Street closed in March.', 'A knowledge cutoff was at work.');
  assert.ok(has(errors({ script: early }), 'term_early', 3, /the reveal \(frame 5\) names it/));
  const unnamed = swap(GOOD.script, "That's called a knowledge cutoff:", "That's called a training gap:");
  assert.ok(has(errors({ script: unnamed }), 'term', 5, /never says the term/));
  const noQuestion = swap(GOOD.script, ' So why would it send anyone there?', ' Nobody could say why at first.');
  assert.ok(has(errors({ script: noQuestion }), 'question', 4, /ends on its question/));
  assert.equal(termCount('A knowledge cutoff, then knowledge cutoffs.', 'knowledge cutoff'), 1);
});

test('the case file: players, artifacts, mechanism with a cause, no logos or photos', () => {
  const noCause = swap(GOOD.storyboard, 'no live alerts (cause)', 'no live alerts');
  assert.ok(has(errors({ storyboard: noCause }), 'case_file', null, /marks no step/));
  const tooMany = swap(GOOD.storyboard, '  - paper map — act 5', '  - paper map — act 5\n  - suitcase — act 2\n  - car — act 2\n  - bus — act 2');
  assert.ok(has(errors({ storyboard: tooMany }), 'case_file', null, /6 objects; at most 5/));
  const photo = swap(GOOD.storyboard, 'The date stamp slams in', 'A photo of the station');
  assert.ok(has(errors({ storyboard: photo }), 'logo', 2, /photo/));
});

test('players are shown only as the brief allows: a logo or a cutout only when banked (RC-33, RC-34)', () => {
  const logo = swap(GOOD.storyboard, 'Harbor City Transit — organization — shown as: name card', 'Harbor City Transit — organization — shown as: logo');
  assert.ok(has(errors({ storyboard: logo }), 'case_file', null, /no banked logo/));
  const banked = swap(GOOD.brief, '- Harbor City Transit (organization): ran', '- Harbor City Transit (organization; logo banked): ran');
  assert.equal(has(errors({ storyboard: logo, brief: banked }), 'case_file', null, /no banked logo/), false);
  const cutout = swap(GOOD.storyboard, 'riders — private person — shown as: silhouette (walking)', 'riders — private person — shown as: cutout');
  assert.ok(has(errors({ storyboard: cutout }), 'case_file', null, /no banked cutout/));
  const stranger = swap(GOOD.storyboard, '  - riders — private person', '  - the mayor — public figure');
  assert.ok(has(errors({ storyboard: stranger }), 'case_file', null, /not in BRIEF.md's ## Players/));
  const unsaid = swap(GOOD.storyboard, 'shown as: silhouette (walking)', 'drawn walking');
  assert.ok(has(errors({ storyboard: unsaid }), 'case_file', null, /say how it is shown/));
});

test('the cold open is engineered (RC-35): no slow start, no question, scored candidates, a strong pick', () => {
  const slow = swap(GOOD.script, "A city's new transit assistant sent", 'In September, a city\'s new transit assistant sent');
  assert.ok(has(errors({ script: slow }), 'cold_open', 1, /opens on "In September"/));
  const framing = swap(GOOD.script, "A city's new transit assistant sent", "This is how a transit assistant sent");
  assert.ok(has(errors({ script: framing }), 'cold_open', 1, /opens on "This is"/));
  const question = swap(GOOD.script, 'that was already closed.', 'that was already closed. How?');
  assert.ok(has(errors({ script: question }), 'cold_open', 1, /asks a question/));
  const unscored = swap(GOOD.storyboard, 'clarity 3/5, thumb-stop 4/5, open loop 3/5', 'clarity 3/5, thumb-stop 4/5');
  assert.ok(has(errors({ storyboard: unscored }), 'cold_open', null, /no open loop score/));
  const weakPick = swap(GOOD.storyboard, '- pick: 1', '- pick: 3');
  assert.ok(has(errors({ storyboard: weakPick }), 'cold_open', null, /clarity and open loop of 4 or more/));
});

test('acts: types in order, grounds, holds, shots and word ranges', () => {
  const type = swap(GOOD.storyboard, '- type: fallout', '- type: pain_point');
  assert.ok(has(errors({ storyboard: type }), 'act_type', 4, /needs "fallout"/));
  const ground = swap(GOOD.storyboard, '- type: reveal\n- ground: whiteboard', '- type: reveal\n- ground: paper');
  assert.ok(has(errors({ storyboard: ground }), 'scenes', null, /whiteboard scene/));
  assert.ok(has(errors({ storyboard: ground }), 'ground', 5, /"paper"/));
  const hold = swap(GOOD.storyboard, '- hold: 1.2s', '- hold: 2s');
  assert.ok(has(errors({ storyboard: hold }), 'hold', 1, /at most 1.2s/));
  const oneShot = swap(GOOD.storyboard, '  - medium — Harbor City Transit\'s app and its trip assistant — on "Harbor"\n  - close — the help line, fewer calls — on "fewer"\n', '');
  assert.ok(has(errors({ storyboard: oneShot }), 'shots', 2, /at least 2/));
  const short = swap(GOOD.script, 'a model only knows the world up to the day its data was gathered.', 'it happens.');
  assert.ok(has(errors({ script: short }), 'word_range', 5, /26 words; act 5/));
});
