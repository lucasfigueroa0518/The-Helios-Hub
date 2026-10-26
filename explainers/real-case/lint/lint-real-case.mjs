#!/usr/bin/env node
// lint-real-case.mjs — deterministic checks on a Real Case Reel's plan (planning/Real Case
// Reels/DECISIONS.md RC-12, RC-19). No model, no judgment: structure against the fixed eight-beat sheet,
// plus the facts rules a machine can check (every cited fact exists, every number in a voiceover is in
// a cited fact, no attribution phrasing). Reuses the Explainer lint's parsers and shot rules.
//
//   node lint-real-case.mjs --storyboard STORYBOARD.md [--script SCRIPT.md] [--brief BRIEF.md] [--out lint.json]
//
// Exit 0 when the files parse (violations are data); exit 2 on a usage or read error.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStoryboard } from '../../hyperframes-skills/faceless-explainer/scripts/lib/storyboard.mjs';
import {
  countWords,
  frameBlocks,
  GROUNDS,
  OPENER_RE,
  parseScript,
  parseShots,
  PERSON_RE,
  REMOVED_SHOTS,
  section,
  shotKinds,
  shotWindows,
  subjectSpoken,
  TOSS_RE,
  TRANSITIONS,
  unsayableProblems,
} from '../../lint/lint-storyboard.mjs';

/**
 * The fixed beat sheet (RC-12; RC-19 splits the incident: one line under the opener, the rest in the
 * puzzle). Order, `type`, nominal seconds, anchor, voiceover word range, longest hold, fewest shots.
 */
export const REAL_CASE_BEATS = [
  { beat: 'the incident', type: 'hook', seconds: 5, anchor: 'scene', words: [10, 16], hold: 0.2, shots: 1, claims: true },
  { beat: 'the puzzle', type: 'pain_point', seconds: 9, anchor: 'scene', words: [18, 30], hold: 0.2, shots: 2, claims: true },
  { beat: 'name it', type: 'product_intro', seconds: 5, anchor: 'own', words: [8, 16], hold: 0.2, shots: 0, claims: false },
  { beat: 'walk it', type: 'feature_showcase', seconds: 13, anchor: 'scene', words: [32, 44], hold: 0.2, shots: 3, claims: true },
  { beat: 'the click', type: 'feature_showcase', seconds: 8, anchor: 'scene', words: [18, 28], hold: 0.2, shots: 2, claims: true },
  { beat: 'the other side', type: 'social_proof', seconds: 8, anchor: 'scene', words: [18, 28], hold: 0.2, shots: 2, claims: true },
  { beat: 'the takeaway', type: 'benefit_highlight', seconds: 6, anchor: 'own', words: [12, 22], hold: 0.2, shots: 1, claims: true },
  { beat: 'close', type: 'branding', seconds: 2.5, anchor: null, words: null, hold: null, shots: 0, voiceless: true, claims: false },
];

export const TOTAL_RANGE = [50, 65];
export const TERM_MAX_WORDS = 4;
export const DEFINITION_MAX_WORDS = 16;
export const STEPS_RANGE = [3, 4];
export const MAX_ENTITIES = 4;
/** Shot subjects must be spoken in their window on these frames; a miss is an error on the first two. */
export const SUBJECT_FRAMES = [2, 4, 5, 6, 7];
export const SUBJECT_ERROR_FRAMES = [4, 5];

/** RC-05: the story is told straight. Attribution phrasing is never used. */
export const ATTRIBUTION_RE = /\b(according to|reportedly|reporters?|journalists?|sources? (?:say|said|says)|is said to|was said to|claims? that|claimed that|in a statement|told (?:reporters|the press)|per (?:the|a) (?:report|statement))\b/i;
/** A logo or brand mark in a scene or the anchor block (frame.md V-17 as narrowed for this format). */
export const LOGO_RE = /\b(logos?|brand marks?|wordmarks?|trademarks?)\b/i;

const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const seconds = (s) => {
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(s ?? ''));
  return m ? Number(m[1]) : NaN;
};

function violation(rule, frame, severity, detail) {
  return { source: 'storyboard', rule, frame, severity, detail };
}

/** A line's sentences, ends kept. */
export function sentencesOf(text) {
  return String(text ?? '').split(/(?<=[.?!]["')\]”’]*)\s+/).map((x) => x.trim()).filter(Boolean);
}

/** BRIEF.md's `## Facts`: `- c1: <text>` lines, as a Map id → text. */
export function parseFacts(brief) {
  const body = section(brief, 'Facts') ?? '';
  const facts = new Map();
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*-\s*(c\d+)\s*[:—–-]\s*(.+?)\s*$/i.exec(line);
    if (m) facts.set(m[1].toLowerCase(), m[2]);
  }
  return facts;
}

/** A frame's `claims:` ids (`c1, c3`), lowercased; [] for `none`; null when the field is absent. */
export function claimIds(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || /^<fill/i.test(text)) return null;
  if (/^none\b/i.test(text)) return [];
  return [...text.matchAll(/\bc\d+\b/gi)].map((m) => m[0].toLowerCase());
}

/** The numbers in a text, digits only ("$1,200" → "1200", "2.5" → "2.5"). */
export function numbersIn(text) {
  return [...String(text ?? '').matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '').replace(/\.$/, ''));
}

/**
 * Facts problems in one frame's voiceover (RC-05, story-design.md § The facts): cited ids that are not
 * facts, numbers no cited fact contains, attribution phrasing. Returns [severity, detail] pairs.
 */
export function factProblems(voice, ids, facts) {
  const out = [];
  if (ATTRIBUTION_RE.test(voice)) {
    out.push(['error', `attribution phrasing "${ATTRIBUTION_RE.exec(voice)[0]}": tell the story straight; a fact is stated as a fact (RC-05)`]);
  }
  if (!ids) return out;
  const unknown = ids.filter((id) => !facts.has(id));
  if (unknown.length) out.push(['error', `claims ${unknown.join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not in BRIEF.md's facts`]);
  const cited = ids.filter((id) => facts.has(id)).map((id) => facts.get(id)).join(' ');
  const allowed = new Set(numbersIn(cited));
  for (const n of new Set(numbersIn(voice))) {
    if (!allowed.has(n)) out.push(['error', `the number ${n} is in no fact this frame cites${ids.length ? ` (${ids.join(', ')})` : ''}: every number about the event comes from a fact, as it is written there`]);
  }
  return out;
}

/** The `## Anchor scene` block's problems (the story world). [severity, detail] pairs. */
function anchorProblems(block) {
  const out = [];
  if (!block) return [['error', 'no ## Anchor scene (the story world)']];
  const hero = /^\s*-\s*hero:\s*(.+)$/im.exec(block);
  if (!hero) out.push(['error', 'no hero: line (the key item, an object)']);
  else if (!/\bobject\b/i.test(hero[1])) out.push(['error', `hero "${hero[1].trim()}": the hero is the key item, an object (no critter is orange)`]);
  if (!/^\s*-\s*hook:\s*\S/im.test(block)) out.push(['error', 'no hook: line']);
  const lines = block.split(/\r?\n/);
  const items = (name) => {
    const start = lines.findIndex((l) => new RegExp(`^\\s*-\\s*${name}:`, 'i').test(l));
    if (start < 0) return null;
    const got = [];
    for (const line of lines.slice(start + 1)) {
      if (/^\s+-\s+\S/.test(line)) got.push(line.replace(/^\s+-\s+/, '').trim());
      else if (line.trim()) break;
    }
    return got;
  };
  const steps = items('steps');
  if (!steps) out.push(['error', 'no steps: (the concept\'s 3 or 4 steps, each "<name> — <what it was in this event>")']);
  else {
    if (steps.length < STEPS_RANGE[0] || steps.length > STEPS_RANGE[1]) out.push(['error', `${steps.length} steps; ${STEPS_RANGE[0]} or ${STEPS_RANGE[1]}`]);
    for (const step of steps) {
      const [name, inStory] = step.split(/\s+[—–]\s+|\s+--?\s+/);
      if (!inStory) out.push(['error', `step "${step}": write "<name> — <what it was in this event>"`]);
      else if (countWords(name) > 4) out.push(['warning', `step name "${name}" is ${countWords(name)} words; the tracker holds 4 or fewer`]);
    }
  }
  const entities = items('entities');
  if (!entities?.length) out.push(['error', 'no entities:']);
  else {
    if (entities.length > MAX_ENTITIES) out.push(['error', `${entities.length} entities; at most ${MAX_ENTITIES}`]);
    for (const e of entities) {
      if (/look:\s*orange/i.test(e)) out.push(['error', `"${e.split(' — ')[0]}" is an orange critter: no critter is orange; the key item carries the orange`]);
      if (PERSON_RE.test(e.replace(/\bcritters?\b/gi, ''))) out.push(['error', `"${e.split(' — ')[0]}" names a person or a body part (${PERSON_RE.exec(e)[0]}): whoever acts is a critter named by role`]);
    }
  }
  if (LOGO_RE.test(block)) out.push(['error', `the story world draws a ${LOGO_RE.exec(block)[0]}: never a logo or brand mark; an organization's name only as a plain label`]);
  return out;
}

function hookProblems(block) {
  if (!block) return [['error', 'no ## Hook']];
  const out = [];
  const candidates = block.split(/\r?\n/).filter((l) => /^\s*\d+\.\s+\S/.test(l));
  if (candidates.length < 3) out.push(['error', `${candidates.length} hook candidates; write three`]);
  if (!/^\s*-\s*pick:\s*\S/im.test(block)) out.push(['error', 'no hook pick']);
  return out;
}

function puzzleProblems(block, gapQuestion) {
  if (!block) return [['error', 'no ## Puzzle']];
  const out = [];
  const question = /^\s*-\s*question:\s*(.+)$/im.exec(block)?.[1]?.replace(/^["“]|["”]$/g, '').trim();
  if (!question) out.push(['error', 'no question: in ## Puzzle']);
  else if (gapQuestion && normalize(question) !== normalize(gapQuestion)) {
    out.push(['error', `## Puzzle's question "${question}" differs from frame 2's gap_question "${gapQuestion}"`]);
  }
  if (!/^\s*-\s*answer:\s*\S/im.test(block)) out.push(['error', 'no answer: in ## Puzzle (the click, one sentence)']);
  if (!/^\s*-\s*closed_by:\s*\S/im.test(block)) out.push(['warning', 'no closed_by: in ## Puzzle']);
  return out;
}

function shotsText(block) {
  const lines = String(block ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^-[ \t]*shots:/i.test(l));
  if (start < 0) return null;
  const items = [lines[start].replace(/^-[ \t]*shots:[ \t]*/i, '')];
  for (const line of lines.slice(start + 1)) {
    if (/^\s+-\s+\S/.test(line)) items.push(line.replace(/^\s+-\s+/, '').trim());
    else if (line.trim()) break;
  }
  return items.join('\n').trim();
}

/** The definition rule: "A/An <term> is…" or "<Term> is…". */
export function definitionStartsRight(definition, term) {
  const d = normalize(definition);
  const t = normalize(term);
  return Boolean(t) && (d.startsWith(`${t} is `) || d.startsWith(`${t} are `) || d.startsWith(`a ${t} is `) || d.startsWith(`an ${t} is `));
}

/**
 * @param {{ storyboard: string, script?: string | null, brief?: string | null }} input
 * @returns {{ violations: { source: string, rule: string, frame: number | null, severity: 'error' | 'warning', detail: string }[], frames: number }}
 */
export function lintRealCase({ storyboard, script = null, brief = null }) {
  const out = [];
  const { frames, globals } = parseStoryboard(storyboard);
  const scriptLines = script ? parseScript(script) : null;
  const facts = parseFacts(brief);
  const blocks = frameBlocks(storyboard);
  const voiceFor = (frame, i) => {
    const n = frame.number ?? i + 1;
    const fromScript = scriptLines?.get(n);
    return String(fromScript ?? frame.voiceover ?? '').replace(/^["“]|["”]$/g, '').trim();
  };

  const term = String(globals?.extra?.term ?? '').trim();
  const concept = String(globals?.extra?.concept ?? '').trim();
  if (!term || /^<fill/.test(term)) out.push(violation('term', null, 'error', 'no term: in the frontmatter (BRIEF.md\'s term)'));
  else if (countWords(term) > TERM_MAX_WORDS) out.push(violation('term', null, 'error', `term "${term}" is ${countWords(term)} words; at most ${TERM_MAX_WORDS}`));
  if (!concept || /^<fill/.test(concept)) out.push(violation('concept', null, 'error', 'no concept: in the frontmatter'));
  const music = String(globals?.extra?.music ?? '').trim().toLowerCase();
  if (music && music !== 'none') out.push(violation('music', null, 'warning', `music "${music}": the kit picks the bed (music: none)`));
  if (brief !== null && facts.size === 0) out.push(violation('facts', null, 'error', "BRIEF.md has no ## Facts (c1, c2…): nothing can be checked"));

  for (const [s, p] of anchorProblems(section(storyboard, 'Anchor scene'))) out.push(violation('anchor_scene', null, s, p));
  for (const [s, p] of hookProblems(section(storyboard, 'Hook'))) out.push(violation('hook', null, s, p));

  if (frames.length !== REAL_CASE_BEATS.length) out.push(violation('frame_count', null, 'error', `${frames.length} frames; the beat sheet has ${REAL_CASE_BEATS.length}`));
  const missing = frames.filter((f) => !Number.isFinite(f.durationSeconds));
  missing.forEach((f, i) => out.push(violation('duration_missing', f.number ?? i + 1, 'error', 'frame has no duration')));
  if (missing.length === 0 && frames.length) {
    const total = Math.round(frames.reduce((a, f) => a + f.durationSeconds, 0) * 1000) / 1000;
    if (total < TOTAL_RANGE[0] || total > TOTAL_RANGE[1]) out.push(violation('total_duration', null, 'warning', `${total}s total; usually ${TOTAL_RANGE[0]}–${TOTAL_RANGE[1]}s`));
  }

  const voices = new Map();
  let gapQuestion = '';
  frames.forEach((frame, i) => {
    const n = frame.number ?? i + 1;
    const sheet = REAL_CASE_BEATS[i];
    const extra = frame.extra ?? {};
    const field = (name) => String(extra[name] ?? '').trim();
    const voice = voiceFor(frame, i);
    if (!sheet?.voiceless) voices.set(n, voice);

    const kind = String(frame.transitionIn ?? '').trim().toLowerCase().split(/\s+/)[0];
    if (kind && !TRANSITIONS.includes(kind)) out.push(violation('transition_kind', n, 'error', `transition "${frame.transitionIn}"; only cut`));
    if (sheet && field('type') !== sheet.type) out.push(violation('beat_type', n, 'error', `type "${field('type') || 'missing'}"; beat ${i + 1} (${sheet.beat}) needs "${sheet.type}"`));
    if (!field('engagement')) out.push(violation('engagement_technique', n, 'error', 'no engagement (a named technique)'));
    if (field('sfx')) out.push(violation('sfx_retired', n, 'warning', "sfx: lines are retired; frame workers design each frame's sound events"));
    const ground = field('ground').toLowerCase();
    if (ground && !GROUNDS.includes(ground)) out.push(violation('ground', n, 'error', `ground "${ground}"; one of ${GROUNDS.join(', ')}`));
    if (/\b(person|people|humans?|man|woman|men|women|hands?|fingers?|faces?)\b/i.test(field('scene'))) {
      out.push(violation('person', n, 'error', `the scene names a person or a body part: whoever acts is a critter named by role`));
    }
    if (LOGO_RE.test(field('scene'))) out.push(violation('logo', n, 'error', `the scene draws a ${LOGO_RE.exec(field('scene'))[0]}: never a logo or brand mark`));

    if (sheet?.voiceless) {
      if (voice) out.push(violation('close_voice', n, 'error', 'the close has no voiceover'));
      return;
    }
    const hold = seconds(field('hold'));
    if (!Number.isFinite(hold)) out.push(violation('hold', n, 'error', 'no hold'));
    else if (sheet && hold > sheet.hold + 1e-9) out.push(violation('hold', n, 'error', `hold ${hold}s; at most ${sheet.hold}s`));

    // Words.
    const words = countWords(voice);
    if (!voice) out.push(violation('voiceover', n, 'error', 'no voiceover'));
    else if (sheet?.words && (words < sheet.words[0] || words > sheet.words[1])) {
      out.push(violation('word_range', n, 'error', `${words} words; beat ${i + 1} (${sheet.beat}) takes ${sheet.words[0]}–${sheet.words[1]}`));
    }
    if (voice.includes('!')) out.push(violation('exclamation', n, 'error', 'an exclamation mark: plain-spoken, no hype'));
    if (/\p{Extended_Pictographic}/u.test(voice)) out.push(violation('emoji', n, 'error', 'emoji in a voiceover'));
    if (TOSS_RE.test(voice)) out.push(violation('toss', n, 'error', `"${TOSS_RE.exec(voice)[0]}" tosses to the next beat`));

    // Facts (RC-05).
    if (sheet?.claims) {
      const ids = claimIds(extra.claims);
      if (ids === null) out.push(violation('claims', n, 'error', 'no claims: (the fact ids this frame uses, or none)'));
      for (const [s, p] of factProblems(voice, ids, facts)) out.push(violation(/attribution/.test(p) ? 'attribution' : 'claims', n, s, p));
    } else if (ATTRIBUTION_RE.test(voice)) {
      out.push(violation('attribution', n, 'error', `attribution phrasing "${ATTRIBUTION_RE.exec(voice)[0]}" (RC-05)`));
    }

    // Shots.
    if (sheet?.shots) {
      const text = shotsText(blocks.get(n));
      const kinds = shotKinds(text);
      const fewest = (frame.durationSeconds ?? sheet.seconds) > 6 ? Math.max(2, sheet.shots) : sheet.shots;
      if (!text) out.push(violation('shots', n, 'error', 'no shots:'));
      else if (kinds.length < fewest) out.push(violation('shots', n, 'error', `${kinds.length} shot(s); beat ${i + 1} cuts between at least ${fewest}`));
      if (n !== 4 && kinds.includes('wide')) out.push(violation('shots', n, 'warning', 'a wide shot outside beat 4; the establishing shot is used once'));
      if (n === 4 && kinds[0] !== 'wide') out.push(violation('shots', n, 'error', 'beat 4 opens on the wide establishing shot'));
      for (const k of new Set(kinds.filter((x) => REMOVED_SHOTS.has(x)))) out.push(violation('shot_kind', n, 'error', `a ${k} shot is not used (a shot is only a camera)`));
      if (SUBJECT_FRAMES.includes(n) && text && voice) {
        for (const { shot, window } of shotWindows(parseShots(text), voice)) {
          if (window === null) out.push(violation('shot_cue', n, 'warning', `the ${shot.kind} shot's cue "${shot.cue}" is not in the voiceover`));
          else if (!subjectSpoken(shot.subject, window)) {
            out.push(violation('shot_subject', n, SUBJECT_ERROR_FRAMES.includes(n) ? 'error' : 'warning', `the ${shot.kind} shot on "${shot.subject}" plays while the voice says "${window}": frame what the voice is naming`));
          }
        }
      }
    }

    // Beat jobs.
    if (n === 1 && OPENER_RE.test(voice)) out.push(violation('incident', 1, 'error', "frame 1 says the analogy format's opener template; it tells the event (RC-04)"));
    if (n === 2) {
      gapQuestion = field('gap_question').replace(/^["“]|["”]$/g, '');
      if (!gapQuestion) out.push(violation('puzzle', 2, 'error', 'no gap_question: (the question the line ends on)'));
      const last = sentencesOf(voice).pop() ?? '';
      if (!last.endsWith('?')) out.push(violation('puzzle', 2, 'error', 'frame 2 ends on its question'));
      else if (gapQuestion && normalize(last) !== normalize(gapQuestion)) out.push(violation('puzzle', 2, 'error', `frame 2 ends on "${last}", not its gap_question "${gapQuestion}"`));
      if (!field('reset')) out.push(violation('reset', 2, 'error', 'no reset: (the attention reset on the 1→2 cut)'));
      if (term && normalize(voice).includes(normalize(term))) out.push(violation('puzzle', 2, 'error', `frame 2 says the term "${term}"; frame 3 names it`));
    }
    if (n === 3) {
      const definition = field('definition').replace(/^["“]|["”]$/g, '');
      if (!definition) out.push(violation('definition', 3, 'error', 'no definition:'));
      else {
        if (normalize(definition) !== normalize(voice)) out.push(violation('definition', 3, 'error', "frame 3's voiceover is its definition, word for word"));
        if (countWords(definition) > DEFINITION_MAX_WORDS) out.push(violation('definition', 3, 'error', `the definition is ${countWords(definition)} words; at most ${DEFINITION_MAX_WORDS}`));
        if (term && !definitionStartsRight(definition, term)) out.push(violation('definition', 3, 'error', `the definition starts "A/An ${term} is…" or "${term} is…"`));
      }
      if (!field('part_of_speech')) out.push(violation('definition', 3, 'error', 'no part_of_speech:'));
    }
  });

  for (const [s, p] of puzzleProblems(section(storyboard, 'Puzzle'), gapQuestion)) out.push(violation('puzzle', null, s, p));
  for (const [n, severity, detail] of unsayableProblems(voices)) out.push(violation('unsayable', n, severity, detail));
  return { violations: out, frames: frames.length };
}

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const storyboardPath = flag('storyboard');
  if (!storyboardPath) {
    console.error('usage: lint-real-case.mjs --storyboard STORYBOARD.md [--script SCRIPT.md] [--brief BRIEF.md] [--out file]');
    process.exit(2);
  }
  try {
    const scriptPath = flag('script');
    const briefPath = flag('brief') ?? resolve(dirname(resolve(storyboardPath)), 'BRIEF.md');
    const result = lintRealCase({
      storyboard: readFileSync(resolve(storyboardPath), 'utf8'),
      script: scriptPath && existsSync(scriptPath) ? readFileSync(resolve(scriptPath), 'utf8') : null,
      brief: existsSync(resolve(briefPath)) ? readFileSync(resolve(briefPath), 'utf8') : null,
    });
    const json = `${JSON.stringify(result, null, 2)}\n`;
    const out = flag('out');
    if (out) writeFileSync(resolve(out), json);
    else process.stdout.write(json);
  } catch (error) {
    console.error(`✗ lint-real-case: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
