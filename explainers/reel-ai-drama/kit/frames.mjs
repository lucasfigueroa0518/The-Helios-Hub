// The frames of a Reel AI Drama reel, read from STORYBOARD.md. No DOM; Node only. try.mjs, mount.mjs,
// pace.mjs, sound.mjs and music.mjs share this one reading (forked from the news kit's frames.mjs:
// any number of frames, no sting, the last frame is the brand close, MD-143).
//
// A frame block is `## Frame N — Name` followed by `- key: value` lines. The frame id is the basename
// of its `src` (compositions/frames/04-moment.html → 04-moment); its scene module is
// assets/frames/<id>.js and its composition is compositions/frames/<id>.html.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLOSE_EVENTS, CLOSE_FADE } from './close-timing.js';

/** Every frame `treatment:` the kit builds (FRAME.md). The close is code's; the rest are the frame workers'. */
export const TREATMENTS = [
  'photo', 'cutout_lift', 'collision', 'page', 'map', 'document', 'post', 'headline', 'lower_third', 'number',
  'board', 'whiteboard', 'newspaper', 'tableau', 'collage', 'stat', 'lift', 'close',
];
/** Treatments on a light ground: captions turn to ink there (the whiteboard, the white close). Every other
 *  ground is dark under the caption band (graded photos, the desk above the newspaper page). */
export const LIGHT_TREATMENTS = new Set(['whiteboard', 'close']);
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

/** The brand close: the frame whose treatment is `close` (the last frame, MD-143). */
export const isClose = (f) => Boolean(f) && frameTreatment(f) === 'close';

/** A frame's music cue (`- music:`), hold when unset or unknown. */
export function musicCue(f) {
  const v = String(f?.fields?.music ?? '').trim().toLowerCase().split(/\s+/)[0];
  return MUSIC_CUES.includes(v) ? v : 'hold';
}

/** The words the voice speaks over a frame, quotes stripped. */
export const voiceText = (f) => String(f?.fields?.voiceover ?? '').replace(/^["'“]|["'”]$/g, '').trim();

/** The close's scene module: the kit's close.js. */
export const CLOSE_MODULE = "// The brand close (MD-143): the kit's, the same in every reel. Written by code; never edit.\nexport { default } from '../kit/close.js';\n";

/** Write the close's module and sound events for storyboard frame `f` of the project at `root`. */
export function writeClose(root, f) {
  const dir = join(root, 'assets', 'frames');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${f.id}.js`), CLOSE_MODULE);
  writeFileSync(join(dir, `${f.id}.events.json`), `${JSON.stringify(CLOSE_EVENTS, null, 1)}\n`);
}

/**
 * A storyboard with the close's `- transition_in:` set to the crossfade (MD-143), so the last story frame
 * never hard-cuts into the white. Every other frame's is left alone. Pure and idempotent.
 */
export function withCloseFade(storyboard) {
  const text = String(storyboard);
  const heads = [...text.matchAll(/^##\s+Frame\s+\d+.*$/gm)];
  for (let i = heads.length - 1; i >= 0; i--) {
    const start = heads[i].index;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const block = text.slice(start, end);
    if (frameTreatment({ fields: blockFields(block) }) !== 'close') continue;
    const line = `- transition_in: ${CLOSE_FADE}`;
    const next = /^-\s+transition_in:.*$/m.test(block) ? block.replace(/^-\s+transition_in:.*$/m, line) : block.replace(/^(##\s+Frame.*(?:\r?\n)+)/, `$1${line}\n`);
    return text.slice(0, start) + next + text.slice(end);
  }
  return text;
}

/** Give the project's close its crossfade (assemble.mjs, before the transitions are injected). */
export function writeCloseFade(root) {
  const file = join(root, 'STORYBOARD.md');
  if (!existsSync(file)) return;
  const before = readFileSync(file, 'utf8');
  const after = withCloseFade(before);
  if (after !== before) writeFileSync(file, after);
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
 * { [asset id]: { id, file, kind, width, height, credit, shows, people, made, made_kind, boxes?, map?, face?,
 * regions? } } (`regions`: the box sidecar's faces, words, photos and lift, 0–1). Empty when missing.
 * @returns {Record<string, any>}
 */
const cutoutOf = (a) => (a.flags ?? []).map((f) => /^cutout_of:(.+)$/.exec(String(f))?.[1]).find(Boolean) ?? null;

/** @returns {Record<string, any>} */
/** Whole years since a picture's date ('2013-05-25', '2011'), today; null when it has none. */
function ageYears(date, now = new Date()) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(String(date ?? ''));
  if (!m) return null;
  return (now - new Date(Date.UTC(Number(m[1]), Number(m[2] ?? 12) - 1, Number(m[3] ?? 28)))) / (365.25 * 24 * 3600 * 1000);
}

const nameWord = (w) => String(w ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/**
 * Across the reel's compiled frames, in order: the first frame to show each picture, and the first to name each person, meaning a
 * frame that has their picture while the voice says their name. A hook frame has its own look and no labels, so it counts for
 * neither. Empty when the frames can't be read.
 */
function reelFirsts(root, assets) {
  const shown = new Map();
  const named = new Map();
  try {
    const dir = join(root, 'assets', 'frames');
    const byId = new Map(assets.map((a) => [a.id, a]));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
      const n = Number.parseInt(file, 10);
      const code = readFileSync(join(dir, file), 'utf8');
      if (!Number.isFinite(n) || !code.includes('compiledFrame(')) continue;
      const ids = [...code.matchAll(/"(?:asset|ground)":\s*"([^"]+)"/g)].map((m) => m[1]).filter((id) => byId.has(id));
      for (const id of ids) if (!shown.has(id)) shown.set(id, n);
      let said = new Set();
      try {
        said = new Set(JSON.parse(readFileSync(join(root, 'assets', 'timing', `${file.slice(0, -3)}.json`), 'utf8')).words?.map((w) => nameWord(w.text)) ?? []);
      } catch {
        // No timing yet: nobody counts as named.
      }
      for (const id of ids) {
        for (const person of byId.get(id).people ?? []) {
          const last = nameWord(String(person).trim().split(/\s+/).pop());
          if (!named.has(person) && (said.has(last) || said.has(`${last}s`))) named.set(person, n);
        }
      }
    }
  } catch {
    // Nothing compiled yet.
  }
  return { shown, named };
}

export function projectMedia(root) {
  try {
    const inv = JSON.parse(readFileSync(join(root, 'assets', 'inventory.json'), 'utf8'));
    const firsts = reelFirsts(root, inv.assets ?? []);
    const out = {};
    for (const a of inv.assets ?? []) {
      const age = ageYears(a.date_taken);
      const namedIn = Object.fromEntries((a.people ?? []).filter((p) => firsts.named.has(p)).map((p) => [p, firsts.named.get(p)]));
      out[a.id] = {
        id: a.id, file: a.file, kind: a.kind, width: a.width, height: a.height, credit: a.credit ?? '', shows: a.shows ?? '',
        // What a photo's own label reads, from its data (compiled.js photoLabel), and which frame shows it or names its people first.
        place: a.place ?? null, date_taken: a.date_taken ?? null, date_confidence: a.date_confidence ?? 'unknown',
        ...(age != null ? { age_years: age } : {}),
        ...(firsts.shown.has(a.id) ? { first_frame: firsts.shown.get(a.id) } : {}),
        ...(Object.keys(namedIn).length ? { named_in: namedIn } : {}),
        character_image: Boolean(a.character_image), people: a.people ?? [], made: Boolean(a.made), made_kind: a.made_kind ?? null,
        ...(a.boxes ? { boxes: a.boxes } : {}), ...(a.map ? { map: a.map } : {}),
        ...(a.cutout ? { cutout: a.cutout } : {}), ...(a.face ? { face: a.face } : {}), ...(a.anchor_for ? { anchor_for: a.anchor_for } : {}),
        ...(a.regions ? { regions: a.regions } : {}),
        // What the stage reads off a record: what kind of cut it is, and the photo it was cut from.
        ...(a.flags?.length ? { flags: a.flags } : {}),
        ...(cutoutOf(a) ? { cutout_of: cutoutOf(a) } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}
