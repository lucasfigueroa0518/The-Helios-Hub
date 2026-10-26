import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  briefGapLine,
  briefOpenerLine,
  BEAT_SHEET,
  LIMIT_CUE_RE,
  OPENER_TEMPLATES,
  openerKind,
  TOTAL_RANGE,
  parseShots,
  shotWindows,
  stem,
  subjectSpoken,
  CLOSER_SHOTS,
  countWords,
  CRITTER_CM,
  stripComments,
  entitySizeProblems,
  eventsFromDir,
  GLASS_FRAMES,
  GROUNDS,
  groundProblem,
  lookLineProblems,
  MAX_EXAGGERATE,
  parseSize,
  RETIRED_GROUNDS,
  jargonCandidates,
  lintStoryboard,
  parseScript,
  quotedSpans,
  section,
  anchorEntities,
  castCritters,
  FRAME7_ANCHORS,
  MAX_SHOT_CRITTERS,
  OVERSTATE_RE,
  sceneShotProblems,
  TECHNIQUE_IDS,
  TRIP_RE,
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
  // Beat 2 asks about the real thing, in its own picture (EX3-115).
  assert.deepEqual(BEAT_SHEET.map((b) => b.anchor), ['scene', 'own', 'own', 'scene', 'scene', 'own', 'own', null]);
  // The hold after each line is pace.mjs's HOLD, 0.15s (EX3-79); the close is voiceless, 2.5s, no hold (EX3-95).
  assert.deepEqual(BEAT_SHEET.map((b) => b.hold), [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, null]);
  assert.equal(BEAT_SHEET[7].seconds, 2.5);
  assert.equal(BEAT_SHEET[7].words, null);
  assert.deepEqual(BEAT_SHEET.map((b) => b.shots), [1, 2, 0, 2, 2, 2, 1, 0]);
  assert.deepEqual(BEAT_SHEET.map((b) => b.type), [
    'hook', 'pain_point', 'product_intro', 'feature_showcase', 'feature_showcase', 'social_proof', 'benefit_highlight', 'branding',
  ]);
});

test('the opener templates are the register verbatim, in the director and story-design (EX3-11, EX3-96, EX3-130)', () => {
  assert.deepEqual(OPENER_TEMPLATES, {
    ai: 'In the next minute, this ___ will teach you an AI concept.',
    tech: 'In the next minute, this ___ will teach you a tech concept.',
  });
  const register = fs.readFileSync(path.join(process.cwd(), 'planning', 'Explainer Reels', 'DECISIONS.md'), 'utf8');
  const block = /### Opener line template\n\n```\n([\s\S]+?)\n```/.exec(register)?.[1] ?? '';
  for (const line of Object.values(OPENER_TEMPLATES)) assert.ok(block.split('\n').includes(line), `the register's opener block lacks "${line}"`);
  for (const file of [['director', 'SKILL.md'], ['skill-overrides', 'faceless-explainer', 'references', 'story-design.md']]) {
    const text = fs.readFileSync(path.join(process.cwd(), 'explainers', ...file), 'utf8');
    for (const line of Object.values(OPENER_TEMPLATES)) assert.ok(text.includes(line), `${file.join('/')} lacks "${line}"`);
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
  const content = ['voiceover_words', 'visual_missing', 'anchor_scene', 'hook', 'curiosity_gap', 'term', 'concept', 'ground', 'attention_reset', 'definition', 'shots', 'example_steps', 'opener_line', 'gap_question', 'shot_cue', 'technique', 'term_part'];
  const structural = (violations as Violation[]).filter((v) => !content.includes(v.rule));
  assert.deepEqual(structural, []);
});

test('a storyboard that breaks the plan reports each rule', () => {
  const { violations } = lintStoryboard({ storyboard: fixture('bad') });
  assert.deepEqual(rules(violations as Violation[]), [
    'anchor@2', // beat 2 shows the real thing in its own picture (EX3-115)
    'anchor_scene@-', // no hook
    'anchor_scene@-', // no steps
    'anchor_scene@-', // a hand is an entity (EX3-77)
    'anchor_scene@-', // no hero (EX3-110)
    'anchor_scene@-', // no set (frame.md § The set)
    'anchor_scene@-', // no beyond (EX4-151)
    'attention_reset@2',
    'beat_type@2',
    'blueprint@3',
    'curiosity_gap@-',
    'definition@3', // no definition
    'definition@3', // no part of speech
    'emoji@3',
    'engagement_technique@1',
    'entity_size@-', // neither entity has its real size (hx-4)
    'exclamation_mark@1',
    'first_transition@1',
    'frame_count@-',
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
    'technique@2', // the tech beats name their technique (EX4-154)
    'technique@3',
    'term@-',
    'term_part@3', // the definition's part of the analogy (EX4-152)
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
  // Frame 2 is too short in the script; frames 3–7 have no script line at all; the close has no voice.
  assert.deepEqual(words, [2, 3, 4, 5, 6, 7]);
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
  // Both variants pass without a brief.
  assert.deepEqual(opener('In the next minute, this mailbox will teach you an AI concept.'), []);
  assert.deepEqual(opener('In the next minute, this mailbox will teach you a tech concept.'), []);
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

test('3.1–3.9 writing rules: no scene restart, the gap story, the dictionary card, the term, shots, the close', () => {
  const good = fixture('good');
  const swap = (from: string, to: string) => {
    assert.ok(good.includes(from), from);
    return good.replace(from, to);
  };
  const flagged = (storyboard: string) => rules(lintStoryboard({ storyboard }).violations as Violation[]);
  assert.deepEqual(flagged(swap("- voiceover: \"Here's the trick: a flag on the mailbox.", '- voiceover: "Picture a mailbox with a flag.')), ['scene_setting@4']);
  // Beat 2 (EX3-115, EX3-116): about the real technology, ending on the viewer's own question, with
  // no toss after it; no label, no "same spot".
  const gap = (line: string) => flagged(good.replace(/- voiceover: "A store takes your card[^\n]*\n- gap_question: [^\n]*\n/, `- voiceover: "${line}"\n`)).filter((r) => /^gap_/.test(r));
  assert.deepEqual(gap("A store takes your card and your phone buzzes. An app waiting on a store is in the same spot. So how does the app know? That's a webhook."), ['gap_same_spot@2', 'gap_term@2', 'gap_toss@2']);
  // Never the analogy's world (EX3-120: gap_scene replaces the gap_real word list).
  assert.deepEqual(gap('The mailbox sits at the end of a long drive. So how would you know the moment a letter lands?'), ['gap_scene@2']);
  assert.deepEqual(gap('Your bank texts you before the receipt even prints. So how does it hear about the sale that fast?').filter((r) => r !== 'gap_closed@7'), [], 'no fixed tech word is required any more');
  assert.deepEqual(gap('A store takes your card and your phone buzzes. Nobody refreshed anything.'), ['gap_question@2']);
  assert.deepEqual(gap('A store takes your card and your phone buzzes. So how does the app know the moment it happens? Stick around.'), ['gap_toss@2']);
  assert.deepEqual(gap('Your phone buzzes the second a store takes your card. Stick around: how does the app know the moment it happens?'), ['gap_toss@2']);
  // "Critter" is never said, in any frame (EX3-121).
  const critter = good.replace(/- voiceover: "A store takes your card[^\n]*\n- gap_question: [^\n]*\n/, '- voiceover: "A critter\'s phone buzzes the second a store takes the card. So how does the app know the moment it happens?"\n');
  assert.deepEqual(flagged(critter).filter((r) => /critter/.test(r)), ['said_critter@2']);
  assert.deepEqual(flagged(swap("- voiceover: \"Here's the trick: a flag on the mailbox.", '- voiceover: "Here\'s the trick: the critter raises a flag on the mailbox.')).filter((r) => /critter/.test(r)), ['said_critter@4']);
  // Gaps about the real thing, the way story-design.md writes them, pass.
  for (const line of [
    'You type half a word and your phone already guesses the rest. It is right most of the time. So how does it know what you meant to say?',
    'You paste a long report into a chatbot and ask one question. It answers from one page in seconds. How did it find that one page?',
  ]) {
    assert.deepEqual(gap(line).filter((r) => /^gap_(term|same_spot|question|scene|toss)/.test(r)), [], line);
  }
  // Frame 2 is BRIEF.md's picked gap, word for word (EX3-120).
  const brief = (line: string) => `# Brief\n\n## Curiosity gap\n\nSay this line in frame 2, word for word:\n\n> ${line}\n\n- gap_question: x\n\n## Notes\n`;
  const picked = 'A store takes your card, and a second later your phone buzzes with the payment. Nobody refreshed anything. So how does the app know the moment it happens?';
  assert.equal(briefGapLine(brief(picked)), picked);
  assert.equal(briefGapLine('# Brief\n\n## Analogy\n\nx\n'), null);
  assert.deepEqual(rules(lintStoryboard({ storyboard: good, brief: brief(picked) }).violations as Violation[]), []);
  assert.deepEqual(rules(lintStoryboard({ storyboard: good, brief: brief('Something else entirely. Why?') }).violations as Violation[]), ['gap_pick@2']);
  assert.deepEqual(flagged(swap('- engagement: Brand close\n', '- engagement: Brand close\n- voiceover: "Apps that tell you."\n')), ['close_voiceover@8']);
  assert.deepEqual(flagged(swap('insert — the empty post where the mailbox stood — on "mailbox"', 'ots — past the carrier to the mailbox — on "mailbox"')), ['shot_kind@5']);
  assert.deepEqual(flagged(swap('close — the phone buzzing — on "phone"', 'close — the critter at the window — on "phone"')), ['shot_subject@2']);
  assert.deepEqual(flagged(swap('- part_of_speech: noun\n', '')), ['definition@3']);
  assert.deepEqual(flagged(swap('- definition: "A webhook is a message one app sends', '- definition: "A webhook is a note one app sends')), ['definition@3']);
  assert.deepEqual(flagged(swap('- closed_by: frame 7, when the voice says the store sends the app a message\n', '')), ['curiosity_gap@-']);
  assert.deepEqual(flagged(swap('- hold: 0.15s', '- hold: 0.6s')), ['hold@1']);
  assert.deepEqual(flagged(swap('term: webhook\n', 'term: event stream\n')), ['concept@-', 'definition_term@3']);
  assert.deepEqual(flagged(swap('## Hook\n', '## Hooks\n')), ['hook@-']);
  assert.deepEqual(flagged(swap('- shots: close — the phone buzzing — on "phone"; close — the payment message — on "payment"', '- shots: close — the phone buzzing')), ['shots@2']);
  assert.deepEqual(flagged(swap('- example_steps: order 4821 ships → store sends message → message lands → order screen updates', '- example_steps: payment → done')), ['example_steps@6', 'example_steps_match@6']);
  assert.deepEqual(flagged(swap('  - carrier — a mail carrier critter — stands for', '  - carrier — a mail carrier man — stands for')), ['anchor_scene@-']);
  assert.deepEqual(flagged(swap('- transition_in: cut\n- status: outline\n- src: compositions/frames/04', '- transition_in: zoom-through\n- status: outline\n- src: compositions/frames/04')), ['transition_kind@4']);
});

test('3.9 beats (EX3-128): frame 5 names a limit, frame 7 closes the gap, closed_by points at frame 7', () => {
  const good = fixture('good');
  const swap = (from: string, to: string) => {
    assert.ok(good.includes(from), from);
    return good.replace(from, to);
  };
  const lint = (storyboard: string) => lintStoryboard({ storyboard }).violations as Violation[];
  // beat5_limit: no limit or trade-off sentence in frame 5 is a warning.
  const noLimit = lint(swap(' But if the mailbox is gone, the letter has nowhere to land."', ' The mailbox tells you at once."'));
  assert.deepEqual(rules(noLimit), ['beat5_limit@5']);
  assert.equal(noLimit[0].severity, 'warning');
  for (const said of ['but it fails', 'except when it rains', 'only while it is there', 'unless you move', 'however, it can be missed', "it can't hold two", "it won't wait", 'the trade-off is noise', 'here it breaks', 'its limit is one letter', 'the downside is cost']) {
    assert.ok(LIMIT_CUE_RE.test(said), said);
  }
  assert.ok(!LIMIT_CUE_RE.test('The flag goes up because the letter raises it.'));
  // gap_closed: frame 7 (the payoff), a warning on its key words; frame 4 no longer answers it.
  const missed = lint(swap('- voiceover: "Your app knows the moment it happens because the store sends it a message as the payment clears.', '- voiceover: "The store sends a message as the payment clears.'));
  assert.deepEqual(rules(missed), ['gap_closed@7']);
  assert.equal(missed[0].severity, 'warning');
  assert.deepEqual(rules(lint(swap(' When it drops in, the flag snaps up on its own."', ' When it drops in, the flag snaps up and the carrier leaves."'))), [], 'frame 4 builds toward the answer; it is not checked for it');
  // closed_by names frame 7.
  const closed = lint(swap('- closed_by: frame 7, when', '- closed_by: frame 4, when'));
  assert.deepEqual(rules(closed), ['curiosity_gap@-']);
  assert.match(closed[0].detail, /not frame 7/);
  // No transition opener ("In everyday life…") is required on frame 7 any more.
  assert.deepEqual(rules(lint(swap('- voiceover: "Your app knows', '- voiceover: "So your app knows'))), []);
});

test('the example walks the same steps as the anchor scene (EX3-129)', () => {
  const good = fixture('good');
  const steps = (to: string) =>
    (lintStoryboard({ storyboard: good.replace('- example_steps: order 4821 ships → store sends message → message lands → order screen updates', `- example_steps: ${to}`) }).violations as Violation[]);
  const three = steps('order 4821 ships → store sends message → order screen updates');
  assert.deepEqual(rules(three), ['example_steps_match@6']);
  assert.equal(three[0].severity, 'error');
  assert.match(three[0].detail, /3 example steps for the anchor scene's 4 steps/);
  assert.deepEqual(rules(steps('order ships → store sends → message lands → screen updates → done')), ['example_steps_match@6']);
  assert.deepEqual(steps('order ships → store sends → message lands → screen updates'), []);
  // An anchor scene with 3 steps takes 3 example steps.
  const threeSteps = good.replace('  - the letter drops in — payload delivered\n', '');
  assert.deepEqual(rules(lintStoryboard({ storyboard: threeSteps }).violations as Violation[]), ['example_steps_match@6']);
});

test('orange is counted on the anchor block only (EX3-107, EX3-132)', () => {
  const good = fixture('good');
  // A frame's own orange critter (frame 7's scene line) is not the anchor's count.
  const frameOrange = good.replace('- scene: A glass phone lights', '- scene: A shopper critter, look: orange, outfit a rain jacket, holds a glass phone that lights');
  assert.deepEqual((lintStoryboard({ storyboard: frameOrange }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene'), []);
  // A second orange critter in the anchor block is.
  const twoOrange = good.replace(/  - letter — [^\n]*\n/, '  - clerk — a store clerk critter — stands for the store — a critter at a till, look: orange, outfit a teal shop apron over a white tee, a name tag — beats 4\n');
  const found = (lintStoryboard({ storyboard: twoOrange }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene');
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /2 orange critters; the hero .* frames 1, 4, 5 and a frame-7 callback/);
});

test('grounds are paper, stage, and white for the close; night and forest are retired (hx-4)', () => {
  assert.deepEqual(GROUNDS, ['paper', 'stage', 'white']);
  assert.deepEqual(RETIRED_GROUNDS, { night: 'stage', forest: 'stage' });
  assert.deepEqual(GLASS_FRAMES, [2, 3, 6]);
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
  // The stage is a ground of the analogy's world.
  assert.deepEqual(ground(4, 'stage'), []);
  assert.deepEqual(ground(7, 'stage'), []);
  // The real-tech frames are glass on paper: another ground there is a warning.
  for (const n of GLASS_FRAMES) assert.deepEqual(ground(n, 'stage').map((x) => `${x.frame}:${x.severity}`), [`${n}:warning`]);
  // The anchor block's ground: paper or stage.
  const anchorGround = (to: string) => (lintStoryboard({ storyboard: good.replace('- ground: paper\n- hook:', `- ground: ${to}\n- hook:`) }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene');
  assert.deepEqual(anchorGround('stage'), []);
  assert.match(anchorGround('forest')[0].detail, /retired in 4\.0/);
  assert.match(anchorGround('white')[0].detail, /the close's/);
});

test('every anchor entity has its real size in cm; exaggeration is capped at 1.5× (hx-4)', () => {
  assert.equal(MAX_EXAGGERATE, 1.5);
  assert.equal(CRITTER_CM, 72);
  assert.deepEqual(parseSize('a fridge — size: 70 × 70 × 180 cm — beats 4'), { dims: [70, 70, 180], unit: 'cm', exaggerate: null });
  assert.deepEqual(parseSize('size: 26cm (exaggerate 1.2×)'), { dims: [26], unit: 'cm', exaggerate: 1.2 });
  assert.equal(parseSize('a fridge — beats 4'), null);
  const good = fixture('good');
  const sizes = (from: string, to: string) => {
    assert.ok(good.includes(from), from);
    return (lintStoryboard({ storyboard: good.replace(from, to) }).violations as Violation[]).filter((v) => v.rule === 'entity_size');
  };
  assert.deepEqual(sizes('size: 20 cm', 'size: 20 cm'), []);
  // Missing on an object: an error naming it. A critter is the ruler and needs none.
  const missing = sizes(' — size: 20 cm', '');
  assert.deepEqual(missing.map((v) => v.severity), ['error']);
  assert.match(missing[0].detail, /1 entity has no real size \(flag\): give each "size: <n> cm"/);
  assert.equal(good.split('\n').find((l) => l.includes('carrier — '))?.includes('size:'), false, 'the critter line has no size');
  assert.match(sizes('size: 20 cm', 'size: 0.2 m')[0].detail, /write its size in cm/);
  assert.match(sizes('size: 20 cm', 'size: big')[0].detail, /not a number/);
  assert.match(sizes('(exaggerate 1.3×)', '(exaggerate 3×)')[0].detail, /exaggerated 3×: at most 1\.5×/);
  assert.deepEqual(entitySizeProblems(null), []);
});

test("a critter's look is its body and an outfit drawn for its role; stock wear only on an exact match (hx-4, EX3-103)", () => {
  assert.deepEqual(lookLineProblems('a nurse critter, look: ink, outfit teal scrubs with a V-neck, a stethoscope, an ID badge — beats 4'), []);
  assert.deepEqual(lookLineProblems('a diner critter, look: paper, outfit none — beats 4'), []);
  assert.deepEqual(lookLineProblems('a chef critter, look: paper, outfit a white chef coat, wear chef-hat (exact: a chef\'s toque is the chef\'s own) — beats 4'), []);
  assert.deepEqual(lookLineProblems('look: ink, wear none'), []);
  assert.deepEqual(lookLineProblems('a nurse critter — beats 4'), [], 'no look line: the anchor check reports it');
  const one = (line: string) => {
    const found = lookLineProblems(line);
    assert.equal(found.length, 1, `${line}: ${found.join(' | ')}`);
    return found[0];
  };
  // The triage nurse in a baseball cap: stock wear with no exact reason.
  assert.match(one('a nurse critter, look: orange, wear cap — beats 4'), /"wear cap" is the stock list, used only on an exact match/);
  assert.match(one('a nurse critter, look: ink — beats 4'), /has no outfit/);
  assert.match(one('a nurse critter, look: ink, outfit — beats 4'), /outfit is empty/);
  assert.match(one('a guard critter, look: ink, outfit an orange vest — beats 4'), /never an outfit color/);
  assert.match(one('a surgeon critter, look: paper, outfit green scrubs, a surgical mask — beats 4'), /"mask" covers a critter's eyes or mouth/);
  assert.match(one('a skier critter, look: paper, outfit a puffer jacket, a scarf over the mouth — beats 4'), /covers a critter's eyes or mouth/);
  assert.deepEqual(lookLineProblems('a student critter, look: paper, outfit a lilac hoodie, glasses, a scarf — beats 4'), [], 'a hoodie, glasses and a scarf at the neck are fine');
  // In the storyboard: an anchor_scene error.
  const LINE = "look: orange, outfit a mail carrier's uniform: blue shirt and shorts, a mailbag across the body, a name badge";
  const found = (lintStoryboard({ storyboard: fixture('good').replace(LINE, 'look: orange, wear backpack') }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene');
  assert.deepEqual(found.map((v) => v.severity), ['error']);
  assert.match(found[0].detail, /"wear backpack" is the stock list/);
  // A frame's own critter line is not the anchor block's.
  const frameLine = fixture('good').replace('- scene: A glass phone lights', '- scene: A shopper critter, look: paper, wear cap, holds a glass phone that lights');
  assert.deepEqual((lintStoryboard({ storyboard: frameLine }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene'), []);
});

test('the place reads first: a set, beat 5 opens on a medium, closer shots are punctuation (frame.md § The set, § Shots)', () => {
  const good = fixture('good');
  const swap = (from: string, to: string) => {
    assert.ok(good.includes(from), from);
    return lintStoryboard({ storyboard: good.replace(from, to) }).violations as Violation[];
  };
  // The anchor block names its set.
  const noSet = swap(good.split('\n').find((l) => l.startsWith('- set: '))! + '\n', '');
  assert.deepEqual(rules(noSet), ['anchor_scene@-']);
  assert.match(noSet[0].detail, /no set/);
  // Beat 5 opens on a medium that shows the place.
  const FIVE = '- shots: medium — the letter pushing the flag up — on "flag"';
  const five = lintStoryboard({ storyboard: good.replace(FIVE, '- shots: insert — the letter pushing the flag up — on "flag"').replace('; insert — the empty post', '; medium — the empty post') }).violations as Violation[];
  assert.deepEqual(five.map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['shots@5:warning']);
  assert.match(five[0].detail, /beat 5 opens on a insert shot; open on a medium/);
  // Most of the analogy is wide or medium.
  assert.deepEqual(CLOSER_SHOTS, ['close', 'insert', 'reaction']);
  const closer = swap('medium — the carrier and the letter — on "carrier"', 'close — the carrier and the letter — on "carrier"');
  assert.deepEqual(closer.map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['shots@4:warning']);
  assert.match(closer[0].detail, /2 of 3 shots are close, insert or reaction/);
  // A frame opens on a new picture: the same kind on the same subject is flagged, the same kind alone is not.
  const same = swap(FIVE, '- shots: close — the flag — on "flag" — cast: flag — angle: low beside the post; medium — the letter');
  assert.ok(same.some((v) => v.rule === 'shots' && v.frame === 5 && /opens on the close shot of "the flag" that frame 4 ended on/.test(v.detail)), JSON.stringify(same));
  const FOUR = good.split('\n').find((l) => l.startsWith('- shots: wide — the drive and the mailbox'))!;
  const [w, m, c] = FOUR.replace('- shots: ', '').split('; ');
  const kindOnly = swap(FOUR, `- shots: ${w}; ${c}; ${m}`);
  assert.ok(!kindOnly.some((v) => /that frame 4 ended on/.test(v.detail)), 'frame 4 ends on a medium of the carrier, frame 5 opens on a medium of the letter: a new picture');
});

test('4.1 shots: each scene shot names its cast (at most 3 critters, a crowd is one) and its angle; no jump cuts (EX4-146, EX4-148)', () => {
  const parsed = parseShots('medium — the carrier and the letter — on "carrier" — cast: carrier, letter and mailbox — angle: low from the drive, left of the wide; insert — the empty post — cast: none — angle: high above it');
  assert.deepEqual(parsed.map((x) => [x.kind, x.subject, x.cue, x.cast, x.angle]), [
    ['medium', 'the carrier and the letter', 'carrier', ['carrier', 'letter', 'mailbox'], 'low from the drive, left of the wide'],
    ['insert', 'the empty post', null, [], 'high above it'],
  ]);
  // A shot line without the 4.1 fields parses as before (Real Case reuses parseShots).
  assert.deepEqual(parseShots('close — the screen — on "screen"').map((x) => [x.subject, x.cast, x.angle]), [['the screen', null, null]]);
  assert.equal(MAX_SHOT_CRITTERS, 3);
  const block = '## Anchor scene\n\n- entities:\n  - a — a cook critter — stands for x — look: orange, outfit y\n  - b — a clerk critter — stands for y — look: ink, outfit z\n  - c — a guard critter — stands for z — look: paper, outfit w\n  - d — a porter critter — stands for w — look: ink, outfit v\n  - crowd — a crowd of shoppers, critters all doing one thing — stands for v\n  - box — a box — stands for u\n';
  const ents = anchorEntities(block.replace('## Anchor scene\n\n', ''));
  assert.deepEqual([...ents.keys()], ['a', 'b', 'c', 'd', 'crowd', 'box']);
  assert.deepEqual(castCritters(['a', 'crowd', 'box', 'b'], ents), ['a', 'crowd', 'b'], 'a crowd counts once; an object not at all');
  const problems = (line: string) => sceneShotProblems(parseShots(line), ents).map(([sev, rule]: string[]) => `${rule}:${sev}`);
  assert.deepEqual(problems('medium — a — cast: a, crowd, box — angle: low left'), []);
  assert.deepEqual(problems('medium — a — cast: a, b, c, d — angle: low left'), ['shot_cast:error']);
  assert.deepEqual(problems('medium — a — angle: low left'), ['shot_cast:error']);
  assert.deepEqual(problems('medium — a — cast: a'), ['shot_angle:error']);
  // The same subject from the same angle is a jump cut, whatever the kind; a new angle or subject is a cut.
  assert.deepEqual(problems('medium — the cook — cast: a — angle: eye level, front; close — the cook — cast: a — angle: Eye level, front'), ['shot_jump:error']);
  assert.deepEqual(problems('medium — the cook — cast: a — angle: eye level, front; close — the cook — cast: a — angle: low from the right side'), []);
  assert.deepEqual(problems('medium — the cook — cast: a — angle: eye level, front; close — the box — cast: box — angle: eye level, front'), []);

  // In the storyboard: the scene frames (1, 4, 5, and 7 with anchor: scene) need both.
  const good = fixture('good');
  const flagged = (storyboard: string) => rules(lintStoryboard({ storyboard }).violations as Violation[]);
  assert.deepEqual(flagged(good.replace(' — cast: carrier, mailbox, letter — angle: low at the drive\'s edge, the mailbox ahead and the house behind', '')), ['shot_angle@1', 'shot_cast@1']);
  assert.deepEqual(flagged(good.replace('— cast: flag, mailbox — angle: from the mailbox\'s side, level with the flag', '— cast: flag, mailbox — angle: low from the drive, 40 degrees left of the wide').replace('close — the flag — on "flag"', 'close — the carrier and the letter — on "flag"')), ['shot_jump@4', 'shot_subject@4']);
  // Tech frames' crop shots need neither.
  assert.ok(!flagged(good).some((r) => /^shot_(cast|angle)@[2367]/.test(r)));
});

test('4.1 frame 7 is glass (anchor: own, with a technique) or a callback (anchor: scene, with cast and angle) (EX4-153)', () => {
  assert.deepEqual(FRAME7_ANCHORS, ['own', 'scene']);
  const good = fixture('good');
  const flagged = (storyboard: string) => rules(lintStoryboard({ storyboard }).violations as Violation[]);
  const SEVEN = good.slice(good.indexOf('## Frame 7'));
  const seven = (from: string, to: string) => {
    assert.ok(SEVEN.includes(from), from);
    return good.replace(SEVEN, SEVEN.replace(from, to));
  };
  const tech = SEVEN.split('\n').find((l) => l.startsWith('- technique: '))! + '\n';
  assert.deepEqual(flagged(seven(tech, '')), ['technique@7']);
  assert.deepEqual(flagged(seven('- anchor: own', '- anchor: hybrid')), ['anchor@7']);
  // A callback needs no technique, but its shots carry their cast and angle.
  const callback = seven('- anchor: own\n' + tech, '- anchor: scene\n');
  assert.deepEqual(flagged(callback), ['shot_angle@7', 'shot_angle@7', 'shot_cast@7', 'shot_cast@7']);
  const shots = SEVEN.split('\n').find((l) => l.startsWith('- shots: '))!;
  const placed = callback.replace(shots, '- shots: medium — the store\'s letter landing in the mailbox — at 0s — cast: carrier, flag, mailbox — angle: low from the street; close — the flag — on "flag" — cast: flag, mailbox — angle: beside the post, level with the flag');
  assert.deepEqual(flagged(placed), []);
});

test('4.1 the tech beats name their technique; the definition names its part and overstates nothing (EX4-152, EX4-154)', async () => {
  await import('../explainers/world-kit/try.mjs'); // the kit's CDN stub, as the kit tests load it
  const kit = await import('../explainers/world-kit/explain.js');
  assert.deepEqual(TECHNIQUE_IDS, [...kit.TECHNIQUE_IDS], 'the lint knows the kit\'s techniques');
  const good = fixture('good');
  const swap = (from: string, to: string) => {
    assert.ok(good.includes(from), from);
    return lintStoryboard({ storyboard: good.replace(from, to) }).violations as Violation[];
  };
  const TECH2 = good.split('\n').find((l) => l.startsWith('- technique: process — the payment message'))!;
  assert.deepEqual(rules(swap(TECH2, '- technique: cards — a card per step')), ['technique@2']);
  assert.match(swap(TECH2, '- technique: cards — a card per step')[0].detail, /not one of process, before-after/);
  assert.deepEqual(rules(swap(TECH2, '- technique: process')), ['technique@2']);
  assert.match(swap(TECH2, '- technique: process')[0].detail, /gives no reason/);
  assert.deepEqual(rules(swap(TECH2 + '\n', '')), ['technique@2']);
  // term_part: required; an unknown part is a warning.
  assert.deepEqual(rules(swap('- term_part: letter — the letter the carrier drops in\n', '')), ['term_part@3']);
  const unknown = swap('- term_part: letter — the letter', '- term_part: envelope — the envelope');
  assert.deepEqual(unknown.map((v) => `${v.rule}:${v.severity}`), ['term_part:warning']);
  // An absolute claim the mechanism does not guarantee: a warning.
  for (const word of ['always', 'never', 'every', 'the smallest', 'the fastest', 'the best']) assert.ok(OVERSTATE_RE.test(`it ${word} works`), word);
  assert.ok(!OVERSTATE_RE.test('A webhook is a message one app sends to another app.'));
  const DEF = 'A webhook is a message one app sends to another app\'s web address the moment an event happens, like a payment going through.';
  const OVER = 'A webhook is the fastest message one app sends to another app\'s web address the moment an event happens, like a payment going through.';
  const over = lintStoryboard({ storyboard: good.replaceAll(DEF, OVER) }).violations as Violation[];
  assert.deepEqual(over.map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['definition_overstated@3:warning']);
});

test('4.1 the place beyond, trips shown, and the named hero as the clear subject (EX4-146, EX4-151)', () => {
  const good = fixture('good');
  const lint = (storyboard: string) => lintStoryboard({ storyboard }).violations as Violation[];
  const BEYOND = good.split('\n').find((l) => l.startsWith('- beyond: '))!;
  const noBeyond = lint(good.replace(BEYOND + '\n', ''));
  assert.deepEqual(rules(noBeyond), ['anchor_scene@-']);
  assert.match(noBeyond[0].detail, /no beyond/);
  // A trip the voice describes, shown nowhere: a warning naming it.
  assert.equal(TRIP_RE.exec('Then the carrier heads back to the depot.')?.[1], 'depot');
  assert.equal(TRIP_RE.exec('nobody walks out to check'), null);
  const LINE4 = "When it drops in, the flag snaps up on its own.";
  const TRIP = 'Then the carrier heads back to the depot, and the flag snaps up.';
  const trip = lint(good.replace(LINE4, TRIP));
  assert.deepEqual(trip.map((v) => `${v.rule}@${v.frame}:${v.severity}`), ['trip_shown@4:warning']);
  assert.match(trip[0].detail, /show the trip/);
  // Shown when the beyond names it (seen or its own set), or a shot frames it.
  assert.deepEqual(lint(good.replace(LINE4, TRIP).replace(BEYOND, '- beyond: the post depot, its own set for the trip back')), []);
  // The voice first names the hero over a shot on something else: a warning.
  const hero = lint(good.replace('medium — the carrier and the letter — on "carrier"', 'medium — the letter in the bag — on "carrier"'));
  assert.ok(hero.some((v) => v.rule === 'hero_subject' && v.frame === 4 && v.severity === 'warning'), JSON.stringify(hero));
  // An object hero has no such check.
  const objectLed = good.replace('- hero: carrier — critter', '- hero: flag — object').replace('look: orange, outfit', 'look: ink, outfit');
  assert.ok(!lint(objectLed.replace('medium — the carrier and the letter — on "carrier"', 'medium — the letter in the bag — on "carrier"')).some((v) => v.rule === 'hero_subject'));
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
  const quoted = swap('Here\'s the trick: a flag on the mailbox.', 'Here\'s the trick: a "flag" on the mailbox. The flag is it.');
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

test("every critter's look is declared, and the hero is the one orange critter (EX3-107)", () => {
  const LINE = "a critter with a bag, look: orange, outfit a mail carrier's uniform: blue shirt and shorts, a mailbag across the body, a name badge";
  const anchor = (to: string) =>
    (lintStoryboard({ storyboard: fixture('good').replace(LINE, to) }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene').map((v) => v.detail);
  assert.deepEqual(anchor(LINE), []);
  assert.match(anchor('a critter with a bag')[0], /a critter has no look/);
  assert.match(anchor("a critter with a bag, look: ink, outfit a mail carrier's uniform")[0], /0 orange critters; the hero/);
});

test('the anchor block names its hero, critter or object; with an object hero no critter is orange (EX3-110, EX3-107)', () => {
  const anchor = (from: string, to: string) =>
    (lintStoryboard({ storyboard: fixture('good').replace(from, to) }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene').map((v) => v.detail);
  assert.match(anchor('- hero: carrier — critter\n', '')[0], /no hero/);
  // An object hero: the critter must not be orange.
  assert.match(anchor('- hero: carrier — critter', '- hero: flag — object')[0], /1 orange critter\(s\) with an object hero/);
  const objectLed = fixture('good').replace('- hero: carrier — critter', '- hero: flag — object').replace('look: orange, outfit', 'look: ink, outfit');
  assert.deepEqual((lintStoryboard({ storyboard: objectLed }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene'), []);
});

test('an actor outside the mapping may be one more entity; a paired term defines both sides (EX4-158, EX4-159)', () => {
  const good = fixture('good');
  const lint = (storyboard: string) => lintStoryboard({ storyboard }).violations as Violation[];
  // A fifth entity from the mapping is too many; an actor outside it is allowed, one only.
  const FIFTH = '  - porch — the porch steps — stands for the house — painted wooden steps — size: 120 × 90 × 50 cm — beats 4';
  const five = lint(good.replace('  - carrier — a mail carrier critter', `${FIFTH}\n  - carrier — a mail carrier critter`));
  assert.ok(five.some((v) => v.rule === 'anchor_scene' && /5 entities from the mapping; at most 4/.test(v.detail)), JSON.stringify(five));
  const actor = lint(good.replace('  - carrier — a mail carrier critter — stands for the other app sending the event', `${FIFTH}\n  - carrier — a mail carrier critter — stands for the actor: the other app that sends the event`));
  assert.ok(!actor.some((v) => v.rule === 'anchor_scene' && /entities from the mapping/.test(v.detail)), JSON.stringify(actor));
  // Paired terms: both sides in the definition, both parts in term_part.
  const DEF = "A webhook is a message one app sends to another app's web address the moment an event happens, like a payment going through.";
  const paired = good.replace('term: webhook\n', 'term: webhook vs polling\n').replace('concept: webhook\n', 'concept: webhook vs polling\n');
  const rulesOf = (sb: string) => rules(lint(sb)).filter((r) => /^(definition_term|term_part)/.test(r));
  assert.deepEqual(rulesOf(paired), ['definition_term@3', 'term_part@3']);
  const both = paired.replaceAll(DEF, "A webhook is a message one app sends the moment an event happens, while polling is an app asking again and again.").replace('- term_part: letter — the letter the carrier drops in', '- term_part: letter — the letter the carrier drops in; mailbox — the walk out to check the mailbox');
  assert.deepEqual(rulesOf(both), []);
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
    [5, "parts.push(el('text', {}, 'But if the mailbox is gone, the letter has nowhere to land.'));"],
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

test('try.mjs: grounds and their aliases, the scale ledger, and outfits clear of the face (hx-4)', async () => {
  const { resolveGround, sizeLedgerProblems, outfitProblems, castShapeProblems, elementBoxes, MAX_EXAGGERATE: TRY_MAX } = await import('../explainers/world-kit/try.mjs');
  const kit = await import('../explainers/world-kit/cast.js');
  // Grounds: night and forest are read as the stage.
  assert.equal(resolveGround('paper'), 'paper');
  assert.equal(resolveGround('night'), 'stage');
  assert.equal(resolveGround('Forest'), 'stage');
  assert.equal(resolveGround('blue'), null);
  // The ledger: an older kit (no space.js) checks only a ledger that is there.
  assert.equal(TRY_MAX, MAX_EXAGGERATE);
  assert.deepEqual(sizeLedgerProblems({ ENTITIES: { fridge: 'x' } }, null), []);
  const world = { ENTITIES: { fridge: 'the cache', nurse: 'the router' }, CAST: { nurse: { body: 'orange' } }, SIZES: { fridge: { w: 70, d: 70, h: 180 } } };
  assert.deepEqual(sizeLedgerProblems(world, null), []);
  assert.match(sizeLedgerProblems({ ...world, SIZES: {} }, null)[0], /no entry for the entity "fridge"/);
  assert.match(sizeLedgerProblems({ ...world, SIZES: { fridge: { w: 70, d: 70, h: 180, exaggerate: 2 } } }, null)[0], /exaggerate is 2: at most 1\.5×/);
  assert.match(sizeLedgerProblems({ ...world, SIZES: { fridge: { w: 70, h: 180 } } }, null)[0], /must be \{ w, d, h \}/);
  // With the hx-4 kit (space.js): SIZES and DRAWN are required, and scaleProblems runs.
  const calls: unknown[] = [];
  const space = { scaleProblems: (sizes: unknown, drawn: unknown) => (calls.push([sizes, drawn]), ['from space']) };
  assert.match(sizeLedgerProblems({ ENTITIES: {} }, space)[0], /must export SIZES/);
  const found = sizeLedgerProblems(world, space);
  assert.ok(found.some((e: string) => /must export DRAWN/.test(e)), found.join('\n'));
  assert.ok(found.includes('from space'));
  assert.deepEqual(sizeLedgerProblems({ ...world, DRAWN: { critterS: 1, fridge: 355 } }, space), ['from space']);
  assert.deepEqual(calls.at(-1), [world.SIZES, { critterS: 1, fridge: 355 }]);
  // The real space.js: a fridge drawn at its size next to a critter at scale 1 passes; at twice it fails.
  const realSpace = await import('../explainers/world-kit/space.js');
  const fridgePx = (180 / realSpace.CRITTER_CM) * realSpace.CRITTER_PX;
  assert.deepEqual(sizeLedgerProblems({ ...world, DRAWN: { critterS: 1, fridge: fridgePx } }, realSpace), []);
  assert.equal(sizeLedgerProblems({ ...world, DRAWN: { critterS: 1, fridge: fridgePx * 2 } }, realSpace).length, 1);
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
