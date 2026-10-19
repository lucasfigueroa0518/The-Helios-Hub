// The frames of an Explainers 3.0 reel, read from STORYBOARD.md (EX3-52). No DOM, no imports
// beyond Node, so try.mjs, mount.mjs, opener-sfx.mjs and the worker share one reading.
//
// A frame block is `## Frame N — Name` followed by `- key: value` lines. The frame id is the
// basename of its `src` (compositions/frames/04-analogy.html → 04-analogy); its scene module is
// assets/frames/<id>.js and its composition is compositions/frames/<id>.html.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLOSE_EVENTS } from './close-timing.js';

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

/** The close is frame 8 (EX3-95). */
export const CLOSE_FRAME = 8;

/** The voiceless close: frame 8 with no voiceover (EX3-95). Code builds it, not a worker. */
export function isClose(f) {
  return Boolean(f) && f.number === CLOSE_FRAME && !String(f.fields?.voiceover ?? '').replace(/["'\u201c\u201d]/g, '').trim();
}

/** The close's scene module: the kit's close.js. */
export const CLOSE_MODULE = "// The close (EX3-95): the kit's, the same in every reel. Written by code; never edit.\nexport { default } from '../kit/close.js';\n";

/** Write the close's module and sound events for storyboard frame `f` of the project at `root`. */
export function writeClose(root, f) {
  const dir = join(root, 'assets', 'frames');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${f.id}.js`), CLOSE_MODULE);
  writeFileSync(join(dir, `${f.id}.events.json`), `${JSON.stringify(CLOSE_EVENTS, null, 1)}\n`);
}
