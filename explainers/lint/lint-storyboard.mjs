#!/usr/bin/env node
// lint-storyboard.mjs — deterministic checks on an Explainer Reel's plan
// (planning/Explainer Reels/BUILD_PLAN.md §7). No model, no judgment: it reports
// structure against the fixed seven-beat sheet. In version one violations are
// recorded and the render continues (E-07); the reviewer layers come after run one.
//
//   node lint-storyboard.mjs --storyboard STORYBOARD.md [--script SCRIPT.md]
//                            [--frames-dir compositions/frames] [--out lint.json]
//
// Exit 0 always when the files parse (violations are data, not failures);
// exit 2 on a usage or read error.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStoryboard } from '../hyperframes-skills/faceless-explainer/scripts/lib/storyboard.mjs';

/** The fixed beat sheet: order, storyboard `type`, nominal seconds. */
export const BEAT_SHEET = [
  { beat: 'hook', type: 'hook', seconds: 4 },
  { beat: 'analogy', type: 'product_intro', seconds: 8 },
  { beat: 'mapping', type: 'feature_showcase', seconds: 9 },
  { beat: 'worked example', type: 'social_proof', seconds: 8 },
  { beat: 'technical catch', type: 'benefit_highlight', seconds: 6 },
  { beat: 'real-world context', type: 'social_proof', seconds: 6 },
  { beat: 'thesis + close', type: 'branding', seconds: 4 },
];

export const TOTAL_SECONDS = 45;
export const TOTAL_TOLERANCE = 3;
export const VO_MIN_WORDS = 6;
export const VO_MAX_WORDS = 20;
export const MAX_TRANSITION_TYPES = 3;

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

/** Visible text of a built frame: tags, scripts, and styles stripped. */
export function visibleText(html) {
  return String(html ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Narration sentences of 4+ words, for the on-screen repeat check. */
function sentences(text) {
  return String(text ?? '')
    .split(/(?<=[.?!])\s+/)
    .map(normalize)
    .filter((s) => s.split(' ').length >= 4);
}

/**
 * Subject-internal jargon candidates in the hook: acronyms and code-shaped tokens.
 * A flag for review, never a judgment (BUILD_PLAN §7).
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

/**
 * @param {{ storyboard: string, script?: string | null, frameHtml?: Map<number, string> }} input
 */
export function lintStoryboard({ storyboard, script = null, frameHtml = new Map() }) {
  const out = [];
  const { frames } = parseStoryboard(storyboard);
  const scriptLines = script ? parseScript(script) : null;
  const voiceFor = (frame, i) => {
    const number = frame.number ?? i + 1;
    return scriptLines ? (scriptLines.get(number) ?? '') : (frame.voiceover ?? '');
  };

  // Frame count and total duration.
  if (frames.length !== BEAT_SHEET.length) {
    out.push(violation('frame_count', null, 'error', `${frames.length} frames; the beat sheet has ${BEAT_SHEET.length}`));
  }
  const durations = frames.map((f) => f.durationSeconds);
  const missing = frames.filter((f) => !Number.isFinite(f.durationSeconds));
  missing.forEach((f, i) => out.push(violation('duration_missing', f.number ?? i + 1, 'error', 'frame has no duration')));
  if (missing.length === 0) {
    const total = durations.reduce((a, b) => a + b, 0);
    if (Math.abs(total - TOTAL_SECONDS) > TOTAL_TOLERANCE) {
      out.push(violation('total_duration', null, 'error', `${total}s total; target ${TOTAL_SECONDS}s ± ${TOTAL_TOLERANCE}s`));
    }
  }

  // Transitions: at most three types, frame 1 a cut.
  const transitions = frames.map((f) => String(f.transitionIn ?? '').trim().toLowerCase().split(/\s+/)[0]).filter(Boolean);
  const kinds = new Set(transitions);
  if (kinds.size > MAX_TRANSITION_TYPES) {
    out.push(violation('transition_types', null, 'warning', `${kinds.size} transition types (${[...kinds].join(', ')}); at most ${MAX_TRANSITION_TYPES}`));
  }
  if (frames[0] && String(frames[0].transitionIn ?? '').trim().toLowerCase() !== 'cut') {
    out.push(violation('first_transition', 1, 'warning', `frame 1 enters on "${frames[0].transitionIn ?? 'nothing'}"; must be cut`));
  }

  // Narration sentences, for the on-screen repeat check below.
  const narration = new Set();

  frames.forEach((frame, i) => {
    const n = frame.number ?? i + 1;
    const sheet = BEAT_SHEET[i];
    const type = String(frame.extra?.type ?? '').trim();
    if (sheet && type !== sheet.type) {
      out.push(violation('beat_type', n, 'error', `type "${type || 'missing'}"; beat ${i + 1} (${sheet.beat}) needs "${sheet.type}"`));
    }
    if (!String(frame.extra?.persuasion ?? '').trim()) {
      out.push(violation('clarity_technique', n, 'error', 'no persuasion (clarity technique)'));
    }
    if (!String(frame.scene ?? '').trim()) {
      out.push(violation('visual_missing', n, 'error', 'no scene: the frame names no visual'));
    }

    const vo = voiceFor(frame, i);
    const words = countWords(vo);
    if (words < VO_MIN_WORDS || words > VO_MAX_WORDS) {
      out.push(violation('voiceover_words', n, 'warning', `${words} words; target ${VO_MIN_WORDS}–${VO_MAX_WORDS}`));
    }
    for (const s of sentences(vo)) narration.add(s);
    if (i === 0) {
      const jargon = jargonCandidates(vo);
      if (jargon.length) out.push(violation('hook_jargon', n, 'warning', `possible jargon in the hook: ${jargon.join(', ')}`));
    }

    // Copy only: narration, the visual line, and the title. Narrative prose is planning notes.
    const copy = [vo, frame.scene, frame.title].join('\n');
    if (/!(?!\[)/.test(copy.replace(/!\[[^\]]*\]\([^)]*\)/g, ''))) {
      out.push(violation('exclamation_mark', n, 'error', 'exclamation mark in voiceover or on-screen copy'));
    }
    if (EMOJI_RE.test(copy)) {
      out.push(violation('emoji', n, 'error', 'emoji in voiceover or on-screen copy'));
    }
  });

  // Built frames, when present: punctuation, emoji, and narration repeated on screen.
  for (const [n, html] of frameHtml) {
    const text = visibleText(html);
    if (text.includes('!')) out.push(violation('exclamation_mark', n, 'error', 'exclamation mark in on-screen text'));
    if (EMOJI_RE.test(text)) out.push(violation('emoji', n, 'error', 'emoji in on-screen text'));
    const screen = normalize(text);
    for (const s of narration) {
      if (screen.includes(s)) {
        out.push(violation('narration_on_screen', n, 'warning', `on-screen text repeats narration: "${s}"`));
      }
    }
  }

  return { violations: out, frames: frames.length };
}

function framesFromDir(dir) {
  const map = new Map();
  if (!dir || !existsSync(dir)) return map;
  for (const file of readdirSync(dir).sort()) {
    const n = /^(\d+)/.exec(file)?.[1];
    if (n && file.endsWith('.html')) map.set(Number(n), readFileSync(join(dir, file), 'utf8'));
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
    console.error('usage: lint-storyboard.mjs --storyboard STORYBOARD.md [--script SCRIPT.md] [--frames-dir dir] [--out file]');
    process.exit(2);
  }
  try {
    const scriptPath = flag('script');
    const result = lintStoryboard({
      storyboard: readFileSync(resolve(storyboardPath), 'utf8'),
      script: scriptPath && existsSync(scriptPath) ? readFileSync(resolve(scriptPath), 'utf8') : null,
      frameHtml: framesFromDir(flag('frames-dir')),
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
