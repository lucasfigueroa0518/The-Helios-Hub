/**
 * Stories' adopter of the shared photo finder (central intake Phase 3, planning/Central Intake/PHASE3-CONTRACT.md
 * "Owner B"). In 'shared' mode a frame tries the shared finder (lib/photos/find.ts) first; a frame it leaves empty
 * goes to today's finder, unchanged, with the shared picks added to its exclude. In 'legacy' mode nothing here runs:
 * the worker keeps today's finder object and builders.
 *
 * Every lib/photos module loads lazily (a missing module, an error, or a 'legacy' switch means today's path), so
 * a web route that imports this file pulls no harvest engine. The shared finder never throws to its caller.
 */
import type { BuildDeps, BuildResult } from '@/lib/stories/build/common';
import { findSetOrEach, type PhotoFinder, type PhotoRequest } from '@/lib/stories/photos';
import type { Photo, Series } from '@/lib/stories/render/types';
import type { FindOptions, FoundPhotos, PhotoBudget, PhotoDeps, PhotoFinderModes, PhotoNeed, PhotoProfile, PhotoProfileId } from '@/lib/photos/types';

/** lib/photos/find.ts findPhotos. */
export type SharedFind = (needs: PhotoNeed[], profile: PhotoProfile, deps: PhotoDeps, opts: FindOptions) => Promise<FoundPhotos>;
/** lib/photos/needs.ts needFromRequest. */
export type NeedFromRequest = (req: PhotoRequest, id: string, extra?: { headline?: string; brief?: string; sourceName?: string | null }) => PhotoNeed;

/** Each Stories series' shared-finder profile. */
// AI Trivia takes over Guess the Number's photo profile and its switch (retired series have none).
export const SERIES_PROFILE: Partial<Record<Series, PhotoProfileId>> = { morning_download: 'md', ai_trivia: 'gtn', free_vs_paid: 'fvp' };
/** Frames a set asks for through single `find` calls (the per-frame allowance); MD finds its set with `findSet`. */
export const SERIES_SINGLE_FRAMES: Partial<Record<Series, number>> = { morning_download: 1, ai_trivia: 2, free_vs_paid: 2 };

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export type SharedPhotoFinder = PhotoFinder & {
  /** The shared finder's own spend so far (Serper + Haiku looks); `usd` minus the fallback's. */
  readonly sharedUsd: number;
};

/**
 * Today's finder with the shared finder in front of it. `usd` = the fallback's + the shared spend; `size` is the
 * fallback's. A fresh budget per `findSet` / `find` call (one post) unless `budget` is passed (one build's frames
 * then share it). `onSpend` hears each shared step's spend before the fallback runs (revisions meter it there).
 */
export function createSharedPhotoFinder(o: {
  profile: PhotoProfile;
  deps: PhotoDeps;
  fallback: PhotoFinder;
  budget?: PhotoBudget;
  /**
   * Frames one post asks for through single `find` calls (Guess the Number, Free vs Paid call `find` once per frame).
   * Each single call gets its share of what is left (left / frames still to come), so the first frame can't spend the
   * whole post's cap. Absent or 1: a single call may use all that is left.
   */
  frames?: number;
  /** Tests inject these; default lib/photos/find.ts and lib/photos/needs.ts. */
  find?: SharedFind;
  need?: NeedFromRequest;
  onSpend?: (usd: number) => void;
}): SharedPhotoFinder {
  let sharedUsd = 0;
  let singles = 0;
  /** The shared step over a set: one photo (or null) and one trace per request, same order. Never throws. */
  const shared = async (reqs: PhotoRequest[], single = false): Promise<{ photos: Array<Photo | null>; traces: string[][] }> => {
    const budget = o.budget ?? { usd: 0, capUsd: o.profile.capUsd };
    const before = budget.usd;
    const framesLeft = single && o.frames ? Math.max(1, o.frames - singles++) : 1;
    // A single call's share of the post's budget; its spend is added back to the post's budget afterwards.
    const view: PhotoBudget = framesLeft > 1 ? { usd: 0, capUsd: Math.max(0, budget.capUsd - budget.usd) / framesLeft } : budget;
    try {
      const find = o.find ?? (await import('@/lib/photos/find')).findPhotos;
      const need = o.need ?? (await import('@/lib/photos/needs')).needFromRequest;
      const needs = reqs.map((r, i) => need(r, String(i)));
      const exclude = new Set(reqs.flatMap((r) => [...r.exclude]));
      const out = await find(needs, o.profile, o.deps, { exclude, budget: view });
      return { photos: reqs.map((_, i) => out.photos[i] ?? null), traces: reqs.map((_, i) => out.traces[i] ?? []) };
    } catch (err) {
      return { photos: reqs.map(() => null), traces: reqs.map(() => [`shared: failed: ${errText(err)}`]) };
    } finally {
      if (view !== budget) budget.usd += view.usd;
      const spent = Math.max(0, budget.usd - before);
      sharedUsd += spent;
      if (spent > 0) o.onSpend?.(spent);
    }
  };
  return {
    get usd() {
      return o.fallback.usd + sharedUsd;
    },
    get sharedUsd() {
      return sharedUsd;
    },
    get size() {
      return o.fallback.size;
    },
    async findSet(reqs, trace) {
      const got = await shared(reqs);
      const picked = got.photos.flatMap((p) => (p ? [p.src] : []));
      const empty = reqs.flatMap((_, i) => (got.photos[i] ? [] : [i]));
      const fallbackTrace: string[][] = [];
      // Only the empty frames, in order, never a photo the shared finder already put in this set. A cover stays a cover.
      const fallback = empty.length
        ? await findSetOrEach(o.fallback, empty.map((i) => ({ ...reqs[i]!, exclude: new Set([...reqs[i]!.exclude, ...picked]) })), fallbackTrace)
        : [];
      trace?.push(
        ...reqs.map((_, i) => {
          const j = empty.indexOf(i);
          return j < 0 ? got.traces[i]! : [...got.traces[i]!, ...(fallbackTrace[j] ?? [])];
        }),
      );
      return reqs.map((_, i) => {
        const j = empty.indexOf(i);
        return j < 0 ? got.photos[i]! : (fallback[j] ?? null);
      });
    },
    async find(req) {
      const got = await shared([req], true);
      return got.photos[0] ?? (await o.fallback.find(req));
    },
  };
}

type Query = { query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> };

/** Stand-ins for the lib/photos modules (tests); each defaults to the real module, loaded lazily. */
export type SharedMake = {
  readModes?: (q: Query) => Promise<PhotoFinderModes>;
  profiles?: Record<PhotoProfileId, PhotoProfile>;
  deps?: () => Promise<PhotoDeps>;
  find?: SharedFind;
  need?: NeedFromRequest;
};

/** The switch, read once. Any error means every type 'legacy' (null). */
async function readModes(q: Query, make?: SharedMake): Promise<PhotoFinderModes | null> {
  try {
    const read = make?.readModes ?? (await import('@/lib/photos/switch')).readPhotoFinderModes;
    return await read(q);
  } catch {
    return null;
  }
}

async function loadShared(make?: SharedMake): Promise<{ profiles: Record<PhotoProfileId, PhotoProfile>; deps: PhotoDeps }> {
  const profiles = make?.profiles ?? (await import('@/lib/photos/profiles')).PHOTO_PROFILES;
  const deps = make?.deps ? await make.deps() : await (await import('@/lib/photos/live')).livePhotoDeps(process.env);
  return { profiles, deps };
}

/**
 * One type's shared-finder setup when its switch reads 'shared' (read once, here); null for 'legacy', a read
 * error, or deps that can't be built. Revisions and the LFD run call it once per use.
 */
export async function sharedPhotoSetup(q: Query, id: PhotoProfileId, make?: SharedMake, log?: (line: string) => void): Promise<{ profile: PhotoProfile; deps: PhotoDeps } | null> {
  const modes = await readModes(q, make);
  if (modes?.[id] !== 'shared') return null;
  try {
    const { profiles, deps } = await loadShared(make);
    return { profile: profiles[id], deps };
  } catch (err) {
    log?.(`shared photo finder not wired for ${id} (${errText(err)}); today's finder`);
    return null;
  }
}

type SeriesBuilder = (d: BuildDeps) => Promise<BuildResult>;

/**
 * The Stories worker's builders for the series whose switch reads 'shared' (read once per build, here). Each wraps
 * the build's finder (`d.photos`, today's) with the shared finder under one per-build budget (the post's cap), and
 * records the shared spend as the set's own cost row. Undefined when no series is shared: the worker then keeps
 * today's builders and finder untouched.
 */
export async function sharedSeriesBuilders(o: {
  query: Query;
  builders: Partial<Record<Series, SeriesBuilder>>;
  /** Default: a stories.cost_events row for the set (vendor anthropic: Haiku looks dominate, Serper included; component photo-finder-shared). */
  recordCost?: (d: BuildDeps, usd: number) => Promise<void>;
  log?: (line: string) => void;
  make?: SharedMake;
}): Promise<Partial<Record<Series, SeriesBuilder>> | undefined> {
  const modes = await readModes(o.query, o.make);
  const series = (Object.keys(SERIES_PROFILE) as Series[]).filter((s) => o.builders[s] && modes?.[SERIES_PROFILE[s]!] === 'shared');
  if (!series.length) return undefined;
  let loaded: Awaited<ReturnType<typeof loadShared>>;
  try {
    loaded = await loadShared(o.make);
  } catch (err) {
    o.log?.(`shared photo finder not wired (${errText(err)}); today's finder for ${series.join(', ')}`);
    return undefined;
  }
  const record =
    o.recordCost ??
    (async (d: BuildDeps, usd: number) => {
      const { recordCost } = await import('@/lib/stories/repository');
      await recordCost(d.db, { setId: d.setId, vendor: 'anthropic', component: 'photo-finder-shared', usd });
    });
  const out: Partial<Record<Series, SeriesBuilder>> = {};
  for (const s of series) {
    const profile = loaded.profiles[SERIES_PROFILE[s]!];
    const build = o.builders[s]!;
    out[s] = async (d) => {
      const budget: PhotoBudget = { usd: 0, capUsd: profile.capUsd };
      const photos = createSharedPhotoFinder({ profile, deps: loaded.deps, fallback: d.photos, budget, frames: SERIES_SINGLE_FRAMES[s] ?? 2, find: o.make?.find, need: o.make?.need });
      try {
        return await build({ ...d, photos });
      } finally {
        if (photos.sharedUsd > 0) await record(d, photos.sharedUsd).catch((err) => o.log?.(`shared photo cost not recorded: ${errText(err)}`));
      }
    };
  }
  return out;
}
