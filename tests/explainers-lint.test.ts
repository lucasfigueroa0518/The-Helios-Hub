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
  countWords,
  eventsFromDir,
  jargonCandidates,
  lintStoryboard,
  parseScript,
  quotedSpans,
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
  // Beat 2 asks about the real thing, in its own picture (EX3-115).
  assert.deepEqual(BEAT_SHEET.map((b) => b.anchor), ['scene', 'own', 'own', 'scene', 'scene', 'own', 'own', null]);
  // At most 0.2s after each line (EX3-79); the close is voiceless, 2.5s, no hold (EX3-95).
  assert.deepEqual(BEAT_SHEET.map((b) => b.hold), [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, null]);
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
  const content = ['voiceover_words', 'visual_missing', 'anchor_scene', 'hook', 'curiosity_gap', 'term', 'concept', 'ground', 'attention_reset', 'definition', 'shots', 'example_steps', 'opener_line', 'gap_question', 'shot_cue'];
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
  assert.deepEqual(flagged(swap('medium — the empty post where the mailbox stood — on "mailbox"', 'ots — past the carrier to the mailbox — on "mailbox"')), ['shot_kind@5']);
  assert.deepEqual(flagged(swap('close — the phone buzzing — on "phone"', 'close — the critter at the window — on "phone"')), ['shot_subject@2']);
  assert.deepEqual(flagged(swap('- part_of_speech: noun\n', '')), ['definition@3']);
  assert.deepEqual(flagged(swap('- definition: "A webhook is a message one app sends', '- definition: "A webhook is a note one app sends')), ['definition@3']);
  assert.deepEqual(flagged(swap('- closed_by: frame 7, when the voice says the store sends the app a message\n', '')), ['curiosity_gap@-']);
  assert.deepEqual(flagged(swap('- hold: 0.15s', '- hold: 0.6s')), ['hold@1']);
  assert.deepEqual(flagged(swap('term: webhook\n', 'term: event stream\n')), ['concept@-', 'definition_term@3']);
  assert.deepEqual(flagged(swap('## Hook\n', '## Hooks\n')), ['hook@-']);
  assert.deepEqual(flagged(swap('- shots: close — the phone buzzing — on "phone"; insert — the payment message — on "payment"', '- shots: close — the phone buzzing')), ['shots@2']);
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
  const frameOrange = good.replace('- scene: A paper phone on a counter lights', '- scene: A shopper critter, look: orange, wear cap, at a paper phone on a counter lights');
  assert.deepEqual((lintStoryboard({ storyboard: frameOrange }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene'), []);
  // A second orange critter in the anchor block is.
  const twoOrange = good.replace(/  - letter — [^\n]*\n/, '  - clerk — a store clerk critter — stands for the store — a critter at a till, look: orange, wear apron — beats 4\n');
  const found = (lintStoryboard({ storyboard: twoOrange }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene');
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /2 orange critters; the hero .* frames 1, 4, 5 and a frame-7 callback/);
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
  const LINE = 'a critter with a bag, look: orange, wear backpack';
  const anchor = (to: string) =>
    (lintStoryboard({ storyboard: fixture('good').replace(LINE, to) }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene').map((v) => v.detail);
  assert.deepEqual(anchor(LINE), []);
  assert.match(anchor('a critter with a bag')[0], /a critter has no look/);
  assert.match(anchor('a critter with a bag, look: ink, wear backpack')[0], /0 orange critters; the hero/);
});

test('the anchor block names its hero, critter or object; with an object hero no critter is orange (EX3-110, EX3-107)', () => {
  const anchor = (from: string, to: string) =>
    (lintStoryboard({ storyboard: fixture('good').replace(from, to) }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene').map((v) => v.detail);
  assert.match(anchor('- hero: carrier — critter\n', '')[0], /no hero/);
  // An object hero: the critter must not be orange.
  assert.match(anchor('- hero: carrier — critter', '- hero: flag — object')[0], /1 orange critter\(s\) with an object hero/);
  const objectLed = fixture('good').replace('- hero: carrier — critter', '- hero: flag — object').replace('look: orange, wear backpack', 'look: ink, wear backpack');
  assert.deepEqual((lintStoryboard({ storyboard: objectLed }).violations as Violation[]).filter((v) => v.rule === 'anchor_scene'), []);
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
