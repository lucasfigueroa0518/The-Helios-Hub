#!/usr/bin/env node
// lint-real-case.mjs — deterministic checks on an AI News Explained reel's plan (planning/Real Case
// Reels/FORMAT.md, DECISIONS.md RC-26 to RC-31). No model, no judgment: structure against the fixed
// eight acts, plus the facts rules a machine can check (every cited fact and artifact exists, every
// number in a voiceover is in a cited fact or artifact, no attribution phrasing, shown artifact words are
// the artifact's own). Reuses the Explainer lint's parsers and shot helpers only.
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
  OPENER_RE,
  parseScript,
  parseShots,
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
 * The eight acts (RC-31): order, `type`, nominal seconds, voiceover word range, longest hold, fewest
 * shots, and whether `claims:` must cite at least one fact.
 */
export const REAL_CASE_BEATS = [
  { beat: 'cold open', type: 'cold_open', seconds: 5, words: [10, 18], hold: 1.2, shots: 1, claims: 'some' },
  { beat: 'setup', type: 'setup', seconds: 9, words: [22, 34], hold: 0.2, shots: 2, claims: 'some' },
  { beat: 'the moment', type: 'moment', seconds: 9, words: [22, 34], hold: 0.2, shots: 2, claims: 'some' },
  { beat: 'fallout', type: 'fallout', seconds: 6, words: [14, 24], hold: 0.2, shots: 2, claims: 'some' },
  { beat: 'what actually happened', type: 'reveal', seconds: 12, words: [30, 42], hold: 0.2, shots: 3, claims: 'some' },
  { beat: 'since then', type: 'since', seconds: 6, words: [14, 24], hold: 0.2, shots: 1, claims: 'some' },
  { beat: 'for you', type: 'for_you', seconds: 4, words: [8, 16], hold: 0.2, shots: 1, claims: 'any' },
  { beat: 'close', type: 'branding', seconds: 2.5, words: null, hold: null, shots: 0, voiceless: true, claims: null },
];

export const TOTAL_RANGE = [50, 68];
export const TERM_MAX_WORDS = 4;
export const TERM_CARD_MAX_WORDS = 14;
export const MAX_PLAYERS = 4;
export const MAX_ARTIFACTS = 3;
export const MECHANISM_RANGE = [2, 4];
export const SHOT_KINDS = ['wide', 'medium', 'close', 'insert'];
/** The format's three scenes (frame.md, RC-44); every reel uses each at least once in frames 1–7. */
export const NEWS_GROUNDS = ['board', 'whiteboard', 'newspaper'];
export const MAX_OBJECTS = 5;
/** Shot subjects must be spoken in their window on these frames; a miss is an error on the reveal and the moment. */
export const SUBJECT_FRAMES = [2, 3, 4, 5, 6];
export const SUBJECT_ERROR_FRAMES = [3, 5];

/** RC-05: the story is told straight. Attribution phrasing is never used. */
export const ATTRIBUTION_RE = /\b(according to|reportedly|reporters?|journalists?|sources? (?:say|said|says)|is said to|was said to|claims? that|claimed that|told (?:reporters|the press)|per (?:the|a) (?:report|statement))\b/i;
/**
 * No photos but the banked cutouts, and no copies of a product's screens (RC-28, RC-33, RC-34). Logos
 * are allowed, only for a company BRIEF.md marks "logo banked" (checked on the case file's players).
 */
export const LOGO_RE = /\b(photos?|photographs?|screenshots?|headshots?|stock images?)\b/i;
/** How a case-file player may be shown (story-design.md § Case file). */
export const SHOWN_AS = ['logo', 'cutout', 'silhouette', 'name card'];
/** A cold open that starts on background, a framing line or a question (RC-35). */
export const SLOW_OPEN_RE = /^(in (?:january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|the)\b|last (?:week|month|year|night)\b|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|this is\b|here'?s\b|have you\b|did you\b|imagine\b|what if\b|picture this\b|so,? )/i;

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

const unquote = (s) => String(s ?? '').trim().replace(/^["“]|["”]$/g, '').trim();

function violation(rule, frame, severity, detail) {
  return { source: 'storyboard', rule, frame, severity, detail };
}

/** A line's sentences, ends kept. */
export function sentencesOf(text) {
  return String(text ?? '').split(/(?<=[.?!]["')\]”’]*)\s+/).map((x) => x.trim()).filter(Boolean);
}

/** BRIEF.md's `## Facts`: `- c1: <text>` lines (under any act label), as a Map id → text. */
export function parseFacts(brief) {
  const body = section(brief, 'Facts') ?? '';
  const facts = new Map();
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*-\s*(c\d+)\s*[:—–-]\s*(.+?)\s*$/i.exec(line);
    if (m) facts.set(m[1].toLowerCase(), m[2]);
  }
  return facts;
}

/** BRIEF.md's `## Artifacts`: `- a1 (kind, speaker; fact c6): "text"` lines, as a Map id → { text, fact }. */
export function parseArtifacts(brief) {
  const body = section(brief, 'Artifacts') ?? '';
  const out = new Map();
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*-\s*(a\d+)\s*\(([^)]*)\)\s*:\s*["“](.+)["”]\s*$/i.exec(line);
    if (!m) continue;
    const fact = /\bfact\s+(c\d+)/i.exec(m[2])?.[1]?.toLowerCase() ?? null;
    out.set(m[1].toLowerCase(), { text: m[3], fact });
  }
  return out;
}

/**
 * BRIEF.md's `## Players`: `- Name (kind[; logo banked | cutout banked]): role`, as a Map of the
 * lowercased name → { kind, logo, cutout }.
 */
export function parsePlayers(brief) {
  const body = section(brief, 'Players') ?? '';
  const out = new Map();
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*-\s*(.+?)\s*\(([^)]*)\)\s*:/.exec(line);
    if (!m) continue;
    out.set(normalize(m[1]), { kind: m[2].split(';')[0].trim(), logo: /\blogo banked\b/i.test(m[2]), cutout: /\bcutout banked\b/i.test(m[2]) });
  }
  return out;
}

/** A frame's id list (`c1, c3` or `a1`), lowercased; [] for `none`; null when the field is absent. */
function idList(value, prefix) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || /^<fill/i.test(text)) return null;
  if (/^none\b/i.test(text)) return [];
  return [...text.matchAll(new RegExp(`\\b${prefix}\\d+\\b`, 'gi'))].map((m) => m[0].toLowerCase());
}

export const claimIds = (value) => idList(value, 'c');
export const artifactIds = (value) => idList(value, 'a');

/** The numbers in a text, digits only ("$1,200" → "1200", "2.5" → "2.5"). */
export function numbersIn(text) {
  return [...String(text ?? '').matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '').replace(/\.$/, ''));
}

/**
 * Facts problems in one frame's voiceover (RC-05, story-design.md § The facts): cited ids that are not
 * facts, numbers no cited fact or artifact contains, attribution phrasing. Returns [severity, detail] pairs.
 * `allowedText` is extra text whose numbers may be said (the frame's cited artifacts).
 */
export function factProblems(voice, ids, facts, allowedText = '') {
  const out = [];
  if (ATTRIBUTION_RE.test(voice)) {
    out.push(['error', `attribution phrasing "${ATTRIBUTION_RE.exec(voice)[0]}": tell the story straight; a fact is stated as a fact (RC-05)`]);
  }
  if (!ids) return out;
  const unknown = ids.filter((id) => !facts.has(id));
  if (unknown.length) out.push(['error', `claims ${unknown.join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not in BRIEF.md's facts`]);
  const cited = ids.filter((id) => facts.has(id)).map((id) => facts.get(id)).join(' ');
  const allowed = new Set(numbersIn(`${cited} ${allowedText}`));
  for (const n of new Set(numbersIn(voice))) {
    if (!allowed.has(n)) out.push(['error', `the number ${n} is in no fact this frame cites${ids.length ? ` (${ids.join(', ')})` : ''}: every number about the event comes from a fact, as it is written there`]);
  }
  return out;
}

/**
 * Words shown from an artifact must be its own (RC-28): each run between `…` (or `...`) is inside the
 * artifact's text, in order. True when they are.
 */
export function shownWordsAreArtifacts(shown, artifactText) {
  const full = normalize(artifactText);
  let from = 0;
  for (const run of String(shown).split(/…|\.\.\./).map(normalize).filter(Boolean)) {
    const at = full.indexOf(run, from);
    if (at < 0) return false;
    from = at + run.length;
  }
  return true;
}

function listItems(block, name) {
  const lines = String(block ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^\\s*-\\s*${name}:`, 'i').test(l));
  if (start < 0) return null;
  const got = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s+-\s+\S/.test(line)) got.push(line.replace(/^\s+-\s+/, '').trim());
    else if (line.trim()) break;
  }
  return got;
}

/** The `## Case file` block's problems. [severity, detail] pairs. `players` is null without a brief. */
function caseFileProblems(block, artifacts, players) {
  if (!block) return [['error', 'no ## Case file']];
  const out = [];
  for (const name of ['when', 'key artifact', 'key detail']) {
    if (!new RegExp(`^\\s*-\\s*${name}:\\s*\\S`, 'im').test(block)) out.push(['error', `no ${name}: line`]);
  }
  const briefPlayers = players;
  players = listItems(block, 'players');
  if (!players?.length) out.push(['error', 'no players:']);
  else if (players.length > MAX_PLAYERS) out.push(['error', `${players.length} players; at most ${MAX_PLAYERS}`]);
  for (const line of players ?? []) {
    const name = line.split(/\s+[—–]\s+/)[0].trim();
    const shown = /shown as:\s*(logo|cutout|silhouette|name card)\b/i.exec(line)?.[1]?.toLowerCase();
    if (!shown) {
      out.push(['error', `player "${name}": say how it is shown (${SHOWN_AS.join(' | ')})`]);
      continue;
    }
    if (!briefPlayers) continue;
    const known = briefPlayers.get(normalize(name));
    if (!known) out.push(['error', `player "${name}" is not in BRIEF.md's ## Players (name them only as it does)`]);
    else if (shown === 'logo' && !known.logo) out.push(['error', `player "${name}" is shown as a logo, but BRIEF.md has no banked logo for it: a name card`]);
    else if (shown === 'cutout' && !known.cutout) out.push(['error', `player "${name}" is shown as a cutout, but BRIEF.md has no banked cutout for them: a silhouette`]);
  }
  const shown = listItems(block, 'artifacts') ?? [];
  if (shown.length > MAX_ARTIFACTS) out.push(['error', `${shown.length} artifacts; at most ${MAX_ARTIFACTS}`]);
  for (const line of shown) {
    const id = /^(a\d+)\b/i.exec(line)?.[1]?.toLowerCase();
    if (!id) {
      if (!/^none\b/i.test(line)) out.push(['error', `artifact line "${line}": start it with the artifact id`]);
      continue;
    }
    const artifact = artifacts.get(id);
    if (!artifact) {
      out.push(['error', `artifact ${id} is not in BRIEF.md's ## Artifacts`]);
      continue;
    }
    for (const quoted of line.matchAll(/["“]([^"”]+)["”]/g)) {
      if (!shownWordsAreArtifacts(quoted[1], artifact.text)) out.push(['error', `artifact ${id} shows "${quoted[1]}", which is not its own words: show them word for word, cut only with …`]);
    }
  }
  const objects = (listItems(block, 'objects') ?? []).filter((l) => !/^none\b/i.test(l));
  if (objects.length > MAX_OBJECTS) out.push(['error', `${objects.length} objects; at most ${MAX_OBJECTS}`]);
  const keyArtifact = /^\s*-\s*key artifact:\s*(a\d+)/im.exec(block)?.[1]?.toLowerCase();
  if (keyArtifact && !artifacts.has(keyArtifact)) out.push(['error', `the key artifact ${keyArtifact} is not in BRIEF.md's ## Artifacts`]);
  const mechanism = /^\s*-\s*mechanism:\s*(.+)$/im.exec(block)?.[1];
  if (!mechanism) out.push(['error', 'no mechanism: (the reveal\'s flow, 2 to 4 steps)']);
  else {
    const steps = mechanism.split(/\s*(?:→|->|>|→)\s*/).map((x) => x.trim()).filter(Boolean);
    if (steps.length < MECHANISM_RANGE[0] || steps.length > MECHANISM_RANGE[1]) out.push(['error', `the mechanism has ${steps.length} steps; ${MECHANISM_RANGE[0]} to ${MECHANISM_RANGE[1]}, joined with →`]);
    if (!/\(cause\)/i.test(mechanism)) out.push(['error', 'the mechanism marks no step "(cause)"']);
    for (const step of steps) {
      const words = countWords(step.replace(/\(cause\)/i, ''));
      if (words > 4) out.push(['warning', `mechanism step "${step}" is ${words} words; 4 or fewer`]);
    }
  }
  if (LOGO_RE.test(block)) out.push(['error', `the case file shows a ${LOGO_RE.exec(block)[0]}: never a logo, photo or copy of a product's screen`]);
  return out;
}

/** A candidate's score for one measure ("open loop 4/5" → 4), or null. */
function scoreOf(line, measure) {
  const m = new RegExp(`${measure}\\s*(\\d)\\s*/\\s*5`, 'i').exec(line);
  return m ? Number(m[1]) : null;
}

/** The engineered cold open (RC-35): three scored candidates, a pick at clarity and open loop 4+. */
function coldOpenProblems(block) {
  if (!block) return [['error', 'no ## Cold open']];
  const out = [];
  const candidates = block.split(/\r?\n/).filter((l) => /^\s*\d+\.\s+\S/.test(l));
  if (candidates.length < 3) out.push(['error', `${candidates.length} cold-open candidates; write three`]);
  for (const c of candidates) {
    const missing = ['clarity', 'thumb-stop', 'open loop'].filter((m) => scoreOf(c, m) === null);
    if (missing.length) out.push(['error', `cold-open candidate "${c.trim().slice(0, 40)}…" has no ${missing.join(', ')} score (N/5)`]);
  }
  const pick = /^\s*-\s*pick:\s*(\d+)?/im.exec(block);
  if (!pick) out.push(['error', 'no cold-open pick']);
  else if (pick[1]) {
    const chosen = candidates.find((c) => new RegExp(`^\\s*${pick[1]}\\.`).test(c));
    if (chosen && ((scoreOf(chosen, 'clarity') ?? 0) < 4 || (scoreOf(chosen, 'open loop') ?? 0) < 4)) {
      out.push(['error', 'the picked cold open needs clarity and open loop of 4 or more']);
    }
  }
  return out;
}

function questionProblems(block, frameQuestion) {
  if (!block) return [['error', 'no ## Question']];
  const out = [];
  const question = unquote(/^\s*-\s*question:\s*(.+)$/im.exec(block)?.[1]);
  if (!question) out.push(['error', 'no question: in ## Question']);
  else if (frameQuestion && normalize(question) !== normalize(frameQuestion)) {
    out.push(['error', `## Question's question "${question}" differs from frame 4's question "${frameQuestion}"`]);
  }
  if (!/^\s*-\s*answer:\s*\S/im.test(block)) out.push(['error', 'no answer: in ## Question (the reveal, one sentence)']);
  if (!/^\s*-\s*closed_by:\s*\S/im.test(block)) out.push(['warning', 'no closed_by: in ## Question']);
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

/** How many times `term` is said in `voice`, as whole words. */
export function termCount(voice, term) {
  const v = ` ${normalize(voice)} `;
  const t = normalize(term);
  if (!t) return 0;
  return v.split(` ${t} `).length - 1;
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
  const artifacts = parseArtifacts(brief);
  const blocks = frameBlocks(storyboard);
  const voiceFor = (frame, i) => {
    const n = frame.number ?? i + 1;
    const fromScript = scriptLines?.get(n);
    return unquote(fromScript ?? frame.voiceover ?? '');
  };

  const term = String(globals?.extra?.term ?? '').trim();
  const concept = String(globals?.extra?.concept ?? '').trim();
  if (!term || /^<fill/.test(term)) out.push(violation('term', null, 'error', 'no term: in the frontmatter (BRIEF.md\'s term)'));
  else if (countWords(term) > TERM_MAX_WORDS) out.push(violation('term', null, 'error', `term "${term}" is ${countWords(term)} words; at most ${TERM_MAX_WORDS}`));
  if (!concept || /^<fill/.test(concept)) out.push(violation('concept', null, 'error', 'no concept: in the frontmatter'));
  const music = String(globals?.extra?.music ?? '').trim().toLowerCase();
  if (music && music !== 'none') out.push(violation('music', null, 'warning', `music "${music}": the kit picks the bed (music: none)`));
  if (brief !== null && facts.size === 0) out.push(violation('facts', null, 'error', "BRIEF.md has no ## Facts (c1, c2…): nothing can be checked"));

  for (const [s, p] of caseFileProblems(section(storyboard, 'Case file'), artifacts, brief === null ? null : parsePlayers(brief))) out.push(violation('case_file', null, s, p));
  for (const [s, p] of coldOpenProblems(section(storyboard, 'Cold open'))) out.push(violation('cold_open', null, s, p));

  if (frames.length !== REAL_CASE_BEATS.length) out.push(violation('frame_count', null, 'error', `${frames.length} frames; the acts are ${REAL_CASE_BEATS.length}`));
  const missing = frames.filter((f) => !Number.isFinite(f.durationSeconds));
  missing.forEach((f, i) => out.push(violation('duration_missing', f.number ?? i + 1, 'error', 'frame has no duration')));
  if (missing.length === 0 && frames.length) {
    const total = Math.round(frames.reduce((a, f) => a + f.durationSeconds, 0) * 1000) / 1000;
    if (total < TOTAL_RANGE[0] || total > TOTAL_RANGE[1]) out.push(violation('total_duration', null, 'warning', `${total}s total; usually ${TOTAL_RANGE[0]}–${TOTAL_RANGE[1]}s`));
  }

  const voices = new Map();
  let frameQuestion = '';
  frames.forEach((frame, i) => {
    const n = frame.number ?? i + 1;
    const sheet = REAL_CASE_BEATS[i];
    const extra = frame.extra ?? {};
    const field = (name) => String(extra[name] ?? frame[name] ?? '').trim();
    const voice = voiceFor(frame, i);
    if (!sheet?.voiceless) voices.set(n, voice);

    const kind = String(frame.transitionIn ?? '').trim().toLowerCase().split(/\s+/)[0];
    if (kind && !TRANSITIONS.includes(kind)) out.push(violation('transition_kind', n, 'error', `transition "${frame.transitionIn}"; only cut`));
    if (sheet && field('type') !== sheet.type) out.push(violation('act_type', n, 'error', `type "${field('type') || 'missing'}"; act ${i + 1} (${sheet.beat}) needs "${sheet.type}"`));
    if (field('sfx')) out.push(violation('sfx_retired', n, 'warning', "sfx: lines are retired; frame workers design each frame's sound events"));
    const ground = field('ground').toLowerCase();
    if (!ground) out.push(violation('ground', n, 'error', `no ground (one of ${NEWS_GROUNDS.join(', ')})`));
    else if (!NEWS_GROUNDS.includes(ground)) out.push(violation('ground', n, 'error', `ground "${ground}"; one of ${NEWS_GROUNDS.join(', ')}`));
    // The close is code's and shows the Helios logo; every other frame shows none.
    if (!sheet?.voiceless && LOGO_RE.test(field('scene'))) out.push(violation('logo', n, 'error', `the scene shows a ${LOGO_RE.exec(field('scene'))[0]}: never a logo, photo or copy of a product's screen`));

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
      out.push(violation('word_range', n, 'error', `${words} words; act ${i + 1} (${sheet.beat}) takes ${sheet.words[0]}–${sheet.words[1]}`));
    }
    if (voice.includes('!')) out.push(violation('exclamation', n, 'error', 'an exclamation mark: plain-spoken, no hype'));
    if (/\p{Extended_Pictographic}/u.test(voice)) out.push(violation('emoji', n, 'error', 'emoji in a voiceover'));
    if (TOSS_RE.test(voice)) out.push(violation('toss', n, 'error', `"${TOSS_RE.exec(voice)[0]}" tosses to the next act`));

    // Artifacts (RC-28).
    const aIds = artifactIds(extra.artifacts);
    if (aIds === null) out.push(violation('artifacts', n, 'error', 'no artifacts: (the artifact ids this frame shows, or none)'));
    const unknownArtifacts = (aIds ?? []).filter((id) => !artifacts.has(id));
    if (brief !== null && unknownArtifacts.length) out.push(violation('artifacts', n, 'error', `artifacts ${unknownArtifacts.join(', ')} not in BRIEF.md's ## Artifacts`));
    const artifactText = (aIds ?? []).map((id) => artifacts.get(id)?.text ?? '').join(' ');

    // Facts (RC-05).
    const ids = claimIds(extra.claims);
    if (ids === null) out.push(violation('claims', n, 'error', 'no claims: (the fact ids this frame uses)'));
    else if (sheet?.claims === 'some' && ids.length === 0) out.push(violation('claims', n, 'error', `act ${i + 1} (${sheet.beat}) tells the event: cite the facts it uses`));
    for (const [s, p] of factProblems(voice, ids, facts, artifactText)) out.push(violation(/attribution/.test(p) ? 'attribution' : 'claims', n, s, p));

    // Shots.
    if (sheet?.shots) {
      const text = shotsText(blocks.get(n));
      const kinds = shotKinds(text);
      const fewest = (frame.durationSeconds ?? sheet.seconds) > 6 ? Math.max(2, sheet.shots) : sheet.shots;
      if (!text) out.push(violation('shots', n, 'error', 'no shots:'));
      else if (kinds.length < fewest) out.push(violation('shots', n, 'error', `${kinds.length} shot(s); act ${i + 1} cuts between at least ${fewest}`));
      for (const k of new Set(kinds.filter((x) => REMOVED_SHOTS.has(x) || !SHOT_KINDS.includes(x)))) out.push(violation('shot_kind', n, 'error', `a ${k} shot is not used; kinds: ${SHOT_KINDS.join(', ')}`));
      if (SUBJECT_FRAMES.includes(n) && text && voice) {
        for (const { shot, window } of shotWindows(parseShots(text), voice)) {
          if (window === null) out.push(violation('shot_cue', n, 'warning', `the ${shot.kind} shot's cue "${shot.cue}" is not in the voiceover`));
          else if (!subjectSpoken(shot.subject, window)) {
            out.push(violation('shot_subject', n, SUBJECT_ERROR_FRAMES.includes(n) ? 'error' : 'warning', `the ${shot.kind} shot on "${shot.subject}" plays while the voice says "${window}": frame what the voice is naming`));
          }
        }
      }
    }

    // Act jobs.
    if (n === 1 && OPENER_RE.test(voice)) out.push(violation('cold_open', 1, 'error', "frame 1 says the Explainer opener template; it opens on the story"));
    if (n === 1 && SLOW_OPEN_RE.test(voice)) out.push(violation('cold_open', 1, 'error', `frame 1 opens on "${SLOW_OPEN_RE.exec(voice)[0].trim()}": lead with the strongest word (the player, the number, the outcome), never background, a framing line or a question (RC-35)`));
    if (n === 1 && voice.includes('?')) out.push(violation('cold_open', 1, 'error', 'frame 1 asks a question: it states the most surprising specific and leaves the loop open (RC-35)'));
    if (n >= 1 && n <= 4 && term && termCount(voice, term) > 0) out.push(violation('term_early', n, 'error', `frame ${n} says the term "${term}"; the reveal (frame 5) names it`));
    if (n === 2 && !field('stamp')) out.push(violation('stamp', 2, 'error', 'no stamp: (the date and place shown)'));
    if (n === 2 && field('stamp')) {
      const cited = (ids ?? []).map((id) => facts.get(id) ?? '').join(' ');
      for (const num of new Set(numbersIn(field('stamp')))) {
        if (!new Set(numbersIn(cited)).has(num)) out.push(violation('stamp', 2, 'error', `the stamp's ${num} is in no fact frame 2 cites`));
      }
    }
    if (n === 4) {
      frameQuestion = unquote(field('question'));
      if (!frameQuestion) out.push(violation('question', 4, 'error', 'no question: (the question the line ends on)'));
      const last = sentencesOf(voice).pop() ?? '';
      if (!last.endsWith('?')) out.push(violation('question', 4, 'error', 'frame 4 ends on its question'));
      else if (frameQuestion && normalize(last) !== normalize(frameQuestion)) out.push(violation('question', 4, 'error', `frame 4 ends on "${last}", not its question "${frameQuestion}"`));
    }
    if (n === 5) {
      const count = term ? termCount(voice, term) : 0;
      if (term && count === 0) out.push(violation('term', 5, 'error', `the reveal never says the term "${term}" exactly`));
      if (count > 1) out.push(violation('term', 5, 'warning', `the reveal says the term ${count} times; once`));
      const card = unquote(field('term_card'));
      if (!card) out.push(violation('term_card', 5, 'error', 'no term_card: (the term\'s meaning)'));
      else if (countWords(card) > TERM_CARD_MAX_WORDS) out.push(violation('term_card', 5, 'error', `the term card is ${countWords(card)} words; at most ${TERM_CARD_MAX_WORDS}`));
    }
  });

  for (const [s, p] of questionProblems(section(storyboard, 'Question'), frameQuestion)) out.push(violation('question', null, s, p));
  // RC-44: the bulletin board, the whiteboard and the newspaper each appear in the spoken frames.
  const used = new Set(frames.slice(0, 7).map((f) => String(f.extra?.ground ?? '').trim().toLowerCase()));
  const unused = NEWS_GROUNDS.filter((g) => !used.has(g));
  if (frames.length >= 7 && unused.length) out.push(violation('scenes', null, 'error', `no frame uses the ${unused.join(' or the ')} scene: every reel uses the board, the whiteboard and the newspaper`));
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
