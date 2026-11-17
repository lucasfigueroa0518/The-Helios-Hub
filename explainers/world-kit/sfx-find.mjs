// Search the sound library from the command line, so a frame's events can name what the library
// really has (the bank: Kenney, Pixabay and Freesound paper/pen/writing foley; plus Lucas's
// drop-ins). Deterministic, no model.
//
//   node assets/kit/sfx-find.mjs paper slide          the best matches for these words
//   node assets/kit/sfx-find.mjs --kind pop [words]   what a pop event can reach (ranked by words)
//   node assets/kit/sfx-find.mjs --families           every family, with how many variants it has
//
// Each line: id · seconds · family (variants) · tags. Put the words that matched in an event's
// `what`; to play one exact sound, put its id in `sound`. Code still varies variants per reel.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { candidatesFor, EVENT_KINDS, foleyQuery, loadCatalog, tagCounts } from './sound.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** The library folder: the project's assets/sfx-library, else the repo's design/sfx. */
export function libraryDir(cwd = process.cwd()) {
  for (const d of [join(cwd, 'assets', 'sfx-library'), join(here, '..', 'sfx-library'), join(here, '..', 'design', 'sfx')]) {
    if (existsSync(join(d, 'catalog.json'))) return d;
  }
  return null;
}

const SKIP_TAGS = new Set(['curated', 'freesound', 'physical', 'foley', 'inbox', 'sync', 'to', 'the', 'on', 'or', 'a', 'of', 'in', 'at', 'so', 'it', 'j', 's']);

function line(s, sizes) {
  const tags = s.tags.filter((t) => !SKIP_TAGS.has(t)).slice(0, 8).join(' ');
  return `${s.id} · ${s.duration}s · ${s.group} (${sizes.get(s.group)}) · ${s.description ?? tags}`;
}

/** Search `catalog`: { words, kind, n } → printable lines. */
export function search(catalog, { words = '', kind = null, n = 10 } = {}) {
  const sizes = new Map();
  for (const s of catalog) sizes.set(s.group, (sizes.get(s.group) ?? 0) + 1);
  const q = words ? foleyQuery(words, tagCounts(catalog)) : null;
  if (kind && kind !== 'foley') {
    const { tier, family } = candidatesFor(catalog, { kind, t: 0, ...(q ? { weights: q.weights } : {}) });
    const seen = new Set();
    const list = [...tier, ...family].filter((h) => !seen.has(h.s.id) && seen.add(h.s.id));
    // one line per family: its first variant
    const groups = new Map();
    for (const h of list) if (!groups.has(h.s.group)) groups.set(h.s.group, h.s);
    return [`${kind}: ${list.length} sounds in ${groups.size} families${q ? ` (ranked by: ${q.any.join(' ')})` : ''}`, ...[...groups.values()].slice(0, n).map((s) => line(s, sizes))];
  }
  if (!q) return [`no library tag matches "${words}"; try other plain words, or --families`];
  const { tier, family } = candidatesFor(catalog, { kind: 'foley', t: 0, ...q });
  const seen = new Set();
  const out = [];
  for (const h of [...tier, ...family]) {
    if (seen.has(h.s.group)) continue;
    seen.add(h.s.group);
    out.push(line(h.s, sizes));
  }
  return [`"${words}" → ${out.length} families (matched: ${q.any.join(' ')})`, ...out.slice(0, n)];
}

/** A pack with more families than this lists its commonest words instead (drop-in packs run to hundreds). */
export const MAX_LISTED_FAMILIES = 60;
/** How many words a big pack lists. */
const PACK_WORDS = 10;
/** Measured-sound tags (acoustics.json): true of a sound, but not words to search a pack by. */
const ACOUSTIC = new Set(['soft-attack', 'hard-attack', 'sharp-attack', 'long', 'short', 'medium', 'sustain', 'oneshot', 'dark', 'bright', 'continuous', 'tail', 'loud', 'quiet']);

/**
 * Every family: `pack: group(variants) …`, one line per pack. A big pack (over MAX_LISTED_FAMILIES
 * families) is one line of its commonest words instead: search those words to reach its sounds.
 */
export function families(catalog) {
  const packs = new Map();
  for (const s of catalog) {
    // drop-ins (group inbox/<their pack>/<sound>) are listed by the pack they came in
    const dropPack = s.pack === 'inbox' ? String(s.group).split('/')[1] : null;
    const pack = s.pack === 'freesound' ? 'freesound (paper, pen, desk)' : dropPack ? `drop-in ${dropPack}` : s.pack;
    if (!packs.has(pack)) packs.set(pack, { groups: new Map(), words: new Map(), n: 0 });
    const p = packs.get(pack);
    p.n++;
    const name = s.group.split('/').pop();
    p.groups.set(name, (p.groups.get(name) ?? 0) + 1);
    for (const t of new Set(s.tags ?? [])) p.words.set(t, (p.words.get(t) ?? 0) + 1);
  }
  return [...packs].map(([pack, p]) => {
    if (p.groups.size <= MAX_LISTED_FAMILIES) return `${pack}: ${[...p.groups].map(([k, v]) => `${k}(${v})`).join(' ')}`;
    const own = new Set(String(pack).toLowerCase().split(/[^a-z0-9]+/));
    const top = [...p.words]
      .filter(([w]) => !SKIP_TAGS.has(w) && !ACOUSTIC.has(w) && !own.has(w) && !own.has(w.replace(/s$/, '')) && w.length > 2 && !/^\d+$/.test(w))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, PACK_WORDS);
    return `${pack}: ${p.n} sounds in ${p.groups.size} families; search its words: ${top.map(([w, v]) => `${w}(${v})`).join(' ')}`;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const dir = libraryDir();
  if (!dir) {
    console.log('no sound library found (assets/sfx-library/catalog.json)');
    process.exit(1);
  }
  const catalog = loadCatalog(dir);
  const ki = args.indexOf('--kind');
  const kind = ki >= 0 ? args[ki + 1] : null;
  if (kind && !EVENT_KINDS.includes(kind)) {
    console.log(`--kind is one of ${EVENT_KINDS.join(', ')}`);
    process.exit(1);
  }
  const words = args.filter((a, i) => !a.startsWith('--') && !(ki >= 0 && i === ki + 1)).join(' ');
  const out = args.includes('--families') ? families(catalog) : search(catalog, { words, kind });
  console.log(out.join('\n'));
}
