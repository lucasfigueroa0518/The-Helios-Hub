// The frames of a Reel AI Drama reel, read from STORYBOARD.md. No DOM; Node only. try.mjs, mount.mjs,
// pace.mjs, sound.mjs and music.mjs share this one reading (forked from the news kit's frames.mjs:
// any number of frames, no sting, the last frame is the brand close, MD-13).
//
// A frame block is `## Frame N — Name` followed by `- key: value` lines. The frame id is the basename
// of its `src` (compositions/frames/04-moment.html → 04-moment); its scene module is
// assets/frames/<id>.js and its composition is compositions/frames/<id>.html.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLOSE_EVENTS } from './close-timing.js';

/** Every frame `treatment:` the kit builds (FRAME.md). The close is code's; the rest are the frame workers'. */
export const TREATMENTS = [
  'photo', 'cutout_lift', 'collision', 'page', 'map', 'document', 'post', 'headline', 'lower_third', 'number',
  'board', 'whiteboard', 'newspaper', 'tableau', 'collage', 'close',
];
/** Treatments on a light ground: captions turn to ink there. Every other ground is dark under the caption
 *  band (graded photos, the desk above the newspaper page). */
export const LIGHT_TREATMENTS = new Set(['whiteboard']);
/** Music cues a frame may carry (S-74): the bed starts, changes, drops out, holds or ends at the frame's start. */
export const MUSIC_CUES = ['start', 'change', 'drop', 'hold', 'end'];

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

/**
 * Every frame in a storyboard, in order: { number, name, id, src, duration, fields }.
 * @returns {{ number: number, name: string, id: string, src: string, duration: number, fields: Record<string, string> }[]}
 */
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

/** A storyboard frame's treatment (`- treatment:`), photo when unset. */
export const frameTreatment = (f) => (f?.fields?.treatment ?? '').trim().toLowerCase() || 'photo';

/** The brand close: the frame whose treatment is `close` (the last frame, MD-13). */
export const isClose = (f) => Boolean(f) && frameTreatment(f) === 'close';

/** A frame's music cue (`- music:`), hold when unset or unknown. */
export function musicCue(f) {
  const v = String(f?.fields?.music ?? '').trim().toLowerCase().split(/\s+/)[0];
  return MUSIC_CUES.includes(v) ? v : 'hold';
}

/** The words the voice speaks over a frame, quotes stripped. */
export const voiceText = (f) => String(f?.fields?.voiceover ?? '').replace(/^["'“]|["'”]$/g, '').trim();

/** The close's scene module: the kit's close.js. */
export const CLOSE_MODULE = "// The brand close (MD-13, MD-18): the kit's, the same in every reel. Written by code; never edit.\nexport { default } from '../kit/close.js';\n";

/** Write the close's module and sound events for storyboard frame `f` of the project at `root`. */
export function writeClose(root, f) {
  const dir = join(root, 'assets', 'frames');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${f.id}.js`), CLOSE_MODULE);
  writeFileSync(join(dir, `${f.id}.events.json`), `${JSON.stringify(CLOSE_EVENTS, null, 1)}\n`);
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

/**
 * The reel's media, for ctx.media: assets/inventory.json (written by project-files.mjs) as
 * { [asset id]: { file, kind, width, height, credit, shows, boxes?, map? } }. Empty when missing.
 * @returns {Record<string, any>}
 */
export function projectMedia(root) {
  try {
    const inv = JSON.parse(readFileSync(join(root, 'assets', 'inventory.json'), 'utf8'));
    const out = {};
    for (const a of inv.assets ?? []) {
      out[a.id] = {
        file: a.file, kind: a.kind, width: a.width, height: a.height, credit: a.credit ?? '', shows: a.shows ?? '',
        character_image: Boolean(a.character_image), ...(a.boxes ? { boxes: a.boxes } : {}), ...(a.map ? { map: a.map } : {}),
        ...(a.cutout ? { cutout: a.cutout } : {}), ...(a.face ? { face: a.face } : {}), ...(a.anchor_for ? { anchor_for: a.anchor_for } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}
