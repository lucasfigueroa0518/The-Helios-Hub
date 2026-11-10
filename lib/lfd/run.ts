// lib/lfd/run.ts
/**
 * One Last Few Days run (spec §3–§6): window → sources → pick → full text →
 * write → fact check → photos → render → JPEGs → a review post. A story that
 * fails a step is replaced from its own lane, then the rundown. The post is
 * never skipped: fewer than 5 stories saves it marked short.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { nyDateKey } from '@/lib/reels/scoring/decide';
import { companyKey } from '@/lib/social/ingest/select/companies';
import type { HubQuery } from '@/lib/social-hub/db';
import type { ClosingsLog } from '@/lib/social/captions/closings-store';
import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';
import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import type { JevAsk } from '@/lib/social/jev/client';
import { storeSlideJpegs } from '@/lib/social/overnight/slides';
import type { FitCheck, FitResult } from '@/lib/social/render/fit-check';
import type { PageRead } from '@/lib/social/reporter/read-page';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import type { AddIntakeSeed, IntakeJev, IntakeQuery, ListStories } from '@/lib/intake/types';
import { intakeLanes, type IntakeLaneDeps } from '@/lib/intake/pool-lfd';
import type { PhotoFinder } from '@/lib/stories/photos';
import type { FindOptions, FoundPhotos, PhotoBudget, PhotoDeps, PhotoNeed, PhotoProfile } from '@/lib/photos/types';

import { LFD_CAPTION_VERSION, writeLfdCaptionLines } from './caption-lines';
import { MEME_POOL_SCAN } from './config';
import { grounded, REWRITE_NOTE } from './ground';
import { leadImage } from './lead-image';
import { leadOrder } from './lead';
import { BUILDER_HARVEST_CAP_USD, findPhotos, harvestBuilderPhoto, REFUSED_ICON_SCENE, type BuilderHarvest, type HarvestBudget } from './photos';
import { judgedPool, leadFor, MAX_SEEDS, MIN_STORIES, mergeSameEvent, PER_COMPANY, RUNDOWN_POOL, rundownOrder, scoreMajor, Selector, slideOrder, withoutUsed } from './pick';
import { arrangeMemes, buildPost, composeCaption, coverMemeOf } from './post';
import { readArchivedKeys, readOpenSeeds, recordSeedOutcomes, seedCandidate, type LfdSeed } from './seeds';
import { carouselLane, freshFeedLane, lastCarouselRunAt, reelsLane } from './sources';
import { adoptRun, finishRun, insertPost, previousPosts, recentPhotoLedger, startRun, usedIdeaIds } from './store';
import { usedReason, type GuardDeps } from '@/lib/photos/used-guard';
import type { Drop, EngineMeme, LfdCandidate, LfdWindow, Pick, Ready, StoryCopy } from './types';
import { checkSlide, VISION_UNAVAILABLE, type SlideVerdict } from './vision';
import { extendWindow, windowFor } from './window';
import { writeStories } from './write';

export const MIN_TEXT_CHARS = 500;
export const THIN_CHARS = 1500;
export const MAX_ROUNDS = 4;
const PREVIOUS_POSTS = 2;
/** Each lane queue's head kept in the run record (spec §8 Ideas view). */
const QUEUE_TOP = 10;

export type LfdRunDeps = {
  query: HubQuery;
  jev: JevAsk;
  create: MessagesCreate;
  photos: PhotoFinder;
  fetchFeeds: () => Promise<FetchedArticle[]>;
  fetchBody: FetchBody;
  /** Reads a story's article page for its lead image (live: readPage). */
  readPage: (url: string) => Promise<PageRead>;
  fitCheck: FitCheck;
  upload: (path: string, body: Buffer, contentType?: string) => Promise<void>;
  now: Date;
  trigger: 'scheduled' | 'manual';
  capUsd: number;
  /** Claude and Jev spend so far (the CLI wires the run budget and Jev tally here). */
  spend: () => { claudeUsd: number; jevUsd: number };
  /** The Last Few Days caption closings (closingsLog(query, 'lfd')): recent closings for the caption call. Absent: no closings block, nothing recorded. */
  closings?: ClosingsLog;
  /** A run the worker already claimed (lfd.runs status running): it is adopted instead of inserting a new row. */
  runId?: string;
  /**
   * A replay (the meme lab's LFD simulation only): `now` is a past moment, and every read that means
   * "up to now" (previous posts, carousel runs) stops there. Never set by the worker or the CLI.
   */
  replay?: boolean;
  /**
   * Memes mid-run: when a selected story has no usable photo, and when the lineup still has no
   * 92% story. Absent: photo failures drop as before (offline tests).
   */
  memes?: {
    capUsd: number;
    clears: (story: { key: string; headline: string; text: string }, opts?: { assumeShort?: boolean }) => Promise<boolean>;
    make: (story: { key: string; headline: string; url: string; body: string; outlet: string }) => Promise<{ png: Buffer; templateId: string; text: string[]; costUsd: number } | null>;
  };
  /**
   * The central intake (Phase 1). Absent (tests, the meme lab, replays): today's lanes. Present: the
   * consumer switch decides ('intake' reads pre-scored intake stories; 'legacy' and 'stale-fallback' keep
   * today's lanes); the run record says which (`record.intake`). Everything but `jev` defaults to the
   * intake's own functions (A's readConsumerMode / ensureIntakeFresh / listStories, B's addIntakeSeed).
   */
  intake?: {
    /** Intake Jev (its own cost bucket): the carousel lane's posted check and seed scoring. */
    jev: IntakeJev;
    mode?: (q: IntakeQuery, now: Date) => Promise<'intake' | 'legacy' | 'stale-fallback'>;
    /** Before a manual run in intake mode: a top-up when the intake is stale. Never fails the run. */
    ensureFresh?: (q: IntakeQuery) => Promise<unknown>;
    lanes?: Partial<IntakeLaneDeps>;
    addSeed?: AddIntakeSeed;
    listStories?: ListStories;
  };
  /** Builder slides' photos: AI Drama's harvest after the article lead image, before the finder. Absent: the finder only. */
  harvest?: BuilderHarvest;
  /**
   * The shared photo finder (central intake Phase 3), present only when the 'lfd' switch read 'shared' (once per
   * run, live.ts). Every slide tries it first; an empty slide then takes today's chain (lead image, finder, meme,
   * replace) without the builder harvest slice. Absent: today's chain, unchanged.
   */
  sharedPhotos?: LfdSharedPhotos;
  /**
   * How the used-photo guard (CI-32, lib/photos/used-guard.ts) downloads and hashes a lead image to check it against
   * the ledger's published pictures. Absent (tests, replays): the lead image's URL is checked only.
   */
  usedPhotos?: GuardDeps;
};

/** The shared finder's wiring for one run. `find` / `need` default to lib/photos/find.ts and lib/photos/needs.ts (tests inject them). */
export type LfdSharedPhotos = {
  profile: PhotoProfile;
  deps: PhotoDeps;
  find?: (needs: PhotoNeed[], profile: PhotoProfile, deps: PhotoDeps, opts: FindOptions) => Promise<FoundPhotos>;
  need?: (pick: Pick, copy: StoryCopy, id: string) => PhotoNeed;
};

/**
 * The shared finder over a set of stories, one photo (or null) and one trace per story, same order, under the
 * post's `budget`. Never throws: an error leaves every story to today's chain, with the reason in its trace.
 */
export async function findSharedLfdPhotos(
  s: LfdSharedPhotos,
  items: Array<{ pick: Pick; copy: StoryCopy }>,
  exclude: ReadonlySet<string>,
  budget: PhotoBudget,
): Promise<{ photos: Array<Ready['photo'] | null>; traces: string[][] }> {
  if (items.length === 0) return { photos: [], traces: [] };
  try {
    const find = s.find ?? (await import('@/lib/photos/find')).findPhotos;
    const need = s.need ?? (await import('@/lib/photos/needs')).needForLfd;
    const out = await find(items.map((it) => need(it.pick, it.copy, it.pick.key)), s.profile, s.deps, { exclude, budget });
    return { photos: items.map((_, i) => out.photos[i] ?? null), traces: items.map((_, i) => out.traces[i] ?? []) };
  } catch (err) {
    return { photos: items.map(() => null), traces: items.map(() => [`shared: failed: ${err instanceof Error ? err.message : String(err)}`]) };
  }
}

export type IntakeMode = 'intake' | 'legacy' | 'stale-fallback';

/** The hub query as the intake's query object. */
const asIntakeQuery = (q: HubQuery): IntakeQuery => ({ query: (text, params) => q(text, params) });

/**
 * Seeds in intake mode (B's addIntakeSeed): each joins or creates its intake story, scored on entry, so it
 * carries stored major-news / story-builder scores and needs no Jev at pick time. A seed the intake cannot
 * take keeps today's path (scored by the run's own major-news call). Never throws.
 */
async function intakeSeeds(d: LfdRunDeps, seeds: LfdSeed[], candidates: LfdCandidate[], record: Record<string, unknown>): Promise<LfdCandidate[]> {
  if (!d.intake || seeds.length === 0) return candidates;
  const iq = asIntakeQuery(d.query);
  const addSeed = d.intake.addSeed ?? (await import('@/lib/intake/seed')).addIntakeSeed;
  const list = d.intake.listStories ?? (await import('@/lib/intake/read')).listStories;
  const ids = new Map<string, string>();
  const errors: string[] = [];
  for (const s of seeds) {
    try {
      const res = await addSeed(iq, d.intake.jev, { order: 'lfd', url: s.url, seededBy: 'lfd', headline: s.headline, body: s.body }, d.now);
      ids.set(s.key, res.storyId);
    } catch (err) {
      errors.push(`${s.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length) record.intakeSeedErrors = errors;
  if (ids.size === 0) return candidates;
  const since = new Date(Math.min(...seeds.map((s) => Date.parse(s.addedAt)).filter(Number.isFinite), d.now.getTime() - 86_400_000));
  const stories = await list(iq, { since }).catch((err: unknown) => {
    errors.push(`read: ${err instanceof Error ? err.message : String(err)}`);
    record.intakeSeedErrors = errors;
    return [];
  });
  const byId = new Map(stories.map((s) => [s.id, s]));
  return candidates.map((c) => {
    const id = ids.get(c.key);
    const story = id ? byId.get(id) : undefined;
    if (!id) return c;
    return {
      ...c,
      refs: [...new Set([...c.refs, id])],
      ...(story
        ? { major: story.scores['major-news'] ?? null, builder: story.scores['story-builder'] ?? null, eventDate: story.eventDate ? story.eventDate.toISOString() : null }
        : {}),
    };
  });
}

/** Window start as an instant: midnight NY after `after` is close enough for "runs finished since". */
function windowStartIso(w: LfdWindow): string {
  return `${w.after}T04:00:00Z`;
}

async function gather(d: LfdRunDeps, w: LfdWindow, used: Set<string>, known: ReadonlyMap<string, number> = new Map(), seeds: LfdCandidate[] = [], mode: IntakeMode = 'legacy') {
  let reels: LfdCandidate[];
  let carousel: LfdCandidate[];
  let feed: LfdCandidate[];
  let feedError: string | undefined;
  let intakeError: string | undefined;
  let lanes: Awaited<ReturnType<typeof intakeLanes>> | null = null;
  if (mode === 'intake' && d.intake) {
    // The intake's pre-scored stories: same three lanes, same keys, no Reels or Carousels run needed. A read error
    // falls back to today's lanes for this run (fix 2): the intake never takes a post down.
    try {
      lanes = await intakeLanes(asIntakeQuery(d.query), w, d.now, d.intake.jev, d.intake.lanes);
    } catch (err) {
      intakeError = err instanceof Error ? err.message : String(err);
      mode = 'legacy';
    }
  }
  if (lanes) {
    reels = withoutUsed(lanes.reels, used);
    carousel = withoutUsed(lanes.carousel, used);
    feed = withoutUsed(lanes.feed, used);
  } else {
    reels = withoutUsed(await reelsLane(d.query, w), used);
    const until = d.replay ? d.now.toISOString() : undefined;
    carousel = withoutUsed(await carouselLane(d.query, windowStartIso(w), until), used);
    const last = await lastCarouselRunAt(d.query, until);
    const since = new Date(last ?? windowStartIso(w));
    const fresh = await freshFeedLane(d.fetchFeeds, since, d.now).catch((err: unknown) => {
      feedError = err instanceof Error ? err.message : String(err);
      return [];
    });
    feed = withoutUsed(fresh, used);
  }
  // A person's seeds are scored by the same judge (one call each, inside the run cap) and go first in the merge so a seed
  // absorbs a same-event duplicate. A machine candidate with a seed's own key is the seed (its source ids are carried over).
  // In intake mode a seed also carries its intake story id: the lane candidate for that story is the seed too.
  const seedKeys = new Set(seeds.map((s) => s.key));
  const seedRefs = new Set(seeds.flatMap((s) => s.refs.filter((r) => r !== s.key)));
  const isSeedOf = (s: LfdCandidate, c: LfdCandidate) => c.key === s.key || c.refs.some((r) => r !== s.key && s.refs.includes(r));
  const ownSeeds = seeds.map((s) => ({ ...s, refs: [...new Set([...s.refs, ...[...reels, ...carousel, ...feed].filter((c) => isSeedOf(s, c)).flatMap((c) => c.refs)])] }));
  // Stored scores (intake seeds) are known: no Jev for them.
  const seedKnown = new Map([...known, ...seeds.filter((s) => s.major !== null).map((s) => [s.key, s.major!] as const)]);
  const scoredSeeds = await scoreMajor(ownSeeds, d.jev, seedKnown);
  const notSeed = (list: LfdCandidate[]) => (seedKeys.size ? list.filter((c) => !seedKeys.has(c.key) && !c.refs.some((r) => seedRefs.has(r))) : list);
  const pool = judgedPool(notSeed(carousel), notSeed(reels), notSeed(feed));
  // Intake mode: major-news is stored on every story, so nothing is judged here (no Jev).
  const judged = mode === 'intake' ? pool : await scoreMajor(pool, d.jev, known);
  const judgedKeys = new Set(judged.map((c) => c.key));
  // Major stays a judged-pool lane as today; builder scores ride on every candidate (round 1: judge deeper into the pool).
  const rundownOnly = notSeed([...reels]).sort(rundownOrder).filter((c) => !judgedKeys.has(c.key)).slice(0, RUNDOWN_POOL).map((c) => (mode === 'intake' ? { ...c, major: null } : c));
  const merged = await mergeSameEvent([...scoredSeeds, ...judged.sort((a, b) => (b.major ?? 0) - (a.major ?? 0)), ...rundownOnly], d.jev);
  const machine = seedKeys.size ? merged.filter((c) => !c.yours) : merged;
  return {
    /** Lead candidates: a major-news score (judged pool) or a story-builder score (intake). */
    majors: machine.filter((c) => c.major !== null || c.builder !== null),
    rundown: machine.filter((c) => c.origin === 'reels' || c.refs.some((r) => reels.some((x) => x.refs.includes(r)))),
    /** The person's seeds, taken before the lanes. */
    forced: merged.filter((c) => c.yours),
    counts: { reels: reels.length, carousel: carousel.length, feed: feed.length, judged: judged.length },
    /** Every major-news score judged so far, by key: a re-gather reuses these instead of judging again. */
    scores: new Map([...known, ...[...scoredSeeds, ...judged].filter((c) => mode !== 'intake' || c.major !== null).map((c) => [c.key, c.major ?? 0] as const)]),
    feedError,
    /** Set when the intake read failed and this gather took today's lanes instead. */
    intakeError,
  };
}

/** Distinct stories that could be picked: leads (above-bar majors, in-window builders) plus the rundown, deduped by key and shared refs. */
function distinctEligible(pools: { majors: LfdCandidate[]; rundown: LfdCandidate[]; forced?: LfdCandidate[] }, now: Date): number {
  const seen = new Set<string>();
  let n = 0;
  for (const c of [...(pools.forced ?? []), ...pools.majors.filter((m) => leadFor(m, now) !== null), ...pools.rundown]) {
    const ids = [c.key, ...c.refs];
    if (ids.some((id) => seen.has(id))) continue;
    ids.forEach((id) => seen.add(id));
    n += 1;
  }
  return n;
}

async function fullText(d: LfdRunDeps, c: LfdCandidate): Promise<string | null> {
  if (c.body.length >= THIN_CHARS) return c.body;
  const fetched = await d.fetchBody(c.url).catch(() => null);
  const best = fetched && fetched.length > c.body.length ? fetched : c.body;
  return best.length >= MIN_TEXT_CHARS ? best : null;
}

/** A story slide whose photo failed to load: by the slide number ("slide 3 image failed to load") or the image src. Cover is slide 1. */
function brokenImageKeys(fit: FitResult, final: Ready[]): string[] {
  const keys = new Set<string>();
  for (const p of fit.problems) {
    if (!/image failed to load/.test(p)) continue;
    const slide = p.match(/slide (\d+)/);
    const bySlide = slide ? final[Number(slide[1]) - 2] : undefined;
    const bySrc = final.find((r) => p.includes(r.photo.src));
    const hit = bySlide ?? bySrc;
    if (hit) keys.add(hit.pick.key);
  }
  return [...keys];
}

/** Everything in a fit result that means a broken slide, apart from text fit (stored in fit_problems). */
function renderProblemsOf(fit: FitResult | null): string[] {
  if (!fit) return [];
  return [
    ...fit.problems.filter((p) => !/text fit/.test(p)),
    ...fit.violations.map((v) => `slide ${v.slide} bounds: ${v.element} "${v.text}" over ${JSON.stringify(v.over)}`),
  ];
}

/** Story slides to replace before anything is uploaded: photos that failed to load, and photos the vision check rejected. */
class BrokenImages extends Error {
  constructor(
    readonly keys: string[],
    readonly rejected: Array<{ key: string; reason: string }> = [],
  ) {
    super(`story slides to replace: ${[...keys.map((k) => `${k} (image failed)`), ...rejected.map((r) => `${r.key} (vision: ${r.reason})`)].join(', ')}`);
  }
}

function memeStorageKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

/** Upload engine memes and replace in-memory data URLs so the post row never stores a PNG. */
async function persistEngineMemes(
  ready: Ready[],
  slug: string,
  render: { slides?: Array<{ photoUrl?: string; lfdCover?: { meme?: { url?: string } } }> },
  upload: LfdRunDeps['upload'],
): Promise<void> {
  for (const r of ready) {
    if (r.photoSource !== 'meme' || !r.meme || !r.photo.src.startsWith('data:')) continue;
    const file = r.meme.object;
    const png = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.from(r.photo.src.replace(/^data:image\/png;base64,/, ''), 'base64');
    if (!png.length) continue;
    const object = `lfd/${slug}/meme-engine-${memeStorageKey(r.pick.key)}.png`;
    await upload(object, png, 'image/png');
    const stored = `storage:${object}`;
    const data = r.photo.src;
    r.photo = { ...r.photo, src: stored };
    r.meme = { ...r.meme, object };
    for (const slide of render.slides ?? []) {
      if (slide.photoUrl === data) slide.photoUrl = stored;
      if (slide.lfdCover?.meme?.url === data) slide.lfdCover.meme.url = stored;
    }
  }
}

function memeAsPhoto(pick: Pick, copy: StoryCopy, made: { png: Buffer; templateId: string; text: string[] }): Ready {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfd-meme-photo-'));
  const file = path.join(dir, 'meme.png');
  fs.writeFileSync(file, made.png);
  // The social renderer loads https, data URLs, or files under public/. A tmp
  // path becomes an ORIGIN request and 404s (blank photo well).
  const src = `data:image/png;base64,${made.png.toString('base64')}`;
  const meme: EngineMeme = { templateId: made.templateId, memeId: `engine:${pick.key}`, rank: 1, role: 'slide', position: 0, object: file, text: made.text };
  return { pick, copy, photo: { src, credit: 'meme', kind: 'scene' }, photoSource: 'meme', photoTrace: ['meme: cleared the 92% gate; used as the photo'], meme };
}

function companyFullIn(ready: Ready[], headline: string): boolean {
  const company = companyKey(headline);
  if (!company) return false;
  return ready.filter((r) => companyKey(r.pick.headline) === company).length >= PER_COMPANY;
}

/** At most this many vision calls at once. */
const VISION_PARALLEL = 3;

async function inPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

export async function runLastFewDays(d: LfdRunDeps): Promise<{ ok: true; runId: string; postId: string; stories: number; short: boolean; recorded?: boolean } | { ok: false; runId: string; error: string }> {
  const nyDate = nyDateKey(d.now);
  const runId = d.runId ? await adoptRun(d.query, d.runId, d.capUsd, nyDate) : await startRun(d.query, d.trigger, d.capUsd, nyDate);
  const record: Record<string, unknown> = {};
  // The shared finder's spend for this post (Serper + Haiku looks); stays 0 in legacy mode.
  const sharedBudget: PhotoBudget = { usd: 0, capUsd: d.sharedPhotos?.profile.capUsd ?? 0 };
  let jevCalls = 0;
  const jev: JevAsk = (req, meta) => {
    jevCalls += 1;
    record.jevCalls = jevCalls;
    return d.jev(req, meta);
  };
  // One read per article page per run: leadImage and any later use share it.
  const pages = new Map<string, Promise<PageRead>>();
  const readPage = (url: string): Promise<PageRead> => {
    let page = pages.get(url);
    if (!page) {
      page = d.readPage(url);
      pages.set(url, page);
    }
    return page;
  };
  const run: LfdRunDeps = { ...d, jev, readPage };
  try {
    const previous = await previousPosts(d.query, PREVIOUS_POSTS, d.replay ? nyDate : undefined);
    const used = usedIdeaIds(previous);
    // A person's seeds and archives. Neither read may fail a run: an error means none, noted in the record.
    let seedList: Awaited<ReturnType<typeof readOpenSeeds>> = [];
    try {
      const archived = await readArchivedKeys(d.query);
      for (const key of archived) used.add(key);
      seedList = d.replay ? [] : await readOpenSeeds(d.query, d.now, archived);
    } catch (err) {
      record.seedError = err instanceof Error ? err.message : String(err);
    }
    // The consumer switch (central intake): which lanes this run reads. Never fails the run: an error means today's lanes.
    let mode: IntakeMode = 'legacy';
    if (d.intake && !d.replay) {
      const iq = asIntakeQuery(d.query);
      try {
        const readMode = d.intake.mode ?? (async (q: IntakeQuery, now: Date) => (await import('@/lib/intake/read')).readConsumerMode(q, 'lfd', now));
        mode = await readMode(iq, d.now);
      } catch (err) {
        record.intakeError = err instanceof Error ? err.message : String(err);
      }
      if (mode === 'intake' && d.trigger === 'manual') {
        const ensure = d.intake.ensureFresh ?? (async (q: IntakeQuery) => (await import('@/lib/intake/run')).ensureIntakeFresh(q));
        record.intakeFresh = await ensure(iq).catch((err: unknown) => ({ ran: false, reason: err instanceof Error ? err.message : String(err) }));
      }
    }
    record.intake = mode;
    // At most MAX_SEEDS to a post; the rest wait (and cost no Jev call).
    const taking = seedList.slice(0, MAX_SEEDS);
    const seedCandidates = mode === 'intake'
      ? await intakeSeeds(d, taking, taking.map(seedCandidate), record).catch((err: unknown) => {
        record.intakeSeedErrors = [err instanceof Error ? err.message : String(err)];
        return taking.map(seedCandidate);
      })
      : taking.map(seedCandidate);
    let window = windowFor(nyDate, previous[0]?.nyDate ?? null);
    let pools = await gather(run, window, used, new Map(), seedCandidates, mode);
    if (pools.intakeError) {
      // The intake read failed: today's lanes for the rest of this run.
      mode = 'legacy';
      record.intake = 'error-fallback';
      record.intakeError = pools.intakeError;
    }
    if (distinctEligible(pools, d.now) < MIN_STORIES) {
      window = extendWindow(window);
      pools = await gather(run, window, used, pools.scores, seedCandidates, mode);
      record.safetyNet = true;
    }
    record.window = window;
    record.pool = pools.counts;
    if (pools.feedError) record.feedError = pools.feedError;

    const selector = new Selector(pools.majors, pools.rundown, previous[0]?.stories ?? [], jev, pools.forced, d.now);
    // `builder` only when scored (intake), so a legacy record keeps today's shape.
    const queueRow = (c: LfdCandidate) => ({ key: c.key, headline: c.headline, major: c.major, net: c.net, ...(c.builder != null ? { builder: c.builder } : {}) });
    record.queues = { major: selector.top('major', QUEUE_TOP).map(queueRow), builder: selector.top('builder', QUEUE_TOP).map(queueRow), rundown: selector.top('rundown', QUEUE_TOP).map(queueRow) };
    let pending: Pick[] = await selector.fill();
    const ready: Ready[] = [];
    const drops: Drop[] = [];
    record.drops = drops;
    const cache = { readTokens: 0, creationTokens: 0 };
    record.claudeCache = cache;
    const vision = { checked: 0, rejected: 0, unavailable: 0, usd: 0 };
    record.vision = vision;
    /** Verdicts by story key + photo: a slide unchanged since the last render is not looked at again. */
    const verdicts = new Map<string, SlideVerdict>();
    // CI-32: photos published in the last 20 days, by URL (the exclude set) and by picture (the ledger's hashes).
    const ledger = await recentPhotoLedger(d.query, d.now);
    const exclude = new Set(ledger.urls);
    // Builder-slide harvests share one budget per post (round 3: $0.15).
    const harvestBudget: HarvestBudget = { usd: 0, capUsd: BUILDER_HARVEST_CAP_USD };
    const harvestRecord: { usd: number; slides: Array<{ key: string; found: boolean }> } = { usd: 0, slides: [] };
    if (d.harvest && !d.sharedPhotos) record.photoHarvest = harvestRecord;
    const sharedRecord: { usd: number; slides: Array<{ key: string; found: boolean }> } = { usd: 0, slides: [] };
    if (d.sharedPhotos) record.photoShared = sharedRecord;
    /** Stories whose photo came from the shared finder, by key → src (a vision reject sends them to today's finder). */
    const sharedPicked = new Map<string, string>();
    const memesRecord: {
      rescued: Array<{ key: string; headline: string; templateId: string }>;
      scanned: Array<{ key: string; headline: string; pass: boolean }>;
      added: { key: string; headline: string; templateId: string } | null;
      costUsd: number;
    } = { rescued: [], scanned: [], added: null, costUsd: 0 };
    if (d.memes) record.memes = memesRecord;

    const storyText = (copy: StoryCopy) => [copy.setup, copy.body].filter(Boolean).join(' ');
    const rescuedReady = new Map<string, Ready>();
    const rescueWithMeme = async (item: { pick: Pick; copy: StoryCopy }): Promise<Ready | null> => {
      const existing = rescuedReady.get(item.pick.key);
      if (existing) return existing;
      if (!d.memes) return null;
      const pass = await d.memes.clears({ key: item.pick.key, headline: item.copy.headline, text: storyText(item.copy) });
      if (!pass) return null;
      const made = await d.memes.make({ key: item.pick.key, headline: item.copy.headline, url: item.pick.url, body: item.pick.body || item.copy.body, outlet: item.pick.sourceName });
      if (!made?.png.length) return null;
      memesRecord.costUsd += made.costUsd;
      const kept = memeAsPhoto(item.pick, item.copy, made);
      rescuedReady.set(item.pick.key, kept);
      memesRecord.rescued.push({ key: item.pick.key, headline: item.copy.headline, templateId: made.templateId });
      return kept;
    };

    const replace = async (p: Pick, reason: Drop['reason'], next: Pick[], detail?: string) => {
      drops.push({ key: p.key, lane: p.lane, headline: p.headline, reason, ...(detail ? { detail } : {}) });
      selector.drop(p.key);
      const r = await selector.replace(p.lane);
      if (r) next.push(r);
    };
    const write = async (items: Array<{ pick: Pick; body: string }>, note?: string) => {
      const res = await writeStories(d.create, items, note);
      cache.readTokens += res.cache.readTokens;
      cache.creationTokens += res.cache.creationTokens;
      return res;
    };

    /** Write a round's stories in one call; if that fails, one call per story so one bad story can't sink the rest. */
    const writeRound = async (texts: Array<{ pick: Pick; body: string }>, round: number, next: Pick[]) => {
      const batch = await write(texts);
      if (batch.ok) return texts.map((t) => ({ ...t, copy: batch.stories.find((s) => s.key === t.pick.key)! }));
      record.writeFailure = batch.detail;
      const out: Array<{ pick: Pick; body: string; copy: StoryCopy }> = [];
      const failed: Pick[] = [];
      for (const t of texts) {
        const one = texts.length > 1 ? await write([t]) : batch;
        if (one.ok) out.push({ ...t, copy: one.stories[0]! });
        else failed.push(t.pick);
      }
      if (round === 0 && out.length === 0) throw new Error(`writing failed: ${batch.detail}`);
      for (const p of failed) await replace(p, 'write-failed', next);
      return out;
    };

    const runRound = async (picks: Pick[], round: number): Promise<Pick[]> => {
      const next: Pick[] = [];
      const texts: Array<{ pick: Pick; body: string }> = [];
      for (const p of picks) {
        const body = await fullText(d, p);
        if (body) texts.push({ pick: { ...p, body }, body });
        else await replace(p, 'thin-text', next);
      }
      if (texts.length === 0) return next;

      const written = await writeRound(texts, round, next);
      const checked: Array<{ pick: Pick; copy: StoryCopy }> = [];
      for (const { pick, body, copy: first } of written) {
        let copy = first;
        if (!(await grounded(jev, copy, body))) {
          const again = await write([{ pick, body }], REWRITE_NOTE);
          const retry = again.ok ? again.stories[0] : undefined;
          if (!retry || !(await grounded(jev, retry, body))) { await replace(pick, 'not-grounded', next); continue; }
          copy = retry;
        }
        checked.push({ pick, copy });
      }

      // The article's own lead image first; only stories without one go to the finder. One set: no photo twice.
      const taken = new Set([...exclude, ...ready.map((r) => r.photo.src)]);
      // Shared mode: every slide tries the shared finder first; the empty ones take today's chain below.
      const sharedHits = new Map<number, { photo: Ready['photo']; trace: string[] }>();
      const sharedTraces = new Map<number, string[]>();
      if (d.sharedPhotos) {
        const got = await findSharedLfdPhotos(d.sharedPhotos, checked, taken, sharedBudget);
        sharedRecord.usd = sharedBudget.usd;
        for (const [i, item] of checked.entries()) {
          const photo = got.photos[i];
          sharedRecord.slides.push({ key: item.pick.key, found: Boolean(photo) });
          if (photo) {
            taken.add(photo.src);
            sharedHits.set(i, { photo, trace: got.traces[i] ?? [] });
          } else sharedTraces.set(i, got.traces[i] ?? []);
        }
      }
      const leads: Array<Awaited<ReturnType<typeof leadImage>>> = [];
      const ledgerNotes = new Map<number, string[]>();
      for (const [i, item] of checked.entries()) {
        if (sharedHits.has(i)) {
          leads.push(null);
          continue;
        }
        let lead = await leadImage(readPage, item.pick, taken);
        const used = lead ? await usedReason(ledger, { url: lead.photo.src, kind: lead.photo.kind }, d.usedPhotos ?? {}) : null;
        if (lead && used) {
          ledgerNotes.set(i, [`lead image refused by the used-photo ledger: ${used}: ${lead.photo.src}`]);
          lead = null;
        }
        if (lead) taken.add(lead.photo.src);
        leads.push(lead);
      }
      // Builder slides with no lead image: AI Drama's harvest next (capped per post); a miss goes to the finder.
      const harvested = new Map<number, { photo: Ready['photo']; trace: string[] }>();
      const harvestTraces = new Map<number, string[]>();
      for (const [i, item] of checked.entries()) {
        // Shared mode skips the builder-only harvest slice: the shared finder already covered every slide.
        if (leads[i] || item.pick.lane !== 'builder' || !d.harvest || d.sharedPhotos) continue;
        const got = await harvestBuilderPhoto(d.harvest, item.pick, item.copy, taken, harvestBudget, d.now, ledger);
        harvestRecord.slides.push({ key: item.pick.key, found: got.photo !== null });
        harvestRecord.usd = harvestBudget.usd;
        if (got.photo) {
          taken.add(got.photo.src);
          harvested.set(i, { photo: got.photo, trace: got.trace });
        } else harvestTraces.set(i, got.trace);
      }
      const rest = checked.filter((_, i) => !leads[i] && !harvested.has(i) && !sharedHits.has(i));
      const found = await findPhotos(d.photos, rest, taken);
      let k = 0;
      for (const [i, item] of checked.entries()) {
        const shared = sharedHits.get(i);
        if (shared) {
          // The shared finder is AI Drama's harvest engine: recorded as 'harvest', its trace steps prefixed `shared:`.
          ready.push({ ...item, photo: shared.photo, photoSource: 'harvest', photoTrace: shared.trace });
          sharedPicked.set(item.pick.key, shared.photo.src);
          continue;
        }
        const lead = leads[i];
        if (lead) {
          ready.push({ ...item, photo: lead.photo, photoSource: 'lead', photoTrace: [...(sharedTraces.get(i) ?? []), lead.note] });
          continue;
        }
        const harvest = harvested.get(i);
        if (harvest) {
          ready.push({ ...item, photo: harvest.photo, photoSource: 'harvest', photoTrace: harvest.trace });
          continue;
        }
        const photo = found.photos[k];
        const photoTrace = [...(sharedTraces.get(i) ?? []), ...(ledgerNotes.get(i) ?? []), ...(harvestTraces.get(i) ?? []), ...(found.traces[k] ?? [])];
        k += 1;
        if (photo) ready.push({ ...item, photo, photoSource: 'finder', photoTrace });
        else {
          const kept = await rescueWithMeme(item);
          if (kept) ready.push(kept);
          else await replace(item.pick, 'no-photo', next, photoTrace.includes(REFUSED_ICON_SCENE) ? REFUSED_ICON_SCENE : undefined);
        }
      }
      return next;
    };

    const unfinished = (left: Pick[]) => {
      for (const p of left) drops.push({ key: p.key, lane: p.lane, headline: p.headline, reason: 'unfinished' });
    };
    for (let round = 0; round < MAX_ROUNDS && pending.length > 0; round++) pending = await runRound(pending, round);
    unfinished(pending);

    const lineupHasPasser = async (): Promise<boolean> => {
      if (ready.some((r) => r.photoSource === 'meme')) return true;
      if (!d.memes) return false;
      for (const r of ready) {
        if (await d.memes.clears({ key: r.pick.key, headline: r.copy.headline, text: storyText(r.copy) })) return true;
      }
      return false;
    };

    const scanAddMemeStory = async (): Promise<void> => {
      if (!d.memes) return;
      if (await lineupHasPasser()) return;
      const skip = new Set([...ready.map((r) => r.pick.key), ...drops.map((x) => x.key)]);
      const candidates = selector.unused(MEME_POOL_SCAN, skip);
      for (const c of candidates) {
        const preview = await d.memes.clears({ key: c.key, headline: c.headline, text: c.body }, { assumeShort: true });
        memesRecord.scanned.push({ key: c.key, headline: c.headline, pass: preview });
        if (!preview) continue;
        if (companyFullIn(ready, c.headline)) continue;
        const body = await fullText(d, c);
        if (!body) continue;
        const lane = leadFor(c, d.now)?.lane ?? 'rundown';
        const pick: Pick = { ...c, lane };
        const batch = await write([{ pick, body }]);
        if (!batch.ok) continue;
        let copy = batch.stories[0]!;
        if (!(await grounded(jev, copy, body))) {
          const again = await write([{ pick, body }], REWRITE_NOTE);
          const retry = again.ok ? again.stories[0] : undefined;
          if (!retry || !(await grounded(jev, retry, body))) continue;
          copy = retry;
        }
        if (!(await d.memes.clears({ key: c.key, headline: copy.headline, text: storyText(copy) }))) continue;
        const made = await d.memes.make({ key: c.key, headline: copy.headline, url: c.url, body, outlet: c.sourceName });
        if (!made?.png.length) continue;
        memesRecord.costUsd += made.costUsd;
        ready.push(memeAsPhoto(pick, copy, made));
        selector.adopt(c, lane);
        memesRecord.added = { key: c.key, headline: copy.headline, templateId: made.templateId };
        break;
      }
    };
    await scanAddMemeStory();

    /** Lead scores by story key, judged once per story this run (spec §4.2). */
    const leadScores = new Map<string, number>();
    const finalOrder = async (): Promise<Ready[]> => {
      const base = slideOrder(ready.map((r) => r.pick), d.now).map((p) => ready.find((r) => r.pick.key === p.key)!);
      const lead = await leadOrder(base, jev, leadScores);
      record.lead = lead.error ? { by: lead.by, error: lead.error } : { by: lead.by };
      const final = lead.order;
      // Spec §4.1: at most 2 setups per post; replacement rounds can add more than normalize's per-call cap.
      let setups = 0;
      for (const r of final) {
        if (!r.copy.setup) continue;
        setups += 1;
        if (setups > 2) r.copy = { ...r.copy, setup: '' };
      }
      return final;
    };

    const taken = (await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM lfd.posts WHERE slug = $1`, [`lfd-${nyDate}`])).rows[0]!.n > 0;
    const slug = taken ? `lfd-${nyDate}-${runId.slice(0, 8)}` : `lfd-${nyDate}`;
    /** Vision-check each story slide's photo (story i is slide i + 2; the cover is slide 1). Returns the rejected ones. */
    const visionCheck = async (final: Ready[], dir: string, skip: Set<string>) => {
      const fs = await import('node:fs/promises');
      const rejected: Array<{ r: Ready; reason: string }> = [];
      const todo = final.map((r, i) => ({ r, i })).filter(({ r }) => !skip.has(r.pick.key));
      await inPool(todo, VISION_PARALLEL, async ({ r, i }) => {
        const id = `${r.pick.key}\n${r.photo.src}`;
        let v = verdicts.get(id);
        if (!v) {
          const png = await fs.readFile(`${dir}/slide-slide-${String(i + 2).padStart(2, '0')}.png`).catch(() => null);
          v = png ? await checkSlide(d.create, png, { headline: r.copy.headline, body: r.copy.body, names: r.copy.names, outlet: r.pick.sourceName }) : { ok: true, reason: VISION_UNAVAILABLE, costUsd: 0 };
          vision.checked += 1;
          vision.usd += v.costUsd;
          if (v.reason === VISION_UNAVAILABLE) vision.unavailable += 1;
          else verdicts.set(id, v);
          if (!v.ok) vision.rejected += 1;
        }
        if (!v.ok) rejected.push({ r, reason: v.reason });
      });
      return final.flatMap((r) => rejected.filter((x) => x.r === r));
    };

    /**
     * Render and store the JPEGs. With `replaceBroken`, a story slide whose photo failed to load or that the
     * vision check rejected throws before anything is uploaded; without it, vision rejections are only recorded.
     */
    const renderAndStore = async (final: Ready[], replaceBroken: boolean, coverMeme?: { url: string }) => {
      const render = buildPost(final, d.now, undefined, coverMeme ? { coverMeme } : undefined);
      let fit: FitResult | null = null;
      const visionProblems: string[] = [];
      const slideObjects = await storeSlideJpegs(slug, render, {
        prefix: 'lfd',
        fitCheck: async (post, opts) => {
          const result = await d.fitCheck(post, opts);
          fit = result;
          const broken = replaceBroken ? brokenImageKeys(result, final) : [];
          const skip = new Set([...broken, ...final.filter((r) => r.photoSource === 'meme').map((r) => r.pick.key)]);
          const rejected = opts?.screenshotDir ? await visionCheck(final, opts.screenshotDir, skip) : [];
          if (replaceBroken && (broken.length || rejected.length)) throw new BrokenImages(broken, rejected.map((x) => ({ key: x.r.pick.key, reason: x.reason })));
          visionProblems.push(...rejected.map((x) => `vision: ${x.r.copy.headline}: ${x.reason}`));
          return result;
        },
        upload: d.upload,
      });
      return { render, slideObjects, fit: fit as FitResult | null, visionProblems };
    };

    const place = (list: Ready[]) => {
      list.forEach((r, i) => { if (!leadAt.has(r.pick.key)) leadAt.set(r.pick.key, leadAt.size || i); });
      const { ready, placement } = arrangeMemes(list);
      return { ready, coverMeme: coverMemeOf(ready, placement) };
    };
    const leadAt = new Map<string, number>();
    let placed = place(await finalOrder());
    let final = placed.ready;
    if (final.length === 0) throw new Error('no stories survived');
    let rendered: Awaited<ReturnType<typeof renderAndStore>>;
    try {
      rendered = await renderAndStore(final, true, placed.coverMeme);
    } catch (err) {
      if (!(err instanceof BrokenImages)) throw err;
      // One extra round: drop each story whose photo failed to load or was rejected, replace it, re-render (whatever fails then is recorded).
      // A rejected article lead image first gets one finder search for the same story; only if that finds nothing is the story dropped.
      // Shared mode: a rejected shared-finder photo is treated the same way (today's finder next).
      const next: Pick[] = [];
      const take = (key: string) => {
        const [gone] = ready.splice(ready.findIndex((r) => r.pick.key === key), 1);
        exclude.add(gone!.photo.src);
        return gone!;
      };
      const fromShared = (key: string) => {
        const r = ready.find((x) => x.pick.key === key);
        return Boolean(r && sharedPicked.get(key) === r.photo.src);
      };
      const isLead = (key: string) => ready.find((r) => r.pick.key === key)?.photoSource === 'lead' || fromShared(key);
      const leadRejected = err.rejected.filter((x) => isLead(x.key)).map((x) => {
        const shared = fromShared(x.key);
        return { gone: take(x.key), reason: x.reason, shared };
      });
      const leave = [...err.keys.map((key) => ({ key, reason: 'image-failed' as const, detail: undefined })), ...err.rejected.filter((x) => !leadRejected.some((l) => l.gone.pick.key === x.key)).map((x) => ({ key: x.key, reason: 'vision-rejected' as const, detail: x.reason }))];
      for (const { key, reason, detail } of leave) {
        const gone = take(key);
        if (gone.photoSource === 'meme') { ready.push(gone); continue; }
        const kept = await rescueWithMeme({ pick: gone.pick, copy: gone.copy });
        if (kept) ready.push(kept);
        else await replace(gone.pick, reason, next, detail);
      }
      if (leadRejected.length) {
        const again = await findPhotos(d.photos, leadRejected.map(({ gone }) => ({ pick: gone.pick, copy: gone.copy })), new Set([...exclude, ...ready.map((r) => r.photo.src)]));
        for (const [j, { gone, reason, shared }] of leadRejected.entries()) {
          const photo = again.photos[j];
          const photoTrace = [`${shared ? 'shared photo' : 'lead image'} rejected by vision: ${reason}: ${gone.photo.src}`, ...(again.traces[j] ?? [])];
          if (photo) ready.push({ pick: gone.pick, copy: gone.copy, photo, photoSource: 'finder', photoTrace });
          else {
            const kept = await rescueWithMeme({ pick: gone.pick, copy: gone.copy });
            if (kept) ready.push(kept);
            else await replace(gone.pick, 'vision-rejected', next, photoTrace.includes(REFUSED_ICON_SCENE) ? `${reason}; finder: ${REFUSED_ICON_SCENE}` : `${reason}; the finder found no photo`);
          }
        }
      }
      if (next.length) unfinished(await runRound(next, MAX_ROUNDS));
      await scanAddMemeStory();
      placed = place(await finalOrder());
      final = placed.ready;
      if (final.length === 0) throw new Error('no stories survived');
      rendered = await renderAndStore(final, false, placed.coverMeme);
    }

    const { slideObjects, fit, visionProblems } = rendered;
    // The caption is on no slide, so it is written once, for the stories that made the final render.
    // Any failure ships the template caption. The call goes through d.create, so the run budget prices it.
    const recent = d.closings ? await d.closings.recent().catch(() => []) : [];
    const caption = await writeLfdCaptionLines(final, recent, d.create);
    // Telemetry and the closings log follow what shipped: model lines that cannot fit fall back to the template.
    const shipped = composeCaption(final, caption.lines);
    record.caption = shipped.by === 'model'
      ? { by: 'model', version: LFD_CAPTION_VERSION, usd: caption.costUsd }
      : { by: 'template', usd: caption.costUsd, reason: caption.reason ?? 'the model caption did not fit the limit' };
    if (shipped.by === 'model' && caption.lines) await d.closings?.record(runId, caption.lines.heliosLine, false);
    const render = { ...rendered.render, caption: shipped.caption };
    await persistEngineMemes(final, slug, render, d.upload);
    const short = final.length < MIN_STORIES;
    const fitProblems = (fit?.problems ?? []).filter((p) => /text fit/.test(p));
    const postId = await insertPost(d.query, {
      runId,
      slug,
      nyDate,
      ideaIds: [...new Set(final.flatMap((r) => [r.pick.key, ...r.pick.refs]))],
      // `photo` is the result; the writer's request (copy.photo) is kept as `photoAsk` so the review screen sees both.
      stories: final.map((r, i) => ({
        lane: r.pick.lane, origin: r.pick.origin, url: r.pick.url, outlet: r.pick.sourceName, major: r.pick.major, ...(r.pick.builder != null ? { builder: r.pick.builder } : {}), net: r.pick.net, lead: leadScores.get(r.pick.key) ?? null, leadIndex: leadAt.get(r.pick.key) ?? i,
        ...r.copy,
        photoAsk: r.copy.photo,
        photo: r.photo,
        photoSource: r.photoSource ?? 'finder',
        photoTrace: r.photoTrace ?? [],
        ...(r.meme ? { meme: { ...r.meme, position: i + 1 } } : {}),
      })),
      render,
      caption: render.caption,
      slideObjects,
      fitProblems,
      renderProblems: [...renderProblemsOf(fit), ...visionProblems],
      short,
    });
    if (seedList.length) {
      const inPost = new Set(final.map((r) => r.pick.key));
      const outcomes = seedList.map((s) => {
        const drop = drops.find((x) => x.key === s.key);
        const repeat = selector.repeats.has(s.key);
        const outcome = inPost.has(s.key)
          ? `in the post${repeat ? ' (the last post already covered it)' : ''}`
          : drop ? `${drop.reason}${drop.detail ? `: ${drop.detail}` : ''}`
          : !taking.some((t) => t.key === s.key) ? `waiting: this run already had ${MAX_SEEDS}`
          : 'not used in this run';
        return { key: s.key, headline: s.headline, url: s.url, outcome, made: inPost.has(s.key), ...(repeat ? { repeat: true } : {}) };
      });
      record.seeds = outcomes;
      try {
        await recordSeedOutcomes(d.query, outcomes.map((o) => ({ key: o.key, outcome: o.outcome, made: o.made })));
      } catch (err) {
        record.seedError = err instanceof Error ? err.message : String(err);
      }
    }
    record.picks = final.map((r) => ({ key: r.pick.key, lane: r.pick.lane, headline: r.pick.headline, origin: r.pick.origin, major: r.pick.major, ...(r.pick.builder != null ? { builder: r.pick.builder } : {}), net: r.pick.net, lead: leadScores.get(r.pick.key) ?? null }));
    record.stories = final.length;
    const spend = d.spend();
    // recorded false: the run row was no longer running (the worker timed it out); it stays failed.
    // Harvest and shared-finder spend (Serper + Haiku looks) is outside the run budget's tally: added here so the run total is whole.
    const recorded = await finishRun(d.query, runId, { status: short ? 'partial' : 'ok', stopReason: short ? `short post: only ${final.length} stories` : undefined, claudeUsd: spend.claudeUsd + harvestBudget.usd + sharedBudget.usd, jevUsd: spend.jevUsd, record });
    return { ok: true, runId, postId, stories: final.length, short, recorded };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    try {
      const spend = d.spend();
      await finishRun(d.query, runId, { status: 'failed', error, claudeUsd: spend.claudeUsd + sharedBudget.usd, jevUsd: spend.jevUsd, record });
    } catch (finishErr) {
      return { ok: false, runId, error: `${error} (recording the failure also failed: ${finishErr instanceof Error ? finishErr.message : String(finishErr)})` };
    }
    return { ok: false, runId, error };
  }
}
