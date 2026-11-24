/**
 * The shared finder's archives path (Stories Split, SS-22): for a profile with `sources: 'archives'` (Real or AI?),
 * findPhotos asks the photo bank first, then the free archives (./sources/archives.ts: Wikimedia Commons Featured and
 * Quality pictures, the NASA image library; NASA first when the need's kind is `space`), instead of AI Drama's harvest.
 * Free: the post's budget is never charged. Nothing is downloaded here: each need gets its ranked finds (`found`), and
 * the type fetches, crops and screens them itself.
 *
 * The profile's rules apply to every find: licence (open or government), height floor, widest ratio, faces (a bank
 * photo's face boxes), a credit. The used-photo ledger (CI-32) refuses a find by any of its URLs; the type checks the
 * downloaded picture's hashes. Never throws; a need with no find is null with a trace saying why. Trace lines start
 * with `shared:` like the harvest path's.
 */
import type { BankHit } from '@/lib/media-library/reader';
import type { Photo } from '@/lib/stories/render/types';

import { cut, queryLadder, searchCommons, searchNasa, yearOf } from './sources/archives';
import { EMPTY_LEDGER, usedMatch, type UsedLedger } from './used';
import type { ArchiveFind, FindOptions, FoundPhotos, PhotoDeps, PhotoNeed, PhotoProfile } from './types';

const errText = (err: unknown) => (err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160));

type Source = { name: ArchiveFind['source']; read: (words: string) => Promise<ArchiveFind[]> };

/** A bank hit as an archives find (the bank's licence classes are open and government only: reader.ts). */
export function bankFind(h: BankHit): ArchiveFind {
  const year = yearOf(h.date);
  return {
    source: 'bank',
    page: h.url,
    imageUrl: h.url,
    alt: [],
    licence: `open or government licence (${h.source})`,
    licenceClass: h.licence === 'government' ? 'government' : 'open',
    credit: h.credit.trim(),
    title: h.title || undefined,
    description: h.tags.length ? h.tags.join(', ') : undefined,
    ...(year ? { year } : {}),
    width: h.width,
    height: h.height,
    portrait: h.height >= h.width,
  };
}

/** The sources in order for one need: the bank, then Commons and NASA (NASA first for space). */
function sourcesFor(need: PhotoNeed, profile: PhotoProfile, deps: PhotoDeps, exclude: ReadonlySet<string>): Source[] {
  const http = deps.fetch ?? deps.harvest?.http ?? fetch;
  const minHeight = profile.minHeight ?? 0;
  const bank: Source = {
    name: 'bank',
    read: async (words) => {
      if (!deps.bank || (await deps.bank.mode()) === 'off') return [];
      const hits = await deps.bank.find({ kind: 'thematic', query: words, qid: null, recent: new Set(exclude), cover: false, limit: 5 });
      const noFaces = profile.refuse?.includes('faces') ?? false;
      return hits.filter((h) => !(noFaces && h.faces && h.faces.length) && h.credit.trim() && h.height >= minHeight).map(bankFind);
    },
  };
  const commons: Source = { name: 'commons', read: (words) => searchCommons(http, words, { minHeight }) };
  const nasa: Source = { name: 'nasa', read: (words) => searchNasa(http, words) };
  return need.kind === 'space' ? [bank, nasa, commons] : [bank, commons, nasa];
}

/** Why a find can't be used, or null when it can. */
function refusal(f: ArchiveFind, profile: PhotoProfile, exclude: ReadonlySet<string>, used: UsedLedger, picked: ReadonlySet<string>): string | null {
  const urls = [f.page, f.imageUrl, ...f.alt];
  if (urls.some((u) => exclude.has(u))) return 'excluded';
  for (const url of urls) {
    const why = usedMatch(used, { url });
    if (why) return why;
  }
  if (urls.some((u) => picked.has(u))) return 'already in the set';
  if (profile.licence === 'open_or_government' && f.licenceClass !== 'open' && f.licenceClass !== 'government') return 'licence';
  if (!f.credit.trim()) return 'no credit';
  if (profile.minHeight && f.height > 0 && f.height < profile.minHeight) return 'too small';
  if (profile.maxAspect && f.width > 0 && f.height > 0 && f.width / f.height > profile.maxAspect + 1e-9) return 'too wide';
  return null;
}

/** The frame's photo for a find: the credit only when the profile draws it on the frame. */
export function archivePhoto(f: ArchiveFind, profile: PhotoProfile): Photo {
  return { src: f.imageUrl, credit: profile.creditOnFrame === false ? '' : f.credit, kind: 'scene' };
}

async function findOne(need: PhotoNeed, profile: PhotoProfile, deps: PhotoDeps, opts: FindOptions, used: UsedLedger, picked: Set<string>): Promise<{ found: ArchiveFind[]; trace: string[] }> {
  const limit = Math.max(1, opts.limit ?? 1);
  const words = need.query || need.copy || need.headline;
  const trace = [`shared: archives, ${need.specificity} need "${words}" (${need.kind}); free`];
  const found: ArchiveFind[] = [];
  const why = new Map<string, number>();
  for (const source of sourcesFor(need, profile, deps, opts.exclude)) {
    if (found.length >= limit) break;
    let hits: ArchiveFind[] = [];
    for (const rung of queryLadder(words)) {
      try {
        hits = await source.read(rung);
      } catch (err) {
        trace.push(`shared: ${source.name} "${rung}": ${errText(err)}`);
        hits = [];
      }
      if (hits.length) {
        trace.push(`shared: ${source.name} "${rung}" found ${hits.length}`);
        break;
      }
    }
    // Portrait finds first within a source (a Story is 9:16).
    hits = [...hits].sort((a, b) => Number(b.portrait) - Number(a.portrait));
    for (const f of hits) {
      if (found.length >= limit) break;
      const r = refusal(f, profile, opts.exclude, used, picked) ?? (opts.accept?.(archivePhoto(f, profile), need) ? 'refused by the type' : null);
      if (r) {
        why.set(r, (why.get(r) ?? 0) + 1);
        continue;
      }
      found.push(f);
      for (const u of [f.page, f.imageUrl]) picked.add(u);
    }
  }
  const reasons = [...why].map(([r, n]) => `${n} ${r}`).join(', ');
  if (!found.length) trace.push(`shared: nothing usable${reasons ? ` (${reasons})` : ''}; today's finder takes over`);
  else trace.push(`shared: kept ${found.length}${reasons ? ` (refused ${reasons})` : ''}; first ${found[0]!.source} ${cut(found[0]!.credit, 60)}: ${found[0]!.imageUrl}`);
  return { found, trace };
}

/** findPhotos for an archives profile: one entry per need, same order, never throws. */
export async function findFromArchives(needs: PhotoNeed[], profile: PhotoProfile, deps: PhotoDeps, opts: FindOptions): Promise<FoundPhotos> {
  let used: UsedLedger = EMPTY_LEDGER;
  if (deps.used && needs.length) {
    try {
      used = await deps.used();
    } catch (err) {
      const t = [`shared: the used-photo ledger could not be read (${errText(err)}); today's finder takes over`];
      return { photos: needs.map(() => null), traces: needs.map(() => [...t]), found: needs.map(() => []) };
    }
  }
  const picked = new Set<string>();
  const photos: Array<Photo | null> = [];
  const traces: string[][] = [];
  const found: ArchiveFind[][] = [];
  for (const need of needs) {
    try {
      const got = await findOne(need, profile, deps, opts, used, picked);
      photos.push(got.found[0] ? archivePhoto(got.found[0], profile) : null);
      traces.push(got.trace);
      found.push(got.found);
    } catch (err) {
      photos.push(null);
      traces.push([`shared: archives failed (${errText(err)}); today's finder takes over`]);
      found.push([]);
    }
  }
  return { photos, traces, found };
}
