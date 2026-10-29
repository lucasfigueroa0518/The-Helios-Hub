import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  briefOpenerLine,
  BEAT_SHEET,
  LOOKS,
  BEAT_LOOKS,
  lookOf,
  frameLooks,
  OPENER_TEMPLATES,
  openerKind,
  TOTAL_RANGE,
  parseShots,
  headwordShown,
  parseCarry,
  placesOf,
  SAFE_AREA,
  RETIRED_FIELDS,
  SHOT_SIZES,
  shotKinds,
  shotWindows,
  stem,
  subjectSpoken,
  countWords,
  stripComments,
  eventsFromDir,
  GROUNDS,
  groundProblem,
  RETIRED_GROUNDS,
  jargonCandidates,
  lintStoryboard,
  parseScript,
  quotedSpans,
  section,
  anchorEntities,
  OVERSTATE_RE,
  TRIP_RE,
  visualArc,
  VISUAL_ARC_FIELDS,
} from '../explainers/lint/lint-storyboard.mjs';

const dir = path.join(process.cwd(), 'explainers', 'lint');
const fixture = (name: string) => fs.readFileSync(path.join(dir, 'fixtures', name, 'STORYBOARD.md'), 'utf8');

type Violation = { rule: string; frame: number | null; severity: string; detail: string };
type ShotWindow = { shot: { subject: string }; window: string | null };
const rules = (vs: Violation[]) => vs.map((v) => `${v.rule}@${v.frame ?? '-'}`).sort();
/** The good fixture with one exact change (the `from` text must be there). */
const swapIn = (from: string, to: string) => {
  const good = fixture('good');
  assert.ok(good.includes(from), from);
  return good.replace(from, to);
};
const lintOf = (storyboard: string) => lintStoryboard({ storyboard }).violations as Violation[];

test('the beat sheet is eight beats of about a minute in the planned order (EX3-10, 3.3, 4.2)', () => {
  assert.equal(BEAT_SHEET.length, 8);
  const nominal = BEAT_SHEET.reduce((a, b) => a + b.seconds, 0);
  assert.ok(nominal >= TOTAL_RANGE[0] && nominal <= TOTAL_RANGE[1], `${nominal}s`);
  // 4.2: no look is fixed to a frame number; the beats keep their jobs.
  assert.ok(BEAT_SHEET.every((b) => !('anchor' in b)), 'no anchor rule per beat');
  // The hold after each line is pace.mjs's HOLD, 0.15s (EX3-79); the close is voiceless, 2.5s, no hold (EX3-95).
  assert.deepEqual(BEAT_SHEET.map((b) => b.hold), [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, null]);
  assert.equal(BEAT_SHEET[7].seconds, 2.5);
  assert.equal(BEAT_SHEET[7].words, null);
  // A shot list on every spoken frame but code's hand-off and the definition card's (one framing is fine there); no count.
  assert.deepEqual(BEAT_SHEET.map((b) => b.shots), [1, 1, 0, 1, 0, 1, 1, 0]);
  assert.deepEqual(BEAT_SHEET.map((b) => b.type), [
    'hook', 'product_intro', 'handoff', 'feature_showcase', 'feature_showcase', 'social_proof', 'benefit_highlight', 'branding',
  ]);
  // 4.3: the quick definition is about 15 words at most; the hand-off line is fixed.
  assert.deepEqual(BEAT_SHEET[1].words, [6, 15]);
  assert.equal(BEAT_SHEET[2].words, null);
});

test('the opener templates are the register verbatim, with one home in story-design (EX3-11, EX3-96, EX3-130)', () => {
  assert.deepEqual(OPENER_TEMPLATES, {
    ai: 'In the next minute, this ___ will teach you an AI concept.',
    tech: 'In the next minute, this ___ will teach you a tech concept.',
    coding: 'In the next minute, this ___ will teach you a coding concept.',
  });
  const register = fs.readFileSync(path.join(process.cwd(), 'planning', 'Explainer Reels', 'DECISIONS.md'), 'utf8');
  const block = /### Opener line template\n\n```\n([\s\S]+?)\n```/.exec(register)?.[1] ?? '';
  for (const line of Object.values(OPENER_TEMPLATES)) assert.ok(block.split('\n').includes(line), `the register's opener block lacks "${line}"`);
  const design = fs.readFileSync(path.join(process.cwd(), 'explainers', 'skill-overrides', 'faceless-explainer', 'references', 'story-design.md'), 'utf8');
  for (const line of Object.values(OPENER_TEMPLATES)) assert.ok(design.includes(line), `story-design.md lacks "${line}"`);
  for (const file of [['director', 'SKILL.md'], ['skill-overrides', 'faceless-explainer', 'references', 'story-design.md']]) {
    const text = fs.readFileSync(path.join(process.cwd(), 'explainers', ...file), 'utf8');
    assert.ok(!/30 seconds/.test(text), `${file.join('/')} still says 30 seconds`);
  }
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
  const content = ['voiceover_words', 'visual_missing', 'anchor_scene', 'hook', 'term', 'concept', 'ground', 'look', 'shots', 'opener_line', 'shot_cue', 'minimum:1', 'minimum:2', 'minimum:3', 'quick_definition', 'handoff_parts', 'world_sounds', 'definition_term'];
  const structural = (violations as Violation[]).filter((v) => !content.includes(v.rule));
  assert.deepEqual(structural, []);
  // Its placeholders carry no topic and no fixed look per frame, but code's hand-off (frame 3, world).
  assert.deepEqual(skeleton.match(/^- look:\s*(world|mechanism|blend)\s*$/gm), ['- look: world']);
  assert.match(skeleton, /## Frame 3 — Hand-off[\s\S]*?- look: world\n/);
  for (const field of Object.keys(RETIRED_FIELDS)) assert.ok(!new RegExp(`^- ${field}:`, 'm').test(skeleton), `the skeleton still has ${field}:`);
  for (const field of VISUAL_ARC_FIELDS) assert.ok(skeleton.includes(`- ${field}:`), `the skeleton lacks ${field}:`);
});

test('a storyboard that breaks the plan reports each rule', () => {
  const { violations } = lintStoryboard({ storyboard: fixture('bad') });
  assert.deepEqual(rules(violations as Violation[]), [
    'anchor_scene@-', // no hook
    'anchor_scene@-', // no places (4.2)
    'anchor_scene@-', // no steps
    'anchor_scene@-', // a hand is an entity (EX3-77)
    'anchor_scene@-', // no hero (EX3-110)
    'beat_type@2',
    'beat_type@3',
    'blueprint@3',
    'emoji@3',
    'exclamation_mark@1',
    'first_transition@1',
    'frame_count@-',
    'ground@3',
    'handoff_line@3', // 4.3: frame 3 says the hand-off line exactly
    'handoff_parts@3',
    'hold@1',
    'hold@2',
    'hold@3',
    'hook@-', // no ## Hook block
    'look@1', // "scene" is no look
    'look@2', // no look
    'look@3', // the hand-off is code's card over the world
    'minimum:1@-', // no world frame (a warning)
    'music@-', // a mood instead of music: none
    'opener_line@1',
    'persuasion_field@1',
    'quick_definition_jargon@2',
    'retired_field@2', // anchor: is retired
    'sfx_retired@2',
    'shot_kind@1', // a reaction is no size
    'shot_line@1', // no angle
    'shot_line@1', // no why
    'shots@2',
    'term@-',
    'total_duration@-',
    'transition_kind@1',
    'transition_kind@2',
    'visual_arc@-', // no ## Visual arc
    'visual_missing@2',
    'world_sounds@3',
  ]);
  const jargon = (violations as Violation[]).find((v) => v.rule === 'quick_definition_jargon');
  assert.match(jargon!.detail, /SDK/);
  assert.equal(jargon?.severity, 'warning');
  assert.ok((violations as Violation[]).some((v) => v.rule === 'anchor_scene' && /person or a body part \("hand"\)/.test(v.detail)));
  assert.equal((violations as Violation[]).find((v) => v.rule === 'total_duration')?.severity, 'warning', 'length is never an error');
  for (const v of (violations as Violation[]).filter((x) => x.rule.startsWith('minimum:'))) assert.equal(v.severity, 'warning', 'a minimum never stops a reel');
});

test('SCRIPT.md lines take precedence over storyboard voiceover guides', () => {
  const script = [
    '# SCRIPT',
    '',
    '## Line 1 — Opener (Frame 1)',
    '',
    '    In the next minute, this little mailbox will teach you a tech concept.',
    '',
    '## Line 2 — Gap (Frame 2)',
    '',
    '    Too short.',
  ].join('\n');
  const lines = parseScript(script);
  assert.equal(lines.get(1), 'In the next minute, this little mailbox will teach you a tech concept.');
  const { violations } = lintStoryboard({ storyboard: fixture('good'), script });
  const words = (violations as Violation[]).filter((v) => v.rule === 'voiceover_words').map((v) => v.frame);
  // Frame 2 is too short in the script; frames 4–7 have no script line at all; the hand-off and the
  // close have no word range (frame 3's line is fixed).
  assert.deepEqual(words, [2, 4, 5, 6, 7]);
  assert.ok(!(violations as Violation[]).some((v) => v.rule === 'opener_line'));
});

test('the opener follows a template, its slot 1–3 words naming the scene (EX3-96, EX3-130)', () => {
  const opener = (line: string, brief: string | null = null) => {
    const script = `## Line 1 — Opener (Frame 1)\n\n    ${line}\n`;
    return (lintStoryboard({ storyboard: fixture('good'), script, brief }).violations as Violation[]).filter((v) => v.rule === 'opener_line');
  };
  assert.equal(opener('In the next minute you will learn something.')[0]?.severity, 'error');
  assert.equal(opener('In the next 30 seconds, this mailbox will teach you an AI concept.')[0]?.severity, 'error', 'the 3.4 line');
  assert.equal(opener("In the next 30 seconds, you'll learn an AI concept.")[0]?.severity, 'error', 'the 3.2 fixed line');
  assert.equal(opener('In the next minute, this very small red tin mailbox will teach you an AI concept.')[0]?.severity, 'error', 'slot too long');
  assert.equal(opener('In the next minute, this soggy forecaster will teach you a tech concept.')[0]?.severity, 'warning', 'names nothing in the scene');
  // Every variant passes without a brief.
  assert.deepEqual(opener('In the next minute, this mailbox will teach you an AI concept.'), []);
  assert.deepEqual(opener('In the next minute, this mailbox will teach you a tech concept.'), []);
  assert.deepEqual(opener('In the next minute, this mailbox will teach you a coding concept.'), []);
  assert.equal(openerKind('In the next minute, this mailbox will teach you a coding concept.'), 'coding');
  assert.equal(openerKind('In the next minute, this mailbox will teach you an AI concept.'), 'ai');
  assert.equal(openerKind('In the next minute this mailbox will teach you a tech concept'), 'tech');
  assert.equal(openerKind('In the next minute, this mailbox will teach you a concept.'), null);
  // BRIEF.md's ## Opener line names the variant; frame 1 must use it.
  const brief = (kind: 'ai' | 'tech') => `# Brief\n\n## Opener line\n\n${OPENER_TEMPLATES[kind]}\n\n## Analogy\n\nName: x\n`;
  assert.equal(briefOpenerLine(brief('ai')), OPENER_TEMPLATES.ai);
  assert.equal(briefOpenerLine(brief('tech')), OPENER_TEMPLATES.tech);
  assert.equal(briefOpenerLine('# Brief\n\n## Opener line\n\n`In the next minute, this ___ will teach you a tech concept.`\n'), OPENER_TEMPLATES.tech);
  assert.equal(briefOpenerLine('# Brief\n\n## Analogy\n\nx\n'), null);
  assert.deepEqual(opener('In the next minute, this mailbox will teach you a tech concept.', brief('tech')), []);
  const wrong = opener('In the next minute, this mailbox will teach you an AI concept.', brief('tech'));
  assert.deepEqual(wrong.map((v) => v.severity), ['error']);
  assert.match(wrong[0].detail, /BRIEF\.md's opener line is "In the next minute, this ___ will teach you a tech concept\."/);
  assert.match(opener('Hello there.', brief('ai'))[0].detail, /the line is "In the next minute, this ___ will teach you an AI concept\."$/);
});

test('shots follow the voice: each shot subject is spoken while it is on screen (EX3-91), a warning', () => {
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
  // In the storyboard it is a warning on any frame (4.2: no frame's shots are held to an error).
  const off = lintOf(swapIn('close — the message arriving — on "message"', 'close — the carrier at the window — on "message"'));
  assert.deepEqual(off.map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['shot_subject@2:warning']);
});

test('4.2 shot lines: size, subject, cue, angle and why, with optional cast, place and carry; old lines still parse', () => {
  assert.deepEqual(SHOT_SIZES, ['wide', 'medium', 'close', 'insert']);
  const [a, b] = parseShots([
    'medium — the cook at the pass — on "the cook\'s" — angle: eye level across the counter — why: who does the work, and where — cast: cook, ticket — place: kitchen',
    'insert — the ticket — on "order" — angle: straight down on the rail — why: a close-up of the one thing that changed — carry: ticket',
  ].join('\n'));
  assert.deepEqual(a, { kind: 'medium', size: 'medium', subject: 'the cook at the pass', cue: "the cook's", cast: ['cook', 'ticket'], angle: 'eye level across the counter', why: 'who does the work, and where', place: 'kitchen', carry: null });
  // The why's words are never read as a shot kind or a subject ("a close-up" there is not a second shot).
  assert.deepEqual([b.kind, b.subject, b.why, b.carry, b.cast], ['insert', 'the ticket', 'a close-up of the one thing that changed', { id: 'ticket', box: null }, null]);
  assert.deepEqual(shotKinds('insert — the ticket — why: a close-up of it, then wide'), ['insert']);
  // A shot line without the 4.2 fields parses as before (Real Case reuses parseShots and shotKinds).
  assert.deepEqual(parseShots('close — the screen — on "screen"').map((x) => [x.subject, x.cast, x.angle, x.why]), [['the screen', null, null, null]]);
  assert.deepEqual(parseShots('medium — the carrier and the letter — on "carrier" — cast: carrier, letter and mailbox — angle: low from the drive; insert — the empty post — cast: none — angle: high above it').map((x) => [x.kind, x.subject, x.cue, x.cast, x.angle]), [
    ['medium', 'the carrier and the letter', 'carrier', ['carrier', 'letter', 'mailbox'], 'low from the drive'],
    ['insert', 'the empty post', null, [], 'high above it'],
  ]);

  // In the storyboard: every line names its size, its cue (after the first), its angle and its why.
  const SHOT = '  - close — the flag — on "flag" — angle: from the mailbox\'s side, level with the flag — why: the alert goes up with nobody checking — cast: flag, mailbox — place: lawn';
  const flagged = (to: string) => lintOf(swapIn(SHOT, to)).map((v) => `${v.rule}@${v.frame}:${v.severity}`);
  assert.deepEqual(flagged('  - close — the flag — on "flag" — why: the alert goes up — cast: flag'), ['shot_line@4:error']);
  assert.deepEqual(flagged('  - close — the flag — on "flag" — angle: level with the flag'), ['shot_line@4:error']);
  assert.deepEqual(flagged('  - close — the flag — angle: level with the flag — why: the alert goes up'), ['shot_line@4:error']);
  assert.match(lintOf(swapIn(SHOT, '  - close — the flag — on "flag" — angle: level')).find((v) => v.rule === 'shot_line')!.detail, /shot 3 names no why/);
  assert.deepEqual(flagged('  - the flag alone — on "flag" — angle: level — why: the alert'), ['shot_line@4:error']);
  assert.deepEqual(flagged('  - reaction — the flag — on "flag" — angle: level — why: the alert'), ['shot_kind@4:error']);
  assert.deepEqual(flagged('  - ots — the flag — on "flag" — angle: level — why: the alert'), ['shot_kind@4:error']);
  // A shot set in a place the anchor scene does not have: a warning.
  assert.deepEqual(flagged(SHOT.replace('place: lawn', 'place: depot')), ['shot_ref@4:warning']);
  // Taste is not the lint's: the same subject twice, any number of critters, no cast at all.
  const SECOND = '  - medium — the carrier and the letter — on "carrier" — angle: low from the drive, the mailbox ahead — why: the sender arrives with the message — cast: carrier, letter, mailbox — place: lawn';
  assert.deepEqual(lintOf(swapIn(SECOND, '  - medium — the flag — on "carrier" — angle: low from the drive — why: the flag waits')
    .replace('  - close — the flag — on "flag"', '  - close — the flag — on "flag"')).filter((v) => v.severity === 'error'), []);
});

test('4.2 carries: one declared screen box on both shots of the cut (NOTES-D)', () => {
  assert.deepEqual(parseCarry('letter box 400 1000 680 1300'), { id: 'letter', box: [400, 1000, 680, 1300] });
  assert.deepEqual(parseCarry('letter'), { id: 'letter', box: null });
  assert.equal(parseCarry(''), null);
  assert.deepEqual(SAFE_AREA, { x0: 96, y0: 570, x1: 940, y1: 1600 });
  const OUT = '— carry: letter box 400 1000 680 1300\n';
  const IN = 'why: the event that starts it — carry: letter box 400 1000 680 1300';
  const flagged = (sb: string) => lintOf(sb).map((v) => `${v.rule}@${v.frame}:${v.severity}`);
  // One side alone: a warning on that side.
  assert.deepEqual(flagged(swapIn(OUT, '\n')), ['carry@6:warning']);
  assert.deepEqual(flagged(swapIn(IN, 'why: the event that starts it')), ['carry@5:warning']);
  // Two boxes for one carry, a box outside the safe area, and a bare id.
  assert.deepEqual(flagged(swapIn(IN, 'why: the event that starts it — carry: letter box 420 1000 700 1300')), ['carry@5:warning', 'carry@6:warning']);
  const outside = flagged(swapIn(OUT, '— carry: letter box 40 1000 680 1300\n').replace(IN, 'why: the event that starts it — carry: letter box 40 1000 680 1300'));
  assert.deepEqual(outside, ['carry@5:warning', 'carry@6:warning']);
  assert.deepEqual(flagged(swapIn(OUT, '— carry: letter\n').replace(IN, 'why: the event that starts it — carry: letter')), ['carry@5:warning', 'carry@6:warning']);
});

test('4.2 every spoken frame declares its look; the pipeline reads it, never the frame number', () => {
  assert.deepEqual(LOOKS, ['world', 'mechanism', 'blend']);
  assert.equal(lookOf('blend — the store and the mailbox share the frame'), 'blend');
  assert.equal(lookOf('scene'), '');
  assert.deepEqual([...frameLooks(fixture('good'))], [[1, 'world'], [2, 'mechanism'], [3, 'world'], [4, 'world'], [5, 'world'], [6, 'mechanism'], [7, 'blend']]);
  const SIX = '- type: social_proof\n- ground: paper\n- look: mechanism';
  assert.deepEqual(rules(lintOf(swapIn(SIX, '- type: social_proof\n- ground: paper'))), ['look@6']);
  assert.deepEqual(rules(lintOf(swapIn(SIX, '- type: social_proof\n- ground: paper\n- look: own'))), ['look@6']);
  // Most beats take any look: a mechanism frame 4 or a world frame 7 is the director's call.
  assert.deepEqual(BEAT_LOOKS, { 1: ['world', 'blend'], 3: ['world'], 6: ['mechanism', 'blend'] });
  assert.deepEqual(lintOf(swapIn('- type: feature_showcase\n- ground: paper\n- look: world\n- voiceover: "This mailbox', '- type: feature_showcase\n- ground: paper\n- look: mechanism\n- voiceover: "This mailbox')), []);
  // Three beats' jobs narrow it: the real technology (6), code's card over the world (3) and the hook through the camera (1).
  assert.deepEqual(lintOf(swapIn(SIX, '- type: social_proof\n- ground: paper\n- look: world')).map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['look@6:warning']);
  assert.deepEqual(lintOf(swapIn('- type: hook\n- ground: paper\n- look: world', '- type: hook\n- ground: paper\n- look: mechanism')).map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['look@1:error']);
  // The close has none.
  const close = lintOf(swapIn('- type: branding\n- ground: white', '- type: branding\n- ground: white\n- look: world'));
  assert.deepEqual(close.map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['look@8:warning']);
  // Retired fields are warnings that name what replaced them.
  assert.deepEqual(Object.keys(RETIRED_FIELDS), ['anchor', 'technique', 'reset', 'term_part', 'example_steps', 'gap_question', 'closed_by']);
  const old = lintOf(swapIn('- look: blend\n', '- look: blend\n- anchor: own\n- technique: process — a route\n'));
  assert.deepEqual(old.map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['retired_field@7:warning', 'retired_field@7:warning']);
  assert.match(old[0].detail, /"anchor:" is retired in 4\.2: each frame declares its look/);
});

test('4.2 the minimums a plan can show are warnings: a world frame, a mechanism or blend frame, the definition', () => {
  const good = fixture('good');
  const allLooks = (to: string) => good.replace(/^- look: \w+$/gm, `- look: ${to}`);
  const minimums = (vs: Violation[]) => vs.filter((v) => v.rule.startsWith('minimum:'));
  const world = minimums(lintOf(allLooks('world')));
  assert.deepEqual(world.map((v) => `${v.rule}:${v.severity}`), ['minimum:2:warning']);
  assert.match(world[0].detail, /the real mechanism is shown working at least once \(minimums\.md 2\)/);
  const tech = minimums(lintOf(allLooks('mechanism')));
  assert.deepEqual(tech.map((v) => `${v.rule}:${v.severity}`), ['minimum:1:warning']);
  assert.match(tech[0].detail, /the analogy plays out in full at least once \(minimums\.md 1\)/);
  // A blend frame counts as showing the mechanism.
  assert.ok(!lintOf(allLooks('world').replace('- look: world\n- voiceover: "The store raised', '- look: blend\n- voiceover: "The store raised')).some((v) => v.rule.startsWith('minimum:')));
  // No definition on the card: minimum 3, a warning on frame 5 (4.3).
  const DEF = "- definition: \"A webhook is a letter one app drops in another app's mailbox the moment something happens.\"\n";
  assert.deepEqual(lintOf(swapIn(DEF, '')).map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['minimum:3@5:warning']);
  // 4.3, minimums.md 7: the tie-together ends on the viewer, a warning.
  const seven = lintOf(swapIn('you know a message just landed."', 'a message just landed."'));
  assert.deepEqual(seven.map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['minimum:7@7:warning']);
});

test('4.2 the visual arc plans the reel as one film: every field written', () => {
  assert.deepEqual(VISUAL_ARC_FIELDS, ['throughline', 'colour script', 'motifs', 'intensity', 'bridges']);
  const arc = visualArc(section(fixture('good'), 'Visual arc'));
  assert.match(arc.throughline!, /^one letter's trip/);
  assert.match(arc['colour script']!, /^1 morning/);
  assert.equal(visualArc('- color script: 1 day; 2 night')['colour script'], '1 day; 2 night', 'either spelling');
  assert.equal(visualArc('- motifs:')['motifs'], '');
  const MOTIFS = fixture('good').split('\n').find((l) => l.startsWith('- motifs: '))!;
  assert.deepEqual(rules(lintOf(swapIn(MOTIFS + '\n', ''))), ['visual_arc@-']);
  assert.deepEqual(rules(lintOf(swapIn('## Visual arc\n', '## Visual plan\n'))), ['visual_arc@-']);
  // "none" is an answer for bridges.
  const BRIDGES = fixture('good').split('\n').find((l) => l.startsWith('- bridges: '))!;
  assert.deepEqual(lintOf(swapIn(BRIDGES, '- bridges: none')), []);
});

test('4.2 places: one line per place, interior or exterior; a trip the voice describes has a place or a shot', () => {
  const block = section(fixture('good'), 'Anchor scene');
  assert.deepEqual(placesOf(block).map((p) => [p.id, p.kind.split(':')[0], p.what]), [['lawn', 'exterior', 'the carrier delivers and the flag goes up']]);
  // Several, as sub-bullets or on their own lines.
  assert.deepEqual(placesOf('- places: shop — interior: a corner shop — the order is placed\n- places:\n  - road — exterior: a road — the van drives\n  - porch — exterior: a porch — the box lands').map((p) => p.id), ['shop', 'road', 'porch']);
  const PLACES = '- places:\n  - lawn — exterior: a curbside lawn at the end of a short gravel drive, the house behind — the carrier delivers and the flag goes up\n';
  const none = lintOf(swapIn(PLACES, ''));
  assert.ok(none.some((v) => v.rule === 'anchor_scene' && v.severity === 'error' && /no places/.test(v.detail)), JSON.stringify(none));
  const vague = lintOf(swapIn(PLACES, '- places:\n  - lawn — a lawn\n'));
  assert.ok(vague.some((v) => v.rule === 'anchor_scene' && v.severity === 'warning' && /place "lawn" needs/.test(v.detail)), JSON.stringify(vague));
  // A trip the voice describes, shown nowhere: a warning naming it (minimum 4's text side).
  assert.equal(TRIP_RE.exec('Then the carrier heads back to the depot.')?.[1], 'depot');
  assert.equal(TRIP_RE.exec('nobody walks out to check'), null);
  const LINE4 = 'When it drops in, the flag snaps up on its own, so nobody walks out to check.';
  const TRIP = 'Then the carrier heads back to the depot, and the flag snaps up on its own.';
  const trip = lintOf(swapIn(LINE4, TRIP));
  assert.deepEqual(trip.map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['trip_shown@4:warning']);
  assert.match(trip[0].detail, /show the trip/);
  // Shown when a place names it.
  const depot = swapIn(LINE4, TRIP).replace(PLACES, `${PLACES}  - depot — interior: the post depot — the carrier picks up the next letter\n`);
  assert.deepEqual(lintStoryboard({ storyboard: depot }).violations, []);
});

test('4.3 writing rules: no scene restart, the quick definition, the hand-off, the dictionary card, the term, the close', () => {
  const flagged = (storyboard: string) => rules(lintOf(storyboard));
  const good = fixture('good');
  assert.deepEqual(flagged(swapIn('- voiceover: "This mailbox is where messages land.', '- voiceover: "Picture a mailbox where messages land.')), ['scene_setting@4']);
  // Beat 2 (4.3): one plain sentence of about 15 words, "[Term] is when …".
  const QUICK = 'A webhook is when one app sends another a message the moment something happens.';
  const quick = (line: string) => flagged(swapIn(QUICK, line)).filter((r) => /^quick_definition|^definition_overstated|^minimum:3/.test(r));
  assert.deepEqual(quick('One app sends another a message the moment something happens.'), ['quick_definition@2']);
  assert.equal(lintOf(swapIn(QUICK, 'One app sends another a message the moment something happens.'))[0].severity, 'error');
  assert.deepEqual(quick('When something happens, a webhook sends a message.'), ['quick_definition@2'], 'names the term, but not "[Term] is …" (a warning)');
  assert.deepEqual(quick('A webhook is when one app sends another a short message the moment something happens, over the internet, to a waiting address.'), ['quick_definition@2'], 'over 15 words');
  assert.deepEqual(quick('A webhook is when one app sends a message. It happens at once.'), ['quick_definition@2'], 'two sentences');
  // Beat 3 (4.3): the hand-off line, exactly; its mapped parts are the anchor scene's.
  assert.deepEqual(flagged(swapIn("- voiceover: \"Let's dive into this in everyday terms.\"", '- voiceover: "Now for the fun part."')), ['handoff_line@3']);
  assert.deepEqual(flagged(swapIn('- handoff_parts: mailbox, letter, flag', '- handoff_parts: fridge, milk')), ['handoff_parts@3']);
  assert.deepEqual(flagged(swapIn('- handoff_parts: mailbox, letter, flag', '- handoff_parts: none')), []);
  assert.deepEqual(flagged(swapIn('- world_sounds: footstep, creak\n', '')), ['world_sounds@3']);
  // A leftover curiosity gap block (4.2) is a warning; its fields are retired.
  assert.deepEqual(flagged(swapIn('## Frame 1 — Series opener', '## Curiosity gap\n\n> Why?\n\n## Frame 1 — Series opener')), ['curiosity_gap@-']);
  assert.ok(RETIRED_FIELDS.gap_question && RETIRED_FIELDS.closed_by);
  // "Critter" is never said, in any frame (EX3-121).
  assert.deepEqual(flagged(swapIn('- voiceover: "This mailbox is where messages land.', '- voiceover: "This mailbox is where the critter lands messages.')).filter((r) => /critter/.test(r)), ['said_critter@4']);
  assert.deepEqual(flagged(swapIn('- type: branding\n', '- type: branding\n- voiceover: "Apps that tell you."\n')), ['close_voiceover@8']);
  // Beat 5: the dictionary card; its definition is the voiceover's first words.
  assert.deepEqual(flagged(swapIn('- part_of_speech: noun\n', '')), ['definition@5']);
  assert.deepEqual(flagged(swapIn('- definition: "A webhook is a letter one app drops', '- definition: "A webhook is a note one app drops')), ['definition@5']);
  assert.deepEqual(flagged(swapIn('- hold: 0.15s', '- hold: 0.6s')), ['hold@1']);
  assert.deepEqual(flagged(swapIn('term: webhook\n', 'term: event stream\n')), ['concept@-', 'definition_term@5', 'quick_definition@2']);
  assert.deepEqual(flagged(swapIn('## Hook\n', '## Hooks\n')), ['hook@-']);
  assert.deepEqual(flagged(swapIn('  - carrier — a mail carrier critter — stands for', '  - carrier — a mail carrier man — stands for')), ['anchor_scene@-']);
  assert.deepEqual(flagged(swapIn('- transition_in: cut\n- status: outline\n- src: compositions/frames/04', '- transition_in: zoom-through\n- status: outline\n- src: compositions/frames/04')), ['transition_kind@4']);
  // No "where it breaks" beat (4.3): a frame 5 with no limit is clean.
  assert.deepEqual(flagged(swapIn('It works because the sender raises the flag', 'It works because the sender itself raises the flag')), []);
});

test('grounds are paper, stage, and white for the close; night and forest are retired (hx-4)', () => {
  assert.deepEqual(GROUNDS, ['paper', 'stage', 'white']);
  assert.deepEqual(RETIRED_GROUNDS, { night: 'stage', forest: 'stage' });
  assert.equal(groundProblem('paper'), null);
  assert.equal(groundProblem('Stage'), null);
  assert.match(groundProblem('night')!, /retired in 4\.0: use "stage"/);
  assert.match(groundProblem('blue')!, /one of paper, stage, white/);
  const good = fixture('good');
  const ground = (frame: number, to: string) => {
    const block = new RegExp(`(## Frame ${frame} [^]*?- ground: )\\w+`);
    assert.ok(block.test(good), `frame ${frame}`);
    return (lintStoryboard({ storyboard: good.replace(block, `$1${to}`) }).violations as Violation[]).filter((v) => v.rule === 'ground');
  };
  // A retired ground is an error with the fix.
  for (const old of ['night', 'forest']) {
    const v = ground(4, old);
    assert.deepEqual(v.map((x) => `${x.frame}:${x.severity}`), ['4:error']);
    assert.match(v[0].detail, /use "stage" \(the premium lit stage\)/);
  }
  // Any spoken frame may stand on the stage (4.2: no ground is fixed to a frame number).
  for (const n of [2, 3, 4, 6, 7]) assert.deepEqual(ground(n, 'stage'), [], `frame ${n}`);
  assert.deepEqual(ground(4, 'white').map((x) => x.detail), ['only the last frame is white']);
  assert.deepEqual(ground(8, 'paper').map((x) => x.detail), ['the last frame is white']);
});

test('the anchor block names its hero, critter or object; its entities are never people (EX3-110, EX3-77)', () => {
  const anchor = (from: string, to: string) => lintOf(swapIn(from, to)).filter((v) => v.rule === 'anchor_scene').map((v) => `${v.severity}: ${v.detail}`);
  assert.match(anchor('- hero: carrier — critter\n', '')[0], /^error: no hero/);
  // An object hero (critters are optional, PLAN.md turn 1); any critter's colours are the scene builder's.
  assert.deepEqual(anchor('- hero: carrier — critter', '- hero: flag — object'), []);
  assert.match(anchor('- hero: carrier — critter', '- hero: van — object')[0], /^warning: the hero "van" is not one of the entities' ids/);
  const ents = anchorEntities(section(fixture('good'), 'Anchor scene'));
  assert.deepEqual([...ents.keys()], ['mailbox', 'letter', 'flag', 'carrier']);
  assert.deepEqual([...ents.values()].map((e) => e.critter), [false, false, false, true]);
  // No cap on entities or critters: a fifth entity is fine.
  const FIFTH = '  - porch — the porch steps — stands for the house — painted wooden steps — beats 4';
  assert.deepEqual(anchor('  - carrier — a mail carrier critter', `${FIFTH}\n  - carrier — a mail carrier critter`), []);
});

test('the definition defines the term, both sides of a paired term, and overstates nothing (EX4-152, EX4-159)', () => {
  for (const word of ['always', 'never', 'every', 'the smallest', 'the fastest', 'the best']) assert.ok(OVERSTATE_RE.test(`it ${word} works`), word);
  assert.ok(!OVERSTATE_RE.test('A webhook is a message one app sends to another app.'));
  const good = fixture('good');
  const DEF = "A webhook is a letter one app drops in another app's mailbox the moment something happens.";
  const OVER = "A webhook is the fastest letter one app drops in another app's mailbox the moment something happens.";
  const over = lintOf(good.replaceAll(DEF, OVER));
  assert.deepEqual(over.map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['definition_overstated@5:warning']);
  const paired = good.replace('term: webhook\n', 'term: webhook vs polling\n').replace('concept: webhook\n', 'concept: webhook vs polling\n');
  const rulesOf = (sb: string) => rules(lintOf(sb)).filter((r) => /^definition_term/.test(r));
  assert.deepEqual(rulesOf(paired), ['definition_term@5']);
  assert.deepEqual(rulesOf(paired.replaceAll(DEF, 'A webhook is a letter one app drops the moment something happens, while polling is an app asking again and again.')), []);
});

test("a frame module's comments are never on screen (narration and emoji checks skip them)", () => {
  assert.equal(stripComments("a(); // the router reads it\n/* 🚀 */ b('https://x.y');").trim(), "a(); \n  b('https://x.y');");
  const frameSource = new Map([[6, "// 2 · but if the mailbox is gone, the letter has nowhere to land\nparts.push(stamp()); /* 📦 */"]]);
  assert.deepEqual(lintStoryboard({ storyboard: fixture('good'), frameSource }).violations, []);
});

test('quoted spans: real quotes only, never an apostrophe inside a word', () => {
  assert.deepEqual(quotedSpans(`The model reads "it". It's the cat's toy. Then 'she' and ‘they’.`), ['it', 'she', 'they']);
  assert.deepEqual(quotedSpans('Here is "The cat ignored the fish because it was tired."'), ['The cat ignored the fish because it was tired.']);
});

test("words that can't be said out loud are errors (EX3-106)", () => {
  const swap = (from: string, to: string) => fixture('good').replace(from, to);
  const said = (storyboard: string) =>
    (lintStoryboard({ storyboard }).violations as Violation[]).filter((v) => v.rule === 'unsayable').map((v) => `${v.frame}:${v.severity}`);
  // A quoted word sounds like ordinary speech; said elsewhere too, the detail counts it.
  const quoted = swap('This mailbox is where messages land.', 'This mailbox is where messages land. A "flag" is on it.');
  assert.deepEqual(said(quoted), ['4:error']);
  assert.match((lintStoryboard({ storyboard: quoted }).violations as Violation[]).find((v) => v.rule === 'unsayable')!.detail, /"flag" is also said \d+ times as an ordinary word/);
  // Symbols and code tokens.
  assert.deepEqual(said(swap('It sends one message', 'It sends one a/b message')), ['6:error']);
  assert.deepEqual(said(swap('It sends one message', 'It sends one orderCreated message')), ['6:error']);
  assert.deepEqual(said(swap('It sends one message', 'It sends one order_created message')), ['6:error']);
  assert.deepEqual(said(swap('It sends one message', 'It sends one message to shop.com')), ['6:warning']);
  // A quoted sentence is fine: the voice reads it as a sentence.
  assert.deepEqual(said(swap('A store ships order 4821.', 'A store writes "Order 4821 has shipped to Lisbon today."')), []);
});

test('the example never reuses the scene (EX3-105)', () => {
  const reused = (from: string, to: string) =>
    (lintStoryboard({ storyboard: fixture('good').replace(from, to) }).violations as Violation[]).filter((v) => v.rule === 'example_reuses_scene');
  // The example quotes the scene's own material: the attention reels' failure.
  const same = reused('A store ships order 4821.', 'A note says "the carrier dropped a letter in the mailbox."');
  assert.equal(same.length >= 1, true);
  assert.ok(same.some((v) => v.severity === 'error' && /carrier|letter/.test(v.detail)));
  // Naming an anchor entity in frame 6 is a warning.
  const named = reused('A store ships order 4821.', 'A store ships order 4821 like a mailbox.');
  assert.deepEqual(named.map((v) => v.severity), ['warning']);
  // Real values of its own are fine.
  assert.deepEqual(reused('A store ships order 4821.', 'A store writes "Order 4821 has shipped to Lisbon today."'), []);
});

test('a reused asset fits exactly: in the catalog, with its exact reason, and never one of its stand-ins (EX3-112, EX3-113)', () => {
  const MAILBOX = 'prop: mailbox (exact: an American rural curbside mailbox on a post, in a house curb)';
  const fit = (to: string) =>
    (lintStoryboard({ storyboard: fixture('good').replace(MAILBOX, to) }).violations as Violation[]).filter((v) => v.rule === 'prop_fit').map((v) => v.detail);
  assert.deepEqual(fit(MAILBOX), []);
  assert.match(fit('prop: mailbox')[0], /has no "\(exact:/);
  assert.match(fit('prop: turnstile (exact: a turnstile)')[0], /not in the asset bank/);
  // The model-routing reel's clinic desk on the dining table, and a grocery aisle on the bookcase.
  assert.ok(fit('the clinic front desk, prop: table (exact: a table, in a clinic)').some((d) => /stands in for "front desk"|stands in for "desk"/.test(d)));
  assert.ok(fit('supermarket shelving, prop: shelf (exact: a bookcase, in a grocery store)').some((d) => /stands in for "supermarket aisle"|shelving/.test(d)));
  // A new drawing named specifically needs no catalog at all.
  assert.deepEqual(fit("new drawing: a clinic reception desk with a raised front counter — built from isoBox"), []);
});

test('the final pass flags a silent frame and needs the mixed track; no event quota (EX3-63, 4.2)', () => {
  const four = [0.1, 0.5, 1, 2].map((t) => ({ t, kind: 'pop' }));
  const one = new Map([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, four.slice(0, 1)]));
  assert.deepEqual(lintStoryboard({ storyboard: fixture('good'), frameEvents: one, eventsTrack: true }).violations, [], 'one event a frame is no warning: density is house style');
  const silent = new Map(one);
  silent.set(4, []);
  silent.delete(5);
  assert.deepEqual(rules(lintStoryboard({ storyboard: fixture('good'), frameEvents: silent, eventsTrack: false }).violations as Violation[]), ['sound_events@4', 'sound_events@5', 'sound_track@-']);
  // A bank opener's frame 1 sounds through its stem.
  const noOne = new Map(one);
  noOne.set(1, []);
  const stem = { sfx: [{ frame: 1, role: 'opener-stem' }, { frame: 1, role: 'opener-riser' }, { frame: 1, role: 'opener-hit' }] };
  assert.ok(!rules(lintStoryboard({ storyboard: fixture('good'), frameEvents: noOne, audioMeta: stem }).violations as Violation[]).includes('sound_events@1'));

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
    [5, "dictionaryCard(t, { headword: 'webhook' }); parts.push(el('text', {}, 'It works because the sender raises the flag, so nobody has to check.'));"],
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


// ── try.mjs's hx-4 world checks (the build-time side of the rules above) ─────────────────────

test('try.mjs: grounds and their aliases, the sizes, and outfits clear of the face (hx-4, 4.2)', async () => {
  const { resolveGround, sizeLedgerProblems, outfitProblems, castShapeProblems, elementBoxes } = await import('../explainers/world-kit/try.mjs');
  const kit = await import('../explainers/world-kit/cast.js');
  // Grounds: night and forest are read as the stage.
  assert.equal(resolveGround('paper'), 'paper');
  assert.equal(resolveGround('night'), 'stage');
  assert.equal(resolveGround('Forest'), 'stage');
  assert.equal(resolveGround('blue'), null);
  // 4.2: no true scale (house style: cheated scale). SIZES, when present, are positive { w, d, h } in cm,
  // and a prop's scale is 'cheat' or a factor; there is no exaggeration cap and no DRAWN ledger.
  assert.deepEqual(sizeLedgerProblems({ ENTITIES: { fridge: 'x' } }), [], 'no SIZES, nothing to check');
  const world = { ENTITIES: { fridge: 'the cache', nurse: 'the router' }, CAST: { nurse: { body: 'orange' } }, SIZES: { fridge: { w: 70, d: 70, h: 180 } } };
  assert.deepEqual(sizeLedgerProblems(world), []);
  assert.deepEqual(sizeLedgerProblems({ ...world, SIZES: { fridge: { w: 70, d: 70, h: 180, exaggerate: 3 } } }), [], 'no cap');
  assert.deepEqual(sizeLedgerProblems({ ...world, SIZES: { fridge: { w: 70, d: 70, h: 180, scale: 'cheat' } } }), []);
  assert.match(sizeLedgerProblems({ ...world, SIZES: { fridge: { w: 70, h: 180 } } })[0], /must be \{ w, d, h \}/);
  assert.match(sizeLedgerProblems({ ...world, SIZES: { fridge: { w: 70, d: 70, h: 180, scale: 'huge' } } })[0], /scale must be 'cheat' or a positive number/);
  // CAST takes { body, outfit }.
  assert.deepEqual(castShapeProblems({ nurse: { body: 'orange', outfit: { top: { kind: 'scrubs', color: 'blue' } } } }), []);
  assert.match(castShapeProblems({ nurse: { body: 'ink', outfit: 'scrubs' } })[0], /outfit must be an object/);
  assert.match(castShapeProblems(undefined)[0], /CAST = \{ <critter id>: \{ body, outfit \} \}/);
  // Outfits through cast.js: its kinds, nothing over the face, never orange.
  const nurse = { top: { kind: 'scrubs', color: 'blue', neck: 'v' }, pants: 'blue', shoes: 'paper', items: ['stethoscope', 'badge', 'fob-watch'] };
  assert.deepEqual(outfitProblems({ nurse: { body: 'orange', outfit: nurse } }, kit), []);
  const one = (outfit: object) => outfitProblems({ x: { body: 'ink', outfit } }, kit);
  assert.match(one({ ...nurse, head: { kind: 'visor' } })[0], /"visor" covers the eyes or mouth/);
  assert.match(one({ ...nurse, items: ['surgical-mask'] })[0], /covers the eyes or mouth/);
  assert.match(one({ ...nurse, head: { kind: 'baseball-cap' } })[0], /head\.kind "baseball-cap" must be one of .*drawn once with custom/);
  assert.match(one({ ...nurse, items: ['mailbag'] })[0], /item "mailbag" must be one of/);
  assert.match(one({ ...nurse, top: { kind: 'vest', color: 'orange' } })[0], /never an outfit color/);
  // A custom garment, drawn on the critter by the kit: never over the face (the kit would clip it away).
  assert.deepEqual(one({ ...nurse, custom: () => '<path d="M -60 -20 L 60 -20 L 60 20 L -60 20 Z" fill="#000"/>' }), []);
  assert.match(one({ ...nurse, custom: () => '<rect x="-40" y="-130" width="80" height="40"/>' })[0], /custom draws a piece over the face \(the eyes\)/);
  assert.match(one({ ...nurse, custom: () => '<rect width="NaN"/>' })[0], /custom: the SVG contains "NaN"/);
  assert.match(one({ ...nurse, custom: () => { throw new Error('boom'); } })[0], /custom threw: boom/);
  // No two critters on screen look alike.
  const { twinProblems } = await import('../explainers/world-kit/try.mjs');
  const draw = (who: string, outfit: object | null) => kit.critter(0, 0, { who, body: 'paper', outfit });
  const gown = (color: string) => ({ top: { kind: 'dress', color } });
  assert.deepEqual(twinProblems([{ t: 0, svg: draw('patients-1', gown('blue')) + draw('patients-2', gown('lilac')) }]), []);
  const twins = twinProblems([{ t: 0.5, svg: draw('patients-1', gown('blue')) + draw('patients-2', gown('blue')) }, { t: 1, svg: draw('patients-1', gown('blue')) + draw('patients-2', gown('blue')) }]);
  assert.equal(twins.length, 1, 'reported once');
  assert.match(twins[0], /"patients-1" and "patients-2" look alike at 0\.50s/);
  // An older kit (no normalizeOutfit): only the face and orange checks.
  assert.deepEqual(outfitProblems({ x: { body: 'ink', outfit: { head: { kind: 'baseball-cap' } } } }, null), []);
  assert.deepEqual(elementBoxes('<circle cx="10" cy="20" r="5"/><path d="m 0 0 l 5 5"/><rect x="1" y="2" width="3" height="4" transform="rotate(4)"/>'), [{ x0: 5, y0: 15, x1: 15, y1: 25 }]);
});

test('a paired term\'s headword may join its words with vs, /, & or "and"', () => {
  assert.ok(headwordShown("dictionaryCard(t, { headword: 'frontend / backend' })", 'frontend vs backend'));
  assert.ok(headwordShown("headword: 'Frontend & Backend'", 'frontend vs backend'));
  assert.ok(headwordShown("headword: 'frontend and backend'", 'frontend versus backend'));
  assert.ok(!headwordShown("headword: 'frontend'", 'frontend vs backend'));
  const paired = fixture('good').replace('term: webhook\n', 'term: frontend vs backend\n').replace('concept: webhook\n', 'concept: frontend vs backend\n');
  const hw = (src: string) => (lintStoryboard({ storyboard: paired, frameSource: new Map([[5, src]]) }).violations as Violation[]).filter((v) => v.rule === 'headword_term');
  assert.deepEqual(hw("headword: 'frontend / backend'"), []);
  assert.equal(hw("headword: 'frontend'").length, 1);
});
