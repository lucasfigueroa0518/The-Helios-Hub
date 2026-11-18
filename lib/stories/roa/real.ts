/**
 * Real photos for Real or AI? (RA-5): the photo bank first, then Wikimedia
 * Commons Featured and Quality pictures and the NASA image library (free,
 * keyless; licence and credit recorded for the reveal's proof, R8). Space
 * scenes try NASA before Commons. Never a dataset's real side. What the camera
 * recorded (EXIF) is kept for the reveal's camera card (RA-26): Commons returns it
 * in the search; NASA in a metadata file read for the photos actually kept.
 *
 * Stories Split (SS-22, SS-23): the Commons and NASA searches are shared finder sources now
 * (lib/photos/sources/archives.ts). With `photo_finders.roa = 'shared'` the finds come through the shared finder
 * (findPhotos with the `roa` profile: lib/photos/archive.ts); otherwise ('legacy', the default) through this file's
 * own loop over the same sources. Bank-first either way. Both refuse a photo the used-photo ledger names (CI-32: by
 * URL, then by the downloaded picture's hashes) on top of the series' own never-repeat history, and keep the original
 * download and its URL (`provenance.src`) so the pool's intake can offer it to the photo bank.
 *
 * Every network read goes through the injected `fetch`; tests pass a stub, so
 * nothing here calls Commons or NASA offline.
 */
import type { BankReader } from '@/lib/media-library/reader';
import { PHOTO_PROFILES, ROA_MIN_HEIGHT } from '@/lib/photos/profiles';
import { searchCommons, searchNasa, USER_AGENT, yearOf } from '@/lib/photos/sources/archives';
import type { ArchiveFind, FindOptions, FoundPhotos, PhotoDeps, PhotoNeed, PhotoProfile } from '@/lib/photos/types';
import { usedMatch, type UsedLedger } from '@/lib/photos/used-match';

import { imageKeyOf, MAX_WIDE, toStoryFrame } from './generate';
import type { Camera, Provenance, Subject } from './types';

export {
  artistName,
  COMMONS_API,
  COMMONS_CATEGORIES,
  commonsSearchUrl,
  NASA_API,
  nasaMetadataUrl,
  nasaSearchUrl,
  queryLadder,
  USER_AGENT,
} from '@/lib/photos/sources/archives';
import { queryLadder } from '@/lib/photos/sources/archives';

/** A real photo must be at least this tall (pixels) to fill a 1080×1920 Story without blowing up. */
export const MIN_HEIGHT = ROA_MIN_HEIGHT;

export type RealPhoto = {
  jpeg: Buffer;
  imageKey: string;
  provenance: Extract<Provenance, { kind: 'bank' | 'commons' | 'nasa' }>;
  /** What the source says about the photo, for the reveal writer (R7). */
  about: { title?: string; description?: string; place?: string; year?: string };
  /** The original download (SS-23), before the 9:16 cut: what the photo bank stores under `provenance.src`. */
  original?: Buffer;
};

/** lib/photos/find.ts findPhotos (tests stub it). */
export type RealSharedFind = (needs: PhotoNeed[], profile: PhotoProfile, deps: PhotoDeps, opts: FindOptions) => Promise<FoundPhotos>;

export type RealDeps = {
  fetch: typeof fetch;
  bank?: BankReader | null;
  /** Source URLs already in the pool, the archive or a posted set: never fetched again. */
  avoidUrls: ReadonlySet<string>;
  /** Image keys already known (pool, archive, posted). */
  avoidKeys: ReadonlySet<string>;
  log?: (msg: string) => void;
  /** `photo_finders.roa` (lib/photos/switch.ts): 'shared' asks through the shared finder; absent or 'legacy', this file's own loop. */
  finder?: 'legacy' | 'shared';
  /** The used-photo ledger (CI-32), read once per run. Absent: the series' own history only. */
  used?: UsedLedger | null;
  /** Hashes a downloaded original for the ledger's picture check (default lib/photos/used-hash.ts hashesOf). */
  hash?: (bytes: Buffer) => Promise<{ phash: string; dhash: string }>;
  /** The shared finder (default lib/photos/find.ts findPhotos). */
  find?: RealSharedFind;
};

type Hit = {
  url: string;
  imageUrl: string;
  /** Tried in order when imageUrl fails. */
  alt?: string[];
  provenance: RealPhoto['provenance'];
  about: RealPhoto['about'];
  portrait: boolean;
  /** Pixel size when the source says (0 or absent: unknown, checked after download). */
  width?: number;
  height?: number;
  /** More about a photo that was kept (best effort): its camera and place. */
  more?: () => Promise<{ camera?: Camera; place?: string }>;
};

async function getBytes(deps: RealDeps, url: string): Promise<Buffer> {
  const res = await deps.fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** A shared archives find as this file's hit: the reveal's provenance and what the source says about it. */
export function hitOf(f: ArchiveFind): Hit {
  const provenance: RealPhoto['provenance'] = {
    kind: f.source,
    url: f.page,
    licence: f.licence,
    credit: f.credit,
    ...(f.year ? { year: f.year } : {}),
    ...(f.camera ? { camera: f.camera } : {}),
  };
  return {
    url: f.page,
    imageUrl: f.imageUrl,
    ...(f.alt.length ? { alt: f.alt } : {}),
    provenance,
    about: { title: f.title, description: f.description, year: f.year },
    portrait: f.portrait,
    width: f.width,
    height: f.height,
    ...(f.more ? { more: f.more } : {}),
  };
}

/** The photo bank (cleared licences only, the used-photo rule applied by the reader). People are skipped (R3). */
async function bankHits(deps: RealDeps, words: string): Promise<Hit[]> {
  if (!deps.bank || (await deps.bank.mode()) === 'off') return [];
  const hits = await deps.bank.find({ kind: 'thematic', query: words, qid: null, recent: new Set(deps.avoidUrls), cover: false, limit: 5 });
  return hits
    .filter((h) => !(h.faces && h.faces.length) && h.credit.trim() && h.height >= MIN_HEIGHT)
    .map((h) => ({
      url: h.url,
      imageUrl: h.url,
      provenance: { kind: 'bank' as const, url: h.url, licence: `open or government licence (${h.source})`, credit: h.credit.trim(), ...(yearOf(h.date) ? { year: yearOf(h.date)! } : {}) },
      about: { title: h.title || undefined, description: h.tags.length ? h.tags.join(', ') : undefined, year: yearOf(h.date) },
      portrait: h.height >= h.width,
      width: h.width,
      height: h.height,
    }));
}

const commonsHits = async (deps: RealDeps, words: string): Promise<Hit[]> => (await searchCommons(deps.fetch, words, { minHeight: MIN_HEIGHT })).map(hitOf);
const nasaHits = async (deps: RealDeps, words: string): Promise<Hit[]> => (await searchNasa(deps.fetch, words)).map(hitOf);

/** How many real photos a real cell fetches and screens; the hardest one goes forward (2026-11-15). */
export const REAL_CANDIDATES = 6;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The used-photo ledger's verdict on a hit's URLs, or null. */
const ledgerOnUrls = (used: UsedLedger | null | undefined, h: Hit): string | null => {
  if (!used) return null;
  for (const url of [h.url, h.imageUrl, ...(h.alt ?? [])]) {
    const why = usedMatch(used, { url });
    if (why) return why;
  }
  return null;
};

/** A hit whose source size is already wider than MAX_WIDE: dropped before any download. */
export const tooWide = (h: { width?: number; height?: number }): boolean => Boolean(h.width && h.height && h.width / h.height > MAX_WIDE);

type Collect = { out: RealPhoto[]; seen: Set<string>; limit: number };

/** Download, check and cut one hit; pushes it to `c.out` when it is usable. */
async function take(deps: RealDeps, name: string, h: Hit, c: Collect): Promise<void> {
  if (deps.avoidUrls.has(h.url) || deps.avoidUrls.has(h.imageUrl) || c.seen.has(h.url)) return;
  if (tooWide(h)) return; // never downloaded: the 9:16 cut would keep too little of it
  const onUrl = ledgerOnUrls(deps.used, h);
  if (onUrl) {
    deps.log?.(`real ${name} ${h.url}: ${onUrl}, skipped`);
    return;
  }
  const checkPicture = !!deps.used && (deps.used.phashes.length > 0 || deps.used.dhashes.length > 0);
  for (const src of [h.imageUrl, ...(h.alt ?? [])]) {
    try {
      const original = await getBytes(deps, src);
      if (checkPicture) {
        const hashes = await (deps.hash ?? (await import('@/lib/photos/used-hash')).hashesOf)(original);
        const why = usedMatch(deps.used!, hashes);
        if (why) {
          deps.log?.(`real ${name} ${h.url}: ${why}, skipped`);
          break;
        }
      }
      const jpeg = await toStoryFrame(original);
      if (!jpeg) {
        deps.log?.(`real ${name} ${h.url}: wider than ${MAX_WIDE.toFixed(2)}:1, skipped`);
        break;
      }
      const imageKey = imageKeyOf(jpeg);
      if (deps.avoidKeys.has(imageKey)) break;
      c.seen.add(h.url);
      let provenance: RealPhoto['provenance'] = { ...h.provenance, src };
      let about = h.about;
      if (h.more) {
        try {
          const more = await h.more();
          if (more.camera) provenance = { ...provenance, camera: more.camera };
          if (more.place) {
            provenance = { ...provenance, place: provenance.place ?? more.place };
            about = { ...about, place: about.place ?? more.place };
          }
        } catch (err) {
          deps.log?.(`real ${name} ${h.url} metadata: ${errText(err)}`);
        }
      }
      c.out.push({ jpeg, imageKey, provenance, about, original });
      break;
    } catch (err) {
      deps.log?.(`real ${name} ${src}: ${errText(err)}`);
    }
  }
}

/** Legacy: this file's own loop over the sources, each searched down the query ladder until it finds something. */
async function legacyCollect(deps: RealDeps, req: { subject: Subject; words: string }, c: Collect): Promise<void> {
  const sources: Array<[string, (d: RealDeps, w: string) => Promise<Hit[]>]> =
    req.subject === 'space'
      ? [['bank', bankHits], ['nasa', nasaHits], ['commons', commonsHits]]
      : [['bank', bankHits], ['commons', commonsHits], ['nasa', nasaHits]];
  for (const [name, read] of sources) {
    let hits: Hit[] = [];
    for (const words of queryLadder(req.words)) {
      try {
        hits = await read(deps, words);
      } catch (err) {
        deps.log?.(`real ${name} "${words}": ${errText(err)}`);
        hits = [];
      }
      if (hits.length) break;
    }
    hits.sort((a, b) => Number(b.portrait) - Number(a.portrait));
    for (const h of hits) {
      if (c.out.length >= c.limit) return;
      await take(deps, name, h, c);
    }
  }
}

/** The need Real or AI? asks the shared finder for: the cell's search words, its subject as the kind, chosen for its look. */
export function realNeed(req: { subject: Subject; words: string }): PhotoNeed {
  return { id: 'real', headline: req.words, brief: req.words, copy: '', query: req.words, kind: req.subject, subjects: [], storyUrls: [], sourceName: null, storyDate: null, specificity: 'aesthetic' };
}

/** Finds asked per cell from the shared finder: some never download, are too wide or already known. */
export const SHARED_FINDS_PER_CANDIDATE = 2;

/** Shared: findPhotos with the `roa` profile (the bank, then Commons and NASA), then the same download and cut. */
async function sharedCollect(deps: RealDeps, req: { subject: Subject; words: string }, c: Collect): Promise<void> {
  const find = deps.find ?? (await import('@/lib/photos/find')).findPhotos;
  const used = deps.used ?? null;
  const got = await find([realNeed(req)], PHOTO_PROFILES.roa, { now: () => new Date(), fetch: deps.fetch, bank: deps.bank ?? null, ...(used ? { used: async () => used } : {}) }, {
    exclude: new Set(deps.avoidUrls),
    budget: { usd: 0, capUsd: 0 },
    limit: c.limit * SHARED_FINDS_PER_CANDIDATE,
  });
  for (const line of got.traces[0] ?? []) deps.log?.(`real ${line}`);
  for (const f of got.found?.[0] ?? []) {
    if (c.out.length >= c.limit) return;
    await take(deps, `shared ${f.source}`, hitOf(f), c);
  }
}

/**
 * Up to `limit` distinct real photos for one cell, best source first. The archives return relevant but ordinary
 * photos first, so the caller screens several and keeps the one that looks most fake (R1).
 */
export async function findRealPhotos(deps: RealDeps, req: { subject: Subject; words: string }, limit = REAL_CANDIDATES): Promise<RealPhoto[]> {
  const c: Collect = { out: [], seen: new Set(), limit };
  if (deps.finder === 'shared') await sharedCollect(deps, req, c);
  else await legacyCollect(deps, req, c);
  return c.out;
}

/** The first real photo for a cell (no screening). */
export async function findRealPhoto(deps: RealDeps, req: { subject: Subject; words: string }): Promise<RealPhoto | null> {
  return (await findRealPhotos(deps, req, 1))[0] ?? null;
}
