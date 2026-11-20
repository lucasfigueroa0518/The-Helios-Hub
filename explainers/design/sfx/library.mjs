// The Helios sound-effect library: the one catalog every content type reads (Explainers, Reel AI
// Drama, Real Case, and any format added later). Offline: files and arithmetic, no model.
//
// The library is this folder (explainers/design/sfx). It holds three catalogs that load as one:
//   catalog.json        the bank (Kenney CC0, Pixabay, Freesound CC0), hand-curated
//   catalog-inbox.json  Lucas's drop-ins, written by tools/ingest-inbox.mjs from inbox/
//   acoustics.json      measured attack, decay, brightness and body of the bank's sounds
// and, for formats that want beds, ambience-catalog.json (long room tones and crowds; never mixed
// into a plain loadLibrary() so no event lookup lands on a 25-second bed).
//
// Plugging in a new content type: import this module (TS: '@/explainers/design/sfx/library.mjs';
// a kit copied into a job workspace: a symlink `sfx-library.mjs` in the kit, see world-kit), load
// with loadLibrary(dir) where `dir` is the job's assets/sfx-library (a link to this folder) or
// SFX_DIR, and pick with searchLibrary() or your own rules. Drop-ins then reach you automatically.
//
//   node explainers/design/sfx/library.mjs --summary              what is in the library
//   node explainers/design/sfx/library.mjs paper slide            search by words
//   node explainers/design/sfx/library.mjs --kind impact --dropins --n 20 wood

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadVoiceScreen, soundVoiceFree } from './voice-screen.mjs';

// The voice screen (voice-screen.mjs) travels with the library: every kit that links this module
// reaches it here.
export { loadVoiceScreen, mentionsVoice, MUSIC_SCREEN_HINT, MUSIC_VOICE_MAX, soundVoiceFree, trackVoiceFree, VOICE_MAX } from './voice-screen.mjs';

export const SFX_DIR = dirname(fileURLToPath(import.meta.url));
export const FILES = { bank: 'catalog.json', dropins: 'catalog-inbox.json', acoustics: 'acoustics.json', ambience: 'ambience-catalog.json' };
/** The pack every drop-in carries. */
export const DROPIN_PACK = 'inbox';

/**
 * Tags a drop-in of each event kind carries, so the formats' tag searches (an impact needs 'impact',
 * a sting 'chime', a tick 'click') find drop-ins exactly as they find bank sounds.
 */
export const KIND_TAGS = {
  impact: ['impact'],
  whoosh: ['whoosh'],
  sting: ['sting', 'chime'],
  pop: ['pop'],
  click: ['click'],
  tick: ['tick', 'click'],
  foley: ['physical'],
};

const readJson = (file, fallback) => {
  try {
    const v = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
    return Array.isArray(fallback) ? (Array.isArray(v) ? v : fallback) : v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
};

/** A drop-in with its kind's tags added (older catalog-inbox.json files lack some). */
export function withKindTags(s) {
  const extra = (KIND_TAGS[s.kind] ?? []).filter((t) => !s.tags?.includes(t));
  return extra.length ? { ...s, tags: [...(s.tags ?? []), ...extra] } : s;
}

/** The first folder of `candidates` holding a catalog.json (default: the job's assets/sfx-library, then this folder). */
export function findLibraryDir(candidates = [join(process.cwd(), 'assets', 'sfx-library'), SFX_DIR]) {
  return candidates.find((d) => d && existsSync(join(d, FILES.bank))) ?? null;
}

/**
 * The library at `dir` as one list: the bank, then the drop-ins (unless `dropins: false`), then the
 * ambience beds (only with `ambience: true`), each with its measured acoustics merged under it.
 * @param {string} [dir]
 * @param {{ dropins?: boolean, ambience?: boolean }} [opts]
 * @returns {any[]}
 */
export function loadLibrary(dir = SFX_DIR, { dropins = true, ambience = false } = {}) {
  const acoustics = readJson(join(dir, FILES.acoustics), {});
  const list = [
    ...readJson(join(dir, FILES.bank), []),
    // a drop-in whose MP3 is not on this machine (its store not synced here) is left out, so no mix
    // ever names a missing file
    ...(dropins ? readJson(join(dir, FILES.dropins), []).filter((s) => typeof s?.file === 'string' && existsSync(join(dir, s.file))).map(withKindTags) : []),
    ...(ambience ? readJson(join(dir, FILES.ambience), []) : []),
  ].filter((s) => s && typeof s.id === 'string' && typeof s.file === 'string' && Array.isArray(s.tags));
  return voiceFree(dir, list).map((s) => (acoustics[s.file] ? { ...acoustics[s.file], ...s } : s));
}

/** The ambience beds at `dir` (ambience-catalog.json), voice-screened like every sound. */
export function loadAmbience(dir = SFX_DIR) {
  return voiceFree(dir, readJson(join(dir, FILES.ambience), []));
}

/**
 * The sounds of `list` that may play: screened and voice-free (voice-screen.mjs). A sound the
 * screen has not measured is left out too, so a new drop-in never plays unheard. A folder with no
 * screen at all (a test's fixture library) is not screened.
 */
function voiceFree(dir, list) {
  const screen = loadVoiceScreen(dir);
  return screen ? list.filter((s) => soundVoiceFree(screen, s?.file)) : list;
}

export const isDropin = (s) => s?.pack === DROPIN_PACK;

// ── Search ──────────────────────────────────────────────────────────────────────────────────────

const singular = (w) => (w.length > 4 && /(sh|ch|x|ss)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
/** Lower-case words of a query or a description. */
export const wordsOf = (text) =>
  String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)
    .map(singular);

const countsCache = new WeakMap();
function tagCountsOf(catalog) {
  let c = countsCache.get(catalog);
  if (!c) {
    c = new Map();
    for (const s of catalog) for (const t of new Set(s.tags.map(singular))) c.set(t, (c.get(t) ?? 0) + 1);
    countsCache.set(catalog, c);
  }
  return c;
}

/**
 * Rank `catalog` against a query. Every filter is optional:
 *   words      plain words ('paper slide'); a tag match scores by how rare the tag is, a match in the
 *              id or description scores half; with words, only sounds matching one are returned
 *   kind       impact | whoosh | sting | pop | click | tick | foley (the drop-in's kind or its tags)
 *   tags/not   tags a sound must all have / must have none of
 *   minDur/maxDur  seconds
 *   attack     'sharp' (≤ 15 ms to its peak) | 'soft' (≥ 80 ms); brightness 'bright' | 'dark'
 *   source     'dropins' | 'bank'
 * Returns up to `n` entries with a `score`, best first (on a tie Lucas's drop-ins first, then by id).

 * @param {any[]} catalog
 * @param {{ words?: string, kind?: string | null, tags?: string[], not?: string[], minDur?: number, maxDur?: number, attack?: 'sharp' | 'soft' | null, brightness?: 'bright' | 'dark' | null, source?: 'dropins' | 'bank' | null, n?: number }} [query]
 * @returns {any[]}
 */
export function searchLibrary(catalog, { words = '', kind = null, tags = [], not = [], minDur = 0, maxDur = Infinity, attack = null, brightness = null, source = null, n = 10 } = {}) {
  const q = [...new Set(wordsOf(words))];
  const counts = tagCountsOf(catalog);
  const total = Math.max(1, catalog.length);
  const idf = (t) => Math.log((total + 1) / (1 + (counts.get(t) ?? 0)));
  const out = [];
  for (const s of catalog) {
    if (!(s.duration >= minDur && s.duration <= maxDur)) continue;
    if (source === 'dropins' && !isDropin(s)) continue;
    if (source === 'bank' && isDropin(s)) continue;
    if (kind && s.kind !== kind && !(KIND_TAGS[kind] ?? [kind]).some((t) => s.tags.includes(t))) continue;
    if (tags.some((t) => !s.tags.includes(t))) continue;
    if (not.some((t) => s.tags.includes(t))) continue;
    if (attack === 'sharp' && !(s.attack <= 15)) continue;
    if (attack === 'soft' && !(s.attack >= 80)) continue;
    if (brightness === 'bright' && !(s.centroid >= 3500)) continue;
    if (brightness === 'dark' && !(s.centroid > 0 && s.centroid <= 1200)) continue;
    let score = 0;
    if (q.length) {
      const st = new Set(s.tags.map(singular));
      const text = new Set(wordsOf(`${s.id} ${s.description ?? ''}`));
      for (const w of q) score += st.has(w) ? idf(w) : text.has(w) ? idf(w) / 2 : 0;
      if (score <= 0) continue;
    }
    out.push({ ...s, score: Math.round(score * 1000) / 1000 });
  }
  return out.sort((a, b) => b.score - a.score || Number(isDropin(b)) - Number(isDropin(a)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, n);
}

/** Counts for a prompt or a report: totals, drop-ins, per kind and pack, and the commonest tags. */
export function librarySummary(catalog, { top = 30 } = {}) {
  const tally = (key) => {
    const m = {};
    for (const s of catalog) {
      const k = key(s);
      if (k) m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  };
  const skip = new Set(['inbox', 'physical', 'freesound', 'curated', 'short', 'long', 'sharp', 'soft-attack', 'bright', 'dark', 'sustain']);
  const tagTally = new Map();
  for (const s of catalog) for (const t of s.tags) if (!skip.has(t)) tagTally.set(t, (tagTally.get(t) ?? 0) + 1);
  return {
    total: catalog.length,
    dropins: catalog.filter(isDropin).length,
    byKind: tally((s) => s.kind ?? null),
    byPack: tally((s) => s.pack ?? null),
    topTags: [...tagTally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, top).map(([t, c]) => `${t} ${c}`),
  };
}

// ── Designed stingers (Reel AI Drama's sound designer) ──────────────────────────────────────────
// The designer picks stingers by id from a short menu per kind (hit, sub, riser, whoosh, spot). The
// bank's are hand-measured (kit/sound.mjs STINGER_LIBRARY); drop-ins join the menu by their words.

/** Name words → the designed-stinger kind a drop-in can play (first match wins, in this order). */
export const STINGER_WORDS = [
  ['riser', ['riser', 'rise', 'rising', 'build', 'buildup', 'swell', 'uplifter', 'upsweep', 'tension', 'reverse']],
  ['sub', ['sub', 'subdrop', 'rumble', 'lowfrequency', 'lowend']],
  ['whoosh', ['whoosh', 'woosh', 'swoosh', 'swish', 'swipe', 'whip', 'flyby', 'passby', 'transition']],
  ['hit', ['hit', 'impact', 'slam', 'boom', 'punch', 'thud', 'smash', 'bang', 'braam', 'stinger']],
];

/** The designed-stinger kind a drop-in can play, 'spot' for a real-world sound (foley), or null. */
export function stingerKindOf(s) {
  if (!isDropin(s)) return null;
  const tags = new Set(s.tags);
  for (const [kind, words] of STINGER_WORDS) {
    if (!words.some((w) => tags.has(w))) continue;
    // a riser builds: its loudest point comes late (at least half a second in)
    if (kind === 'riser' && !(s.attack >= 500)) continue;
    return kind;
  }
  return s.kind === 'foley' && s.duration <= 4 ? 'spot' : null;
}

/** A drop-in as a stinger menu entry: `land` is where it hits (or a riser crests), from its attack. */
export function asStinger(s) {
  const land = Number.isFinite(s.attack) ? Math.round(s.attack) / 1000 : 0;
  const about = String(s.description ?? s.tags.join(' ')).replace(/\s+/g, ' ').slice(0, 90);
  return { id: s.id, land, about };
}

/**
 * Drop-ins for the designer's stinger menu: up to `perKind` per kind (`spot` up to `spots`), one per
 * sound family first so the menu spans the drop-ins instead of ten takes of one hit.

 * @param {any[]} catalog
 * @param {{ perKind?: number, spots?: number }} [opts]
 * @returns {Record<string, { id: string, land: number, about: string }[]>}
 */
export function dropinStingers(catalog, { perKind = 8, spots = 16 } = {}) {
  const byKind = {};
  for (const s of catalog) {
    const kind = stingerKindOf(s);
    if (kind) (byKind[kind] ??= []).push(s);
  }
  const out = {};
  for (const [kind, list] of Object.entries(byKind)) {
    const families = new Map();
    for (const s of [...list].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const g = s.group ?? s.id;
      if (!families.has(g)) families.set(g, []);
      families.get(g).push(s);
    }
    const cap = kind === 'spot' ? spots : perKind;
    const picked = [];
    for (let round = 0; picked.length < cap; round++) {
      let any = false;
      for (const fam of families.values()) {
        if (round < fam.length && picked.length < cap) {
          picked.push(fam[round]);
          any = true;
        }
      }
      if (!any) break;
    }
    out[kind] = picked.map(asStinger);
  }
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : null;
  };
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? Boolean(args.splice(i, 1)) : false;
  };
  const dir = opt('--dir') ?? findLibraryDir() ?? SFX_DIR;
  const kind = opt('--kind');
  const n = Number(opt('--n') ?? 15);
  const summary = flag('--summary');
  const dropins = flag('--dropins');
  const catalog = loadLibrary(dir);
  if (summary || !args.length) {
    console.log(JSON.stringify(librarySummary(catalog), null, 1));
  } else {
    for (const s of searchLibrary(catalog, { words: args.join(' '), kind, n, ...(dropins ? { source: 'dropins' } : {}) })) {
      console.log(`${s.id} · ${s.duration}s · ${s.kind ?? '-'} · ${s.description ?? s.tags.slice(0, 8).join(' ')}`);
    }
  }
}
