// The frames of an Explainers 3.0 reel, read from STORYBOARD.md (EX3-52). No DOM, no imports
// beyond Node (and the opener bank's plain data), so try.mjs, mount.mjs, opener-sfx.mjs and the
// worker share one reading.
//
// A frame block is `## Frame N — Name` followed by `- key: value` lines. The frame id is the
// basename of its `src` (compositions/frames/04-analogy.html → 04-analogy); its scene module is
// assets/frames/<id>.js and its composition is compositions/frames/<id>.html.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLOSE_EVENTS } from './close-timing.js';
import { openerByKey } from './openers/bank.js';
import { chosenOpener, openerLine } from './openers/sound.mjs';

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

/** The opener is frame 1 (EX3-102): the bank's opener over the worker's hook. */
export const OPENER_FRAME = 1;
/** The hook's scene module, which the frame worker writes for frame 1. */
export const HOOK_ID = '01-hook';

/** The storyboard's `term:` (its front matter), or ''. */
export function storyboardTerm(root) {
  const file = join(root, 'STORYBOARD.md');
  if (!existsSync(file)) return '';
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'));
  return (/^term:\s*(.+)$/m.exec(fm?.[1] ?? '')?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
}

/** True when frame 1 is the bank's (the job chose an opener: assets/opener.json). */
export const isBankOpener = (root, f) => Boolean(f) && f.number === OPENER_FRAME && Boolean(chosenOpener(root));

/**
 * Write frame 1's module (one call into the bank, with the line's length and word times baked in)
 * and its sound events (none: the opener's stem carries its sound) for storyboard frame `f`.
 * Returns the opener's key, or null when the job chose none (frame 1 is then the worker's own).
 */
export function writeOpener(root, f) {
  const key = chosenOpener(root);
  if (!key || !f?.id) return null;
  const metaFile = join(root, 'audio_meta.json');
  const line = existsSync(metaFile) ? openerLine(JSON.parse(readFileSync(metaFile, 'utf8'))) : null;
  const voice = line?.voice > 0 ? line.voice : 3.8;
  const words = (line?.words ?? []).map((w) => ({ text: String(w.text ?? '').trim(), start: w.start, end: w.end }));
  const dir = join(root, 'assets', 'frames');
  mkdirSync(dir, { recursive: true });
  const module = [
    `// Frame 1 (EX3-102): the bank's "${openerByKey(key).name}" opener over the hook (${HOOK_ID}.js).`,
    '// Written by code from assets/opener.json; never edit. The frame worker writes only the hook.',
    `import * as hook from './${HOOK_ID}.js';`,
    "import { openerFrame } from '../kit/openers/index.js';",
    '',
    `export default openerFrame(${JSON.stringify(key)}, { hook, voice: ${voice}, words: ${JSON.stringify(words)}, term: ${JSON.stringify(storyboardTerm(root))} });`,
    '',
  ].join('\n');
  writeFileSync(join(dir, `${f.id}.js`), module);
  writeFileSync(join(dir, `${f.id}.events.json`), '[]\n');
  return key;
}
