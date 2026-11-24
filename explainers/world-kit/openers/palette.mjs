// The opener's sound palette (Lucas 2026-11-17: "the hit sound effect is still being used BACK TO
// BACK to start the reel. This is unacceptable ... use more sound effects"). Deterministic, no model.
//
// Before: every opener's score played one of two near-identical pixabay bass hits at its break, and
// the 1→2 cut played the other one, so every reel opened bass, bass. Now each reel draws its own
// palette from the whole library (the bank plus Lucas's drop-ins, design/sfx/library.mjs):
//   - break:  the one heavy hit of the opening, at the opener's break (a sharp impact; the Deep
//             Impacts pack when it is installed, the bank's heavy impacts when it is not);
//   - swish:  the opener's own whoosh moves, one short whoosh;
//   - cut:    the 1→2 cut, never a hit: a whoosh or a riser tail that rushes into the cut.
// Rules code enforces: one heavy hit in the opening, no two sounds of one family, the cut is a sweep.
// The draw is seeded by the job (the project folder's parent is the job id), so a reel keeps its
// palette on every re-run and different reels sound different.

import { basename, dirname, resolve } from 'node:path';

import { loadLibrary } from '../sfx-library.mjs';

/** The bank's sharp heavy hits: the break pool when no drop-in impacts are installed. */
export const BANK_BREAKS = [
  'pixabay/impact-bass-1.mp3',
  'pixabay/impact-bass-2.mp3',
  'kenney/impact-sounds/Audio/impactPunch_heavy_000.ogg',
  'kenney/impact-sounds/Audio/impactPunch_heavy_002.ogg',
  'kenney/impact-sounds/Audio/impactSoft_heavy_002.ogg',
  'kenney/impact-sounds/Audio/impactMetal_heavy_001.ogg',
];
/** The bank's whooshes: the swish and cut pools when no drop-in whooshes are installed. */
export const BANK_SWEEPS = ['pixabay/whoosh.mp3', 'pixabay/whoosh-short.mp3', 'pixabay/whoosh-cinematic.mp3', 'pixabay/riser.mp3'];

/** Placeholders an opener's score uses (openers/sound.mjs); the palette resolves them. */
export const BREAK = 'PALETTE/BREAK';
export const SWISH = 'PALETTE/SWISH';

/** One family per sound: its catalog group, else its file without a trailing number. */
export function familyOf(s) {
  if (s?.group) return String(s.group).replace(/[-_ ]?\d+$/, '');
  return String(s?.file ?? s).replace(/\.(mp3|ogg|wav)$/i, '').replace(/[-_ ]?\d+$/, '');
}

/** A small seeded generator (mulberry32) from any string. */
export function seeded(text) {
  let h = 1779033703 ^ String(text).length;
  for (let i = 0; i < String(text).length; i++) h = Math.imul(h ^ String(text).charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed for a project: OPENER_SEED, else the job id (the project folder's parent), else its path. */
export function seedFor(root) {
  if (process.env.OPENER_SEED) return process.env.OPENER_SEED;
  const abs = resolve(root);
  return basename(abs) === 'project' ? basename(dirname(abs)) : abs;
}

const fromDropins = (s, pack) => s.pack === 'inbox' && String(s.group ?? s.id ?? '').includes(`/${pack}/`);
const pick = (pool, rand) => pool[Math.floor(rand() * pool.length)] ?? null;

/** The pools from a library catalog (loadLibrary's list). */
export function palettePools(catalog) {
  const byFile = new Map(catalog.map((s) => [s.file, s]));
  const bank = (files) => files.map((f) => byFile.get(f) ?? { file: f, group: f }).filter(Boolean);
  // a sharp, short-to-medium impact with a real tail
  const breaks = catalog.filter((s) => s.kind === 'impact' && fromDropins(s, 'deep-impacts-sound-fx') && s.duration >= 0.6 && s.duration <= 3.5 && (s.attack ?? 0) <= 40);
  // short whooshes for the opener's own moves; slightly longer ones (or riser tails) for the cut
  const whooshes = catalog.filter((s) => s.kind === 'whoosh' && fromDropins(s, 'ultimate-whooshes-sound-fx'));
  const swishes = whooshes.filter((s) => s.duration >= 0.3 && s.duration <= 1.2);
  const cuts = [...whooshes.filter((s) => s.duration > 0.6 && s.duration <= 2.2), ...catalog.filter((s) => fromDropins(s, 'risers-sound-fx') && s.duration >= 0.8 && s.duration <= 2.5)];
  return {
    breaks: breaks.length >= 8 ? breaks : bank(BANK_BREAKS),
    swishes: swishes.length >= 8 ? swishes : bank(BANK_SWEEPS.slice(0, 2)),
    cuts: cuts.length >= 8 ? cuts : bank(BANK_SWEEPS),
  };
}

/**
 * One reel's palette: { break, swish, cut } (catalog entries), all of different families, the cut
 * never an impact. `avoid`: library files the reel must not use here (the stem's other sounds).
 */
export function drawPalette(catalog, seed, { avoid = [] } = {}) {
  const rand = seeded(seed);
  const pools = palettePools(catalog);
  const used = new Set(avoid.map((f) => familyOf(catalog.find((s) => s.file === f) ?? f)));
  const take = (pool) => {
    const free = pool.filter((s) => !used.has(familyOf(s)) && s.kind !== 'impact');
    const choice = pick(free.length ? free : pool, rand);
    if (choice) used.add(familyOf(choice));
    return choice;
  };
  const hit = (() => {
    const free = pools.breaks.filter((s) => !used.has(familyOf(s)));
    const choice = pick(free.length ? free : pools.breaks, rand);
    if (choice) used.add(familyOf(choice));
    return choice;
  })();
  const swish = take(pools.swishes);
  const cut = take(pools.cuts);
  return { seed: String(seed), break: hit, swish, cut };
}

/** The palette for the project at `root`, from its library (assets/sfx-library, drop-ins included). */
export function projectPalette(root, opts = {}) {
  const dir = resolve(root, 'assets', 'sfx-library');
  let catalog = [];
  try {
    catalog = loadLibrary(dir);
  } catch {
    catalog = [];
  }
  return { catalog, palette: drawPalette(catalog, opts.seed ?? seedFor(root), opts) };
}

/** A score's clips with the palette's placeholders resolved (a clip whose sound is missing is dropped). */
export function applyPalette(clips, palette) {
  const map = { [BREAK]: palette.break?.file, [SWISH]: palette.swish?.file };
  return clips.flatMap((c) => {
    if (!c.src || !(c.src in map)) return [c];
    return map[c.src] ? [{ ...c, src: map[c.src] }] : [];
  });
}

/**
 * The opening's sound check, in code: at most one heavy hit (an impact from the break pool or a
 * bass impact) in `files`, and no family twice. Returns the problems (empty when it holds).
 */
export function openingProblems(files, catalog) {
  // bank entries carry no kind: name it from the file, like an unknown file
  const kindOf = (f) => (/impact|hit|boom/i.test(f) ? 'impact' : /whoosh|swish|swoosh|riser|sweep/i.test(f) ? 'whoosh' : 'other');
  const entries = files.map((f) => {
    const s = catalog.find((x) => x.file === f) ?? { file: f };
    return s.kind ? s : { ...s, kind: kindOf(f) };
  });
  const heavy = entries.filter((s) => s.kind === 'impact' && (/heavy|bass|deep-impacts|boom/i.test(`${s.file} ${s.group ?? ''}`)));
  const out = [];
  if (heavy.length > 1) out.push(`${heavy.length} heavy hits in the opening (${heavy.map((s) => s.file).join(', ')}): one at most`);
  const fams = new Map();
  // accents only: a gesture's repeated foley (typewriter keys, knocks) is one sound, on purpose
  for (const s of entries.filter((e) => e.kind === 'impact' || e.kind === 'whoosh')) {
    const f = familyOf(s);
    fams.set(f, (fams.get(f) ?? 0) + 1);
  }
  for (const [f, n] of fams) if (n > 1) out.push(`the family ${f} plays ${n} times in the opening`);
  return out;
}
