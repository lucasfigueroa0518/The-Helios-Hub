import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BEAT_SHEET,
  OPENER_TEMPLATE,
  TOTAL_RANGE,
  parseShots,
  shotWindows,
  stem,
  subjectSpoken,
  countWords,
  eventsFromDir,
  jargonCandidates,
  lintStoryboard,
  parseScript,
  section,
} from '../explainers/lint/lint-storyboard.mjs';

const dir = path.join(process.cwd(), 'explainers', 'lint');
const fixture = (name: string) => fs.readFileSync(path.join(dir, 'fixtures', name, 'STORYBOARD.md'), 'utf8');

type Violation = { rule: string; frame: number | null; severity: string; detail: string };
type ShotWindow = { shot: { subject: string }; window: string | null };
const rules = (vs: Violation[]) => vs.map((v) => `${v.rule}@${v.frame ?? '-'}`).sort();

test('the beat sheet is eight beats of about a minute in the planned order (EX3-10, 3.3)', () => {
  assert.equal(BEAT_SHEET.length, 8);
  const nominal = BEAT_SHEET.reduce((a, b) => a + b.seconds, 0);
  assert.ok(nominal >= TOTAL_RANGE[0] && nominal <= TOTAL_RANGE[1], `${nominal}s`);
  // Beat 6 illustrates the example itself (EX3-87).
  assert.deepEqual(BEAT_SHEET.map((b) => b.anchor), ['scene', 'scene', 'own', 'scene', 'scene', 'own', 'own', null]);
  // At most 0.2s after each line (EX3-79); the close is voiceless, 2.5s, no hold (EX3-95).
  assert.deepEqual(BEAT_SHEET.map((b) => b.hold), [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, null]);
  assert.equal(BEAT_SHEET[7].seconds, 2.5);
  assert.equal(BEAT_SHEET[7].words, null);
  assert.deepEqual(BEAT_SHEET.map((b) => b.shots), [1, 2, 0, 2, 2, 2, 1, 0]);
  assert.deepEqual(BEAT_SHEET.map((b) => b.type), [
    'hook', 'pain_point', 'product_intro', 'feature_showcase', 'feature_showcase', 'social_proof', 'benefit_highlight', 'branding',
  ]);
});

test('the opener template is the register verbatim (EX3-11, EX3-96)', () => {
  const register = fs.readFileSync(path.join(process.cwd(), 'planning', 'Explainer Reels', 'DECISIONS.md'), 'utf8');
  const block = /### Opener line template\n\n```\n(.+)\n```/.exec(register)?.[1];
  assert.equal(OPENER_TEMPLATE, block);
  const director = fs.readFileSync(path.join(process.cwd(), 'explainers', 'director', 'SKILL.md'), 'utf8');
  assert.ok(director.includes(OPENER_TEMPLATE));
});

test('a storyboard that follows the plan has no violations', () => {
  const result = lintStoryboard({ storyboard: fixture('good') });
  assert.equal(result.frames, 8);
  assert.deepEqual(result.violations, []);
});

test('the recipe skeleton passes the structural checks', () => {
  const skeleton = fs.readFileSync(path.join(process.cwd(), 'explainers', 'recipe', 'storyboard-skeleton.md'), 'utf8');
  const { violations } = lintStoryboard({ storyboard: skeleton });
  // The skeleton has no content yet: only content checks may fire.
  const content = ['voiceover_words', 'visual_missing', 'anchor_scene', 'hook', 'curiosity_gap', 'term', 'concept', 'ground', 'attention_reset', 'definition', 'shots', 'example_steps', 'opener_line', 'gap_question', 'shot_cue'];
  const structural = (violations as Violation[]).filter((v) => !content.includes(v.rule));
  assert.deepEqual(structural, []);
});

test('a storyboard that breaks the plan reports each rule', () => {
  const { violations } = lintStoryboard({ storyboard: fixture('bad') });
  assert.deepEqual(rules(violations as Violation[]), [
    'anchor_scene@-', // no hook
    'anchor_scene@-', // no steps
    'anchor_scene@-', // a hand is an entity (EX3-77)
    'attention_reset@2',
    'beat_type@2',
    'blueprint@3',
    'curiosity_gap@-',
    'definition@3', // no definition
    'definition@3', // no part of speech
    'emoji@3',
    'engagement_technique@1',
    'exclamation_mark@1',
    'first_transition@1',
    'frame_count@-',
    'gap_promise@2', // a question with no promise (EX3-101)
    'ground@3',
    'hold@1',
    'hold@2',
    'hold@3',
    'hook@-', // no ## Hook block
    'hook_jargon@2',
    'music@-', // a mood instead of music: none
    'opener_line@1',
    'persuasion_field@1',
    'sfx_retired@2',
    'shots@1',
    'shots@2',
    'term@-',
    'total_duration@-',
    'transition_kind@1',
    'transition_kind@2',
    'visual_missing@2',
    'voiceover_words@2',
    'voiceover_words@3',
  ]);
  const jargon = (violations as Violation[]).find((v) => v.rule === 'hook_jargon');
  assert.match(jargon!.detail, /SDK/);
  assert.equal(jargon?.severity, 'warning');
  assert.ok((violations as Violation[]).some((v) => v.rule === 'anchor_scene' && /person or a body part \("hand"\)/.test(v.detail)));
  assert.equal((violations as Violation[]).find((v) => v.rule === 'total_duration')?.severity, 'warning', 'length is never an error');
});

test('SCRIPT.md lines take precedence over storyboard voiceover guides', () => {
  const script = [
    '# SCRIPT',
    '',
    '## Line 1 — Opener (Frame 1)',
    '',
    '    In the next 30 seconds, this little mailbox will teach you an AI concept.',
    '',
    '## Line 2 — Gap (Frame 2)',
    '',
    '    Too short.',
  ].join('\n');
  const lines = parseScript(script);
  assert.equal(lines.get(1), 'In the next 30 seconds, this little mailbox will teach you an AI concept.');
  const { violations } = lintStoryboard({ storyboard: fixture('good'), script });
  const words = (violations as Violation[]).filter((v) => v.rule === 'voiceover_words').map((v) => v.frame);
  // Frame 2 is too short in the script; frames 3–7 have no script line at all; the close has no voice.
  assert.deepEqual(words, [2, 3, 4, 5, 6, 7]);
  assert.ok(!(violations as Violation[]).some((v) => v.rule === 'opener_line'));
});

test('the opener follows the template, its slot 1–3 words naming the scene (EX3-96)', () => {
  const opener = (line: string) => {
    const script = `## Line 1 — Opener (Frame 1)\n\n    ${line}\n`;
    return (lintStoryboard({ storyboard: fixture('good'), script }).violations as Violation[]).filter((v) => v.rule === 'opener_line');
  };
  assert.equal(opener('In the next minute you will learn something.')[0]?.severity, 'error');
  assert.equal(opener("In the next 30 seconds, you'll learn an AI concept.")[0]?.severity, 'error', 'the 3.2 fixed line');
  assert.equal(opener('In the next 30 seconds, this very small red tin mailbox will teach you an AI concept.')[0]?.severity, 'error', 'slot too long');
  assert.equal(opener('In the next 30 seconds, this soggy forecaster will teach you an AI concept.')[0]?.severity, 'warning', 'names nothing in the scene');
  assert.deepEqual(opener('In the next 30 seconds, this mailbox will teach you an AI concept.'), []);
});

test('shots follow the voice: each shot subject is spoken while it is on screen (EX3-91)', () => {
  assert.equal(stem("hire's"), 'hire');
  assert.equal(stem('binders'), 'binder');
  assert.equal(stem('reading'), stem('reads'));
  const shots = parseShots('close — shelf of binders, untouched — on "This"\nreaction — the hire\'s worried face — on "customer"\ninsert — the customer\'s question bubble — on "How"');
  assert.deepEqual(shots.map((x) => [x.kind, x.cue]), [['close', 'This'], ['reaction', 'customer'], ['insert', 'How']]);
  const vo = "This new hire has never read the shop's rules. A customer asks about returns. How can the hire answer correctly?";
  const windows = shotWindows(shots, vo);
  assert.equal(windows[1].window, 'customer asks about returns.');
  // The 3.2 RAG gap: all three shots framed something the voice was not naming.
  assert.deepEqual((windows as ShotWindow[]).map(({ shot, window }) => subjectSpoken(shot.subject, window)), [false, false, false]);
  // As 3.3 plans it.
  const fixed = parseShots('medium — the new hire — on "This"; medium — the customer and the question bubble — on "customer"; insert — the hire\'s guess card — on "How"');
  assert.deepEqual((shotWindows(fixed, vo) as ShotWindow[]).map(({ shot, window }) => subjectSpoken(shot.subject, window)), [true, true, true]);
});

test('3.1–3.3 writing rules: no scene restart, the gap story, because, the transition, the dictionary card, the term, shots, the close', () => {
  const good = fixture('good');
  const swap = (from: string, to: string) => {
    assert.ok(good.includes(from), from);
    return good.replace(from, to);
  };
  const flagged = (storyboard: string) => rules(lintStoryboard({ storyboard }).violations as Violation[]);
  assert.deepEqual(flagged(swap("- voiceover: \"Here's the trick: a flag on the mailbox.", '- voiceover: "Picture a mailbox with a flag.')), ['scene_setting@4']);
  // Beat 2 (EX3-101): a story a stranger follows, the viewer's question, a promise; no label, no "same spot".
  const gap = (line: string) => flagged(good.replace(/- voiceover: "The mailbox sits[^\n]*\n- gap_question: [^\n]*\n/, `- voiceover: "${line}"\n`));
  assert.deepEqual(gap("This mailbox sits at the end of a long drive. An AI app waiting on other apps is in the same spot. So how do you know a letter arrived? That's a webhook."), ['gap_promise@2', 'gap_same_spot@2', 'gap_term@2']);
  assert.deepEqual(gap('The mailbox sits at the end of a long drive. Every letter means a walk out. Apps have it worse.'), ['gap_question@2']);
  assert.deepEqual(gap('The mailbox sits at the end of a long drive. So how would you know the moment a letter lands, without walking out?'), ['gap_promise@2']);
  assert.deepEqual(gap('The mailbox critter sits at the end of a long drive. So how would you know the moment a letter lands, without walking out? Watch: apps tell each other the same way.'), ['gap_plain_roles@2']);
  assert.deepEqual(flagged(swap(' That\'s how you know the moment a letter lands."', ' The carrier leaves for the next house."')), ['gap_closed@4']);
  // The plan's rewrites of the 3.3 gaps (hallucination, agent loop, embeddings) pass the gap story rules.
  for (const line of [
    'A tourist asks the helper for Elm Street. The helper has never heard of it, but points left anyway, totally sure. Wrong way. Why would it answer at all? Stick around: it\'s the same reason chatbots make things up.',
    'This little thermostat has one job: get the room to the red mark. No one\'s there to watch it. So how does it get it just right, not too cold, not too hot? Watch closely: AI agents finish whole tasks the very same way.',
    "A shopper asks for something sour. Not one label in the store says 'sour'. So how will the stocker find it? Watch: it's the same trick that lets search find what you mean, not just what you typed.",
  ]) {
    assert.deepEqual(gap(line).filter((r) => /^gap_(term|same_spot|question|promise|plain_roles)/.test(r)), [], line);
  }
  assert.deepEqual(flagged(swap('- engagement: Brand close\n', '- engagement: Brand close\n- voiceover: "Apps that tell you."\n')), ['close_voiceover@8']);
  assert.deepEqual(flagged(swap('medium — the mailbox with its label — on "mailbox"', 'ots — past the carrier to the mailbox — on "mailbox"')), ['shot_kind@5']);
  assert.deepEqual(flagged(swap('close — the empty mailbox — on "mailbox"', 'close — the critter at the window — on "mailbox"')), ['shot_subject@2']);
  assert.deepEqual(flagged(swap(', because it carries what happened.', ', and it carries what happened.').replace(', because it tells you at once.', '. It tells you at once.')), ['map_because@5']);
  assert.deepEqual(flagged(swap('- voiceover: "In everyday life, you meet webhooks when', '- voiceover: "You get webhooks when')), ['real_world_transition@7']);
  assert.deepEqual(flagged(swap('- part_of_speech: noun\n', '')), ['definition@3']);
  assert.deepEqual(flagged(swap('- definition: "A webhook is a message one app sends', '- definition: "A webhook is a note one app sends')), ['definition@3']);
  assert.deepEqual(flagged(swap('- closed_by: frame 4, when the letter drops in and the flag snaps up\n', '')), ['curiosity_gap@-']);
  assert.deepEqual(flagged(swap('- hold: 0.15s', '- hold: 0.6s')), ['hold@1']);
  assert.deepEqual(flagged(swap('term: webhook\n', 'term: event stream\n')), ['concept@-', 'definition_term@3']);
  assert.deepEqual(flagged(swap('## Hook\n', '## Hooks\n')), ['hook@-']);
  assert.deepEqual(flagged(swap('- shots: close — the empty mailbox — on "mailbox"; insert — the letter in the mailbox — on "letter"', '- shots: close — the empty mailbox')), ['shots@2']);
  assert.deepEqual(flagged(swap('- example_steps: payment goes through → store sends a POST → order app updates', '- example_steps: payment → done')), ['example_steps@6']);
  assert.deepEqual(flagged(swap('  - carrier — a mail carrier critter — stands for', '  - carrier — a mail carrier man — stands for')), ['anchor_scene@-']);
  assert.deepEqual(flagged(swap('- transition_in: cut\n- status: outline\n- src: compositions/frames/04', '- transition_in: zoom-through\n- status: outline\n- src: compositions/frames/04')), ['transition_kind@4']);
});

test('the final pass counts sound events and needs the mixed track (EX3-63)', () => {
  const four = [0.1, 0.5, 1, 2].map((t) => ({ t, kind: 'pop' }));
  const full = new Map([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, n === 3 || n === 8 ? four.slice(0, 1) : four]));
  assert.deepEqual(rules(lintStoryboard({ storyboard: fixture('good'), frameEvents: full, eventsTrack: true }).violations as Violation[]), ['sound_events@-']);
  const many = new Map([...full].map(([n, list]) => [n, [...list, ...list]]));
  assert.deepEqual(lintStoryboard({ storyboard: fixture('good'), frameEvents: many, eventsTrack: true }).violations, []);
  const thin = new Map(many);
  thin.set(4, four.slice(0, 2));
  assert.deepEqual(rules(lintStoryboard({ storyboard: fixture('good'), frameEvents: thin, eventsTrack: false }).violations as Violation[]), ['sound_events@4', 'sound_track@-']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-'));
  fs.writeFileSync(path.join(dir, '01-opener.events.json'), JSON.stringify(four));
  fs.writeFileSync(path.join(dir, '02-gap.events.json'), 'not json');
  fs.writeFileSync(path.join(dir, '02-gap.js'), 'export default {}');
  const read = eventsFromDir(dir);
  assert.equal(read.get(1)?.length, 4);
  assert.deepEqual(read.get(2), []);
  assert.equal(read.size, 2);
});

test('scene modules: narration on screen and emoji are flagged', () => {
  const frameSource = new Map([
    [5, "parts.push(el('text', {}, 'The letter is the event, because it carries what happened.'));"],
    [6, "parts.push(el('text', {}, 'order 4821 📦'));"],
    [7, "const lit = !seen && t > 1; // operators are not exclamation marks"],
  ]);
  const { violations } = lintStoryboard({ storyboard: fixture('good'), frameSource });
  assert.deepEqual(rules(violations as Violation[]), ['emoji@6', 'narration_on_screen@5']);
});

test("the final pass checks the opener's riser and hit", () => {
  const without = lintStoryboard({ storyboard: fixture('good'), audioMeta: { voices: [], sfx: [] } });
  assert.deepEqual(rules(without.violations as Violation[]), ['opener_sfx@1']);
  const withSfx = lintStoryboard({
    storyboard: fixture('good'),
    audioMeta: {
      sfx: [
        { frame: 1, file: 'assets/sfx/opener-riser.mp3', source: 'host', role: 'opener-riser' },
        { frame: 1, file: 'assets/sfx/impact-bass-1.mp3', source: 'host', role: 'opener-hit' },
      ],
    },
  });
  assert.deepEqual(withSfx.violations, []);
});

test('helpers: word count, jargon candidates, sections', () => {
  assert.equal(countWords('Ask for order forty-two — and wait.'), 6);
  assert.deepEqual(jargonCandidates('Why does JavaScript call an API via fetch_data or app/v2?'), [
    'JavaScript', 'API', 'fetch_data', 'app/v2',
  ]);
  assert.deepEqual(jargonCandidates('Why does a waiter never forget your order?'), []);
  assert.match(section(fixture('good'), 'Anchor scene') ?? '', /^- metaphor: a mailbox/);
  assert.equal(section(fixture('good'), 'Video direction'), null);
});

test('the CLI writes JSON and exits 0 even with violations', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lint-')), 'lint.json');
  const res = spawnSync(process.execPath, [
    path.join(dir, 'lint-storyboard.mjs'),
    '--storyboard', path.join(dir, 'fixtures', 'bad', 'STORYBOARD.md'),
    '--out', out,
  ], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(parsed.frames, 3);
  assert.ok(parsed.violations.length > 0);
  assert.equal(spawnSync(process.execPath, [path.join(dir, 'lint-storyboard.mjs')]).status, 2);
});
