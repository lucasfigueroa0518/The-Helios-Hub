import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  BEAT_SHEET,
  countWords,
  jargonCandidates,
  lintStoryboard,
  parseScript,
  visibleText,
} from '../explainers/lint/lint-storyboard.mjs';

const dir = path.join(process.cwd(), 'explainers', 'lint');
const fixture = (name: string) => fs.readFileSync(path.join(dir, 'fixtures', name, 'STORYBOARD.md'), 'utf8');

type Violation = { rule: string; frame: number | null; severity: string; detail: string };
const rules = (vs: Violation[]) => vs.map((v) => `${v.rule}@${v.frame ?? '-'}`).sort();

test('the beat sheet adds up to 45 seconds in the planned order', () => {
  assert.equal(BEAT_SHEET.reduce((a, b) => a + b.seconds, 0), 45);
  assert.deepEqual(BEAT_SHEET.map((b) => b.type), [
    'hook', 'product_intro', 'feature_showcase', 'social_proof', 'benefit_highlight', 'social_proof', 'branding',
  ]);
});

test('a storyboard that follows the plan has no violations', () => {
  const result = lintStoryboard({ storyboard: fixture('good') });
  assert.equal(result.frames, 7);
  assert.deepEqual(result.violations, []);
});

test('the recipe skeleton passes the structural checks', () => {
  const skeleton = fs.readFileSync(path.join(process.cwd(), 'explainers', 'recipe', 'storyboard-skeleton.md'), 'utf8');
  const { violations } = lintStoryboard({ storyboard: skeleton });
  // The skeleton has no content yet: only content checks may fire.
  const structural = (violations as Violation[]).filter(
    (v) => !['voiceover_words', 'visual_missing'].includes(v.rule),
  );
  assert.deepEqual(structural, []);
});

test('a storyboard that breaks the plan reports each rule', () => {
  const { violations } = lintStoryboard({ storyboard: fixture('bad') });
  assert.deepEqual(rules(violations as Violation[]), [
    'beat_type@2',
    'clarity_technique@2',
    'emoji@3',
    'exclamation_mark@1',
    'first_transition@1',
    'frame_count@-',
    'hook_jargon@1',
    'total_duration@-',
    'transition_types@-',
    'visual_missing@2',
    'voiceover_words@2',
    'voiceover_words@3',
  ]);
  const jargon = (violations as Violation[]).find((v) => v.rule === 'hook_jargon');
  assert.match(jargon!.detail, /REST, API, JSON, HTTP/);
  assert.equal((violations as Violation[]).find((v) => v.rule === 'hook_jargon')?.severity, 'warning');
});

test('SCRIPT.md lines take precedence over storyboard voiceover guides', () => {
  const script = [
    '# SCRIPT',
    '',
    '## Line 1 — Hook (Frame 1)',
    '',
    '    Every app you use is quietly ordering from a kitchen.',
    '',
    '## Line 2 — Analogy (Frame 2)',
    '',
    '    Too short.',
  ].join('\n');
  const lines = parseScript(script);
  assert.equal(lines.get(1), 'Every app you use is quietly ordering from a kitchen.');
  const { violations } = lintStoryboard({ storyboard: fixture('good'), script });
  const words = (violations as Violation[]).filter((v) => v.rule === 'voiceover_words').map((v) => v.frame);
  // Frame 2 is too short in the script; frames 3–7 have no script line at all.
  assert.deepEqual(words, [2, 3, 4, 5, 6, 7]);
});

test('built frames: on-screen narration, exclamation marks, and emoji are flagged', () => {
  const frameHtml = new Map([
    [1, '<template><div id="root"><style>.a{}</style><h1>Every app you use is quietly ordering from a kitchen you never see.</h1></div></template>'],
    [2, '<template><div id="root"><h1>Waiter!</h1><span>🍽</span><svg><text>ignored!</text></svg></div></template>'],
    [3, '<template><div id="root"><h1>Diner → Kitchen</h1></div></template>'],
  ]);
  const { violations } = lintStoryboard({ storyboard: fixture('good'), frameHtml });
  assert.deepEqual(rules(violations as Violation[]), ['emoji@2', 'exclamation_mark@2', 'narration_on_screen@1']);
});

test('helpers: word count, jargon candidates, visible text', () => {
  assert.equal(countWords('Ask for order forty-two — and wait.'), 6);
  assert.deepEqual(jargonCandidates('Why does JavaScript call an API via fetch_data or app/v2?'), [
    'JavaScript', 'API', 'fetch_data', 'app/v2',
  ]);
  assert.deepEqual(jargonCandidates('Why does a waiter never forget your order?'), []);
  assert.equal(visibleText('<div>A&nbsp;<b>B</b><script>x</script></div>'), 'A B');
});

test('the CLI writes JSON and exits 0 even with violations', () => {
  const out = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lint-')), 'lint.json');
  const res = spawnSync(process.execPath, [
    path.join(dir, 'lint-storyboard.mjs'),
    '--storyboard', path.join(dir, 'fixtures', 'bad', 'STORYBOARD.md'),
    '--out', out,
  ], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(parsed.frames, 5);
  assert.ok(parsed.violations.length > 0);
  assert.equal(spawnSync(process.execPath, [path.join(dir, 'lint-storyboard.mjs')]).status, 2);
});
