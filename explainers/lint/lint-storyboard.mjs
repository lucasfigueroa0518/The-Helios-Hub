#!/usr/bin/env node
// lint-storyboard.mjs — deterministic checks on an Explainer Reel's plan (Explainers 4.1:
// planning/Explainer Reels/DECISIONS.md EX3-10 to EX3-24, EX3-60 to EX3-132, the visual system's
// grounds, sizes and outfits (planning/Explainer Reels/VISUAL_SYSTEM_4.md), and 4.1's plan rules,
// EX4-145 to EX4-154: the place beyond, each shot's cast and angle, the cut rule, the named hero,
// trips shown, the definition's part, the tech beats' techniques). No model, no judgment: it
// reports structure against the fixed eight-beat sheet. Violations are recorded and the render
// continues (E-07, EX3-06).
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
 * The fixed beat sheet (EX3-10; 3.2: EX3-79, EX3-83, EX3-87; 3.3: EX3-95, EX3-96; 4.1: the hold is
 * pace.mjs's HOLD, 0.15s, and the opener's nominal length is its line's, about 4.5s): order,
 * storyboard `type`, nominal seconds, anchor rule (`scene`, `own`, or none), the voiceover word
 * range, the longest hold after the voice, and the fewest shots (frames 3 and 8 have no shot
 * list). The close (frame 8) is voiceless and code's: 2.5s, no words, no hold. 3.9 (EX3-128):
 * beat 5 is why the analogy works, then where it breaks; beat 7 is the payoff.
 */
export const BEAT_SHEET = [
  { beat: 'series opener', type: 'hook', seconds: 4.5, anchor: 'scene', words: null, hold: 0.15, shots: 1 },
  { beat: 'curiosity gap', type: 'pain_point', seconds: 9, anchor: 'own', words: [18, 36], hold: 0.15, shots: 2 },
  { beat: 'define', type: 'product_intro', seconds: 7, anchor: 'own', words: [12, 26], hold: 0.15, shots: 0 },
  { beat: 'everyday analogy', type: 'feature_showcase', seconds: 12, anchor: 'scene', words: [20, 36], hold: 0.15, shots: 2 },
  { beat: 'why it works, where it breaks', type: 'feature_showcase', seconds: 10, anchor: 'scene', words: [18, 34], hold: 0.15, shots: 2 },
  { beat: 'tiny real example', type: 'social_proof', seconds: 10, anchor: 'own', words: [18, 32], hold: 0.15, shots: 2 },
  { beat: 'the payoff', type: 'benefit_highlight', seconds: 6, anchor: 'own', words: [12, 26], hold: 0.15, shots: 1 },
  { beat: 'close', type: 'branding', seconds: 2.5, anchor: null, words: null, hold: null, shots: 0, voiceless: true },
];

/** The series opener's line (EX3-96; 3.9, EX3-130: "the next minute", and an AI or a tech concept).
 *  Code picks the kind from the topic's ai_focus score and writes the exact line into BRIEF.md's
 *  `## Opener line`; the slot names what the hook shows in 1–3 words. */
export const OPENER_TEMPLATES = {
  ai: 'In the next minute, this ___ will teach you an AI concept.',
  tech: 'In the next minute, this ___ will teach you a tech concept.',
};
/** Either variant; group 1 is the slot, group 2 the kind ("an ai" or "a tech"). */
export const OPENER_RE = /^in the next minute,? this (.+?) will teach you (an ai|a tech) concept\.?$/i;
export const OPENER_SLOT_WORDS = [1, 3];
/** The opener kind a line uses: 'ai', 'tech', or null when it is neither template. */
export function openerKind(line) {
  const m = OPENER_RE.exec(String(line ?? '').trim().replace(/[‘’]/g, "'"));
  return m ? (/ai/i.test(m[2]) ? 'ai' : 'tech') : null;
}
/** Words for the real technology a viewer meets (an AI, a chatbot, an app, search, a phone…). The
 *  example-reuse check skips them. Frame 2 no longer has to say one (gap_real removed, EX3-120). */
export const PROMISE_WORD_RE = /\b(ai|a\.i\.|models?|chatbots?|assistants?|agents?|llms?|chatgpt|siri|alexa|apps?|search(?:es)?|phones?|websites?|software|computers?|online|internet|emails?|feeds?)\b/i;
/** A toss to the next beat (EX3-116; Lucas, 2026-10-22: "That makes it feel like we're going to
 *  commercial break"): the gap ends on the viewer's question and the definition answers it. */
export const TOSS_RE = /\b(stick around|stay tuned|keep watching|stay with me|hang (?:on|tight)|wait for it|let'?s find out|find out (?:how|why|what)|here'?s (?:the thing|why|how)|but first|watch closely|don'?t go anywhere|before we (?:get|go))\b/i;
/** Frame 2 never claims a parallel the viewer cannot check yet (EX3-101). */
export const SAME_SPOT_RE = /\b(same spot|same boat|same position|same situation|same problem)\b/i;
/** Words that never make a question's key words (the frame 7 payoff check). */
const QUESTION_STOP = new Set(['so', 'how', 'why', 'what', 'when', 'who', 'which', 'does', 'do', 'did', 'can', 'could', 'would', 'will', 'is', 'are', 'it', 'its', 'you', 'your', 'they', 'the', 'a', 'an', 'to', 'of', 'at', 'all', 'just', 'get', 'that', 'this', 'there', 'be', 'not', 'too', 'and', 'or', 'with', 'without', 'anyway', 'even']);

/** The reel usually runs 50–65s; outside it is a warning, never an error: words are never cut for length (EX3-79). */
export const TOTAL_RANGE = [50, 65];
export const TERM_MAX_WORDS = 4;
/** Shot kinds a storyboard `shots:` line may name (EX3-83, the kit's shots.js); `ots` and
 *  `reverse` are read so they can be flagged (removed in 3.3, EX3-90). */
export const SHOT_KIND_RE = /\b(wide|medium|close(?:-up)?|insert|cutaway|reaction|ots|over[- ]the[- ]shoulder|reverse)\b/gi;
export const REMOVED_SHOTS = new Set(['ots', 'reverse']);
/** The closer shot kinds: punctuation in the analogy's frames, never most of them (frame.md § Shots). */
export const CLOSER_SHOTS = ['close', 'insert', 'reaction'];
/** A frame module's source without its comments (nothing in a comment is drawn). Leaves `://` in strings alone. */
export function stripComments(source) {
  return String(source ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}
/** Frames whose shot subjects must be spoken in their window (EX3-91). Frame 1's line is the
 *  opener's; its hook is judged on its own. */
export const SUBJECT_FRAMES = [2, 4, 5, 6, 7];
/** On the anchor-scene frames a mismatch is an error; on frames 6 and 7 (their own pictures) a warning. */
export const SUBJECT_ERROR_FRAMES = [2, 4, 5];
/** People and body parts never appear (EX3-77): critters act. */
export const PERSON_RE = /\b(hands?|fingers?|fingertips?|palms?|fists?|arms?|person|people|humans?|man|woman|men|women|boy|girl|child|kid|figure)\b/i;
/** Frame 6's example steps (EX3-87): as many as the anchor scene's steps, step N mirroring step N (EX3-129). */
export const EXAMPLE_STEPS_RANGE = [3, 5];
export const MAX_ENTITIES = 4;
/** An actor outside the mapping, when the director casts one, is written "stands for the actor: …"; one at most, beside the 4 (EX4-158). */
export const ACTOR_RE = /stands for the actor\b/i;
/** A paired term ("X vs Y"): frame 3 defines both, and term_part names both parts (EX4-159). */
export const TERM_PAIR_RE = /\s+(?:vs\.?|versus)\s+/i;
export const STEPS_RANGE = [3, 5];
export const TRANSITIONS = ['cut'];
/** The grounds (hx-4, VISUAL_SYSTEM_4.md): the paper studio sweep, the premium lit stage, white for the close. */
export const GROUNDS = ['paper', 'stage', 'white'];
/** Grounds retired in 4.0, and what replaces them (the kit still draws them as `stage` for old projects). */
export const RETIRED_GROUNDS = { night: 'stage', forest: 'stage' };
/** The real-tech frames (hx-4): glass and gloss on the paper studio ground. */
export const GLASS_FRAMES = [2, 3, 6];
/**
 * The techniques a tech beat picks from (4.1, EX4-154; principles.md § 6): explain.js TECHNIQUE_IDS,
 * kept equal by the lint test (the lint never loads the drawing kit).
 */
export const TECHNIQUE_IDS = ['process', 'before-after', 'comparison', 'transformation', 'scale', 'structure', 'timeline', 'cause-effect', 'product', 'match-cut'];
/** Frames that name their `technique:`; frame 7 does too when it is built in glass (`anchor: own`). */
export const TECHNIQUE_FRAMES = [2, 3, 6];
/** Frame 7 is built in glass (`own`) or as a callback to the analogy world (`scene`) (EX4-153). */
export const FRAME7_ANCHORS = ['own', 'scene'];
/** The frames shot through the analogy world's camera, whose shots name a cast and an angle (frame 7 when `anchor: scene`). */
export const SCENE_SHOT_FRAMES = [1, 4, 5];
/** At most this many critters in one shot; a crowd is one subject (principles.md § 3, EX4-146). */
export const MAX_SHOT_CRITTERS = 3;
/** Absolute words a definition says only when the mechanism guarantees them (EX4-152): a warning. */
export const OVERSTATE_RE = /\b(always|never|every(?:thing|one)?|smallest|largest|biggest|cheapest|fastest|slowest|best|worst|perfect(?:ly)?|guarantee[sd]?)\b/i;
/** A trip the voice describes (EX4-151): a going verb, "to the" (or a/an/its…), and the destination's word (group 1). */
export const TRIP_RE = /\b(?:go(?:es)?|going|went|head(?:s|ed)?|walk(?:s|ed)?|run(?:s)?|ran|drive(?:s)?|drove|travel(?:s|ed)?|hurr(?:y|ies|ied)|rush(?:es|ed)?|dash(?:es|ed)?|trip|off)\s+(?:back\s+)?(?:out\s+)?to\s+(?:the|a|an|its|his|her|their|our|your)\s+([a-z][a-z'-]+)/i;
/** Story exaggeration of a real size is capped (hx-4, still 01): SIZES' `exaggerate` at most this, bigger or smaller. */
export const MAX_EXAGGERATE = 1.5;
/** A critter is the scene's ruler (core.js CRITTER_CM): it needs no size of its own. */
export const CRITTER_CM = 72;
/** Things worn over a critter's eyes or mouth (EX3-103): never part of a look; glasses are the one exception. */
export const FACE_COVER_RE = /\b(masks?|blindfolds?|hoods?|visors?|sunglasses|balaclavas?|veils?|goggles|eye ?patch(?:es)?|face ?shields?)\b|\bscarf\s+(?:over|across|covering)\s+(?:the\s+|its\s+)?(?:mouth|face)\b/i;

/**
 * An entity line's real size (hx-4, still 01): `size: 26 cm`, or `size: 70 × 70 × 180 cm`, with an
 * optional story exaggeration `(exaggerate 1.3×)`. Returns null when the line has no `size:`, else
 * { dims: [cm…], unit, exaggerate } (unit is null when the size names none).
 */
export function parseSize(line) {
  const m = /\bsize:\s*([^—–;\n]*)/i.exec(String(line ?? ''));
  if (!m) return null;
  const text = m[1];
  const dims = /^\s*(\d+(?:\.\d+)?)(?:\s*[×x*]\s*(\d+(?:\.\d+)?))?(?:\s*[×x*]\s*(\d+(?:\.\d+)?))?\s*(cm|mm|m)?\b/i.exec(text);
  const ex = /exaggerat\w*\s*(\d+(?:\.\d+)?)/i.exec(text);
  return {
    dims: dims ? dims.slice(1, 4).filter(Boolean).map(Number) : [],
    unit: dims?.[4]?.toLowerCase() ?? null,
    exaggerate: ex ? Number(ex[1]) : null,
  };
}

/**
 * A critter's look line (EX3-107, hx-4): `look: <orange|ink|paper>, outfit <the role's outfit>`. The
 * stock `wear` list is accepted only with its exact-match reason, `wear <items> (exact: <why each is
 * exactly the role's own>)`, or as `wear none`. Returns the problems, as strings.
 */
export function lookLineProblems(line) {
  const text = String(line ?? '');
  const look = /\blook:\s*(orange|ink|paper)\b([^—–\n]*)/i.exec(text);
  if (!look) return [];
  const rest = look[2];
  const out = [];
  const outfitM = /\boutfit\b\s*:?\s*(.*?)(?=\bwear\b|$)/i.exec(rest);
  const wearM = /\bwear\b\s*:?\s*(.*)$/i.exec(rest);
  const outfit = outfitM ? outfitM[1].replace(/[\s,;.]+$/, '').trim() : null;
  const wear = wearM ? wearM[1].trim() : null;
  const short = text.trim().replace(/^-\s*/, '').slice(0, 60);
  if (outfit === null && wear === null) {
    out.push(`a critter has no outfit ("look: <orange|ink|paper>, outfit <its role's outfit, drawn for this reel>"): ${short}`);
  }
  if (outfit !== null && !/[\p{L}]/u.test(outfit)) out.push(`a critter's outfit is empty: name the outfit drawn for its role, or "outfit none": ${short}`);
  if (outfit && /\borange\b/i.test(outfit)) out.push(`an outfit is orange ("${outfit}"): orange is the hero's body and the focal, never an outfit color`);
  if (wear !== null && !/^none\b/i.test(wear) && !/\(\s*exact:/i.test(wear)) {
    out.push(`"wear ${wear.replace(/[\s,;.]+$/, '')}" is the stock list, used only on an exact match: draw the role's outfit ("outfit <…>"), or say why each stock item is exactly the role's own ("wear <items> (exact: <why>)")`);
  }
  const cover = FACE_COVER_RE.exec(rest);
  if (cover) out.push(`"${cover[0]}" covers a critter's eyes or mouth: nothing worn ever does, glasses excepted (EX3-103)`);
  return out;
}

/** A ground word's problem, or null: one of GROUNDS; night and forest are retired (hx-4). */
export function groundProblem(ground) {
  const g = String(ground ?? '').trim().toLowerCase();
  if (RETIRED_GROUNDS[g]) return `ground "${g}" is retired in 4.0: use "${RETIRED_GROUNDS[g]}" (the premium lit stage) for a dark, tense or night scene, or "paper" (the studio sweep)`;
  if (!GROUNDS.includes(g)) return `ground "${g}"; one of ${GROUNDS.join(', ')}`;
  return null;
}

/** Beat 4 continues the scene the viewer has seen (EX3-97): it never opens by setting it again. */
export const SCENE_SETTING_RE = /^(let's say|let us say|picture|imagine|let's look at|let us look at|think of|say you)\b/i;
/**
 * Beat 5 ends on where the analogy breaks (EX3-128): its one limit or trade-off. A heuristic, so a
 * warning: some sentence of frame 5 carries a word that marks a limit ("but", "except", "only",
 * "unless", "however", "though", "can't", "won't", "breaks", "limit", "trade-off", "downside").
 */
export const LIMIT_CUE_RE = /\b(but|except|only|unless|however|though|although|can'?t|cannot|won'?t|doesn'?t work|breaks?|limits?|limited|limitation|trade-?offs?|downside)\b/i;
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
  // The set makes the place read (frame.md V-4, the set and the cast): its room, fixtures and signs.
  if (!/^-\s*set:\s*\S/im.test(block)) out.push(['error', 'no set ("- set: <the place, its 3–5 tells, its walls and openings, its density>": a place a stranger recognizes in one second, principles.md § 1)']);
  // Every place the story goes to exists (EX4-151): the place beyond, or none.
  if (!/^-\s*beyond:\s*\S/im.test(block)) out.push(['error', 'no beyond ("- beyond: <every other place the story goes to and how it is shown, or none>": a trip the voice describes is shown, EX4-151)']);
  const steps = subItems(block, 'steps');
  if (steps === null) out.push(['error', 'no steps']);
  else {
    if (steps.length < STEPS_RANGE[0] || steps.length > STEPS_RANGE[1]) out.push(['error', `${steps.length} steps; ${STEPS_RANGE[0]} to ${STEPS_RANGE[1]}`]);
    const bare = steps.filter((st) => !/\S\s+[—–-]{1,2}\s+\S/.test(st));
    if (bare.length) out.push(['error', `${bare.length} step(s) without "<analogy> — <technical name>"`]);
  }
  const entities = block.split(/\r?\n/).filter((l) => /^\s+-\s+\S/.test(l) && /stands for/i.test(l));
  if (entities.length < 2) out.push(['error', `${entities.length} entities with "stands for"; at least 2`]);
  const actors = entities.filter((l) => ACTOR_RE.test(l));
  const mapped = entities.length - actors.length;
  if (mapped > MAX_ENTITIES) out.push(['error', `${mapped} entities from the mapping; at most ${MAX_ENTITIES} (an actor outside the mapping, "stands for the actor: …", may be one more, EX4-158)`]);
  if (actors.length > 1) out.push(['error', `${actors.length} actors outside the mapping; at most one (EX4-158)`]);
  for (const line of entities) {
    const what = line.split(/stands for/i)[0];
    const m = PERSON_RE.exec(what);
    if (m && !/critter/i.test(what)) out.push(['error', `an entity is a person or a body part ("${m[0]}"); whoever acts is a critter (EX3-77)`]);
  }
  if (/^-\s*peak:/im.test(block) && !/^-\s*hook:/im.test(block)) out.push(['warning', 'peak is retired; the opener shows the hook']);
  // The hero the hook follows (EX3-110): a critter, or an object when the objects act.
  const hero = /^-\s*hero:\s*([\w-]+)\s*[—–-]+\s*(critter|object)\b/im.exec(block);
  if (!hero) out.push(['error', 'no hero ("- hero: <entity id> — critter | object": the one the hook follows, EX3-110)']);
  // Each critter's look is fixed for the reel (EX3-107): `look: <orange|ink|paper>, outfit <…>`. A
  // critter hero is the one orange critter; with an object hero no critter is orange. Orange is
  // counted on this block's entity lines only (EX3-132): a frame's own critters (frame 7's callback,
  // a frame 3 visual) are never the count.
  const critters = entities.filter((line) => /\bcritter\b/i.test(line.split(/stands for/i)[1] ?? line));
  const looks = critters.map((line) => /\blook:\s*(orange|ink|paper)\b/i.exec(line)?.[1]?.toLowerCase() ?? null);
  critters.forEach((line, i) => {
    if (!looks[i]) out.push(['error', `a critter has no look ("look: <orange|ink|paper>, outfit <its role's outfit>"): ${line.trim().slice(0, 60)} (EX3-107)`]);
    // Outfits are drawn for the role; the stock wear only on an exact match (hx-4, still 03).
    for (const p of lookLineProblems(line)) out.push(['error', `${p} (EX3-107, hx-4)`]);
  });
  // The anchor scene's ground: paper or stage (white is the close's).
  const ground = /^-\s*ground:\s*([\w-]+)/im.exec(block)?.[1];
  if (ground) {
    const p = groundProblem(ground) ?? (ground.toLowerCase() === 'white' ? 'ground "white" is the close\'s; the anchor scene is paper or stage' : null);
    if (p) out.push(['error', p]);
  }
  const orange = looks.filter((l) => l === 'orange').length;
  if (hero?.[2].toLowerCase() === 'object') {
    if (orange > 0) out.push(['error', `${orange} orange critter(s) with an object hero: the hero object carries the orange, no critter does (EX3-107)`]);
  } else if (critters.length && looks.every(Boolean) && orange !== 1) {
    out.push(['error', `${orange} orange critters; the hero (the hook's critter) is the one orange critter, shown only in frames 1, 4, 5 and a frame-7 callback (EX3-107, EX3-132)`]);
  }
  return out;
}

/**
 * Every anchor entity's real size (hx-4, still 01; Lucas, 2026-10-26: sizes were "preposterous"):
 * each entity line that is not a critter carries `size: <n> cm` (a critter is the 72 cm ruler), and
 * a story exaggeration is at most MAX_EXAGGERATE.
 */
export function entitySizeProblems(block) {
  const out = [];
  if (!block) return out;
  const entities = block.split(/\r?\n/).filter((l) => /^\s+-\s+\S/.test(l) && /stands for/i.test(l));
  const missing = [];
  for (const line of entities) {
    const id = line.replace(/^\s+-\s+/, '').split(/\s+[—–]\s+/)[0].trim();
    const critter = /\bcritter\b/i.test(line.split(/stands for/i)[1] ?? line);
    const size = parseSize(line);
    if (!size) {
      if (!critter) missing.push(id);
      continue;
    }
    if (!size.dims.length || !size.dims.every((n) => n > 0)) out.push(['error', `"${id}": its size is not a number ("size: 26 cm", or "size: 70 × 70 × 180 cm")`]);
    else if (size.unit !== 'cm') out.push(['error', `"${id}": write its size in cm ("size: ${size.dims.join(' × ')} cm"): the scale ledger is in centimetres`]);
    if (size.exaggerate !== null && !(size.exaggerate <= MAX_EXAGGERATE + 1e-9 && size.exaggerate >= 1 / MAX_EXAGGERATE - 1e-9)) {
      out.push(['error', `"${id}" is exaggerated ${size.exaggerate}×: at most ${MAX_EXAGGERATE}× bigger or smaller; show a tiny thing through a magnifier or an insert shot instead`]);
    }
  }
  if (missing.length) {
    out.push(['error', `${missing.length} entit${missing.length === 1 ? 'y has' : 'ies have'} no real size (${missing.join(', ')}): give each "size: <n> cm", its real size; a critter is ${CRITTER_CM} cm, the ruler (hx-4)`]);
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

/** A shot line without its 4.1 tagged parts (cast, angle, place), whose words are never a kind or a subject. */
const untagged = (text) => String(text ?? '').replace(/\s*[—–]\s+(?:cast|angle|place)\s*:[^—–;\n]*/gi, '');

/** The shots a `shots:` text names, in order (the kinds only). */
export function shotKinds(text) {
  return [...untagged(text).matchAll(SHOT_KIND_RE)].map((m) => m[1].toLowerCase().replace(/^close-up$/, 'close').replace(/^cutaway$/, 'insert').replace(/^over[- ]the[- ]shoulder$/, 'ots'));
}

/** Words that never make a shot subject match: framing words and fillers. */
const SUBJECT_STOP = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'to', 'at', 'and', 'or', 'with', 'its', 'it', 'is', 'as', 'by', 'from', 'into', 'over', 'under', 'one', 'two', 'big', 'small', 'alone', 'whole', 'shot', 'face', 'faces', 'label', 'labels', 'close', 'wide', 'medium', 'insert', 'reaction', 'view', 'beside', 'behind', 'their', 'his', 'her', 'this', 'that', 'there', 'here', 'just', 'still', 'then', 'now', 'all', 'up', 'down', 'out', 'off', 'again', 'new', 'old']);

/** A shot's subject as a set of content stems (the same-picture checks). */
export function subjectKeyOf(shot) {
  return [...new Set(String(shot?.subject ?? '').split(/[\s,]+/).map(stem).filter((w) => w && !SUBJECT_STOP.has(w)))].sort().join(' ');
}

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
 * The shots of a `shots:` text: [{ kind, subject, cue, cast, angle, place }]. A shot reads
 * "<kind> — <subject> — on \"<cue>\" — cast: <ids> — angle: <where the camera stands>" (one per
 * sub-bullet, or `;`-separated on one line). `cast` is a list of entity ids ([] for "none", null
 * when the shot names no cast); `angle` and `place` are null when absent (4.1, EX4-146, EX4-148).
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
      const tagged = (key) => {
        const part = parts.find((p) => new RegExp(`^${key}\\s*:`, 'i').test(p));
        return part === undefined ? null : part.replace(/^\w+\s*:\s*/, '').trim();
      };
      const castText = tagged('cast');
      const cast = castText === null ? null : /^none\b/i.test(castText) ? [] : castText.split(/\s*,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
      const subject = parts.slice(1).filter((p) => !/^(on|at)\s+/i.test(p) && !/^\d/.test(p) && !/^(cast|angle|place)\s*:/i.test(p)).join(' ');
      return { kind, subject, cue: cueM ? cueM[1].trim() : null, cast, angle: tagged('angle') || null, place: tagged('place') || null };
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

/** The critters a shot's cast holds (EX4-146): each listed critter id once; a crowd's one id counts once. */
export function castCritters(cast, entities) {
  return (cast ?? []).filter((id) => entities.get(id)?.critter || entities.get(id.replace(/-\d+$/, ''))?.critter);
}

/**
 * Problems with one frame's shots on the analogy's camera (4.1, EX4-146, EX4-148): each shot names its
 * `cast:` (at most MAX_SHOT_CRITTERS critters) and its `angle:`; a cut to the same subject from the same
 * angle is a jump cut. Returns [severity, rule, detail] triples.
 */
export function sceneShotProblems(shots, entities) {
  const out = [];
  shots.forEach((shot, k) => {
    const name = `shot ${k + 1} (${shot.kind} — ${shot.subject || '?'})`;
    if (shot.cast === null) out.push(['error', 'shot_cast', `${name} names no cast ("— cast: <entity ids, or none>"): plan who is on screen, at most ${MAX_SHOT_CRITTERS} critters (EX4-146)`]);
    else {
      const critters = castCritters(shot.cast, entities);
      if (critters.length > MAX_SHOT_CRITTERS) out.push(['error', 'shot_cast', `${name} holds ${critters.length} critters (${critters.join(', ')}): at most ${MAX_SHOT_CRITTERS}; the rest go off screen, and a crowd is one entity (EX4-146)`]);
    }
    if (!shot.angle) out.push(['error', 'shot_angle', `${name} names no angle ("— angle: <where the camera stands>"): every cut changes the subject or the angle (EX4-148)`]);
    const prev = shots[k - 1];
    if (prev && prev.angle && shot.angle && subjectKeyOf(prev) && subjectKeyOf(prev) === subjectKeyOf(shot) && normalize(prev.angle) === normalize(shot.angle)) {
      out.push(['error', 'shot_jump', `shots ${k} and ${k + 1} frame "${shot.subject}" from the same angle ("${shot.angle}"): a jump cut; cut to a new subject or a clearly new angle (about 30° around it, or a change of height), EX4-148`]);
    }
  });
  return out;
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
 * Problems with the `## Curiosity gap` block (EX3-13; 3.8, EX3-120): BRIEF.md's picked gap, copied
 * (the `> ` line), and `closed_by:`. The gap writer wrote the candidates and Jev picked; the director
 * never rewrites it.
 */
function gapProblems(block) {
  if (block === null) return [['error', 'no ## Curiosity gap block (copy BRIEF.md\'s)']];
  const out = [];
  if (!/^>\s*\S/m.test(block)) out.push(['error', 'no picked gap: copy BRIEF.md\'s ## Curiosity gap block, its "> " line word for word (EX3-120)']);
  const closedBy = /^-\s*closed_by:\s*(.*\S)/im.exec(block);
  if (!closedBy) out.push(['error', 'no closed_by (where the reel answers the gap: frame 7, the payoff)']);
  else if (!/\b(frame|beat)\s*7\b/i.test(closedBy[1])) out.push(['error', `closed_by "${closedBy[1]}" is not frame 7: the payoff answers the gap (EX3-128)`]);
  return out;
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

/** BRIEF.md's picked curiosity gap (EX3-120): the first `> ` line of its `## Curiosity gap`; null when it has none. */
export function briefGapLine(brief) {
  const block = brief ? section(brief, 'Curiosity gap') : null;
  const m = block ? /^>\s*(.+)$/m.exec(block) : null;
  return m ? m[1].trim() : null;
}

const stripQuotes = (s) => String(s ?? '').trim().replace(/^["“']|["”']$/g, '').trim();
const seconds = (s) => {
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(s ?? ''));
  return m ? Number(m[1]) : NaN;
};

/**
 * @param {{ storyboard: string, script?: string | null, brief?: string | null, frameSource?: Map<number, string>, audioMeta?: unknown,
 *           frameEvents?: Map<number, unknown[]> | null, eventsTrack?: boolean | null }} input
 *   brief: BRIEF.md; frame 2 must say its picked curiosity gap word for word (EX3-120), and frame 1
 *   the variant of its `## Opener line` (EX3-130).
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

  // The plan's three blocks, the term, and the music.
  for (const [severity, p] of anchorProblems(section(storyboard, 'Anchor scene'))) out.push(violation('anchor_scene', null, severity, p));
  for (const [severity, p] of propFitProblems(section(storyboard, 'Anchor scene'), catalog)) out.push(violation('prop_fit', null, severity, p));
  for (const [severity, p] of entitySizeProblems(section(storyboard, 'Anchor scene'))) out.push(violation('entity_size', null, severity, p));
  for (const [severity, p] of hookProblems(section(storyboard, 'Hook'))) out.push(violation('hook', null, severity, p));
  for (const [severity, p] of gapProblems(section(storyboard, 'Curiosity gap'))) out.push(violation('curiosity_gap', null, severity, p));
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
  const shotsByFrame = new Map();
  const aliases = entityAliases(section(storyboard, 'Anchor scene'));
  const pickedGap = briefGapLine(brief);
  const pickedOpener = briefOpenerLine(brief);
  const anchorSteps = subItems(section(storyboard, 'Anchor scene'), 'steps');
  const anchorBlock = section(storyboard, 'Anchor scene');
  const entities = anchorEntities(anchorBlock);
  const hero = /^-\s*hero:\s*([\w-]+)\s*[—–-]+\s*(critter|object)\b/im.exec(anchorBlock ?? '');
  const beyondLine = /^-\s*beyond:\s*(.*\S)/im.exec(anchorBlock ?? '')?.[1] ?? '';
  // The first frame after the hook whose voice names a critter hero has it as a shot's subject (EX4-146).
  let heroNamed = !hero || hero[2].toLowerCase() !== 'critter';

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
  // Frame 2's question, for the payoff's check (frame 7, EX3-128).
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
      shotsByFrame.set(n, parseShots(text));
      if (!text) out.push(violation('shots', n, 'error', 'no shots: (the frame\'s shot list, frame.md § Shots)'));
      else if (kinds.length < sheet.shots) out.push(violation('shots', n, 'error', `${kinds.length} shot(s); beat ${i + 1} cuts between at least ${sheet.shots}`));
      if (i !== 3 && kinds.includes('wide')) out.push(violation('shots', n, 'warning', 'a wide shot outside beat 4; the establishing shot is used once'));
      if (i === 3 && kinds[0] !== 'wide') out.push(violation('shots', n, 'warning', 'beat 4 opens on the wide establishing shot'));
      // The place reads first (frame.md § Shots): beat 5 opens on a medium, and the analogy's
      // frames spend most of their shots wide or medium; closer shots are punctuation.
      if (i === 4 && kinds.length && kinds[0] !== 'medium') out.push(violation('shots', n, 'warning', `beat 5 opens on a ${kinds[0]} shot; open on a medium that shows the place, then cut closer`));
      if ((i === 3 || i === 4) && kinds.length >= 2 && kinds.filter((k) => CLOSER_SHOTS.includes(k)).length * 2 > kinds.length) {
        out.push(violation('shots', n, 'warning', `${kinds.filter((k) => CLOSER_SHOTS.includes(k)).length} of ${kinds.length} shots are close, insert or reaction: most of the analogy is wide or medium, so the place reads; closer shots are punctuation`));
      }
      for (const k of new Set(kinds.filter((x) => REMOVED_SHOTS.has(x)))) {
        out.push(violation('shot_kind', n, 'error', `a ${k} shot: removed in 3.3 (a shot is only a camera; ${k === 'ots' ? 'over-the-shoulder drew a second copy of a critter' : 'mirroring makes every critter jump sides'}), EX3-90`));
      }
      // The analogy's camera (4.1): each shot names its cast and angle; no jump cuts (EX4-146, EX4-148).
      const sceneShots = SCENE_SHOT_FRAMES.includes(n) || (i === 6 && field('anchor').toLowerCase() === 'scene');
      if (sceneShots && text && !/<fill in/.test(text)) {
        for (const [severity, rule, detail] of sceneShotProblems(parseShots(text), entities)) out.push(violation(rule, n, severity, detail));
      }
      // The shot's subject is what the voice is naming during it (EX3-91).
      if (SUBJECT_FRAMES.includes(n) && text && voiceFor(frame, i).trim() && !/<fill in/.test(voiceFor(frame, i))) {
        for (const { shot, window } of shotWindows(parseShots(text), voiceFor(frame, i))) {
          if (window === null) out.push(violation('shot_cue', n, 'warning', `the ${shot.kind} shot's cue "${shot.cue}" is not in the voiceover`));
          else if (!subjectSpoken(shot.subject, window, aliases)) {
            out.push(violation('shot_subject', n, SUBJECT_ERROR_FRAMES.includes(n) ? 'error' : 'warning', `the ${shot.kind} shot on "${shot.subject}" plays while the voice says "${window}": frame what the voice is naming (EX3-91)`));
          }
        }
      }
      // The named hero is the clear subject when the voice first names it (EX4-146; principles.md § 3).
      if (sceneShots && !heroNamed && n > 1 && text && voiceFor(frame, i).trim() && !/<fill in/.test(voiceFor(frame, i))) {
        const named = (shotWindows(parseShots(text), voiceFor(frame, i)) ?? []).find(({ window }) => window !== null && subjectSpoken(hero[1], window, aliases));
        if (named) {
          heroNamed = true;
          if (!subjectSpoken(named.shot.subject, [hero[1], ...(aliases.get(stem(hero[1])) ?? [])].join(' '))) {
            out.push(violation('hero_subject', n, 'warning', `the voice first names the hero ("${hero[1]}") over the ${named.shot.kind} shot on "${named.shot.subject}": make the hero that shot's clear subject, alone or lit and acting while anyone else is still (EX4-146)`));
          }
        }
      }
      // Every trip the voice describes is shown (EX4-151): its destination is a shot's, or the anchor block's beyond.
      if (sceneShots && text && !/<fill in/.test(voiceFor(frame, i))) {
        const shown = new Set([...parseShots(text).flatMap((x) => [x.subject, x.angle ?? '', x.place ?? '']), /^none\b/i.test(beyondLine) ? '' : beyondLine].join(' ').split(/[^\p{L}\p{N}'-]+/u).map(stem).filter(Boolean));
        for (const m of stripQuotes(voiceFor(frame, i)).matchAll(new RegExp(TRIP_RE.source, 'gi'))) {
          const where = stem(m[1]);
          if (where && !SUBJECT_STOP.has(where) && !shown.has(where)) {
            out.push(violation('trip_shown', n, 'warning', `the voice says "${m[0]}", but no shot and no beyond: shows the ${m[1]}: show the trip (a cut to the destination, or a time cut where the character comes back changed), EX4-151`));
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
      // The example walks the same steps as the analogy (EX3-129): one example step per anchor step.
      if (steps.length && anchorSteps?.length && steps.length !== anchorSteps.length) {
        out.push(violation('example_steps_match', n, 'error', `${steps.length} example steps for the anchor scene's ${anchorSteps.length} steps: the example walks the same steps, step N doing step N's job (EX3-129)`));
      }
    }
    if (!String(frame.scene ?? '').trim()) out.push(violation('visual_missing', n, 'error', 'no scene: the frame names no visual'));

    // Ground (EX3-42, hx-4): paper, stage, or white (the last frame only, which must be white);
    // night and forest are retired. The real-tech frames are glass on paper (a warning).
    const ground = field('ground').toLowerCase();
    if (!ground) out.push(violation('ground', n, 'error', 'no ground'));
    else if (groundProblem(ground)) out.push(violation('ground', n, 'error', groundProblem(ground)));
    else if (i === BEAT_SHEET.length - 1 && ground !== 'white') out.push(violation('ground', n, 'error', 'the last frame is white'));
    else if (i < BEAT_SHEET.length - 1 && ground === 'white') out.push(violation('ground', n, 'error', 'only the last frame is white'));
    else if (GLASS_FRAMES.includes(n) && ground !== 'paper') out.push(violation('ground', n, 'warning', `frame ${n} shows the real thing in glass and gloss, on the paper studio ground: ground "paper" (frame.md § Real-tech frames)`));

    // Anchor (EX3-10; 3.2): the scene on beats 1, 2, 4, 5; own visuals on 3, 6 and 7.
    const anchor = field('anchor').toLowerCase();
    if (sheet?.anchor === 'scene' && anchor !== 'scene') out.push(violation('anchor', n, 'error', `anchor "${anchor || 'missing'}"; beat ${i + 1} shows the anchor scene`));
    if (i === 6) {
      // Frame 7 is built in glass (own) or as a callback to the analogy world (scene), EX4-153.
      if (!FRAME7_ANCHORS.includes(anchor)) out.push(violation('anchor', n, 'error', `anchor "${anchor || 'missing'}"; beat 7 is built in glass ("own") or as a callback to the analogy world ("scene")`));
    } else if (sheet?.anchor === 'own' && anchor !== 'own') out.push(violation('anchor', n, 'error', `anchor "${anchor || 'missing'}"; beat ${i + 1} has its own visuals`));
    // The tech beats name their technique (EX4-154): frames 2, 3, 6, and 7 when built in glass.
    if (TECHNIQUE_FRAMES.includes(n) || (i === 6 && anchor === 'own')) {
      const raw = field('technique');
      const m = /^([a-z-]+)\s*(?:[—–]|--?)\s*(\S.*)$/i.exec(raw);
      const id = (m?.[1] ?? raw.split(/\s+/)[0] ?? '').toLowerCase();
      if (!raw || /^<fill/.test(raw)) out.push(violation('technique', n, 'error', `no technique ("- technique: <id> — <why this idea is best shown this way>", one of ${TECHNIQUE_IDS.join(', ')}; EX4-154)`));
      else if (!TECHNIQUE_IDS.includes(id)) out.push(violation('technique', n, 'error', `technique "${id}" is not one of ${TECHNIQUE_IDS.join(', ')} (a card is never the technique; EX4-154)`));
      else if (!m) out.push(violation('technique', n, 'error', `technique "${id}" gives no reason ("- technique: ${id} — <why this idea is best shown this way>")`));
    }
    if (i === 1 && !field('reset')) out.push(violation('attention_reset', n, 'error', 'no reset: the 1→2 cut needs an attention reset'));

    const vo = voiceFor(frame, i);
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
      // A paired term ("X vs Y") is defined side by side: each side is named (EX4-159).
      const sides = TERM_PAIR_RE.test(term) ? term.split(TERM_PAIR_RE) : [term];
      const missingSide = sides.find((x) => x && !normalize(definition).includes(normalize(x)));
      if (term && definition && missingSide !== undefined) {
        out.push(violation('definition_term', n, 'error', sides.length > 1 ? `the definition does not define "${missingSide}": a paired term defines both sides (EX4-159)` : `the definition does not define the term "${term}" (EX3-86)`));
      }
      if (/\b(when something happens|some data|a thing that|something that|stuff)\b/i.test(vo)) {
        out.push(violation('definition_vague', n, 'warning', 'vague phrase in the definition; name the trigger and the receiver'));
      }
      // The definition names the part the analogy calls the term (EX4-152), and overstates nothing.
      const part = stripQuotes(field('term_part'));
      if (!part || /^<fill/.test(part)) out.push(violation('term_part', n, 'error', 'no term_part ("- term_part: <the anchor entity the analogy calls the term> — <what it is in the analogy>": the definition names that same thing, EX4-152, EX4-159)'));
      else {
        // One part per term; a paired term lists both, separated by ";" (EX4-159).
        const parts = part.split(/\s*;\s*/).filter(Boolean);
        if (TERM_PAIR_RE.test(term) && parts.length < 2) out.push(violation('term_part', n, 'error', `the paired term "${term}" needs both parts ("- term_part: <entity> — <…>; <entity> — <…>", EX4-159)`));
        for (const one of parts) {
          const partId = one.split(/\s+[—–-]+\s+|\s+/)[0].replace(/[,.]+$/, '');
          if (entities.size && !entities.has(partId)) {
            out.push(violation('term_part', n, 'warning', `term_part "${partId}" is not an anchor entity: name the entity the analogy calls the term; when no mapping row's concept is the term itself (a whole system), add the entity that is the whole and name it (EX4-159)`));
          }
        }
      }
      const overstated = OVERSTATE_RE.exec(definition || vo);
      if (overstated) out.push(violation('definition_overstated', n, 'warning', `the definition says "${overstated[0]}": claim no more than the mechanism does, unless it guarantees it (EX4-152)`));
    }
    // Beat 2 is the curiosity gap BRIEF.md picked (EX3-120: written by the gap writer for the most
    // pull, picked by Jev), word for word; about the real thing, never the analogy's world (EX3-115);
    // no toss after its question (EX3-116), no term.
    if (i === 1 && vo) {
      const plain = stripQuotes(vo);
      const said = sentences2(plain);
      const qAt = said.map((x) => /\?["')\]]*$/.test(x)).lastIndexOf(true);
      if (pickedGap && normalize(plain) !== normalize(stripQuotes(pickedGap))) out.push(violation('gap_pick', n, 'error', `frame 2 is not BRIEF.md's picked curiosity gap word for word ("${pickedGap}"): say it as picked (EX3-120)`));
      if (term && normalize(plain).includes(normalize(term))) out.push(violation('gap_term', n, 'error', `the gap says the term "${term}": it never answers itself with a label (the title card and frame 3 name it)`));
      if (SAME_SPOT_RE.test(plain)) out.push(violation('gap_same_spot', n, 'error', 'the gap claims a parallel ("the same spot"): ask about the real thing itself'));
      const spokenStems = new Set(normalize(plain).split(' ').map(stem));
      const named = [...aliases.keys()].filter((id) => id.length >= 3 && spokenStems.has(id));
      if (named.length) out.push(violation('gap_scene', n, 'error', `the gap names the anchor scene's ${named.map((x) => `"${x}"`).join(', ')}: it is about the real technology, never the analogy's world (EX3-115)`));
      if (qAt < 0) out.push(violation('gap_question', n, 'error', "the gap asks no question: end on the viewer's own question"));
      else if (qAt < said.length - 1) out.push(violation('gap_toss', n, 'error', `the gap goes on after its question ("${said.slice(qAt + 1).join(' ')}"): end on the question; the definition answers it (EX3-116)`));
      const declared = stripQuotes(field('gap_question'));
      if (declared && !normalize(plain).includes(normalize(declared))) out.push(violation('gap_question', n, 'error', 'gap_question: is not the question the voiceover asks'));
      gapQuestion = qAt >= 0 ? said[qAt] : '';
    }
    // No toss into or out of the gap (EX3-116).
    if ((i === 1 || i === 2) && vo && TOSS_RE.test(stripQuotes(vo)) && !out.some((v) => v.rule === 'gap_toss' && v.frame === n)) {
      out.push(violation('gap_toss', n, 'error', `"${TOSS_RE.exec(stripQuotes(vo))[0]}" tosses to the next beat like a commercial break: end the gap on the question and let the definition answer it (EX3-116)`));
    }
    // Beat 7, the payoff, answers the gap's question in real terms (EX3-101, EX3-128). Its key
    // words are a hint, not proof, so a miss is a warning (an error forced circular lines).
    if (i === 6 && vo && gapQuestion) {
      const keys = (x) => normalize(x).split(' ').map(stem).filter((w) => w && !QUESTION_STOP.has(w));
      const wanted = new Set(keys(gapQuestion));
      const hit = new Set(keys(stripQuotes(vo)).filter((w) => wanted.has(w))).size;
      if (wanted.size && hit < Math.min(2, wanted.size)) {
        out.push(violation('gap_closed', n, 'warning', `the payoff ("${stripQuotes(vo)}") shares few words with the gap's question ("${gapQuestion}"): check that it answers it in real terms (EX3-128)`));
      }
    }
    // Beat 4 continues the scene the viewer has seen (EX3-97): no "Picture…" restart.
    if (i === 3 && vo && SCENE_SETTING_RE.test(stripQuotes(vo))) {
      out.push(violation('scene_setting', n, 'error', 'beat 4 restarts the scene ("Picture…", "Imagine…", "Let\'s say…"); continue it ("Here\'s what the hire does:", "Watch the forecaster:", "Back on the lawn:")'));
    }
    // Beat 5: why it works, then where it breaks (EX3-128). No limit word anywhere is a warning.
    if (i === 4 && vo && !sentences2(stripQuotes(vo)).some((x) => LIMIT_CUE_RE.test(x))) {
      out.push(violation('beat5_limit', n, 'warning', "frame 5 names no limit or trade-off: after why the analogy works, say where it breaks (EX3-128)"));
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

  // What the voice says, by frame: words a listener can't hear as written (EX3-106), and an
  // example that reuses the scene (EX3-105).
  const voices = new Map(frames.map((f, i) => [f.number ?? i + 1, voiceFor(f, i)]).filter(([n, v]) => n <= 7 && String(v).trim() && !/<fill in/.test(String(v))));
  for (const [n, severity, p] of unsayableProblems(voices)) out.push(violation('unsayable', n, severity, p));
  // "Critter" is the drawing style's word, never said (EX3-121; Lucas, 2026-10-22: "sometimes the
  // vo/caption calls them 'critters'. That's incorrect"): characters are named by their role.
  for (const [n, v] of voices) {
    const said = /\bcritters?\b/i.exec(stripQuotes(v));
    if (said) out.push(violation('said_critter', n, 'error', `the voice says "${said[0]}": name each character by its role in the scene (the waiter, the searcher); "critter" is never said or shown (EX3-121)`));
  }
  const exampleFrame = frames[5];
  const exampleSteps = exampleFrame ? String(exampleFrame.extra?.example_steps ?? '') : '';
  for (const [n, severity, p] of exampleReuseProblems(voices, exampleSteps, section(storyboard, 'Anchor scene'), term)) {
    out.push(violation('example_reuses_scene', n, severity, p));
  }

  // No two consecutive scene frames meet on the same picture (EX3-83): a frame's first shot is
  // not the previous frame's last one, the same kind on the same subject.
  const subjectKey = (shot) => [...new Set(String(shot?.subject ?? '').split(/[\s,]+/).map(stem).filter((w) => w && !SUBJECT_STOP.has(w)))].sort().join(' ');
  for (let n = 2; n <= BEAT_SHEET.length; n++) {
    const prev = shotsByFrame.get(n - 1);
    const cur = shotsByFrame.get(n);
    const a = prev?.[prev.length - 1];
    const b = cur?.[0];
    if (a && b && a.kind === b.kind && subjectKey(a) && subjectKey(a) === subjectKey(b)) {
      out.push(violation('shots', n, 'warning', `opens on the ${b.kind} shot of "${b.subject}" that frame ${n - 1} ended on: open on a new picture`));
    }
  }

  // Built frames, when present: emoji and narration repeated on screen, in the scene modules'
  // source (their SVG text is string literals there); frame 3's headword is the term.
  if (term && frameSource.has(3) && !normalize(frameSource.get(3)).includes(normalize(term))) {
    out.push(violation('headword_term', 3, 'error', `frame 3's dictionary card does not show the term "${term}"`));
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
