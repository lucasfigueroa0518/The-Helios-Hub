#!/usr/bin/env node
// lint-storyboard.mjs — deterministic checks on an Explainer Reel's plan (Explainers 3.3,
// planning/Explainer Reels/DECISIONS.md EX3-10 to EX3-24, EX3-60 to EX3-101). No model, no
// judgment: it reports structure against the fixed eight-beat sheet. Violations are recorded and
// the render continues (E-07, EX3-06).
//
//   node lint-storyboard.mjs --storyboard STORYBOARD.md [--script SCRIPT.md]
//                            [--frames-dir assets/frames] [--audio-meta audio_meta.json]
//                            [--events-track assets/sfx/events.wav] [--out lint.json]
//
// Exit 0 always when the files parse (violations are data, not failures);
// exit 2 on a usage or read error.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStoryboard } from '../hyperframes-skills/faceless-explainer/scripts/lib/storyboard.mjs';
import { hasOpenerSfx } from '../world-kit/opener-sfx.mjs';

/**
 * The fixed beat sheet (EX3-10; 3.2: EX3-79, EX3-83, EX3-87; 3.3: EX3-95, EX3-96): order,
 * storyboard `type`, nominal seconds, anchor rule (`scene`, `own`, or none), the voiceover word
 * range, the longest hold after the voice, and the fewest shots (frames 3 and 8 have no shot
 * list). The close (frame 8) is voiceless and code's: 2.5s, no words, no hold.
 */
export const BEAT_SHEET = [
  { beat: 'series opener', type: 'hook', seconds: 3.5, anchor: 'scene', words: null, hold: 0.2, shots: 1 },
  { beat: 'curiosity gap', type: 'pain_point', seconds: 9, anchor: 'scene', words: [18, 36], hold: 0.2, shots: 2 },
  { beat: 'define', type: 'product_intro', seconds: 7, anchor: 'own', words: [12, 26], hold: 0.2, shots: 0 },
  { beat: 'everyday analogy', type: 'feature_showcase', seconds: 12, anchor: 'scene', words: [20, 36], hold: 0.2, shots: 2 },
  { beat: 'map the analogy', type: 'feature_showcase', seconds: 10, anchor: 'scene', words: [18, 34], hold: 0.2, shots: 2 },
  { beat: 'tiny real example', type: 'social_proof', seconds: 10, anchor: 'own', words: [18, 32], hold: 0.2, shots: 2 },
  { beat: 'real world', type: 'benefit_highlight', seconds: 6, anchor: 'own', words: [12, 26], hold: 0.2, shots: 1 },
  { beat: 'close', type: 'branding', seconds: 2.5, anchor: null, words: null, hold: null, shots: 0, voiceless: true },
];

/** The series opener's line (EX3-96, Option 4): the template, its slot naming what the hook
 *  shows in 1–3 words ("this little shop", "this soggy forecaster"). */
export const OPENER_TEMPLATE = 'In the next 30 seconds, this ___ will teach you an AI concept.';
export const OPENER_RE = /^in the next 30 seconds,? this (.+?) will teach you an ai concept\.?$/i;
export const OPENER_SLOT_WORDS = [1, 3];
/** The 3.2 fixed line, kept for the old plans' tests. */
export const OPENER_LINE = "In the next 30 seconds, you'll learn an AI concept.";
/** Frame 2's promise ties the answer to something in the viewer's life (EX3-101): an AI, a
 *  chatbot, an app, search, a phone… */
export const PROMISE_WORD_RE = /\b(ai|a\.i\.|models?|chatbots?|assistants?|agents?|llms?|chatgpt|siri|alexa|apps?|search(?:es)?|phones?|websites?|software|computers?|online|internet|emails?|feeds?)\b/i;
/** Frame 2 never claims a parallel the viewer cannot check yet (EX3-101). */
export const SAME_SPOT_RE = /\b(same spot|same boat|same position|same situation|same problem)\b/i;
/** Words that never make a question's key words (the frame 4 callback check). */
const QUESTION_STOP = new Set(['so', 'how', 'why', 'what', 'when', 'who', 'which', 'does', 'do', 'did', 'can', 'could', 'would', 'will', 'is', 'are', 'it', 'its', 'you', 'your', 'they', 'the', 'a', 'an', 'to', 'of', 'at', 'all', 'just', 'get', 'that', 'this', 'there', 'be', 'not', 'too', 'and', 'or', 'with', 'without', 'anyway', 'even']);

/** The reel usually runs 50–65s; outside it is a warning, never an error: words are never cut for length (EX3-79). */
export const TOTAL_RANGE = [50, 65];
export const TERM_MAX_WORDS = 4;
/** Shot kinds a storyboard `shots:` line may name (EX3-83, the kit's shots.js); `ots` and
 *  `reverse` are read so they can be flagged (removed in 3.3, EX3-90). */
export const SHOT_KIND_RE = /\b(wide|medium|close(?:-up)?|insert|cutaway|reaction|ots|over[- ]the[- ]shoulder|reverse)\b/gi;
export const REMOVED_SHOTS = new Set(['ots', 'reverse']);
/** Frames whose shot subjects must be spoken in their window (EX3-91). Frame 1's line is the
 *  opener's; its hook is judged on its own. */
export const SUBJECT_FRAMES = [2, 4, 5, 6, 7];
/** On the anchor-scene frames a mismatch is an error; on frames 6 and 7 (their own pictures) a warning. */
export const SUBJECT_ERROR_FRAMES = [2, 4, 5];
/** People and body parts never appear (EX3-77): critters act. */
export const PERSON_RE = /\b(hands?|fingers?|fingertips?|palms?|fists?|arms?|person|people|humans?|man|woman|men|women|boy|girl|child|kid|figure)\b/i;
/** Frame 6's example steps (EX3-87). */
export const EXAMPLE_STEPS_RANGE = [3, 5];
export const MAX_ENTITIES = 4;
export const STEPS_RANGE = [3, 5];
export const TRANSITIONS = ['cut'];
export const GROUNDS = ['paper', 'night', 'forest', 'white'];

/** Beat 4 continues the scene the viewer has seen (EX3-97): it never opens by setting it again. */
export const SCENE_SETTING_RE = /^(let's say|let us say|picture|imagine|let's look at|let us look at|think of|say you)\b/i;
/** Beat 7 opens with a transition (EX3-18). */
export const REAL_WORLD_TRANSITION_RE =
  /^(another example|in everyday life|in real life|in daily life|outside (our|the|this)|every time you|next time|you meet|you'll meet|you will meet|you've met|you have met|you see this|you'll see this)\b/i;
/** Beat 5 says why: at least this many "because" (EX3-16). */
export const MIN_BECAUSE = 2;
/** Sound events (EX3-63): per frame on these beats, and per reel. */
export const EVENT_FRAMES = [1, 2, 4, 5, 6, 7];
export const MIN_EVENTS_PER_FRAME = 4;
export const MIN_EVENTS_TOTAL = 30;

// Emoji and pictographs (Extended_Pictographic covers emoji presentation and symbols).
const EMOJI_RE = /\p{Extended_Pictographic}/u;

function violation(rule, frame, severity, detail) {
  return { source: 'storyboard', rule, frame, severity, detail };
}

export function countWords(text) {
  return String(text ?? '')
    .replace(/[—–]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * SCRIPT.md spoken lines by frame number: `## Line N — label (Frame N)` headings,
 * spoken text in the indented block beneath (script-format.md).
 */
export function parseScript(source) {
  const byFrame = new Map();
  let frame = null;
  for (const line of String(source ?? '').split(/\r?\n/)) {
    const heading = /^##\s+.*\(\s*frame\s+(\d+)\s*\)/i.exec(line);
    if (heading) {
      frame = Number(heading[1]);
      continue;
    }
    if (/^#/.test(line)) {
      frame = null;
      continue;
    }
    if (frame !== null && /^( {4}|\t)\S/.test(line)) {
      const prev = byFrame.get(frame);
      byFrame.set(frame, prev ? `${prev} ${line.trim()}` : line.trim());
    }
  }
  return byFrame;
}

/** The body of a `## <name>` section (not a frame), or null. */
export function section(storyboard, name) {
  const re = new RegExp(`^##\\s+${name}\\s*$`, 'im');
  const m = re.exec(String(storyboard ?? ''));
  if (!m) return null;
  const rest = String(storyboard).slice(m.index + m[0].length);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A line's sentences as written (ends kept). */
function sentences2(text) {
  return String(text ?? '').split(/(?<=[.?!]["')\]]*)\s+/).map((x) => x.trim()).filter(Boolean);
}

/** Narration sentences of 4+ words, for the on-screen repeat check. */
function sentences(text) {
  return String(text ?? '')
    .split(/(?<=[.?!])\s+/)
    .map(normalize)
    .filter((s) => s.split(' ').length >= 4);
}

/**
 * Subject-internal jargon candidates: acronyms and code-shaped tokens.
 * A flag for review, never a judgment.
 */
export function jargonCandidates(text) {
  const tokens = String(text ?? '').match(/[\p{L}\p{N}_.\-/]+/gu) ?? [];
  const found = new Set();
  for (const raw of tokens) {
    const token = raw.replace(/^[.\-/]+|[.\-/]+$/g, '');
    if (!token) continue;
    if (/^[A-Z][A-Z0-9]{1,}s?$/.test(token)) found.add(token); // API, SQL, LLMs, RAG
    else if (/[a-z][A-Z]/.test(token)) found.add(token); // camelCase, JavaScript
    else if (/[_/]|\.\w/.test(token)) found.add(token); // snake_case, a/b, file.ext
  }
  return [...found];
}

/** The indented list items under `- <name>:` in a block (its sub-bullets). */
function subItems(block, name) {
  const lines = String(block ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^-\\s*${name}:`, 'i').test(l));
  if (start < 0) return null;
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s+-\s+\S/.test(line)) items.push(line.replace(/^\s+-\s+/, '').trim());
    else if (line.trim()) break;
  }
  return items;
}

/** Problems with the `## Anchor scene` block (EX3-21, 3.1). */
function anchorProblems(block) {
  if (block === null) return [['error', 'no ## Anchor scene block']];
  const out = [];
  if (!/^-\s*metaphor:\s*\S/im.test(block)) out.push(['error', 'no metaphor']);
  if (!/^-\s*hook:\s*\S/im.test(block)) out.push(['error', "no hook (the opener's moment in this world)"]);
  const steps = subItems(block, 'steps');
  if (steps === null) out.push(['error', 'no steps']);
  else {
    if (steps.length < STEPS_RANGE[0] || steps.length > STEPS_RANGE[1]) out.push(['error', `${steps.length} steps; ${STEPS_RANGE[0]} to ${STEPS_RANGE[1]}`]);
    const bare = steps.filter((st) => !/\S\s+[—–-]{1,2}\s+\S/.test(st));
    if (bare.length) out.push(['error', `${bare.length} step(s) without "<analogy> — <technical name>"`]);
  }
  const entities = block.split(/\r?\n/).filter((l) => /^\s+-\s+\S/.test(l) && /stands for/i.test(l));
  if (entities.length < 2) out.push(['error', `${entities.length} entities with "stands for"; at least 2`]);
  if (entities.length > MAX_ENTITIES) out.push(['error', `${entities.length} entities; at most ${MAX_ENTITIES}`]);
  for (const line of entities) {
    const what = line.split(/stands for/i)[0];
    const m = PERSON_RE.exec(what);
    if (m && !/critter/i.test(what)) out.push(['error', `an entity is a person or a body part ("${m[0]}"); whoever acts is a critter (EX3-77)`]);
  }
  if (/^-\s*peak:/im.test(block) && !/^-\s*hook:/im.test(block)) out.push(['warning', 'peak is retired; the opener shows the hook']);
  return out;
}

/** Problems with the `## Hook` block (EX3-88): three candidates rated, and a pick. */
function hookProblems(block) {
  if (block === null) return [['error', 'no ## Hook block (three hook candidates rated on standalone clarity, and a pick)']];
  const out = [];
  const candidates = block.split(/\r?\n/).filter((l) => /^\s*\d+[.)]\s+\S/.test(l));
  if (candidates.length < 3) out.push(['error', `${candidates.length} hook candidates; 3 needed`]);
  const unrated = candidates.filter((l) => !/clarity/i.test(l));
  if (candidates.length && unrated.length) out.push(['warning', `${unrated.length} hook candidate(s) not rated on clarity`]);
  if (!/^-\s*pick:\s*\S/im.test(block)) out.push(['error', 'no hook pick']);
  return out;
}

/** Each frame's raw block, by frame number (for fields that run onto sub-bullets). */
export function frameBlocks(storyboard) {
  const map = new Map();
  const re = /^##\s+Frame\s+(\d+)[^\n]*\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/gim;
  for (const m of String(storyboard ?? '').matchAll(re)) map.set(Number(m[1]), m[2]);
  return map;
}

/** A frame's `shots:` text: the line and any sub-bullets under it. */
function shotsText(block) {
  const line = /^-[ \t]*shots:[ \t]*(.*)$/im.exec(String(block ?? ''));
  if (!line) return null;
  const items = subItems(block, 'shots') ?? [];
  return [line[1], ...items].join('\n').trim();
}

/** The shots a `shots:` text names, in order (the kinds only). */
export function shotKinds(text) {
  return [...String(text ?? '').matchAll(SHOT_KIND_RE)].map((m) => m[1].toLowerCase().replace(/^close-up$/, 'close').replace(/^cutaway$/, 'insert').replace(/^over[- ]the[- ]shoulder$/, 'ots'));
}

/** Words that never make a shot subject match: framing words and fillers. */
const SUBJECT_STOP = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'to', 'at', 'and', 'or', 'with', 'its', 'it', 'is', 'as', 'by', 'from', 'into', 'over', 'under', 'one', 'two', 'big', 'small', 'alone', 'whole', 'shot', 'face', 'faces', 'label', 'labels', 'close', 'wide', 'medium', 'insert', 'reaction', 'view', 'beside', 'behind', 'their', 'his', 'her', 'this', 'that', 'there', 'here', 'just', 'still', 'then', 'now', 'all', 'up', 'down', 'out', 'off', 'again', 'new', 'old']);

/** A crude stem: lowercase, no possessive, no plural or -ing/-ed ending. */
export function stem(word) {
  let w = String(word).toLowerCase().replace(/[’']s$/, '').replace(/[^\p{L}\p{N}]/gu, '');
  for (const [end, keep] of [['ies', 'y'], ['ing', ''], ['ed', ''], ['es', ''], ['s', '']]) {
    if (w.length > end.length + 2 && w.endsWith(end)) {
      w = w.slice(0, -end.length) + keep;
      break;
    }
  }
  return w;
}

/**
 * The shots of a `shots:` text: [{ kind, subject, cue }]. A shot reads
 * "<kind> — <subject> — on \"<cue>\"" (one per sub-bullet, or `;`-separated on one line).
 */
export function parseShots(text) {
  return String(text ?? '')
    .split(/\n|;/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((line) => {
      const kind = shotKinds(line)[0] ?? null;
      const parts = line.split(/\s+[—–]\s+|\s+--?\s+/).map((x) => x.trim());
      const cueM = /\bon\s+["“']([^"”']+)["”']/i.exec(line);
      const subject = parts.slice(1).filter((p) => !/^(on|at)\s+/i.test(p) && !/^\d/.test(p)).join(' ');
      return { kind, subject, cue: cueM ? cueM[1].trim() : null };
    })
    .filter((x) => x.kind);
}

/**
 * Each shot's spoken window: the voiceover words from its cue to the next shot's cue (EX3-91).
 * Returns [{ shot, window: string | null }] (null when the cue is not in the voiceover).
 */
export function shotWindows(shots, voiceover) {
  const words = String(voiceover ?? '').split(/\s+/).filter(Boolean);
  const keys = words.map((w) => stem(w));
  const find = (cue, from) => {
    const c = String(cue).split(/\s+/).map(stem).filter(Boolean);
    if (!c.length) return -1;
    for (let i = from; i <= keys.length - c.length; i++) if (c.every((x, k) => keys[i + k] === x)) return i;
    return -1;
  };
  let pos = 0;
  const starts = shots.map((s, i) => {
    if (i === 0 && !s.cue) return 0;
    const at = s.cue ? find(s.cue, pos) : -1;
    if (at >= 0) pos = at;
    return at;
  });
  return shots.map((shot, i) => {
    if (starts[i] < 0) return { shot, window: null };
    const next = starts.slice(i + 1).find((x) => x > starts[i]);
    return { shot, window: words.slice(starts[i], next ?? words.length).join(' ') };
  });
}

/** Whether a shot's subject is named in its spoken window: a content word of the subject (or
 *  of an entity the subject names, via `aliases`) is spoken there. */
export function subjectSpoken(subject, window, aliases = new Map()) {
  const spoken = new Set(String(window ?? '').split(/\s+/).map(stem).filter(Boolean));
  const words = String(subject ?? '').split(/[\s,]+/).map(stem).filter((w) => w && !SUBJECT_STOP.has(w));
  const extra = words.flatMap((w) => aliases.get(w) ?? []);
  return [...words, ...extra].some((w) => spoken.has(w));
}

/** Entity aliases from `## Anchor scene`: an entity id's stem → the content words of what it is. */
function entityAliases(anchor) {
  const map = new Map();
  for (const line of String(anchor ?? '').split(/\r?\n/)) {
    if (!/^\s+-\s+\S/.test(line) || !/stands for/i.test(line)) continue;
    const [id, what] = line.replace(/^\s+-\s+/, '').split(/\s+[—–]\s+/);
    const words = String(what ?? '').split(/[\s,]+/).map(stem).filter((w) => w && !SUBJECT_STOP.has(w));
    map.set(stem(id), words);
  }
  return map;
}

/** Problems with the `## Curiosity gap` block (EX3-13, 3.1). */
function gapProblems(block) {
  if (block === null) return [['error', 'no ## Curiosity gap block']];
  const out = [];
  const candidates = block.split(/\r?\n/).filter((l) => /^\s*\d+[.)]\s+\S/.test(l));
  if (candidates.length < 3) out.push(['error', `${candidates.length} candidate gaps; 3 needed`]);
  const unrated = candidates.filter((l) => !/closable/i.test(l));
  if (candidates.length && unrated.length) out.push(['warning', `${unrated.length} candidate(s) not rated on closable`]);
  if (!/^-\s*pick:\s*\S/im.test(block)) out.push(['error', 'no pick']);
  if (!/^-\s*closed_by:\s*\S/im.test(block)) out.push(['error', 'no closed_by (where the reel answers the gap)']);
  return out;
}

const stripQuotes = (s) => String(s ?? '').trim().replace(/^["“']|["”']$/g, '').trim();
const seconds = (s) => {
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(s ?? ''));
  return m ? Number(m[1]) : NaN;
};

/**
 * @param {{ storyboard: string, script?: string | null, frameSource?: Map<number, string>, audioMeta?: unknown,
 *           frameEvents?: Map<number, unknown[]> | null, eventsTrack?: boolean | null }} input
 *   frameSource: the frame scene modules (assets/frames/NN-*.js) by frame number.
 *   audioMeta: audio_meta.json, parsed; the opener's sounds are checked only when given.
 *   frameEvents: each frame's sound events (assets/frames/NN-*.events.json), checked when given.
 *   eventsTrack: whether assets/sfx/events.wav exists, checked when given.
 */
export function lintStoryboard({ storyboard, script = null, frameSource = new Map(), audioMeta = undefined, frameEvents = null, eventsTrack = null }) {
  const out = [];
  const { frames, globals } = parseStoryboard(storyboard);
  const scriptLines = script ? parseScript(script) : null;
  const voiceFor = (frame, i) => {
    const number = frame.number ?? i + 1;
    return scriptLines ? (scriptLines.get(number) ?? '') : (frame.voiceover ?? '');
  };

  // The plan's three blocks, the term, and the music.
  for (const [severity, p] of anchorProblems(section(storyboard, 'Anchor scene'))) out.push(violation('anchor_scene', null, severity, p));
  for (const [severity, p] of hookProblems(section(storyboard, 'Hook'))) out.push(violation('hook', null, severity, p));
  for (const [severity, p] of gapProblems(section(storyboard, 'Curiosity gap'))) out.push(violation('curiosity_gap', null, severity, p));
  const term = String(globals?.extra?.term ?? '').trim();
  const concept = String(globals?.extra?.concept ?? '').trim();
  if (!term || /^<fill/.test(term)) out.push(violation('term', null, 'error', 'no term: in the frontmatter (BRIEF.md\'s term, EX3-86)'));
  else if (countWords(term) > TERM_MAX_WORDS) out.push(violation('term', null, 'error', `term "${term}" is ${countWords(term)} words; at most ${TERM_MAX_WORDS}`));
  if (!concept || /^<fill/.test(concept)) out.push(violation('concept', null, 'error', 'no concept: in the frontmatter'));
  else if (term && normalize(concept) !== normalize(term)) out.push(violation('concept', null, 'warning', `concept "${concept}" differs from the term "${term}"`));
  const music = String(globals?.extra?.music ?? '').trim().toLowerCase();
  if (music && music !== 'none') out.push(violation('music', null, 'warning', `music "${music}": the kit picks the bed (music: none, EX3-82)`));
  const blocks = frameBlocks(storyboard);
  const shotsByFrame = new Map();
  const aliases = entityAliases(section(storyboard, 'Anchor scene'));

  // Frame count and total duration.
  if (frames.length !== BEAT_SHEET.length) {
    out.push(violation('frame_count', null, 'error', `${frames.length} frames; the beat sheet has ${BEAT_SHEET.length}`));
  }
  const missing = frames.filter((f) => !Number.isFinite(f.durationSeconds));
  missing.forEach((f, i) => out.push(violation('duration_missing', f.number ?? i + 1, 'error', 'frame has no duration')));
  if (missing.length === 0) {
    const total = Math.round(frames.reduce((a, f) => a + f.durationSeconds, 0) * 1000) / 1000;
    if (total < TOTAL_RANGE[0] || total > TOTAL_RANGE[1]) {
      out.push(violation('total_duration', null, 'warning', `${total}s total; usually ${TOTAL_RANGE[0]}–${TOTAL_RANGE[1]}s (words are never cut for length)`));
    }
  }

  // Transitions: only cut (EX3-46).
  frames.forEach((f, i) => {
    const kind = String(f.transitionIn ?? '').trim().toLowerCase().split(/\s+/)[0];
    if (kind && !TRANSITIONS.includes(kind)) {
      out.push(violation('transition_kind', f.number ?? i + 1, 'error', `transition "${f.transitionIn}"; only ${TRANSITIONS.join(' or ')}`));
    }
  });
  if (frames[0] && String(frames[0].transitionIn ?? '').trim().toLowerCase() !== 'cut') {
    out.push(violation('first_transition', 1, 'warning', `frame 1 enters on "${frames[0].transitionIn ?? 'nothing'}"; must be cut`));
  }

  // Narration sentences, for the on-screen repeat check below.
  const narration = new Set();
  // Frame 2's question, for frame 4's callback check (EX3-101).
  let gapQuestion = '';

  frames.forEach((frame, i) => {
    const n = frame.number ?? i + 1;
    const sheet = BEAT_SHEET[i];
    const extra = frame.extra ?? {};
    const field = (name) => String(extra[name] ?? '').trim();
    const type = field('type');
    if (sheet && type !== sheet.type) {
      out.push(violation('beat_type', n, 'error', `type "${type || 'missing'}"; beat ${i + 1} (${sheet.beat}) needs "${sheet.type}"`));
    }
    if (!field('engagement')) out.push(violation('engagement_technique', n, 'error', 'no engagement (a named engagement technique)'));
    if (field('persuasion')) out.push(violation('persuasion_field', n, 'warning', 'persuasion is retired; name the engagement technique instead'));
    if (field('blueprint')) out.push(violation('blueprint', n, 'warning', 'blueprints are not used; compose from the anchor scene and the kit'));
    if (field('sfx')) out.push(violation('sfx_retired', n, 'warning', 'sfx: lines are retired; frame workers design each frame\'s sound events'));

    // Hold (EX3-60, EX3-79): the pause after the voice, at most 0.2s (the end card holds longer).
    const hold = seconds(field('hold'));
    if (sheet?.voiceless) {
      // The close (EX3-95): no voice, so no hold; code makes it 2.5s.
    } else if (!Number.isFinite(hold)) out.push(violation('hold', n, 'error', 'no hold (the pause after the line)'));
    else if (sheet && hold > sheet.hold + 1e-9) out.push(violation('hold', n, 'error', `hold ${hold}s; at most ${sheet.hold}s`));

    // Shots (EX3-83): scene frames list their shots; long frames cut between at least two.
    if (sheet?.shots) {
      const text = shotsText(blocks.get(n));
      const kinds = shotKinds(text);
      shotsByFrame.set(n, kinds);
      if (!text) out.push(violation('shots', n, 'error', 'no shots: (the frame\'s shot list, frame.md § Shots)'));
      else if (kinds.length < sheet.shots) out.push(violation('shots', n, 'error', `${kinds.length} shot(s); beat ${i + 1} cuts between at least ${sheet.shots}`));
      if (i !== 3 && kinds.includes('wide')) out.push(violation('shots', n, 'warning', 'a wide shot outside beat 4; the establishing shot is used once'));
      if (i === 3 && kinds[0] !== 'wide') out.push(violation('shots', n, 'warning', 'beat 4 opens on the wide establishing shot'));
      for (const k of new Set(kinds.filter((x) => REMOVED_SHOTS.has(x)))) {
        out.push(violation('shot_kind', n, 'error', `a ${k} shot: removed in 3.3 (a shot is only a camera; ${k === 'ots' ? 'over-the-shoulder drew a second copy of a critter' : 'mirroring makes every critter jump sides'}), EX3-90`));
      }
      // The shot's subject is what the voice is naming during it (EX3-91).
      if (SUBJECT_FRAMES.includes(n) && text && voiceFor(frame, i).trim()) {
        for (const { shot, window } of shotWindows(parseShots(text), voiceFor(frame, i))) {
          if (window === null) out.push(violation('shot_cue', n, 'warning', `the ${shot.kind} shot's cue "${shot.cue}" is not in the voiceover`));
          else if (!subjectSpoken(shot.subject, window, aliases)) {
            out.push(violation('shot_subject', n, SUBJECT_ERROR_FRAMES.includes(n) ? 'error' : 'warning', `the ${shot.kind} shot on "${shot.subject}" plays while the voice says "${window}": frame what the voice is naming (EX3-91)`));
          }
        }
      }
    }
    // Frame 6: the example's own steps (EX3-87).
    if (i === 5) {
      const steps = field('example_steps').split(/\s*(?:→|->|;|\|)\s*/).filter((x) => x.trim());
      if (!steps.length) out.push(violation('example_steps', n, 'error', 'no example_steps: (the example\'s own 3–5 steps)'));
      else if (steps.length < EXAMPLE_STEPS_RANGE[0] || steps.length > EXAMPLE_STEPS_RANGE[1]) {
        out.push(violation('example_steps', n, 'error', `${steps.length} example steps; ${EXAMPLE_STEPS_RANGE[0]} to ${EXAMPLE_STEPS_RANGE[1]}`));
      }
    }
    if (!String(frame.scene ?? '').trim()) out.push(violation('visual_missing', n, 'error', 'no scene: the frame names no visual'));

    // Ground (EX3-42): one of the four; white only on the last frame, which must be white.
    const ground = field('ground').toLowerCase();
    if (!ground) out.push(violation('ground', n, 'error', 'no ground'));
    else if (!GROUNDS.includes(ground)) out.push(violation('ground', n, 'error', `ground "${ground}"; one of ${GROUNDS.join(', ')}`));
    else if (i === BEAT_SHEET.length - 1 && ground !== 'white') out.push(violation('ground', n, 'error', 'the last frame is white'));
    else if (i < BEAT_SHEET.length - 1 && ground === 'white') out.push(violation('ground', n, 'error', 'only the last frame is white'));

    // Anchor (EX3-10; 3.2): the scene on beats 1, 2, 4, 5; own visuals on 3, 6 and 7.
    const anchor = field('anchor').toLowerCase();
    if (sheet?.anchor === 'scene' && anchor !== 'scene') out.push(violation('anchor', n, 'error', `anchor "${anchor || 'missing'}"; beat ${i + 1} shows the anchor scene`));
    if (sheet?.anchor === 'own' && anchor !== 'own') out.push(violation('anchor', n, 'error', `anchor "${anchor || 'missing'}"; beat ${i + 1} has its own visuals`));
    if (i === 1 && !field('reset')) out.push(violation('attention_reset', n, 'error', 'no reset: the 1→2 cut needs an attention reset'));

    const vo = voiceFor(frame, i);
    if (i === 0) {
      // The opener points at the scene (EX3-96): the template, its slot naming what the hook shows.
      const m = OPENER_RE.exec(stripQuotes(vo).replace(/[‘’]/g, "'"));
      if (!m) out.push(violation('opener_line', n, 'error', `frame 1 says "${vo}"; the line is "${OPENER_TEMPLATE}"`));
      else {
        const slot = countWords(m[1]);
        if (slot < OPENER_SLOT_WORDS[0] || slot > OPENER_SLOT_WORDS[1]) out.push(violation('opener_line', n, 'error', `the opener's slot "${m[1]}" is ${slot} words; ${OPENER_SLOT_WORDS[0]} to ${OPENER_SLOT_WORDS[1]}`));
        const anchorWords = new Set(String(section(storyboard, 'Anchor scene') ?? '').split(/[\s,.;:()]+/).map(stem));
        const named = m[1].split(/\s+/).map(stem).filter((w) => w && !SUBJECT_STOP.has(w));
        if (named.length && !named.some((w) => anchorWords.has(w))) out.push(violation('opener_line', n, 'warning', `the opener's slot "${m[1]}" names nothing in the anchor scene`));
      }
    } else if (sheet?.voiceless) {
      if (stripQuotes(vo)) out.push(violation('close_voiceover', n, 'error', 'the close has no voiceover (EX3-95): the logo and "AI BRAIN BREAK" only'));
    } else if (sheet?.words) {
      const words = countWords(vo);
      if (words < sheet.words[0] || words > sheet.words[1]) {
        out.push(violation('voiceover_words', n, 'warning', `${words} words; beat ${i + 1} takes ${sheet.words[0]}–${sheet.words[1]}`));
      }
    }

    // Beat 3: the dictionary card (EX3-14). Its definition is the voiceover.
    if (i === 2) {
      const definition = stripQuotes(field('definition'));
      if (!definition) out.push(violation('definition', n, 'error', 'no definition: (the dictionary card)'));
      else if (normalize(definition) !== normalize(vo)) out.push(violation('definition', n, 'error', 'the definition is not the voiceover word for word'));
      if (!field('part_of_speech')) out.push(violation('definition', n, 'error', 'no part_of_speech: (the dictionary card)'));
      if (term && definition && !normalize(definition).includes(normalize(term))) {
        out.push(violation('definition_term', n, 'error', `the definition does not define the term "${term}" (EX3-86)`));
      }
      if (/\b(when something happens|some data|a thing that|something that|stuff)\b/i.test(vo)) {
        out.push(violation('definition_vague', n, 'warning', 'vague phrase in the definition; name the trigger and the receiver'));
      }
    }
    // Beat 2 is a tiny story a stranger can follow (EX3-101): a goal, what's in the way, the
    // viewer's own question, then a promise tying the answer to their life. No term, no "same spot".
    if (i === 1 && vo) {
      const plain = stripQuotes(vo);
      const said = sentences2(plain);
      const qAt = said.map((x) => /\?["')\]]*$/.test(x)).lastIndexOf(true);
      if (term && normalize(plain).includes(normalize(term))) out.push(violation('gap_term', n, 'error', `the gap says the term "${term}": it never answers itself with a label (the title card and frame 3 name it)`));
      if (SAME_SPOT_RE.test(plain)) out.push(violation('gap_same_spot', n, 'error', 'the gap claims a parallel ("the same spot"): keep it in the scene; tie it to the viewer in the promise'));
      if (qAt < 0) out.push(violation('gap_question', n, 'error', "the gap asks no question: end the story on the viewer's own question"));
      else if (!said.slice(qAt + 1).some((x) => PROMISE_WORD_RE.test(x))) {
        out.push(violation('gap_promise', n, 'error', 'no promise after the question: one sentence on why the answer matters to the viewer, naming something they know ("it\'s the same reason chatbots make things up")'));
      }
      if (/\bcritters?\b/i.test(plain)) out.push(violation('gap_plain_roles', n, 'warning', 'the gap says "critter": name characters by plain roles (the helper, the new hire)'));
      const declared = stripQuotes(field('gap_question'));
      if (declared && !normalize(plain).includes(normalize(declared))) out.push(violation('gap_question', n, 'error', 'gap_question: is not the question the voiceover asks'));
      gapQuestion = qAt >= 0 ? said[qAt] : '';
    }
    // Beat 4's last sentence answers the gap's question in its own words (EX3-101).
    if (i === 3 && vo && gapQuestion) {
      const keys = (x) => normalize(x).split(' ').map(stem).filter((w) => w && !QUESTION_STOP.has(w));
      const wanted = new Set(keys(gapQuestion));
      const last = sentences2(stripQuotes(vo)).pop() ?? '';
      const hit = keys(last).filter((w) => wanted.has(w)).length;
      if (wanted.size && hit < Math.min(2, wanted.size)) {
        out.push(violation('gap_closed', n, 'error', `frame 4's last sentence ("${last}") does not answer the gap's question ("${gapQuestion}") in its words: close the loop explicitly`));
      }
    }
    // Beat 4 continues the scene the viewer has seen (EX3-97): no "Picture…" restart.
    if (i === 3 && vo && SCENE_SETTING_RE.test(stripQuotes(vo))) {
      out.push(violation('scene_setting', n, 'error', 'beat 4 restarts the scene ("Picture…", "Imagine…", "Let\'s say…"); continue it ("Here\'s what the hire does:", "Watch the forecaster:", "Back on the lawn:")'));
    }
    // Beat 5 says why (EX3-16).
    if (i === 4 && vo) {
      const because = (vo.match(/\bbecause\b/gi) ?? []).length;
      if (because < MIN_BECAUSE) out.push(violation('map_because', n, 'error', `${because} "because"; each mapped pair says why (at least ${MIN_BECAUSE})`));
    }
    // Beat 7 opens with a transition (EX3-18).
    if (i === 6 && vo && !REAL_WORLD_TRANSITION_RE.test(stripQuotes(vo))) {
      out.push(violation('real_world_transition', n, 'error', 'beat 7 does not open with a transition ("Another example would be…", "In everyday life, you meet…")'));
    }
    for (const s of sentences(vo)) narration.add(s);
    if (i === 1) {
      // The term and "AI" are spoken on purpose in the bridge (EX3-97).
      const jargon = jargonCandidates(vo).filter((j) => normalize(j) !== normalize(term) && !/^ai$/i.test(j));
      if (jargon.length) out.push(violation('hook_jargon', n, 'warning', `possible jargon in the curiosity gap: ${jargon.join(', ')}`));
    }

    // Copy only: narration, the visual line, and the title. Narrative prose is planning notes.
    const copy = [vo, frame.scene, frame.title].join('\n');
    if (/!(?!\[)/.test(copy.replace(/!\[[^\]]*\]\([^)]*\)/g, ''))) {
      out.push(violation('exclamation_mark', n, 'error', 'exclamation mark in voiceover or on-screen copy'));
    }
    if (EMOJI_RE.test(copy)) out.push(violation('emoji', n, 'error', 'emoji in voiceover or on-screen copy'));
  });

  // No two consecutive scene frames meet on the same picture (EX3-83): a frame's first shot kind
  // differs from the previous frame's last when both name one.
  for (let n = 2; n <= BEAT_SHEET.length; n++) {
    const prev = shotsByFrame.get(n - 1);
    const cur = shotsByFrame.get(n);
    if (prev?.length && cur?.length && prev[prev.length - 1] === cur[0] && cur[0] !== 'insert') {
      out.push(violation('shots', n, 'warning', `opens on a ${cur[0]} shot, the shot frame ${n - 1} ended on; check it is a different picture`));
    }
  }

  // Built frames, when present: emoji and narration repeated on screen, in the scene modules'
  // source (their SVG text is string literals there); frame 3's headword is the term.
  if (term && frameSource.has(3) && !normalize(frameSource.get(3)).includes(normalize(term))) {
    out.push(violation('headword_term', 3, 'error', `frame 3's dictionary card does not show the term "${term}"`));
  }
  for (const [n, source] of frameSource) {
    if (EMOJI_RE.test(source)) out.push(violation('emoji', n, 'error', 'emoji in a frame module'));
    const text = normalize(String(source).replace(/\\(.)/g, '$1')); // JS string escapes, e.g. app\'s
    for (const s of narration) {
      if (text.includes(s)) out.push(violation('narration_on_screen', n, 'warning', `on-screen text repeats narration: "${s}"`));
    }
  }

  // The opener's riser and hit (EX3-24), once audio exists.
  if (audioMeta !== undefined && audioMeta !== null && !hasOpenerSfx(audioMeta)) {
    out.push(violation('opener_sfx', 1, 'error', "the opener's sounds (the bank opener's stem, or the riser, and the hit on the cut) are not in audio_meta.json"));
  }

  // Sound events (EX3-63), once frames are built: enough per frame and per reel, and the mix.
  if (frameEvents) {
    let total = 0;
    for (const f of frames) {
      const n = f.number;
      const list = frameEvents.get(n);
      const count = Array.isArray(list) ? list.length : 0;
      total += count;
      // a bank opener's frame 1 sounds through its stem, not events (EX3-102)
      const stem = n === 1 && (audioMeta?.sfx ?? []).some((x) => x?.role === 'opener-stem');
      if (EVENT_FRAMES.includes(n) && count < MIN_EVENTS_PER_FRAME && !stem) {
        out.push(violation('sound_events', n, 'warning', `${count} sound events; at least ${MIN_EVENTS_PER_FRAME}`));
      }
    }
    if (total < MIN_EVENTS_TOTAL) out.push(violation('sound_events', null, 'warning', `${total} sound events in the reel; at least ${MIN_EVENTS_TOTAL}`));
  }
  if (eventsTrack === false) out.push(violation('sound_track', null, 'error', 'assets/sfx/events.wav is missing: the sound events were never mixed'));

  return { violations: out, frames: frames.length };
}

function modulesFromDir(dir) {
  const map = new Map();
  if (!dir || !existsSync(dir)) return map;
  for (const file of readdirSync(dir).sort()) {
    const n = /^(\d+)/.exec(file)?.[1];
    if (n && file.endsWith('.js')) map.set(Number(n), readFileSync(join(dir, file), 'utf8'));
  }
  return map;
}

/** Each frame's sound events (NN-*.events.json) by frame number; unreadable files count as none. */
export function eventsFromDir(dir) {
  const map = new Map();
  if (!dir || !existsSync(dir)) return map;
  for (const file of readdirSync(dir).sort()) {
    const n = /^(\d+)/.exec(file)?.[1];
    if (!n || !file.endsWith('.events.json')) continue;
    try {
      const list = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      map.set(Number(n), Array.isArray(list) ? list : []);
    } catch {
      map.set(Number(n), []);
    }
  }
  return map;
}

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const storyboardPath = flag('storyboard');
  if (!storyboardPath) {
    console.error('usage: lint-storyboard.mjs --storyboard STORYBOARD.md [--script SCRIPT.md] [--frames-dir dir] [--audio-meta file] [--events-track file] [--out file]');
    process.exit(2);
  }
  try {
    const scriptPath = flag('script');
    const metaPath = flag('audio-meta');
    const result = lintStoryboard({
      storyboard: readFileSync(resolve(storyboardPath), 'utf8'),
      script: scriptPath && existsSync(scriptPath) ? readFileSync(resolve(scriptPath), 'utf8') : null,
      frameSource: modulesFromDir(flag('frames-dir')),
      audioMeta: metaPath && existsSync(metaPath) ? JSON.parse(readFileSync(resolve(metaPath), 'utf8')) : undefined,
      frameEvents: flag('frames-dir') ? eventsFromDir(flag('frames-dir')) : null,
      eventsTrack: flag('events-track') ? existsSync(resolve(flag('events-track'))) : null,
    });
    const json = `${JSON.stringify(result, null, 2)}\n`;
    const out = flag('out');
    if (out) writeFileSync(resolve(out), json);
    else process.stdout.write(json);
  } catch (error) {
    console.error(`✗ lint-storyboard: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
