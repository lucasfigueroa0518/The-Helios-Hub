#!/usr/bin/env node
// lint-storyboard.mjs — deterministic checks on an Explainer Reel's plan (Explainers 4.3; 4.2:
// .explainers-local/4.2-plan/CONTRACT-4.2.md § Storyboard; planning/Explainer Reels/DECISIONS.md).
// Its job is structure and the minimums, never taste (PLAN.md turn 2: code judges breakage, prompts
// judge taste):
//   - structure: the eight-beat sheet, the blocks and fields the pipeline reads (the visual arc, the
//     anchor scene, the hook, each frame's look and shot lines), the format's fixed lines (the
//     opener template, the quick definition, the hand-off line, the definition on the card);
//   - the minimums a text can show (recipe/minimums.md): a world frame, a mechanism or blend frame,
//     the definition — as warnings (`minimum:<n>`);
//   - the house's "never" rules a text check can see: no person or body part as an entity, no
//     quoted word, symbol or code token in the voice, "critter" never said, no `!` or emoji, the
//     example never the analogy's material.
// No shot counts, cast caps, angle or cut rules, sizes, or looks per frame number: those are craft,
// judged by the builders and the picture check. Violations are recorded and the render continues
// (fail open, E-07, EX3-06).
//
//   node lint-storyboard.mjs --storyboard STORYBOARD.md [--script SCRIPT.md]
//                            [--frames-dir assets/frames] [--audio-meta audio_meta.json]
//                            [--events-track assets/sfx/events.wav] [--out lint.json]
//
// Exit 0 always when the files parse (violations are data, not failures);
// exit 2 on a usage or read error.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStoryboard } from '../hyperframes-skills/faceless-explainer/scripts/lib/storyboard.mjs';
import { hasOpenerSfx } from '../world-kit/opener-sfx.mjs';
import { catalogEntries } from '../world-kit/props/catalog.mjs';

/**
 * The fixed beat sheet (EX3-10; 3.x: EX3-79 to EX3-128; 4.2: each frame's look is the director's;
 * 4.3: hook, quick definition, hand-off, analogy, definition payoff, real example, tie-together,
 * close): order, storyboard `type`, nominal seconds, the voiceover word range, the longest hold
 * after the voice, and whether the frame needs a shot list (`shots: 1`; frame 5 may keep one
 * framing under its card). Frame 3 (the hand-off) and frame 8 (the close) are code's: no shots;
 * the close is voiceless, 2.5s, no hold, no look.
 */
export const BEAT_SHEET = [
  { beat: 'series opener', type: 'hook', seconds: 4.5, words: null, hold: 0.15, shots: 1 },
  { beat: 'quick definition', type: 'product_intro', seconds: 5, words: [6, 15], hold: 0.15, shots: 1 },
  { beat: 'hand-off', type: 'handoff', seconds: 3, words: null, hold: 0.15, shots: 0 },
  { beat: 'the analogy plays', type: 'feature_showcase', seconds: 13, words: [22, 38], hold: 0.15, shots: 1 },
  { beat: 'definition payoff', type: 'feature_showcase', seconds: 10, words: [16, 32], hold: 0.15, shots: 0 },
  { beat: 'tiny real example', type: 'social_proof', seconds: 11, words: [18, 34], hold: 0.15, shots: 1 },
  { beat: 'tie-together', type: 'benefit_highlight', seconds: 8, words: [14, 28], hold: 0.15, shots: 1 },
  { beat: 'close', type: 'branding', seconds: 2.5, words: null, hold: null, shots: 0, voiceless: true },
];
/** The quick definition's soft cap (4.3): one plain sentence of about 15 words. */
export const QUICK_DEFINITION_MAX = 15;
/** The hand-off line, said exactly (4.3; handoff-bank.js HANDOFF_LINE). */
export const HANDOFF_LINE = "Let's dive into this in everyday terms.";
/** The frame whose dictionary card shows the definition (4.3: the definition payoff). */
export const DEFINITION_FRAME = 5;

/** Each frame's look (4.2, CONTRACT § Storyboard): frames 1–7 declare one; the close has none. */
export const LOOKS = ['world', 'mechanism', 'blend'];
/** The looks a beat's job allows, where it narrows them (story-design.md § Frame fields): the hook is a
 *  moment of the anchor scene (its module needs the hero through the camera); the hand-off is code's
 *  card over the world; the example is the real technology. Other beats take any look. */
export const BEAT_LOOKS = { 1: ['world', 'blend'], 3: ['world'], 6: ['mechanism', 'blend'] };
/** A shot's size (4.2): the first part of every shot line. */
export const SHOT_SIZES = ['wide', 'medium', 'close', 'insert'];
/** The `## Visual arc` block's fields (4.2): the reel planned as one film. */
export const VISUAL_ARC_FIELDS = ['throughline', 'colour script', 'motifs', 'intensity', 'bridges'];
/** Fields 4.2 retired, and what replaced each (a warning when a storyboard still has one). */
export const RETIRED_FIELDS = {
  anchor: 'each frame declares its look: world | mechanism | blend',
  technique: "each shot line's why: carries the plan",
  reset: "frame 2's first shot plans the cut into it",
  term_part: "the answer key's story_part names the part the analogy calls the term",
  example_steps: "the example's steps live in its voiceover and its shots",
  gap_question: '4.3 has no curiosity gap: frame 2 is the quick definition',
  closed_by: '4.3 has no curiosity gap: the reel ends on what the concept means for the viewer',
};

/** The series opener's line (EX3-96; 3.9, EX3-130: "the next minute"; 4.3: an AI, a tech or a
 *  coding concept). Code picks the kind from the topic (workspace.ts openerLineFor) and writes the
 *  exact line into BRIEF.md's `## Opener line`; the slot names what the hook shows in 1–3 words. */
export const OPENER_TEMPLATES = {
  ai: 'In the next minute, this ___ will teach you an AI concept.',
  tech: 'In the next minute, this ___ will teach you a tech concept.',
  coding: 'In the next minute, this ___ will teach you a coding concept.',
};
/** Any variant; group 1 is the slot, group 2 the kind ("an ai", "a tech" or "a coding"). */
export const OPENER_RE = /^in the next minute,? this (.+?) will teach you (an ai|a tech|a coding) concept\.?$/i;
export const OPENER_SLOT_WORDS = [1, 3];
/** The opener kind a line uses: 'ai', 'tech', 'coding', or null when it is no template. */
export function openerKind(line) {
  const m = OPENER_RE.exec(String(line ?? '').trim().replace(/[‘’]/g, "'"));
  return m ? (/ai/i.test(m[2]) ? 'ai' : /coding/i.test(m[2]) ? 'coding' : 'tech') : null;
}
/** Words for the real technology a viewer meets (an AI, a chatbot, an app, search, a phone…). The
 *  example-reuse check skips them. */
export const PROMISE_WORD_RE = /\b(ai|a\.i\.|models?|chatbots?|assistants?|agents?|llms?|chatgpt|siri|alexa|apps?|search(?:es)?|phones?|websites?|software|computers?|online|internet|emails?|feeds?)\b/i;
/** A toss to the next beat (EX3-116; Lucas, 2026-10-22: "That makes it feel like we're going to
 *  commercial break"). The gap writer's line check (ideas/gap.ts) reads it; 4.3 reels have no gap. */
export const TOSS_RE = /\b(stick around|stay tuned|keep watching|stay with me|hang (?:on|tight)|wait for it|let'?s find out|find out (?:how|why|what)|here'?s (?:the thing|why|how)|but first|watch closely|don'?t go anywhere|before we (?:get|go))\b/i;
/** Words that never make a question's key words (and never an example's material). */
const QUESTION_STOP = new Set(['so', 'how', 'why', 'what', 'when', 'who', 'which', 'does', 'do', 'did', 'can', 'could', 'would', 'will', 'is', 'are', 'it', 'its', 'you', 'your', 'they', 'the', 'a', 'an', 'to', 'of', 'at', 'all', 'just', 'get', 'that', 'this', 'there', 'be', 'not', 'too', 'and', 'or', 'with', 'without', 'anyway', 'even']);
/** The tie-together ends on the viewer (4.3, minimums.md 7): a word that speaks to them. */
export const VIEWER_RE = /\b(you|your|you're|yours|we|our|us)\b/i;

/** The reel usually runs 50–65s; outside it is a warning, never an error: words are never cut for length (EX3-79). */
export const TOTAL_RANGE = [50, 65];
export const TERM_MAX_WORDS = 4;
/** Shot kinds a `shots:` line may name (EX3-83, the kit's shots.js). The 4.2 sizes are SHOT_SIZES;
 *  `reaction`, `ots` and `reverse` are read so they can be flagged (removed in 3.3, EX3-90, and a
 *  reaction is a close on a face in 4.2). Real Case reads the same kinds against its own list. */
export const SHOT_KIND_RE = /\b(wide|medium|close(?:-up)?|insert|cutaway|reaction|ots|over[- ]the[- ]shoulder|reverse)\b/gi;
export const REMOVED_SHOTS = new Set(['ots', 'reverse']);
/** A frame module's source without its comments (nothing in a comment is drawn). Leaves `://` in strings alone. */
export function stripComments(source) {
  return String(source ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}
/** Frames whose shot subjects should be spoken in their window (EX3-91), a warning. Frame 1's line
 *  is the opener's; its hook is judged on its own. */
export const SUBJECT_FRAMES = [2, 4, 5, 6, 7];
/** People and body parts never appear (EX3-77): critters act. */
export const PERSON_RE = /\b(hands?|fingers?|fingertips?|palms?|fists?|arms?|person|people|humans?|man|woman|men|women|boy|girl|child|kid|figure)\b/i;
/** Whether a frame source shows the term as its headword: the term itself, or for a paired term
 *  ("X vs Y") the same words joined by vs, /, & or "and" ("frontend / backend"). */
export function headwordShown(source, term) {
  const text = normalize(source);
  if (text.includes(normalize(term))) return true;
  if (!TERM_PAIR_RE.test(term)) return false;
  const [a, b] = term.split(TERM_PAIR_RE).map((x) => String(x).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim());
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const raw = String(source ?? '').toLowerCase();
  return new RegExp(`${esc(a)}\\s*(?:vs\\.?|versus|/|&|and)\\s*${esc(b)}`, 'iu').test(raw);
}
/** A paired term ("X vs Y"): frame 3 defines both (EX4-159). */
export const TERM_PAIR_RE = /\s+(?:vs\.?|versus)\s+/i;
export const STEPS_RANGE = [3, 5];
export const TRANSITIONS = ['cut'];
/** The grounds (hx-4, VISUAL_SYSTEM_4.md): the paper studio sweep, the premium lit stage, white for the close. */
export const GROUNDS = ['paper', 'stage', 'white'];
/** Grounds retired in 4.0, and what replaces them (the kit still draws them as `stage` for old projects). */
export const RETIRED_GROUNDS = { night: 'stage', forest: 'stage' };
/** Absolute words a definition says only when the mechanism guarantees them (EX4-152): a warning. */
export const OVERSTATE_RE = /\b(always|never|every(?:thing|one)?|smallest|largest|biggest|cheapest|fastest|slowest|best|worst|perfect(?:ly)?|guarantee[sd]?)\b/i;
/** A trip the voice describes (EX4-151): a going verb, "to the" (or a/an/its…), and the destination's word (group 1). */
export const TRIP_RE = /\b(?:go(?:es)?|going|went|head(?:s|ed)?|walk(?:s|ed)?|run(?:s)?|ran|drive(?:s)?|drove|travel(?:s|ed)?|hurr(?:y|ies|ied)|rush(?:es|ed)?|dash(?:es|ed)?|trip|off)\s+(?:back\s+)?(?:out\s+)?to\s+(?:the|a|an|its|his|her|their|our|your)\s+([a-z][a-z'-]+)/i;

/** A ground word's problem, or null: one of GROUNDS; night and forest are retired (hx-4). */
export function groundProblem(ground) {
  const g = String(ground ?? '').trim().toLowerCase();
  if (RETIRED_GROUNDS[g]) return `ground "${g}" is retired in 4.0: use "${RETIRED_GROUNDS[g]}" (the premium lit stage) for a dark, tense or night scene, or "paper" (the studio sweep)`;
  if (!GROUNDS.includes(g)) return `ground "${g}"; one of ${GROUNDS.join(', ')}`;
  return null;
}

/** A `look:` value's look word (`world`, `mechanism`, `blend`), or '' when it names none. */
export function lookOf(value) {
  const word = String(value ?? '').trim().toLowerCase().split(/[\s—–,;:(]+/)[0] ?? '';
  return LOOKS.includes(word) ? word : '';
}

/** Beat 4 continues the scene the viewer has seen (EX3-97): it never opens by setting it again. */
export const SCENE_SETTING_RE = /^(let's say|let us say|picture|imagine|let's look at|let us look at|think of|say you)\b/i;
/** Sound events (EX3-63): the spoken frames whose builders write them. A frame with none is silent
 *  (a warning); how many a frame needs is house style's (dense, every meaningful event), never a count here. */
export const EVENT_FRAMES = [1, 2, 3, 4, 5, 6, 7];

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


/**
 * The places of `## Anchor scene` (4.2, CONTRACT § Storyboard): `- places:` with one sub-bullet per
 * place, `<place id> — <interior | exterior: kind> — <what happens there>`; a single place may sit on
 * the `- places:` line itself, and several `- places:` lines are read too. Returns
 * [{ id, kind, what, line }] (kind and what are '' when the line leaves them out).
 */
export function placesOf(block) {
  const out = [];
  const read = (text) => {
    const line = String(text ?? '').trim();
    if (!line) return;
    const [id = '', kind = '', ...what] = line.split(/\s+[—–]\s+|\s+--?\s+/).map((x) => x.trim());
    out.push({ id: id.replace(/[,.;:]+$/, ''), kind, what: what.join(' — '), line });
  };
  const lines = String(block ?? '').split(/\r?\n/);
  lines.forEach((l, i) => {
    const head = /^-\s*places?:\s*(.*)$/i.exec(l);
    if (!head) return;
    read(head[1]);
    for (const sub of lines.slice(i + 1)) {
      if (/^\s+-\s+\S/.test(sub)) read(sub.replace(/^\s+-\s+/, ''));
      else if (sub.trim()) break;
    }
  });
  return out;
}

/**
 * The `## Visual arc` block's fields (4.2), each its text or null.
 * @returns {{ throughline: string | null, 'colour script': string | null, motifs: string | null, intensity: string | null, bridges: string | null }}
 */
export function visualArc(block) {
  /** @type {Record<string, string | null>} */
  const out = {};
  for (const name of VISUAL_ARC_FIELDS) {
    const re = new RegExp(`^-\\s*${name.replace('colour', 'colou?r')}\\s*:\\s*(.*\\S)?\\s*$`, 'im');
    const m = re.exec(String(block ?? ''));
    out[name] = m ? (m[1] ?? '').trim() : null;
  }
  return /** @type {any} */ (out);
}

/** Problems with the `## Visual arc` block (4.2): the reel planned as one film, every field written. */
function visualArcProblems(block) {
  if (block === null) return [['error', `no ## Visual arc block (${VISUAL_ARC_FIELDS.map((f) => `- ${f}:`).join(' ')}): plan the reel as one film before its frames`]];
  const out = [];
  const arc = visualArc(block);
  for (const name of VISUAL_ARC_FIELDS) {
    if (!arc[name]) out.push(['error', `no ${name} ("- ${name}: …")`]);
  }
  return out;
}

/** Problems with the `## Anchor scene` block (EX3-21, 3.1; 4.2: places, the hero, the entities). */
function anchorProblems(block) {
  if (block === null) return [['error', 'no ## Anchor scene block']];
  const out = [];
  if (!/^-\s*metaphor:\s*\S/im.test(block)) out.push(['error', 'no metaphor']);
  if (!/^-\s*hook:\s*\S/im.test(block)) out.push(['error', "no hook (the opener's moment in this world)"]);
  // Where the story happens (4.2): one line per place, its kind and what happens there.
  const places = placesOf(block);
  if (!places.length) out.push(['error', 'no places ("- places:" and one line per place: <place id> — <interior | exterior: kind> — <what happens there>)']);
  for (const p of places) {
    if (!p.kind || !p.what) out.push(['warning', `place "${p.id}" needs "<place id> — <interior | exterior: kind> — <what happens there>"`]);
    else if (!/^(interior|exterior)\b/i.test(p.kind)) out.push(['warning', `place "${p.id}" is "${p.kind}": say interior or exterior, then its kind`]);
  }
  const steps = subItems(block, 'steps');
  if (steps === null) out.push(['error', 'no steps']);
  else {
    if (steps.length < STEPS_RANGE[0] || steps.length > STEPS_RANGE[1]) out.push(['warning', `${steps.length} steps; usually ${STEPS_RANGE[0]} to ${STEPS_RANGE[1]}`]);
    const bare = steps.filter((st) => !/\S\s+[—–-]{1,2}\s+\S/.test(st));
    if (bare.length) out.push(['error', `${bare.length} step(s) without "<analogy> — <technical name>"`]);
  }
  const entities = block.split(/\r?\n/).filter((l) => /^\s+-\s+\S/.test(l) && /stands for/i.test(l));
  if (entities.length < 2) out.push(['error', `${entities.length} entities with "stands for"; at least 2`]);
  for (const line of entities) {
    const what = line.split(/stands for/i)[0];
    const m = PERSON_RE.exec(what);
    if (m && !/critter/i.test(what)) out.push(['error', `an entity is a person or a body part ("${m[0]}"); whoever acts is a critter or an object (EX3-77)`]);
  }
  if (/^-\s*peak:/im.test(block) && !/^-\s*hook:/im.test(block)) out.push(['warning', 'peak is retired; the opener shows the hook']);
  // The hero the hook follows (EX3-110): a critter, or an object (PLAN.md turn 1: critters are optional).
  const hero = /^-\s*hero:\s*([\w-]+)\s*[—–-]+\s*(critter|object)\b/im.exec(block);
  if (!hero) out.push(['error', 'no hero ("- hero: <entity id> — critter | object": the one the hook follows, EX3-110)']);
  else if (entities.length && !anchorEntities(block).has(hero[1])) out.push(['warning', `the hero "${hero[1]}" is not one of the entities' ids`]);
  // A ground on the anchor block, when one is given: paper or stage (white is the close's).
  const ground = /^-\s*ground:\s*([\w-]+)/im.exec(block)?.[1];
  if (ground) {
    const p = groundProblem(ground) ?? (ground.toLowerCase() === 'white' ? 'ground "white" is the close\'s; the anchor scene is paper or stage' : null);
    if (p) out.push(['error', p]);
  }
  return out;
}

/**
 * Reused assets fit exactly (EX3-112, EX3-113; Lucas, 2026-10-22: "I never want this stand-in look").
 * Every `prop: <name>` in the anchor block names a catalog asset, gives its `(exact: …)` reason, and
 * nothing on its line is a thing the asset's tags say it is never a stand-in for (the model-routing
 * reel's "prop: table (the desk)": a desk is in the table's `not` list).
 */
export function propFitProblems(block, entries = catalogEntries()) {
  const out = [];
  if (!block) return out;
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  for (const line of block.split(/\r?\n/)) {
    for (const m of line.matchAll(/\bprop:\s*([^(—–,;\n]+?)\s*(\((?:[^()]|\([^()]*\))*\))?(?=\s*(?:[—–,;]|$|\s-\s))/gi)) {
      const said = m[1].trim().toLowerCase();
      const name = names.find((n) => said === n || said.startsWith(`${n} `)) ?? null;
      if (!name) {
        out.push(['error', `"prop: ${m[1].trim()}" is not in the asset bank (assets/kit/props/CATALOG.md): draw it new, as this scene's own (EX3-112)`]);
        continue;
      }
      const paren = m[2] ?? '';
      if (!/^\(\s*exact:/i.test(paren)) {
        out.push(['error', `"prop: ${name}" has no "(exact: <its is line>, in <this setting>)": reuse an asset only when it is exactly the thing; otherwise draw it new (EX3-112)`]);
      }
      const rest = ` ${line.replace(/\(\s*exact:[^)]*\)/gi, ' ').toLowerCase()} `;
      for (const term of byName.get(name).tags?.not ?? []) {
        if (new RegExp(`[^a-z]${String(term).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?[^a-z]`).test(rest)) {
          out.push(['error', `"prop: ${name}" stands in for "${term}", which its tags rule out (${byName.get(name).tags.is}): draw the ${term} new (EX3-112)`]);
          break;
        }
      }
    }
  }
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

/** The tagged parts of a shot line (4.1 cast, angle, place; 4.2 why, carry): never a kind or a subject. */
const SHOT_TAGS = ['cast', 'angle', 'place', 'why', 'carry'];
const SHOT_TAG_RE = new RegExp(`^(${SHOT_TAGS.join('|')})\\s*:`, 'i');
/** A shot line without its tagged parts, whose words are never a kind or a subject. */
const untagged = (text) => String(text ?? '').replace(new RegExp(`\\s*[—–]\\s+(?:${SHOT_TAGS.join('|')})\\s*:[^—–;\\n]*`, 'gi'), '');

/** The shots a `shots:` text names, in order (the kinds only). */
export function shotKinds(text) {
  return [...untagged(text).matchAll(SHOT_KIND_RE)].map((m) => m[1].toLowerCase().replace(/^close-up$/, 'close').replace(/^cutaway$/, 'insert').replace(/^over[- ]the[- ]shoulder$/, 'ots'));
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

/** A shot line's cue: the words in `on "<cue>"` (straight, curly or single quotes, each closed by its own kind). */
const cueOf = (line) => {
  const m = /\bon\s+(?:"([^"]+)"|“([^”]+)”|'([^']+)'|‘([^’]+)’)/i.exec(line) ?? /\bon\s+["“'‘]([^"”'’]+)["”'’]/i.exec(line);
  return m ? m.slice(1).find((x) => x !== undefined).trim() : null;
};

/** The safe area (frame.md § The frame): where a carried element's screen box sits. */
export const SAFE_AREA = { x0: 96, y0: 570, x1: 940, y1: 1600 };
/**
 * A shot's `carry:` part (4.2, CONTRACT § Storyboard; NOTES-D): `<element id> box <x0> <y0> <x1> <y1>`,
 * the element's screen box at the cut, in frame px. Returns { id, box } (box null for a bare id), or
 * null when the text names no id. The kit's shots.js parseCarry reads the same declaration.
 */
export function parseCarry(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const m = /^([\w-]+)\s+box\s+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*$/i.exec(t);
  if (m) return { id: m[1], box: m.slice(2, 6).map(Number) };
  const id = /^([\w-]+)/.exec(t)?.[1];
  return id ? { id, box: null } : null;
}

/** The raw shot lines of a `shots:` text: one per sub-bullet, or `;`-separated on one line. */
export function shotLines(text) {
  return String(text ?? '').split(/\n|;/).map((x) => x.trim()).filter(Boolean);
}

/**
 * The shots of a `shots:` text: [{ kind, size, subject, cue, angle, why, cast, place, carry }]. A
 * 4.2 shot reads (CONTRACT § Storyboard):
 *   <size> — <subject> — on "<cue words>" — angle: <where the camera stands> — why: <what the viewer
 *   learns or feels>[ — cast: <entity ids>][ — place: <place id>][ — carry: <element id>]
 * one per sub-bullet, or `;`-separated on one line. Older lines (no angle, why, cast…) still parse:
 * every tagged part is optional. `size` equals `kind` (the first shot kind named); `cast` is a list of
 * ids ([] for "none", null when the shot names no cast); `carry` is parseCarry's { id, box }; `angle`,
 * `why`, `place` and `carry` are null when absent. Real Case reuses this parser.
 */
export function parseShots(text) {
  return shotLines(text)
    .map((line) => {
      const kind = shotKinds(line)[0] ?? null;
      const parts = line.split(/\s+[—–]\s+|\s+--?\s+/).map((x) => x.trim());
      const tagged = (key) => {
        const part = parts.find((p) => new RegExp(`^${key}\\s*:`, 'i').test(p));
        return part === undefined ? null : part.replace(/^\w+\s*:\s*/, '').trim();
      };
      const castText = tagged('cast');
      const cast = castText === null ? null : /^none\b/i.test(castText) ? [] : castText.split(/\s*,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
      const subject = parts.slice(1).filter((p) => !/^(on|at)\s+/i.test(p) && !/^\d/.test(p) && !SHOT_TAG_RE.test(p)).join(' ');
      return { kind, size: kind, subject, cue: cueOf(line), cast, angle: tagged('angle') || null, why: tagged('why') || null, place: tagged('place') || null, carry: parseCarry(tagged('carry')) };
    })
    .filter((x) => x.kind);
}

/** The anchor block's entities: id → { critter } (its "what it is" or its build names a critter), from its "stands for" lines. */
export function anchorEntities(block) {
  const map = new Map();
  for (const line of String(block ?? '').split(/\r?\n/)) {
    if (!/^\s+-\s+\S/.test(line) || !/stands for/i.test(line)) continue;
    const id = line.replace(/^\s+-\s+/, '').split(/\s+[—–]\s+/)[0].trim();
    const [, what = ''] = line.replace(/^\s+-\s+/, '').split(/\s+[—–]\s+/);
    map.set(id, { critter: /\bcritters?\b/i.test(`${what} ${line.split(/stands for/i)[1] ?? ''}`) });
  }
  return map;
}

/**
 * Each frame's look by frame number (4.2): Map<number, 'world' | 'mechanism' | 'blend' | ''> for
 * frames 1–7 ('' when the frame declares none or an unknown one). The pipeline and the checks read
 * the frame kind from here, never from the frame number.
 */
export function frameLooks(storyboard) {
  const map = new Map();
  for (const [n, block] of frameBlocks(storyboard)) {
    const m = /^-[ \t]*look:[ \t]*(.*)$/im.exec(block);
    if (n <= 7) map.set(n, lookOf(m?.[1]));
  }
  return map;
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

/**
 * Quoted spans in spoken text: a quote opens after a space, a dash or the line's start and closes
 * before a space or punctuation, so an apostrophe inside a word (it's, the cat's) never counts.
 */
export function quotedSpans(text) {
  const out = [];
  const re = /(^|[\s(—–:,])(["“‘'])(.+?)(["”’'])(?=$|[\s).,;:!?—–])/g;
  for (const m of String(text ?? '').matchAll(re)) out.push(m[3].trim());
  return out;
}

/** Quoted words a listener cannot hear as quoted (EX3-106): at most this many words. */
export const SPOKEN_QUOTE_MAX_WORDS = 3;
/** Symbols the voice reads badly or not at all (EX3-106). */
export const UNSAYABLE_SYMBOL_RE = /->|→|[=\/&#@<>{}[\]*]/;
/** Code-like tokens the voice cannot say: camelCase and snake_case (EX3-106). */
export const CODE_TOKEN_RE = /\b([a-z]+[A-Z][A-Za-z]*|[A-Za-z]+_[A-Za-z_]+)\b/;
/** A dotted name (file.ext, example.com): read as "dot", which a listener may not follow. */
export const DOTTED_RE = /\b[A-Za-z]+\.[A-Za-z]{2,}\b/;

/**
 * Words that can't be said out loud (EX3-106; Lucas, 2026-10-21): a listener cannot hear quote
 * marks, so a quoted word or two sounds like ordinary speech (the attention reels said "it" 16
 * times, the quoted word and the pronoun mixed); symbols and code tokens are read badly or skipped.
 */
export function unsayableProblems(voices) {
  const out = [];
  const all = [...voices.values()].join(' ');
  for (const [n, text] of voices) {
    for (const span of new Set(quotedSpans(text).map((q) => q.replace(/[.,;:!?]+$/, '')))) {
      if (countWords(span) > SPOKEN_QUOTE_MAX_WORDS) continue;
      const word = span.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
      const bare = word && countWords(word) === 1
        ? (all.match(new RegExp(`(^|[^\\p{L}"“‘'])${word}(?![\\p{L}"”’'])`, 'giu')) ?? []).length
        : 0;
      out.push([n, 'error', `the voice quotes "${span}", but a listener cannot hear quote marks${bare > 1 ? `, and "${word}" is also said ${bare} times as an ordinary word` : ''}: say it without naming the word, or show the word on screen (EX3-106)`]);
    }
    const symbol = UNSAYABLE_SYMBOL_RE.exec(text);
    if (symbol) out.push([n, 'error', `the voice has "${symbol[0]}", which the voice reads badly or skips: write it as words (EX3-106)`]);
    const code = CODE_TOKEN_RE.exec(text);
    if (code) out.push([n, 'error', `the voice has the code token "${code[0]}": say it in plain words (EX3-106)`]);
    const dotted = DOTTED_RE.exec(text);
    if (dotted) out.push([n, 'warning', `the voice has "${dotted[0]}", read with a "dot": say it the way a person would (EX3-106)`]);
  }
  return out;
}

/** Words that never count as shared material between the scene and the example. */
const MATERIAL_STOP = new Set([...SUBJECT_STOP, ...QUESTION_STOP, 'for', 'but', 'not', 'then', 'here', 'real', 'example', 'word', 'thing', 'every', 'each', 'some', 'other', 'others', 'one', 'first', 'next', 'then', 'now', 'because', 'means', 'mean', 'say', 'said', 'has', 'have', 'had', 'was', 'were', 'been', 'being', 'out', 'up', 'down', 'back', 'than', 'more', 'most', 'less', 'only', 'same', 'new', 'like', 'into', 'about', 'him', 'them', 'she', 'he', 'they', 'we', 'our', 'us', 'me', 'my', 'i']);

/** Content words by stem, each with the first way it was written. */
function materialWords(text, skip) {
  const out = new Map();
  for (const raw of String(text ?? '').split(/[^\p{L}\p{N}'’]+/u)) {
    const w = stem(raw);
    if (w.length >= 3 && !MATERIAL_STOP.has(w) && !skip.has(w) && !PROMISE_WORD_RE.test(w) && !out.has(w)) out.set(w, raw.toLowerCase());
  }
  return out;
}

/**
 * The example is never the analogy (EX3-105; Lucas, 2026-10-21). Frame 6 is the real system; the
 * anchor scene (frames 1, 4, 5) is a different world (frame 2 is the real thing too, EX3-115). An error when the example's quoted
 * material (its sentence, its values) shares two or more content words with what the scene's
 * frames say (the attention reels' party talked about a cat and a fish, and the example was "the
 * cat ignored the fish because it was tired"). A warning when frame 6 names an anchor entity.
 * Verbs a mapping naturally shares (asks, reads, answers) are not counted: only quoted material
 * is. The comprehension check judges the rest (EX3-108).
 */
export function exampleReuseProblems(voices, exampleSteps, anchorBlock, term) {
  const out = [];
  const voice = voices.get(6) ?? '';
  if (!voice.trim()) return out;
  const skip = new Set(String(term ?? '').split(/\s+/).map(stem));
  const spoken = materialWords(voice, skip);
  for (const [id] of entityAliases(anchorBlock)) {
    if (id && id.length >= 3 && spoken.has(id)) out.push([6, 'warning', `frame 6 names the anchor scene's "${id}": the example is the real thing, a different world from the scene (EX3-105)`]);
  }
  const exampleWords = materialWords(quotedSpans(voice).join(' '), skip);
  const scene = materialWords([1, 4, 5].map((n) => voices.get(n) ?? '').join(' '), skip);
  const shared = [...exampleWords.keys()].filter((w) => scene.has(w));
  if (shared.length >= 2) {
    out.push([6, 'error', `frame 6's example reuses the scene's material (${shared.map((w) => exampleWords.get(w)).join(', ')}): the analogy and the example are never the same thing; give the example its own real values (EX3-105)`]);
  }
  return out;
}

/** The anchor scene's entity ids as written, lowercased (`- <id> — … — stands for …`). */
function entityIdsOf(anchor) {
  const out = [];
  for (const line of String(anchor ?? '').split(/\r?\n/)) {
    if (!/^\s+-\s+\S/.test(line) || !/stands for/i.test(line)) continue;
    out.push(line.replace(/^\s+-\s+/, '').split(/\s+[—–]\s+/)[0].trim().replace(/[`"]/g, '').toLowerCase());
  }
  return out;
}

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

/**
 * BRIEF.md's opener line (EX3-130): the template line in its `## Opener line` section, its slot
 * still "___" ("In the next minute, this ___ will teach you an AI concept."); null when it has none.
 */
export function briefOpenerLine(brief) {
  const block = brief ? section(brief, 'Opener line') : null;
  if (!block) return null;
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim().replace(/^>\s*/, '').replace(/^[`"“]+|[`"”]+$/g, '').trim();
    if (openerKind(line)) return line;
  }
  return null;
}

const stripQuotes = (s) => String(s ?? '').trim().replace(/^["“']|["”']$/g, '').trim();
const seconds = (s) => {
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(s ?? ''));
  return m ? Number(m[1]) : NaN;
};

/**
 * @param {{ storyboard: string, script?: string | null, brief?: string | null, frameSource?: Map<number, string>, audioMeta?: unknown,
 *           frameEvents?: Map<number, unknown[]> | null, eventsTrack?: boolean | null }} input
 *   brief: BRIEF.md; frame 1 says the variant of its `## Opener line` (EX3-130).
 *   frameSource: the frame scene modules (assets/frames/NN-*.js) by frame number.
 *   audioMeta: audio_meta.json, parsed; the opener's sounds are checked only when given.
 *   frameEvents: each frame's sound events (assets/frames/NN-*.events.json), checked when given.
 *   eventsTrack: whether assets/sfx/events.wav exists, checked when given.
 */
export function lintStoryboard({ storyboard, script = null, brief = null, frameSource = new Map(), audioMeta = undefined, frameEvents = null, eventsTrack = null, catalog = catalogEntries() }) {
  const out = [];
  const { frames, globals } = parseStoryboard(storyboard);
  const scriptLines = script ? parseScript(script) : null;
  const voiceFor = (frame, i) => {
    const number = frame.number ?? i + 1;
    return scriptLines ? (scriptLines.get(number) ?? '') : (frame.voiceover ?? '');
  };
  const filled = (text) => String(text ?? '').trim() && !/<fill in/i.test(String(text));

  // The plan's blocks, the term, and the music.
  const anchorBlock = section(storyboard, 'Anchor scene');
  for (const [severity, p] of visualArcProblems(section(storyboard, 'Visual arc'))) out.push(violation('visual_arc', null, severity, p));
  for (const [severity, p] of anchorProblems(anchorBlock)) out.push(violation('anchor_scene', null, severity, p));
  for (const [severity, p] of propFitProblems(anchorBlock, catalog)) out.push(violation('prop_fit', null, severity, p));
  for (const [severity, p] of hookProblems(section(storyboard, 'Hook'))) out.push(violation('hook', null, severity, p));
  // 4.3 has no curiosity gap: a leftover block is a warning, never read.
  if (section(storyboard, 'Curiosity gap') !== null) out.push(violation('curiosity_gap', null, 'warning', '## Curiosity gap is retired in 4.3: remove it (frame 2 is the quick definition)'));
  const anchorIds = new Set(entityIdsOf(anchorBlock));
  const termRaw = String(globals?.extra?.term ?? '').trim();
  const term = /^<fill/.test(termRaw) ? '' : termRaw; // the skeleton's placeholder is no term
  const concept = String(globals?.extra?.concept ?? '').trim();
  if (!term) out.push(violation('term', null, 'error', 'no term: in the frontmatter (BRIEF.md\'s term, EX3-86)'));
  else if (countWords(term) > TERM_MAX_WORDS) out.push(violation('term', null, 'error', `term "${term}" is ${countWords(term)} words; at most ${TERM_MAX_WORDS}`));
  if (!concept || /^<fill/.test(concept)) out.push(violation('concept', null, 'error', 'no concept: in the frontmatter'));
  else if (term && normalize(concept) !== normalize(term)) out.push(violation('concept', null, 'warning', `concept "${concept}" differs from the term "${term}"`));
  const music = String(globals?.extra?.music ?? '').trim().toLowerCase();
  if (music && music !== 'none') out.push(violation('music', null, 'warning', `music "${music}": the kit picks the bed (music: none, EX3-82)`));
  const blocks = frameBlocks(storyboard);
  const aliases = entityAliases(anchorBlock);
  const pickedOpener = briefOpenerLine(brief);
  const places = placesOf(anchorBlock);
  const placeIds = new Set(places.map((p) => p.id.toLowerCase()));
  // Where the story goes (EX4-151): the places' ids, kinds and what happens there.
  const placeWords = places.map((p) => `${p.id} ${p.kind} ${p.what}`).join(' ');
  const looks = new Map();
  /** Every shot of frames 1–7 in play order, for the carries across cuts. */
  const sequence = [];
  let definitionSaid = false;
  let quickSaid = false;

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

  frames.forEach((frame, i) => {
    const n = frame.number ?? i + 1;
    const sheet = BEAT_SHEET[i];
    const extra = frame.extra ?? {};
    const field = (name) => String(extra[name] ?? '').trim();
    const type = field('type');
    if (sheet && type !== sheet.type) {
      out.push(violation('beat_type', n, 'error', `type "${type || 'missing'}"; beat ${i + 1} (${sheet.beat}) needs "${sheet.type}"`));
    }
    if (field('persuasion')) out.push(violation('persuasion_field', n, 'warning', 'persuasion is retired'));
    if (field('blueprint')) out.push(violation('blueprint', n, 'warning', 'blueprints are not used; compose from the plan and the kit'));
    if (field('sfx')) out.push(violation('sfx_retired', n, 'warning', 'sfx: lines are retired; frame workers design each frame\'s sound events'));
    for (const [name, now] of Object.entries(RETIRED_FIELDS)) {
      if (field(name)) out.push(violation('retired_field', n, 'warning', `"${name}:" is retired in 4.2: ${now}`));
    }

    // Hold (EX3-60, EX3-79): the pause after the voice (the close has none).
    const hold = seconds(field('hold'));
    if (sheet?.voiceless) {
      // The close (EX3-95): no voice, so no hold; code makes it 2.5s.
    } else if (!Number.isFinite(hold)) out.push(violation('hold', n, 'error', 'no hold (the pause after the line)'));
    else if (sheet && hold > sheet.hold + 1e-9) out.push(violation('hold', n, 'error', `hold ${hold}s; at most ${sheet.hold}s`));

    // The look (4.2): frames 1–7 each declare one; the builders and the checks read it.
    const lookRaw = field('look');
    if (sheet?.voiceless || i >= BEAT_SHEET.length - 1) {
      if (lookRaw) out.push(violation('look', n, 'warning', 'the close is code\'s and has no look'));
    } else if (!lookRaw || /^<fill/.test(lookRaw)) out.push(violation('look', n, 'error', `no look ("- look: ${LOOKS.join(' | ')}")`));
    else if (!lookOf(lookRaw)) out.push(violation('look', n, 'error', `look "${lookRaw}"; one of ${LOOKS.join(', ')}`));
    else {
      looks.set(n, lookOf(lookRaw));
      const allowed = BEAT_LOOKS[n];
      if (allowed && !allowed.includes(lookOf(lookRaw))) {
        out.push(violation('look', n, n === 1 ? 'error' : 'warning', `look "${lookOf(lookRaw)}" on beat ${n}: its job takes ${allowed.join(' or ')}${n === 1 ? ' (the hook is a moment of the anchor scene, drawn through the camera)' : ' (it shows the real technology)'}`));
      }
    }

    // Shots (4.2, CONTRACT § Storyboard): every line a size, a subject, its cue, an angle and a why.
    const text = shotsText(blocks.get(n));
    const shots = parseShots(text);
    // (a frame with no shot list, frame 3's hand-off or frame 5's one framing, still stands between its neighbours)
    if (n <= 7) (shots.length && !/<fill in/i.test(text ?? '') ? shots : [{ carry: null }]).forEach((shot, k) => sequence.push({ n, k, shot }));
    const vo = voiceFor(frame, i);
    if (sheet?.shots && (!text || !shots.length)) out.push(violation('shots', n, 'error', 'no shots: (one line per shot: <size> — <subject> — on "<cue words>" — angle: <where the camera stands> — why: <what the viewer learns or feels>)'));
    if (text && filled(text)) {
      const lack = { cue: [], angle: [], why: [] };
      shotLines(text).forEach((line, k) => {
        const kind = shotKinds(line)[0];
        const name = `shot ${k + 1}`;
        if (!kind) {
          out.push(violation('shot_line', n, 'error', `${name} names no size ("${line.slice(0, 60)}"): it starts with one of ${SHOT_SIZES.join(', ')}`));
          return;
        }
        if (REMOVED_SHOTS.has(kind)) {
          out.push(violation('shot_kind', n, 'error', `${name} is a ${kind} shot: removed in 3.3 (a shot is only a camera), EX3-90; the sizes are ${SHOT_SIZES.join(', ')}`));
          return;
        }
        if (!SHOT_SIZES.includes(kind)) out.push(violation('shot_kind', n, 'error', `${name} is a ${kind} shot; a shot's size is one of ${SHOT_SIZES.join(', ')}`));
        const [shot] = parseShots(line);
        if (k > 0 && !shot.cue) lack.cue.push(k + 1);
        if (!shot.angle) lack.angle.push(k + 1);
        if (!shot.why) lack.why.push(k + 1);
        if (shot.carry) {
          const b = shot.carry.box;
          if (!b) out.push(violation('carry', n, 'warning', `${name} carries "${shot.carry.id}" with no screen box (— carry: ${shot.carry.id} box <x0> <y0> <x1> <y1>): both sides of the cut need the same spot`));
          else if (!(b[0] < b[2] && b[1] < b[3]) || b[0] < SAFE_AREA.x0 || b[2] > SAFE_AREA.x1 || b[1] < SAFE_AREA.y0 || b[3] > SAFE_AREA.y1) {
            out.push(violation('carry', n, 'warning', `${name} carries "${shot.carry.id}" in box ${b.join(' ')}: give x0 < x1 and y0 < y1, inside the safe area (x ${SAFE_AREA.x0}–${SAFE_AREA.x1}, y ${SAFE_AREA.y0}–${SAFE_AREA.y1})`));
          }
        }
        if (shot.place && placeIds.size && !placeIds.has(shot.place.toLowerCase())) {
          out.push(violation('shot_ref', n, 'warning', `${name} is set in "${shot.place}", which is not one of the anchor scene's places (${[...placeIds].join(', ')})`));
        }
      });
      const PART = { cue: '— on "<the words the cut lands on>"', angle: '— angle: <where the camera stands>', why: '— why: <what the viewer learns or feels>' };
      for (const [part, ks] of Object.entries(lack)) {
        if (ks.length) out.push(violation('shot_line', n, 'error', `shot${ks.length > 1 ? 's' : ''} ${ks.join(', ')} name${ks.length > 1 ? '' : 's'} no ${part} (${PART[part]})`));
      }
      // The shot's subject is what the voice is naming during it (EX3-91), a warning.
      if (SUBJECT_FRAMES.includes(n) && filled(vo)) {
        for (const { shot, window } of shotWindows(shots, vo)) {
          if (window === null) {
            if (shot.cue) out.push(violation('shot_cue', n, 'warning', `the ${shot.kind} shot's cue "${shot.cue}" is not in the voiceover`));
          }
          else if (!subjectSpoken(shot.subject, window, aliases)) {
            out.push(violation('shot_subject', n, 'warning', `the ${shot.kind} shot on "${shot.subject}" plays while the voice says "${window}": frame what the voice is naming (EX3-91)`));
          }
        }
      }
      // Every trip the voice describes is shown (EX4-151): its destination is a shot's, or a place's.
      if (filled(vo)) {
        const shown = new Set([...shots.flatMap((x) => [x.subject, x.angle ?? '', x.place ?? '']), placeWords].join(' ').split(/[^\p{L}\p{N}'-]+/u).map(stem).filter(Boolean));
        for (const m of stripQuotes(vo).matchAll(new RegExp(TRIP_RE.source, 'gi'))) {
          const where = stem(m[1]);
          if (where && !SUBJECT_STOP.has(where) && !shown.has(where)) {
            out.push(violation('trip_shown', n, 'warning', `the voice says "${m[0]}", but no shot and no place shows the ${m[1]}: show the trip (minimums.md 4)`));
          }
        }
      }
    }
    if (!String(frame.scene ?? '').trim()) out.push(violation('visual_missing', n, 'error', 'no scene: the frame names what the viewer sees'));

    // Ground (EX3-42, hx-4): paper, stage, or white (the last frame only, which must be white).
    const ground = field('ground').toLowerCase();
    if (!ground) out.push(violation('ground', n, 'error', 'no ground'));
    else if (groundProblem(ground)) out.push(violation('ground', n, 'error', groundProblem(ground)));
    else if (i === BEAT_SHEET.length - 1 && ground !== 'white') out.push(violation('ground', n, 'error', 'the last frame is white'));
    else if (i < BEAT_SHEET.length - 1 && ground === 'white') out.push(violation('ground', n, 'error', 'only the last frame is white'));

    if (i === 0) {
      // The opener points at the scene (EX3-96, EX3-130): a template, its slot naming what the hook
      // shows; the variant BRIEF.md's `## Opener line` gives, when it gives one.
      const m = OPENER_RE.exec(stripQuotes(vo).replace(/[‘’]/g, "'"));
      const wanted = pickedOpener ? [pickedOpener] : Object.values(OPENER_TEMPLATES);
      if (!m) out.push(violation('opener_line', n, 'error', `frame 1 says "${vo}"; the line is ${wanted.map((x) => `"${x}"`).join(' or ')}`));
      else {
        if (pickedOpener && openerKind(stripQuotes(vo)) !== openerKind(pickedOpener)) {
          out.push(violation('opener_line', n, 'error', `frame 1 says "${vo}", but BRIEF.md's opener line is "${pickedOpener}": say that line with its slot filled (EX3-130)`));
        }
        const slot = countWords(m[1]);
        if (slot < OPENER_SLOT_WORDS[0] || slot > OPENER_SLOT_WORDS[1]) out.push(violation('opener_line', n, 'error', `the opener's slot "${m[1]}" is ${slot} words; ${OPENER_SLOT_WORDS[0]} to ${OPENER_SLOT_WORDS[1]}`));
        const anchorWords = new Set(String(anchorBlock ?? '').split(/[\s,.;:()]+/).map(stem));
        const named = m[1].split(/\s+/).map(stem).filter((w) => w && !SUBJECT_STOP.has(w));
        if (named.length && !named.some((w) => anchorWords.has(w))) out.push(violation('opener_line', n, 'warning', `the opener's slot "${m[1]}" names nothing in the anchor scene`));
      }
    } else if (sheet?.voiceless) {
      if (stripQuotes(vo)) out.push(violation('close_voiceover', n, 'error', 'the close has no voiceover (EX3-95): the logo and "AI BRAIN BREAK" only'));
    } else if (i === 2) {
      // The hand-off (4.3): the fixed line, said exactly; code builds the frame from the plan's
      // mapped parts and world sounds (handoff-bank.js), so it names them.
      if (normalize(stripQuotes(vo)) !== normalize(HANDOFF_LINE)) out.push(violation('handoff_line', n, 'error', `frame 3 says "${vo}"; the hand-off line is "${HANDOFF_LINE}", exactly`));
      const parts = field('handoff_parts').replace(/<fill in[^>]*>/i, '').split(/[,;]/).map((x) => x.trim().replace(/[`"]/g, '')).filter((x) => x && !/^none$/i.test(x));
      if (!field('handoff_parts')) out.push(violation('handoff_parts', n, 'warning', 'no handoff_parts: (2–3 entity ids of the analogy\'s mapped parts, or none): the gather templates draw them around the card'));
      const unknown = anchorIds.size ? parts.filter((x) => !anchorIds.has(x.toLowerCase())) : [];
      if (unknown.length) out.push(violation('handoff_parts', n, 'warning', `handoff_parts names ${unknown.map((x) => `"${x}"`).join(', ')}, not the anchor scene's entities`));
      if (!field('world_sounds')) out.push(violation('world_sounds', n, 'warning', "no world_sounds: (1–2 foley words from frame.md's list that the analogy's world makes, or none)"));
    } else if (sheet?.words) {
      const words = countWords(vo);
      if (words < sheet.words[0] || words > sheet.words[1]) {
        out.push(violation('voiceover_words', n, 'warning', `${words} words; beat ${i + 1} takes ${sheet.words[0]}–${sheet.words[1]}`));
      }
    }

    // Beat 2 (4.3): the quick definition, one plain sentence of about 15 words, "[Term] is when …",
    // written fresh from the mechanism; captions only (the dictionary card is frame 5's).
    if (i === 1 && vo) {
      const plain = stripQuotes(vo);
      quickSaid = Boolean(plain) && !/^<fill/.test(plain);
      const said = sentences2(plain);
      if (said.length > 1) out.push(violation('quick_definition', n, 'warning', `the quick definition is ${said.length} sentences: one plain sentence`));
      if (countWords(plain) > QUICK_DEFINITION_MAX) out.push(violation('quick_definition', n, 'warning', `the quick definition is ${countWords(plain)} words; about ${QUICK_DEFINITION_MAX} at most`));
      if (term && !normalize(plain).includes(normalize(term))) out.push(violation('quick_definition', n, 'error', `the quick definition does not name the term "${term}": "[Term] is when …"`));
      else if (term && !new RegExp(`^(?:a |an |the )?${normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (is|are) `).test(normalize(plain))) out.push(violation('quick_definition', n, 'warning', `the quick definition does not open "${term} is …": "[Term] is when …"`));
      const overstated = OVERSTATE_RE.exec(plain);
      if (overstated) out.push(violation('definition_overstated', n, 'warning', `the quick definition says "${overstated[0]}": claim no more than the mechanism does (minimums.md 3)`));
      const jargon = jargonCandidates(vo).filter((j) => normalize(j) !== normalize(term) && !/^ai$/i.test(j));
      if (jargon.length) out.push(violation('quick_definition_jargon', n, 'warning', `possible jargon in the quick definition: ${jargon.join(', ')}`));
    }
    // Beat 5 (4.3): the definition payoff. The dictionary card (EX3-14) shows the term restated,
    // `definition:`, which is the voiceover's first words, word for word; the rest of the line is
    // why the analogy works. That a definition exists is minimum 3.
    if (n === DEFINITION_FRAME) {
      const definition = stripQuotes(field('definition'));
      definitionSaid = !!definition && !/^<fill/.test(definition);
      if (definitionSaid && !normalize(vo).startsWith(normalize(definition))) out.push(violation('definition', n, 'error', 'the definition is not the voiceover\'s first words, word for word (the card writes it as it is said)'));
      if (!field('part_of_speech')) out.push(violation('definition', n, 'error', 'no part_of_speech: (the dictionary card)'));
      // A paired term ("X vs Y") is defined side by side: each side is named (EX4-159).
      const sides = TERM_PAIR_RE.test(term) ? term.split(TERM_PAIR_RE) : [term];
      const missingSide = sides.find((x) => x && !normalize(definition).includes(normalize(x)));
      if (term && definitionSaid && missingSide !== undefined) {
        out.push(violation('definition_term', n, 'error', sides.length > 1 ? `the definition does not define "${missingSide}": a paired term defines both sides (EX4-159)` : `the definition does not define the term "${term}" (EX3-86)`));
      }
      if (/\b(when something happens|some data|a thing that|something that|stuff)\b/i.test(definition || vo)) {
        out.push(violation('definition_vague', n, 'warning', 'vague phrase in the definition; name the trigger and the receiver'));
      }
      const overstated = OVERSTATE_RE.exec(definition || vo);
      if (overstated) out.push(violation('definition_overstated', n, 'warning', `the definition says "${overstated[0]}": claim no more than the mechanism does, unless it guarantees it (minimums.md 3)`));
    }
    // Beat 4 continues the scene the viewer has seen (EX3-97): no "Picture…" restart.
    if (i === 3 && vo && SCENE_SETTING_RE.test(stripQuotes(vo))) {
      out.push(violation('scene_setting', n, 'error', 'beat 4 restarts the scene ("Picture…", "Imagine…", "Let\'s say…"); continue the story the hook began'));
    }
    // Beat 7 (4.3, minimums.md 7): the reel ends on what the concept means for the viewer. A
    // heuristic, so a warning: its last sentence speaks to them.
    if (i === 6 && filled(vo)) {
      const said = sentences2(stripQuotes(vo));
      if (said.length && !VIEWER_RE.test(said[said.length - 1])) out.push(violation('minimum:7', n, 'warning', 'the tie-together does not end on the viewer: its last sentence says what the concept means for them, in real terms (minimums.md 7)'));
    }
    for (const s of sentences(vo)) narration.add(s);
    // Copy only: narration, the visual line, and the title. Narrative prose is planning notes.
    const copy = [vo, frame.scene, frame.title].join('\n');
    if (/!(?!\[)/.test(copy.replace(/!\[[^\]]*\]\([^)]*\)/g, ''))) {
      out.push(violation('exclamation_mark', n, 'error', 'exclamation mark in voiceover or on-screen copy'));
    }
    if (EMOJI_RE.test(copy)) out.push(violation('emoji', n, 'error', 'emoji in voiceover or on-screen copy'));
  });

  // A carry is declared on both shots of its cut, with the same box (NOTES-D): the two builders work
  // in parallel and meet only on the declared spot.
  sequence.forEach(({ n, k, shot }, i) => {
    if (!shot.carry) return;
    const sides = [sequence[i - 1], sequence[i + 1]].filter((x) => x?.shot.carry?.id === shot.carry.id);
    const where = `frame ${n} shot ${k + 1}`;
    if (!sides.length) out.push(violation('carry', n, 'warning', `${where} carries "${shot.carry.id}", but neither shot on the other side of its cut does: declare it on both shots, with the same box`));
    else if (shot.carry.box && sides.every((x) => x.shot.carry.box && x.shot.carry.box.join(' ') !== shot.carry.box.join(' '))) {
      out.push(violation('carry', n, 'warning', `${where} carries "${shot.carry.id}" in box ${shot.carry.box.join(' ')}, but the other side of its cut gives another box: one spot on both sides`));
    }
  });

  // The minimums a plan can show (recipe/minimums.md; CONTRACT § Storyboard): warnings, never a stop.
  if (frames.length) {
    const declared = [...looks.values()];
    if (!declared.includes('world')) out.push(violation('minimum:1', null, 'warning', 'no frame has look: world: the analogy plays out in full at least once (minimums.md 1)'));
    if (!declared.some((l) => l === 'mechanism' || l === 'blend')) out.push(violation('minimum:2', null, 'warning', 'no frame has look: mechanism or blend: the real mechanism is shown working at least once (minimums.md 2)'));
    if (frames.length >= 2 && !quickSaid) out.push(violation('minimum:3', 2, 'warning', 'frame 2 says no quick definition (true and clear; minimums.md 3)'));
    if (frames.length >= DEFINITION_FRAME && !definitionSaid) out.push(violation('minimum:3', DEFINITION_FRAME, 'warning', `frame ${DEFINITION_FRAME} has no definition: (the dictionary card, true and clear; minimums.md 3)`));
  }

  // What the voice says, by frame: words a listener can't hear as written (EX3-106), and an
  // example that reuses the scene (EX3-105).
  const voices = new Map(frames.map((f, i) => [f.number ?? i + 1, voiceFor(f, i)]).filter(([n, v]) => n <= 7 && String(v).trim() && !/<fill in/.test(String(v))));
  for (const [n, severity, p] of unsayableProblems(voices)) out.push(violation('unsayable', n, severity, p));
  // "Critter" is the drawing style's word, never said (EX3-121; Lucas, 2026-10-22: "sometimes the
  // vo/caption calls them 'critters'. That's incorrect"): characters are named by their role.
  for (const [n, v] of voices) {
    const said = /\bcritters?\b/i.exec(stripQuotes(v));
    if (said) out.push(violation('said_critter', n, 'error', `the voice says "${said[0]}": name each character by its role in the scene; "critter" is never said or shown (EX3-121)`));
  }
  for (const [n, severity, p] of exampleReuseProblems(voices, '', anchorBlock, term)) {
    out.push(violation('example_reuses_scene', n, severity, p));
  }

  // Built frames, when present: emoji and narration repeated on screen, in the scene modules'
  // source (their SVG text is string literals there); the dictionary card's headword is the term.
  if (term && frameSource.has(DEFINITION_FRAME) && !headwordShown(frameSource.get(DEFINITION_FRAME), term)) {
    out.push(violation('headword_term', DEFINITION_FRAME, 'error', `frame ${DEFINITION_FRAME}'s dictionary card does not show the term "${term}"`));
  }
  for (const [n, raw] of frameSource) {
    const source = stripComments(raw); // comments are never drawn
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

  // Sound events (EX3-63), once frames are built: a spoken frame with none is silent; and the mix.
  if (frameEvents) {
    for (const f of frames) {
      const n = f.number;
      const list = frameEvents.get(n);
      const count = Array.isArray(list) ? list.length : 0;
      // a bank opener's frame 1 sounds through its stem, not events (EX3-102)
      const stem = n === 1 && (audioMeta?.sfx ?? []).some((x) => x?.role === 'opener-stem');
      if (EVENT_FRAMES.includes(n) && count === 0 && !stem) {
        out.push(violation('sound_events', n, 'warning', 'no sound events: the frame is silent (house-style.md § Sound and music)'));
      }
    }
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
    console.error('usage: lint-storyboard.mjs --storyboard STORYBOARD.md [--script SCRIPT.md] [--brief BRIEF.md] [--frames-dir dir] [--audio-meta file] [--events-track file] [--out file]');
    process.exit(2);
  }
  try {
    const scriptPath = flag('script');
    const metaPath = flag('audio-meta');
    // BRIEF.md's picked curiosity gap (EX3-120): --brief, or the BRIEF.md beside the storyboard.
    const briefPath = flag('brief') ?? resolve(dirname(resolve(storyboardPath)), 'BRIEF.md');
    const result = lintStoryboard({
      storyboard: readFileSync(resolve(storyboardPath), 'utf8'),
      script: scriptPath && existsSync(scriptPath) ? readFileSync(resolve(scriptPath), 'utf8') : null,
      brief: existsSync(resolve(briefPath)) ? readFileSync(resolve(briefPath), 'utf8') : null,
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
