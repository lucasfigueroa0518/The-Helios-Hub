// The frames of an AI News Explained reel, read from STORYBOARD.md. No DOM; Node only. try.mjs,
// mount.mjs, pace.mjs, sound.mjs and music.mjs share this one reading (forked from the world kit's
// frames.mjs: no opener bank, our close, our grounds, the sting in frame 1's hold).
//
// A frame block is `## Frame N — Name` followed by `- key: value` lines. The frame id is the basename
// of its `src` (compositions/frames/04-moment.html → 04-moment); its scene module is
// assets/frames/<id>.js and its composition is compositions/frames/<id>.html.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLOSE_EVENTS, STING, STING_EVENTS } from './close-timing.js';

/** The three scenes (RC-44). The close draws its own folder; its storyboard ground is free. */
export const GROUND_NAMES = ['board', 'whiteboard', 'newspaper'];
/** Grounds dark enough that captions turn light. */
export const DARK_GROUNDS = new Set(['board']);

/** `- key: value` fields of one frame block, keys lowercased. */
export function blockFields(block) {
  const fields = {};
  for (const line of String(block).split(/\r?\n/)) {
    const m = /^-\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line.trim());
    if (m && !(m[1].toLowerCase() in fields)) fields[m[1].toLowerCase()] = m[2].trim();
  }
  return fields;
}

/** Seconds from a duration field ("4s", "4.2", "4.2 s"); NaN when absent. */
export function seconds(value) {
  const m = /^(\d+(?:\.\d+)?)\s*s?$/i.exec(String(value ?? '').trim());
  return m ? Number(m[1]) : NaN;
}

/** Every frame in a storyboard, in order: { number, name, id, src, duration, fields }. */
export function parseFrames(storyboard) {
  const out = [];
  const re = /^##\s+Frame\s+(\d+)\s*[—–-]?\s*(.*)$/gm;
  const heads = [...String(storyboard).matchAll(re)];
  heads.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : String(storyboard).length;
    const fields = blockFields(String(storyboard).slice(start, end).replace(/^##\s+(?!Frame)[\s\S]*$/m, ''));
    const src = fields.src ?? '';
    const id = /([^/]+)\.html$/.exec(src)?.[1] ?? '';
    out.push({ number: Number(m[1]), name: m[2].trim(), id, src, duration: seconds(fields.duration), fields });
  });
  return out;
}

/** The frames of the project at `root`; empty when there is no STORYBOARD.md. */
export function projectFrames(root) {
  const file = join(root, 'STORYBOARD.md');
  return existsSync(file) ? parseFrames(readFileSync(file, 'utf8')) : [];
}

/** A storyboard frame's ground (`- ground:`), board when unset. */
export const frameGround = (f) => (f.fields?.ground ?? '').trim().toLowerCase() || 'board';

/** Frame 1 carries the sting in its hold (RC-31). */
export const STING_FRAME = 1;
export const STING_HOLD = STING.duration;
/** Where the sting starts in frame 1: its voice end (pace.mjs writes `voice_end`). */
export const stingAt = (f) => {
  const v = seconds(f?.fields?.voice_end);
  return Number.isFinite(v) ? v : Math.max(0, (f?.duration ?? STING_HOLD) - STING_HOLD);
};

/** The close is frame 8, voiceless (RC-31). */
export const CLOSE_FRAME = 8;
export function isClose(f) {
  return Boolean(f) && f.number === CLOSE_FRAME && !String(f.fields?.voiceover ?? '').replace(/["'\u201c\u201d]/g, '').trim();
}

/** The close's scene module: the kit's close.js. */
export const CLOSE_MODULE = "// The close (RC-31): the kit's, the same in every reel. Written by code; never edit.\nexport { default } from '../kit/close.js';\n";

/** Write the close's module and sound events for storyboard frame `f` of the project at `root`. */
export function writeClose(root, f) {
  const dir = join(root, 'assets', 'frames');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${f.id}.js`), CLOSE_MODULE);
  writeFileSync(join(dir, `${f.id}.events.json`), `${JSON.stringify(CLOSE_EVENTS, null, 1)}\n`);
}

/**
 * Add the sting's sounds to frame 1's events file (marked `sting: true`, replaced on every run, the
 * worker's own events kept). Frame 1's events file is the worker's; this only appends.
 */
export function writeStingEvents(root, f) {
  const file = join(root, 'assets', 'frames', `${f.id}.events.json`);
  let list = [];
  try {
    list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  } catch {
    return false; // try.mjs reports the broken file
  }
  if (!Array.isArray(list)) return false;
  const at = stingAt(f);
  const kept = list.filter((e) => !e?.sting && !(typeof e?.t === 'number' && e.t > at + 1e-6));
  const next = [...kept, ...STING_EVENTS(at).map((e) => ({ ...e, t: Math.round(e.t * 1000) / 1000, sting: true }))];
  mkdirSync(join(root, 'assets', 'frames'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 1)}\n`);
  return true;
}

/** The placed drawings' strokes by kind and slug (assets/objects/<kind>/<slug>.strokes.json), for ctx.objects. */
export function objectStrokes(root) {
  const out = { drawing: {}, 'person-sketch': {} };
  for (const kind of Object.keys(out)) {
    const dir = join(root, 'assets', 'objects', kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.strokes.json'))) {
      try {
        out[kind][f.replace(/\.strokes\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        // a broken strokes file is left out; the frame treats the drawing as missing
      }
    }
  }
  return out;
}
