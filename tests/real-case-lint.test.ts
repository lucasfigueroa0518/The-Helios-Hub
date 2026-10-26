import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  claimIds,
  definitionStartsRight,
  factProblems,
  lintRealCase,
  numbersIn,
  parseFacts,
} from '../explainers/real-case/lint/lint-real-case.mjs';

const DIR = path.join(process.cwd(), 'explainers', 'real-case', 'lint', 'fixtures', 'good');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const GOOD = { storyboard: read('STORYBOARD.md'), script: read('SCRIPT.md'), brief: read('BRIEF.md') };

type V = { rule: string; frame: number | null; severity: string; detail: string };
const errors = (input: Partial<typeof GOOD>) =>
  (lintRealCase({ ...GOOD, ...input }).violations as V[]).filter((v) => v.severity === 'error');
const has = (vs: V[], rule: string, frame: number | null, re: RegExp) =>
  vs.some((v) => v.rule === rule && v.frame === frame && re.test(v.detail));

test('the good fixture is clean', () => {
  assert.deepEqual(lintRealCase(GOOD).violations, []);
});

test('facts: parsing, ids, numbers', () => {
  const facts = parseFacts(GOOD.brief);
  assert.deepEqual([...facts.keys()], ['c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(claimIds('c1, C3'), ['c1', 'c3']);
  assert.deepEqual(claimIds('none'), []);
  assert.equal(claimIds(undefined), null);
  assert.deepEqual(numbersIn('In June 2025, $1,200 and 2.5 hours.'), ['2025', '1200', '2.5']);
  assert.deepEqual(factProblems('It cost $4.', ['c1'], facts), []);
  assert.match(factProblems('It cost $5.', ['c1'], facts)[0][1], /the number 5 is in no fact/);
  assert.match(factProblems('It cost $4.', ['c9'], facts)[0][1], /c9 is not in BRIEF/);
  assert.match(factProblems('According to the bakery, it cost $4.', ['c1'], facts)[0][1], /attribution phrasing "According to"/);
});

test('a number the cited facts do not contain is an error', () => {
  const script = GOOD.script.replace('1,200 orders', '1,500 orders');
  assert.ok(has(errors({ script }), 'claims', 2, /the number 1500/));
});

test('citing a fact that does not exist, or no claims field, is an error', () => {
  assert.ok(has(errors({ storyboard: GOOD.storyboard.replace('- claims: c4', '- claims: c7') }), 'claims', 6, /c7 is not in BRIEF/));
  assert.ok(has(errors({ storyboard: GOOD.storyboard.replace('- claims: c4\n', '') }), 'claims', 6, /no claims/));
});

test('attribution phrasing is an error (RC-05)', () => {
  const script = GOOD.script.replace('The bakery fixed it at the refresh step.', 'Reportedly, the bakery fixed it at the refresh step.');
  assert.ok(has(errors({ script }), 'attribution', 6, /Reportedly/));
});

test("frame 1 tells the event, never the analogy format's opener template", () => {
  const line = 'In the next minute, this bakery will teach you a tech concept.';
  const script = GOOD.script.replace("In June 2025, a bakery's website kept selling sourdough at its old price of $4.", line);
  assert.ok(has(errors({ script }), 'incident', 1, /opener template/));
});

test('frame 2 ends on its question, never names the term, and has a reset', () => {
  const noQuestion = GOOD.script.replace(' So why would a website keep showing a price that no longer exists?', ' It made no sense to anyone at the time.');
  assert.ok(has(errors({ script: noQuestion }), 'puzzle', 2, /ends on its question/));
  const named = GOOD.script.replace('The price had already gone up.', 'The caching had already gone wrong.');
  assert.ok(has(errors({ script: named }), 'puzzle', 2, /says the term/));
  assert.ok(has(errors({ storyboard: GOOD.storyboard.replace('- reset: punch-in\n', '') }), 'reset', 2, /no reset/));
});

test('frame 3: the voiceover is the definition, starts right, and is short', () => {
  assert.ok(definitionStartsRight('Caching is keeping a copy.', 'caching'));
  assert.ok(definitionStartsRight('A webhook is a message.', 'webhook'));
  assert.equal(definitionStartsRight('This is caching.', 'caching'), false);
  const script = GOOD.script.replace('Caching is keeping a saved copy of something so it can be served faster.', 'Caching keeps copies.');
  assert.ok(has(errors({ script }), 'definition', 3, /word for word/));
});

test('the story world: the hero is an object, no orange critter, 3 or 4 steps, no logos', () => {
  const critterHero = GOOD.storyboard.replace('- hero: pricetag — object', '- hero: clerk — critter');
  assert.ok(has(errors({ storyboard: critterHero }), 'anchor_scene', null, /the key item, an object/));
  const orange = GOOD.storyboard.replace('look: ink, wear apron', 'look: orange, wear apron');
  assert.ok(has(errors({ storyboard: orange }), 'anchor_scene', null, /orange critter/));
  const twoSteps = GOOD.storyboard.replace('  - serve the copy — the old price goes out\n  - refresh — the copy expires after a day\n', '');
  assert.ok(has(errors({ storyboard: twoSteps }), 'anchor_scene', null, /2 steps/));
  const logo = GOOD.storyboard.replace('a stack of saved page copies beside it', "the bakery's logo beside it");
  assert.ok(has(errors({ storyboard: logo }), 'anchor_scene', null, /logo/));
});

test('beat 4 opens on the wide shot, and word ranges hold', () => {
  const noWide = GOOD.storyboard.replace('  - wide — the sourdough page — on "Step"', '  - medium — the sourdough page — on "Step"');
  assert.ok(has(errors({ storyboard: noWide }), 'shots', 4, /wide establishing shot/));
  const short = GOOD.script.replace(' So for a day, every customer got the copy, and the copy still said $4.', '');
  assert.ok(has(errors({ script: short }), 'word_range', 5, /9 words/));
});
