// lib/lfd/run.ts
/**
 * One Last Few Days run (spec §3–§6; the news chain, wiring contract 2026-11-24 Owner E): window candidates →
 * shortlist (Jev R8) → rerank (Opus) → cleanup → walk the rerank order (WC2: 5–6 stories, in rank order, a story
 * without usable media is skipped and replaced from further down) → media per story (golden video → a meme that
 * clears the gate → findStoryPhoto with the lead image and the builder harvest as extra candidates) → the news
 * writer once per round (editor angles from the rerank; its Haiku fact check and one rewrite) → render → vision →
 * JPEGs → a review post. The post is never skipped: fewer than 5 stories saves it marked short.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { nyDateKey } from '@/lib/reels/scoring/decide';
import type { HubQuery } from '@/lib/social-hub/db';
import { markPromoteUsed, recordPromoteSkip, type MovesQuery } from '@/lib/social-hub/moves-store';
import { finishNightPlacements, readNightQueue } from '@/lib/social-hub/queue-store';
import type { ClosingsLog } from '@/lib/social/captions/closings-store';
import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';
import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import type { JevAsk } from '@/lib/social/jev/client';
import { SlideImagesFailed, storeSlideJpegs } from '@/lib/social/overnight/slides';
import type { FitCheck, FitResult } from '@/lib/social/render/fit-check';
import type { PageRead } from '@/lib/social/reporter/read-page';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import type { AddIntakeSeed, IntakeJev, IntakeQuery, ListStories } from '@/lib/intake/types';
import { intakeLanes, type IntakeLaneDeps } from '@/lib/intake/pool-lfd';
import type { PhotoFinder } from '@/lib/stories/photos';
import type { WriterCreate } from '@/lib/stories/writer';
import type { FindOptions, FoundPhotos, PhotoBudget, PhotoDeps, PhotoNeed, PhotoProfile } from '@/lib/photos/types';
import { lfdMedia } from '@/lib/news-ranker/media-ladder';
import { findSpinOffs } from '@/lib/news-ranker/repeats';
import { cleanup, type MediaVerdict } from '@/lib/news-ranker/posts';
import { rerank, type Graded } from '@/lib/news-ranker/rerank';
import { shortlist, SHORTLIST_TOP, type ChainStory } from '@/lib/news-ranker/shortlist';
import { findStoryPhoto, readPageImages, type Candidate, type PhotoJev, type PhotoResult, type PhotoStory } from '@/lib/news-photos';
import { writeStories, type WriterStory, type Written } from '@/lib/news-writer';
import type { VideoFind } from '@/lib/video-finder/find';

import { LFD_CAPTION_VERSION, writeLfdCaptionLines } from './caption-lines';
import { makeLfdAiCover, type LfdAiCoverResult } from './cover';
import type { FalImage, FalWait } from './cover/fal-image';
import { MEME_POOL_SCAN } from './config';
import { leadImage } from './lead-image';
import { articleCopy, BUILDER_HARVEST_CAP_USD, harvestBuilderPhoto, NO_PHOTO_REQUEST, type BuilderHarvest, type HarvestBudget } from './photos';
import { applyLfdQueue, coveredBy, type LfdQueue, judgedPool, leadFor, LineupWalk, MAX_SEEDS, MAX_STORIES, MIN_STORIES, pairNames, RUNDOWN_POOL, rundownOrder, scoreUnscoredSeeds, withoutUsed } from './pick';
import { arrangeMemes, buildPost, composeCaption, coverMemeOf, nextLfdCanvas, nextLfdCoverHook } from './post';
import { readArchivedKeys, readOpenSeeds, recordSeedOutcomes, seedCandidate, type LfdSeed } from './seeds';
import { carouselLane, freshFeedLane, lastCarouselRunAt, reelsLane } from './sources';
import { adoptRun, finishRun, insertPost, previousPosts, recentPhotoLedger, startRun, usedIdeaIds } from './store';
import { usedReason, type GuardDeps } from '@/lib/photos/used-guard';
import type { Drop, EngineMeme, LfdCandidate, LfdSavedVideo, LfdVideoPick, LfdWindow, Pick, Ready, StoryCopy } from './types';
import { LFD_VIDEO_CONCURRENCY, posterDataUrl, videoCheck, videoCredit, videoSlug, type LfdSlideVideo, type LfdVideoDeps } from './video';
import { checkSlide, VISION_UNAVAILABLE, type SlideVerdict } from './vision';
import { extendWindow, windowFor } from './window';
import { normalize, ordinalKey } from './write';

export const MIN_TEXT_CHARS = 500;
export const THIN_CHARS = 1500;
export const MAX_ROUNDS = 4;
const PREVIOUS_POSTS = 2;
/** Each lane queue's head kept in the run record (spec §8 Ideas view). */
const QUEUE_TOP = 10;

/** The hub's idea id for a Last Few Days story is `last_few_days:story:<key>` (lib/social-hub/adapters/last-few-days.ts). */
export const LFD_STORY_IDEA = 'last_few_days:story:';
/** Why a pinned story could not go on tonight's post (shown on the pin in the hub). */
export const LFD_PIN_GONE = 'the story is not among this run’s candidates (outside the window, already posted, or merged into another)';

export type LfdRunDeps = {
  query: HubQuery;
  /**
   * The hub's queue by story key (pins, drags, archives; Tommy, 2026-11-16: Last Few Days follows the queue). Absent:
   * read from social_hub.idea_adjustments (never for a replay); an unreadable moves table is an empty queue.
   */
  queue?: LfdQueue & { readAt?: Date };
  jev: JevAsk;
  create: MessagesCreate;
  /**
   * Not called by the run since the news chain (findStoryPhoto replaced the Stories finder). Still required because
   * the LFD lab's progress wrapper (lib/memes/lfd-sim/report.ts) wraps it; drop it once that file stops.
   */
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
   * How the used-photo guard (CI-32, lib/photos/used-guard.ts) downloads and hashes a lead image to check it against
   * the ledger's published pictures. Absent (tests, replays): the lead image's URL is checked only.
   */
  usedPhotos?: GuardDeps;
  /**
   * Real footage (MD-LFD D16–D19, lib/lfd/video.ts). Present: every lineup story and every story in the scan window
   * (MEME_POOL_SCAN) is video-checked; a golden clip takes the slide before any photo (the ladder: golden video → a
   * meme that clears the gate → photo), a golden story in the window replaces the lowest-ranked photo-only slide, and
   * each video slide is made into an MP4 after the final render (a failure takes the next rung). Absent (tests,
   * replays, a machine without yt-dlp or the keys): today's run, unchanged.
   */
  video?: LfdVideoDeps;
  /**
   * The news photo finder's clients (lib/news-photos findStoryPhoto): the TypeSafe image client, Serper image search
   * and the image fetcher. `create` (Haiku brief + AI check) defaults to the run's `create`; live wires its own so the
   * photo spend is added to the run total once. Absent (and no `news.findPhoto`): no photo rung.
   */
  newsPhotos?: { jev: PhotoJev; serper: ((q: string) => Promise<string[]>) | null; fetchImage: (url: string) => Promise<Buffer | null>; create?: WriterCreate; minShortSide?: number };
  /** The news chain's steps; tests stub them. Defaults: lib/news-ranker shortlist/rerank, lib/news-writer writeStories, findStoryPhoto. */
  news?: LfdNewsChain;
  /**
   * The AI cover (PLAN.md C7, lib/lfd/cover): fal (GPT Image 2.6 edit) and the fetch for reference photos and the result.
   * Absent: no AI image (the hook still rotates and the cover draws as before). The writer uses the run's `create`.
   */
  aiCover?: { fal: FalImage | null; fetch: (input: string, init?: RequestInit) => Promise<Response>; wait?: FalWait };
};

/** The chain steps a run calls; each defaults to the shared module. `findPhoto` gets the run's ledger check as `usedReason`. */
export type LfdNewsChain = {
  shortlist?: typeof shortlist;
  rerank?: typeof rerank;
  write?: typeof writeStories;
  findPhoto?: (s: PhotoStory, o: { extra: Candidate[]; usedReason: (src: string) => Promise<string | null> }) => Promise<PhotoResult>;
};

/** The shared finder's wiring (the revisions screen's LFD photo swap; the run itself uses findStoryPhoto). `find` / `need` default to lib/photos/find.ts and lib/photos/needs.ts (tests inject them). */
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

async function gather(d: LfdRunDeps, w: LfdWindow, used: Set<string>, seeds: LfdCandidate[] = [], mode: IntakeMode = 'legacy') {
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
  // A machine candidate with a seed's own key or a shared source id is the seed (its source ids are carried over).
  // In intake mode a seed also carries its intake story id: the lane candidate for that story is the seed too.
  const seedKeys = new Set(seeds.map((s) => s.key));
  const seedRefs = new Set(seeds.flatMap((s) => s.refs.filter((r) => r !== s.key)));
  const isSeedOf = (s: LfdCandidate, c: LfdCandidate) => c.key === s.key || c.refs.some((r) => r !== s.key && s.refs.includes(r));
  const forced = seeds.map((s) => ({ ...s, refs: [...new Set([...s.refs, ...[...reels, ...carousel, ...feed].filter((c) => isSeedOf(s, c)).flatMap((c) => c.refs)])] }));
  const notSeed = (list: LfdCandidate[]) => (seedKeys.size ? list.filter((c) => !seedKeys.has(c.key) && !c.refs.some((r) => seedRefs.has(r))) : list);
  // The window's candidates as today: the judged pool (carousel tops, reels per night, the fresh feed) plus the
  // reels rundown pool. The shortlist scores them all; no lane scores (major-news) are asked for any more.
  const pool = judgedPool(notSeed(carousel), notSeed(reels), notSeed(feed));
  const poolKeys = new Set(pool.map((c) => c.key));
  const rundownOnly = notSeed([...reels]).sort(rundownOrder).filter((c) => !poolKeys.has(c.key)).slice(0, RUNDOWN_POOL);
  return {
    candidates: distinctStories([...pool, ...rundownOnly]),
    /** The person's seeds, walked before the reranked list. */
    forced,
    counts: { reels: reels.length, carousel: carousel.length, feed: feed.length, judged: pool.length },
    feedError,
    /** Set when the intake read failed and this gather took today's lanes instead. */
    intakeError,
  };
}

/** One story per key and per shared source id, first one wins. */
function distinctStories(list: LfdCandidate[]): LfdCandidate[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const ids = [c.key, ...c.refs];
    if (ids.some((id) => seen.has(id))) return false;
    ids.forEach((id) => seen.add(id));
    return true;
  });
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

/**
 * Video slides into Storage (D19): each poster replaces its data URL in the stories and the saved render (as the run's
 * memes do); a made MP4 and its band clip are uploaded, and the slide's JPEG is replaced by a frame of the MP4 so
 * review shows what posts. Returns the saved video per story key (an upload failure leaves that slide a still).
 */
async function persistVideos(
  ready: Ready[],
  slug: string,
  render: { slides?: Array<{ photoUrl?: string; lfdCover?: { photos?: Array<{ url: string }> } }> },
  slideObjects: string[],
  made: (r: Ready) => LfdSlideVideo | undefined,
  upload: LfdRunDeps['upload'],
  log: Array<{ key: string; ok: boolean; seconds?: number; fit?: string; error?: string }>,
): Promise<Map<string, LfdSavedVideo>> {
  const saved = new Map<string, LfdSavedVideo>();
  for (const [i, r] of ready.entries()) {
    if (r.photoSource !== 'video' || !r.video) continue;
    const video = made(r);
    const name = `lfd/${slug}/video-${videoSlug(r.pick.key)}`;
    if (r.photo.src.startsWith('data:')) {
      const data = r.photo.src;
      await upload(`${name}.jpg`, Buffer.from(data.replace(/^data:image\/jpeg;base64,/, ''), 'base64'), 'image/jpeg');
      const stored = `storage:${name}.jpg`;
      r.photo = { ...r.photo, src: stored };
      for (const slide of render.slides ?? []) {
        if (slide.photoUrl === data) slide.photoUrl = stored;
        for (const p of slide.lfdCover?.photos ?? []) if (p.url === data) p.url = stored;
      }
    }
    if (!video) {
      log.push({ key: r.pick.key, ok: false, error: 'no MP4: the slide posts its still' });
      continue;
    }
    try {
      await upload(`${name}.mp4`, video.mp4, 'video/mp4');
      await upload(`${name}-band.mp4`, video.band, 'video/mp4');
      const jpeg = slideObjects[i + 1];
      if (jpeg) await upload(jpeg, video.still, 'image/jpeg');
      saved.set(r.pick.key, { object: `${name}.mp4`, band: `${name}-band.mp4`, seconds: video.seconds, fit: video.fit, tier: 'golden', sourceUrl: r.video.sourceUrl, check: videoCheck({ ...r.copy, photo: r.photo }) });
      log.push({ key: r.pick.key, ok: true, seconds: video.seconds, fit: video.fit });
    } catch (err) {
      log.push({ key: r.pick.key, ok: false, error: `upload failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return saved;
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

/** At most this many vision calls at once. */
const VISION_PARALLEL = 3;

async function inPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/** The window as the reranker's user turn names it (WC8): the NY dates the post covers. */
export function windowLabel(w: LfdWindow): string {
  const first = new Date(`${w.after}T12:00:00Z`);
  first.setUTCDate(first.getUTCDate() + 1);
  const from = first.toISOString().slice(0, 10);
  return from === w.through ? w.through : `${from} to ${w.through}`;
}

/** A story the reranker did not grade (a seed, a pin, or every story when the rerank call failed): zero grades, no angle. */
function ungraded(s: ChainStory): Graded {
  return { ...s, cool: 0, value: 0, final: 0, grade: { cool: 0, value: 0, duplicate_of: null, top_tier: false, crowds: [], angle: '' } };
}

const toChainStory = (c: LfdCandidate): ChainStory => ({
  id: c.key, headline: c.headline, text: c.body, outlets: [...new Set([c.sourceName, ...c.alsoFrom].filter(Boolean))], published: c.publishedAt, url: c.url,
});

/** Source text the writer sees per story (as the old writer's SOURCE_CHARS). */
const WRITER_SOURCE_CHARS = 9000;

/** The writer's story as slide copy: no setup (WC10), names from code, no writer photo request; normalize trims as before. */
function copyOf(key: string, w: Written): StoryCopy {
  return normalize([{ key, setup: '', headline: w.headline, highlight: w.highlight, names: w.names, body: w.body, photo: NO_PHOTO_REQUEST }], [key])[0]!;
}

export async function runLastFewDays(d: LfdRunDeps): Promise<{ ok: true; runId: string; postId: string; stories: number; short: boolean; recorded?: boolean } | { ok: false; runId: string; error: string }> {
  const nyDate = nyDateKey(d.now);
  const runId = d.runId ? await adoptRun(d.query, d.runId, d.capUsd, nyDate) : await startRun(d.query, d.trigger, d.capUsd, nyDate);
  const record: Record<string, unknown> = {};
  // The news photo finder's spend for this post (Haiku brief + AI check, Jev grades, Serper): outside the run budget's tally.
  const photoRecord: { usd: number; stories: Array<{ key: string; tier: MediaVerdict; source: string | null }> } = { usd: 0, stories: [] };
  // Builder-slide harvests share one budget per post (round 3: $0.15).
  const harvestBudget: HarvestBudget = { usd: 0, capUsd: BUILDER_HARVEST_CAP_USD };
  // The AI cover's fal image spend: outside the run budget's tally (its Jev and writer calls go through the run's).
  let coverImageUsd = 0;
  let jevCalls = 0;
  const jev: JevAsk = (req, meta) => {
    jevCalls += 1;
    record.jevCalls = jevCalls;
    return d.jev(req, meta);
  };
  // One read per article page per run: the lead image, the photo finder and any later use share it.
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
  // The shared modules take a plain Messages create; the run's create (and its budget) answers it.
  const create: WriterCreate = (p) => d.create(p as unknown as Anthropic.MessageCreateParamsNonStreaming);
  const chain = { shortlist: d.news?.shortlist ?? shortlist, rerank: d.news?.rerank ?? rerank, write: d.news?.write ?? writeStories };
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
    // At most MAX_SEEDS to a post; the rest wait.
    const taking = seedList.slice(0, MAX_SEEDS);
    const seedCandidates = mode === 'intake'
      ? await intakeSeeds(d, taking, taking.map(seedCandidate), record).catch((err: unknown) => {
        record.intakeSeedErrors = [err instanceof Error ? err.message : String(err)];
        return taking.map(seedCandidate);
      })
      : taking.map(seedCandidate);
    let window = windowFor(nyDate, previous[0]?.nyDate ?? null);
    let pools = await gather(run, window, used, seedCandidates, mode);
    if (pools.intakeError) {
      // The intake read failed: today's lanes for the rest of this run.
      mode = 'legacy';
      record.intake = 'error-fallback';
      record.intakeError = pools.intakeError;
    }
    if (pools.forced.length + pools.candidates.length < MIN_STORIES) {
      window = extendWindow(window);
      pools = await gather(run, window, used, seedCandidates, mode);
      record.safetyNet = true;
    }
    record.window = window;
    record.pool = pools.counts;
    if (pools.feedError) record.feedError = pools.feedError;
    // A seed with no stored score (outside intake mode, or one the intake could not add) gets one major-news call, so
    // the lane bar decides its lane as before. A seed that carries intake scores makes no call. A failed call: rundown.
    const seedScoreErrors: string[] = [];
    pools = { ...pools, forced: await scoreUnscoredSeeds(jev, pools.forced, (key, err) => seedScoreErrors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`)) };
    if (seedScoreErrors.length) record.seedScoreErrors = seedScoreErrors;

    // The hub's queue: pins are a person's call (walked after the seeds); archives leave; drags and demotes move a
    // story within the rerank order (applyLfdQueue over one list).
    const movesQ = d.query as unknown as MovesQuery;
    const night = d.queue ?? (d.replay ? undefined : await readNightQueue(movesQ, 'last_few_days', LFD_STORY_IDEA));
    const queued = night && (night.pins.length || night.placed.size || night.archived.size || night.demoted?.size) ? night : undefined;
    const q0 = queued ? applyLfdQueue([], pools.candidates, queued) : { rundown: pools.candidates, pinned: [] as Array<{ c: LfdCandidate }> };
    const pinned = q0.pinned.map((p) => p.c);
    if (night && (night.pins.length || night.placed.size || night.archived.size)) {
      const found = new Set(pinned.flatMap((c) => [c.key, ...c.refs]));
      const gone = night.pins.filter((id) => !found.has(id));
      record.queue = { pinned: pinned.map((c) => c.key), pinsGone: gone, placed: night.placed.size, archived: night.archived.size };
      for (const id of gone) await recordPromoteSkip(movesQ, 'last_few_days', `${LFD_STORY_IDEA}${id}`, LFD_PIN_GONE);
    }

    // Shortlist (Jev R8) over the window, rerank (Opus) of its top, cleanup (duplicates and crowds).
    const byKey = new Map<string, LfdCandidate>([...q0.rundown, ...pinned, ...pools.forced].map((c) => [c.key, c]));
    const sl = await chain.shortlist(q0.rundown.map(toChainStory), { jev, component: 'lfd' });
    // Own-repeat exclusion (WC6) before the rerank: a shortlisted story about an event the last post covered is out,
    // whatever its article. Seeds and pins are not shortlisted, so they bypass it (the walk still flags them).
    const lastPost = previous[0]?.stories ?? [];
    const shortTop = sl.ranked.slice(0, SHORTLIST_TOP);
    const covered = await findSpinOffs(shortTop.map((s) => ({ id: s.id, headline: s.headline, text: byKey.get(s.id)!.body })), lastPost, { jev, component: 'prev', names: pairNames });
    const top = shortTop.filter((s) => !covered.hits.has(s.id));
    let graded: Graded[];
    let rerankError: string | undefined;
    let rerankUsd = 0;
    try {
      const rr = await chain.rerank(top, { create, windowLabel: windowLabel(window) });
      graded = rr.graded;
      rerankUsd = rr.costUsd;
    } catch (err) {
      // A failed rerank never takes the post down: the shortlist's order stands, with no angles.
      rerankError = err instanceof Error ? err.message : String(err);
      graded = top.map(ungraded);
    }
    const { kept, merged } = cleanup(graded);
    const gradedById = new Map(graded.map((g) => [g.id, g]));
    const rankOrder = (queued ? applyLfdQueue([], kept.map((g) => byKey.get(g.id)!), queued).rundown : kept.map((g) => byKey.get(g.id)!));
    record.rerank = {
      shortlisted: sl.ranked.length,
      shortlistUsd: sl.costUsd,
      ...(covered.hits.size ? { repeats: [...covered.hits].map(([key, p]) => ({ key, headline: byKey.get(key)!.headline, covered: p.headline })) } : {}),
      reranked: graded.length,
      usd: rerankUsd,
      kept: kept.map((g) => ({ key: g.id, headline: g.headline, cool: g.grade.cool, value: g.grade.value, topTier: g.grade.top_tier })),
      duplicates: [...merged].flatMap(([into, dups]) => dups.map((x) => ({ key: x.id, into }))),
      ...(rerankError ? { error: rerankError } : {}),
    };
    // `builder` only when scored (intake), so a legacy record keeps today's shape. The Ideas view reads these by lane.
    const queueRow = (c: LfdCandidate) => ({ key: c.key, headline: c.headline, major: c.major, net: c.net, ...(c.builder != null ? { builder: c.builder } : {}) });
    const laneOf = (c: LfdCandidate) => leadFor(c, d.now)?.lane ?? 'rundown';
    record.queues = {
      major: rankOrder.filter((c) => laneOf(c) === 'major').slice(0, QUEUE_TOP).map(queueRow),
      builder: rankOrder.filter((c) => laneOf(c) === 'builder').slice(0, QUEUE_TOP).map(queueRow),
      rundown: rankOrder.filter((c) => laneOf(c) === 'rundown').slice(0, QUEUE_TOP).map(queueRow),
    };
    // Walk order: the person's seeds, then pins, then the rerank order. One story per key and shared source id.
    const walkOrder = distinctStories([...pools.forced, ...pinned, ...rankOrder]).map((c) => gradedById.get(c.key) ?? ungraded(toChainStory(c)));
    const rankOf = new Map(walkOrder.map((g, i) => [g.id, i]));
    const personal = new Set([...pools.forced, ...pinned].map((c) => c.key));
    const repeats = new Set<string>();

    const ready: Ready[] = [];
    const drops: Drop[] = [];
    record.drops = drops;
    const writerRecord: { usd: number; over: string[]; log: string[] } = { usd: 0, over: [], log: [] };
    record.writer = writerRecord;
    const vision = { checked: 0, rejected: 0, unavailable: 0, usd: 0 };
    record.vision = vision;
    /** Verdicts by story key + photo: a slide unchanged since the last render is not looked at again. */
    const verdicts = new Map<string, SlideVerdict>();
    // CI-32: photos published in the last 20 days, by URL (the exclude set) and by picture (the ledger's hashes).
    // Bald-Eagle D3: the day's earlier post still waiting in review is what this run replaces; its photos don't count.
    const { waitingItemsOn } = await import('@/lib/photos/pending');
    const ledger = await recentPhotoLedger(d.query, d.now, undefined, { excludeItem: await waitingItemsOn((text, params) => d.query(text, params), 'lfd', nyDate) });
    const exclude = new Set(ledger.urls);
    /** Every photo this post holds or has given a story: no photo twice in one post. */
    const postPhotos = new Set<string>();
    const harvestRecord: { usd: number; slides: Array<{ key: string; found: boolean }> } = { usd: 0, slides: [] };
    if (d.harvest) record.photoHarvest = harvestRecord;
    record.photos = photoRecord;
    const memesRecord: {
      rescued: Array<{ key: string; headline: string; templateId: string }>;
      scanned: Array<{ key: string; headline: string; pass: boolean }>;
      added: { key: string; headline: string; templateId: string } | null;
      costUsd: number;
    } = { rescued: [], scanned: [], added: null, costUsd: 0 };
    if (d.memes) record.memes = memesRecord;

    // Real footage (D16–D19). With no `d.video` nothing here runs.
    const videoRecord: {
      checked: Array<{ key: string; headline: string; tier: VideoFind['tier']; usd: number; where: 'lineup' | 'window' }>;
      slides: Array<{ key: string; ok: boolean; seconds?: number; fit?: string; error?: string; fallback?: 'meme' | 'photo' | 'dropped' }>;
      costUsd: number;
    } = { checked: [], slides: [], costUsd: 0 };
    if (d.video) record.video = videoRecord;
    /** One video check per story per run, whichever stage asks first. A finder error or the cap reached means no clip. */
    const videoFinds = new Map<string, Promise<VideoFind | null>>();
    const findVideo = (s: Pick | LfdCandidate, where: 'lineup' | 'window'): Promise<VideoFind | null> => {
      let p = videoFinds.get(s.key);
      if (!p) {
        const v = d.video!;
        p = (async () => {
          if (v.spent().usd >= v.capUsd) return null;
          const f = await v.find({ id: s.key, headline: s.headline, url: s.url, body: s.body, eventDate: s.eventDate }).catch(() => null);
          videoRecord.checked.push({ key: s.key, headline: s.headline, tier: f?.tier ?? 'none', usd: f?.costUsd ?? 0, where });
          videoRecord.costUsd = v.spent().usd;
          return f;
        })();
        videoFinds.set(s.key, p);
      }
      return p;
    };
    const isGolden = (f: VideoFind | null | undefined) => Boolean(f?.clip) && lfdMedia({ video: f!.tier, meme: false, photo: false }) === 'video';
    /** The ladder's first rung (lfdMedia): a golden clip makes the story a video slide, its poster the slide's photo. */
    const asVideo = (pick: Pick, copy: StoryCopy, f: VideoFind | null | undefined): Ready | null => {
      if (!f?.clip || !isGolden(f)) return null;
      const c = f.clip;
      let src: string;
      try {
        src = posterDataUrl(c.poster);
      } catch {
        return null;
      }
      const video: LfdVideoPick = { tier: 'golden', file: c.file, poster: c.poster, sourceUrl: c.sourceUrl, channel: c.channel, site: c.site, len: c.len };
      return { pick, copy, photo: { src, credit: videoCredit(c), kind: 'scene' }, photoSource: 'video', photoTrace: [`video: golden clip ${c.sourceUrl}`], video };
    };

    const storyText = (copy: StoryCopy) => [copy.setup, copy.body].filter(Boolean).join(' ');
    const rescuedReady = new Map<string, Ready>();
    /** The meme rung after writing: the gate on the written copy, then the meme. Null: no meme. */
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
      return kept;
    };

    // The photo rung: findStoryPhoto with the article's lead image and (builder stories) AI Drama's harvest as extra
    // candidates. One story at a time, so two slides never take the same picture.
    const photoDeps = d.newsPhotos;
    const findPhoto: NonNullable<LfdNewsChain['findPhoto']> | null = d.news?.findPhoto
      ?? (photoDeps
        ? (s, o) => findStoryPhoto(s, { create: photoDeps.create ?? create, jev: photoDeps.jev, serper: photoDeps.serper, fetchImage: photoDeps.fetchImage, readPage: readPageImages(readPage), usedReason: o.usedReason, ...(photoDeps.minShortSide !== undefined ? { minShortSide: photoDeps.minShortSide } : {}) }, { extra: o.extra })
        : null);
    let photoQueue: Promise<unknown> = Promise.resolve();
    const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
      const p = photoQueue.then(fn);
      photoQueue = p.catch(() => undefined);
      return p;
    };
    const photoFor = (pick: Pick, why: string[] = []): Promise<{ photo: Ready['photo']; tier: MediaVerdict; source: 'lead' | 'harvest' | 'finder'; trace: string[] } | { photo: null; trace: string[] }> => oneAtATime(async () => {
      const trace = [...why];
      if (!findPhoto) return { photo: null, trace: [...trace, 'photo: no photo finder wired'] };
      const taken = new Set([...exclude, ...postPhotos]);
      const extra: Candidate[] = [];
      const lead = await leadImage(readPage, pick, taken);
      if (lead) {
        extra.push({ src: lead.photo.src, source: 'extra', credit: lead.photo.credit });
        trace.push(lead.note);
      }
      let harvested: string | null = null;
      if (d.harvest && pick.lane === 'builder') {
        const got = await harvestBuilderPhoto(d.harvest, pick, articleCopy(pick), taken, harvestBudget, d.now, ledger);
        harvestRecord.slides.push({ key: pick.key, found: got.photo !== null });
        harvestRecord.usd = harvestBudget.usd;
        trace.push(...got.trace);
        if (got.photo) {
          harvested = got.photo.src;
          extra.push({ src: got.photo.src, source: 'extra', credit: got.photo.credit });
        }
      }
      const story: PhotoStory = { id: pick.key, headline: pick.headline, text: pick.body, url: pick.url, duplicateUrls: (merged.get(pick.key) ?? []).map((x) => x.url) };
      const check = async (src: string) => (taken.has(src) ? 'already on this post or published recently' : usedReason(ledger, { url: src, kind: 'scene' }, d.usedPhotos ?? {}));
      let res: PhotoResult;
      try {
        res = await findPhoto(story, { extra, usedReason: check });
      } catch (err) {
        return { photo: null, trace: [...trace, `photo: failed: ${err instanceof Error ? err.message : String(err)}`] };
      }
      photoRecord.usd += res.costUsd;
      photoRecord.stories.push({ key: pick.key, tier: res.tier, source: res.pick?.source ?? null });
      trace.push(...res.log.map((l) => `photo: ${l}`));
      if (!res.pick || res.tier === 'none') return { photo: null, trace };
      postPhotos.add(res.pick.src);
      const source = res.pick.src === lead?.photo.src ? 'lead' : res.pick.src === harvested ? 'harvest' : 'finder';
      return { photo: { src: res.pick.src, credit: res.pick.credit, kind: 'scene' }, tier: res.tier, source, trace };
    });

    /** Media found for a walked story before it is written (the ladder's rung, and what it found). */
    type Slot = { pick: Pick; media: 'video' | 'meme' | 'photo'; video?: VideoFind | null; photo?: Ready['photo']; photoSource?: 'lead' | 'harvest' | 'finder'; photoTrace: string[] };
    const slots = new Map<string, Slot>();
    const drop = (p: Pick | LfdCandidate, lane: Pick['lane'], reason: Drop['reason'], detail?: string) => {
      drops.push({ key: p.key, lane, headline: p.headline, reason, ...(detail ? { detail } : {}) });
    };
    /** The pick for a story: its full text, its lane (for the hub and the builder harvest), and its reranked duplicates' ids and outlets. */
    const pickOf = (c: LfdCandidate, body: string): Pick => {
      const dups = (merged.get(c.key) ?? []).map((g) => byKey.get(g.id)).filter((x): x is LfdCandidate => Boolean(x));
      return {
        ...c,
        body,
        lane: laneOf(c),
        refs: [...new Set([...c.refs, ...dups.flatMap((x) => [x.key, ...x.refs])])],
        alsoFrom: [...new Set([...c.alsoFrom, ...dups.flatMap((x) => [x.sourceName, ...x.alsoFrom])])].filter((s) => s && s !== c.sourceName),
      };
    };

    /** WC2 walk step for one story: the last post's events out, full text, then the media ladder. */
    const resolve = async (g: Graded): Promise<MediaVerdict> => {
      const c = byKey.get(g.id)!;
      // A machine story the last post covered never reached the rerank. A person's seed or pin is taken anyway, and the run says so.
      if (personal.has(c.key) && (await coveredBy(jev, lastPost, c))) repeats.add(c.key);
      const body = await fullText(d, c);
      if (!body) {
        drop(c, laneOf(c), 'thin-text');
        return 'none';
      }
      const pick = pickOf(c, body);
      if (d.video) {
        const f = await findVideo(pick, 'lineup');
        if (isGolden(f)) {
          slots.set(c.key, { pick, media: 'video', video: f, photoTrace: [] });
          return 'good';
        }
      }
      if (d.memes) {
        // The gate before writing (the scan's preview, on the article): the written copy is gated again before the meme is made.
        const pass = await d.memes.clears({ key: c.key, headline: c.headline, text: body }, { assumeShort: true });
        if (pass) {
          slots.set(c.key, { pick, media: 'meme', photoTrace: [] });
          return 'good';
        }
      }
      const got = await photoFor(pick);
      if (!got.photo) {
        drop(pick, pick.lane, 'no-photo', got.trace.at(-1));
        return 'none';
      }
      slots.set(c.key, { pick, media: 'photo', photo: got.photo, photoSource: got.source, photoTrace: got.trace });
      return got.tier;
    };
    const walk = new LineupWalk(walkOrder, resolve, LFD_VIDEO_CONCURRENCY);

    /**
     * The writer over some stories (ordinal keys, so long feed keys never reach the model). A call that throws falls
     * back to one call per story, so one bad story can't sink the rest. Returns the copy by story key.
     */
    const writeSome = async (picks: Pick[]): Promise<{ copies: Map<string, StoryCopy>; failed: string | null }> => {
      const copies = new Map<string, StoryCopy>();
      const once = async (list: Pick[]) => {
        const stories: WriterStory[] = list.map((p, i) => ({ key: ordinalKey(i), headline: p.headline, text: p.body.slice(0, WRITER_SOURCE_CHARS) }));
        const angles = Object.fromEntries(list.map((p, i) => [ordinalKey(i), gradedById.get(p.key)?.grade.angle ?? '']));
        const res = await chain.write('lfd', stories, angles, { create });
        writerRecord.usd += res.costUsd;
        writerRecord.log.push(...res.log);
        const real = (k: string) => list[Number(k.slice(1)) - 1]!;
        for (const w of res.written) copies.set(real(w.key).key, copyOf(real(w.key).key, w));
        for (const x of res.dropped) {
          const p = real(x.key);
          drop(p, p.lane, /missing/.test(x.reason) ? 'write-failed' : 'not-grounded', x.reason);
        }
        for (const k of res.over) writerRecord.over.push(real(k).key);
      };
      try {
        await once(picks);
        return { copies, failed: null };
      } catch (err) {
        const failed = err instanceof Error ? err.message : String(err);
        record.writeFailure = failed;
        if (picks.length === 1) {
          drop(picks[0]!, picks[0]!.lane, 'write-failed', failed);
          return { copies, failed };
        }
        for (const p of picks) {
          try {
            await once([p]);
          } catch (e) {
            drop(p, p.lane, 'write-failed', e instanceof Error ? e.message : String(e));
          }
        }
        return { copies, failed };
      }
    };

    /** A video slide that can't be one takes the ladder's next rung: a meme that clears the gate, then a photo. Null: neither. */
    const videoFallback = async (item: { pick: Pick; copy: StoryCopy }, why: string): Promise<Ready | null> => {
      const meme = await rescueWithMeme(item);
      if (meme) {
        memesRecord.rescued.push({ key: item.pick.key, headline: item.copy.headline, templateId: meme.meme!.templateId });
        return meme;
      }
      const got = await photoFor(item.pick, [why]);
      return got.photo ? { pick: item.pick, copy: item.copy, photo: got.photo, photoSource: got.source, photoTrace: got.trace } : null;
    };

    /** One writing round: the stories the walk took are written together, then each takes its rung's media. */
    const writeRound = async (keys: string[], round: number): Promise<void> => {
      const taken = keys.map((k) => slots.get(k)!);
      const { copies, failed } = await writeSome(taken.map((s) => s.pick));
      if (round === 0 && copies.size === 0 && failed) throw new Error(`writing failed: ${failed}`);
      for (const s of taken) {
        const copy = copies.get(s.pick.key);
        if (!copy) continue;
        const item = { pick: s.pick, copy };
        if (s.media === 'video') {
          const v = asVideo(s.pick, copy, s.video);
          const r = v ?? (await videoFallback(item, 'video poster could not be read'));
          if (r) ready.push(r);
          else drop(s.pick, s.pick.lane, 'no-photo', 'the video poster could not be read and no meme or photo was found');
          continue;
        }
        if (s.media === 'meme') {
          const m = await rescueWithMeme(item);
          if (m) {
            memesRecord.rescued.push({ key: s.pick.key, headline: copy.headline, templateId: m.meme!.templateId });
            ready.push(m);
            continue;
          }
          // The written copy failed the gate (or no meme came back): the photo rung.
          const got = await photoFor(s.pick, ['meme: the written copy did not clear the gate or no meme was made']);
          if (got.photo) ready.push({ ...item, photo: got.photo, photoSource: got.source, photoTrace: got.trace });
          else drop(s.pick, s.pick.lane, 'no-photo', got.trace.at(-1));
          continue;
        }
        ready.push({ ...item, photo: s.photo!, photoSource: s.photoSource, photoTrace: s.photoTrace });
      }
    };

    /** Fill to MAX_STORIES from the walk, one writer call per round. */
    const fill = async (rounds: number, first = 0) => {
      for (let round = first; round < first + rounds; round++) {
        const need = MAX_STORIES - ready.length;
        if (need <= 0) return;
        const keys = await walk.take(need);
        if (!keys.length) return;
        await writeRound(keys, round);
      }
    };
    await fill(MAX_ROUNDS);

    /**
     * The one-meme-story scan (D16/D19): when no slide is a meme, the next stories down the rerank order (up to
     * MEME_POOL_SCAN) are gated; the first that clears is written and made, and takes the lowest-ranked photo slide's
     * place when the post is full (never a video or meme slide, a person's seed or a pin).
     */
    const photoVictim = (): Ready | undefined =>
      [...ready].sort((a, b) => (rankOf.get(b.pick.key) ?? 0) - (rankOf.get(a.pick.key) ?? 0))
        .find((r) => r.photoSource !== 'video' && r.photoSource !== 'meme' && !personal.has(r.pick.key));
    const scanAddMemeStory = async (): Promise<void> => {
      if (!d.memes || ready.some((r) => r.photoSource === 'meme')) return;
      if (ready.length >= MAX_STORIES && !photoVictim()) return;
      for (const g of walk.upcoming(MEME_POOL_SCAN)) {
        const c = byKey.get(g.id)!;
        const preview = await d.memes.clears({ key: c.key, headline: c.headline, text: c.body }, { assumeShort: true });
        memesRecord.scanned.push({ key: c.key, headline: c.headline, pass: preview });
        if (!preview) continue;
        walk.claim(g.id);
        if (personal.has(c.key) && (await coveredBy(jev, lastPost, c))) continue;
        const body = await fullText(d, c);
        if (!body) continue;
        const pick = pickOf(c, body);
        const { copies } = await writeSome([pick]);
        const copy = copies.get(pick.key);
        if (!copy) continue;
        const m = await rescueWithMeme({ pick, copy });
        if (!m) continue;
        if (ready.length >= MAX_STORIES) {
          const victim = photoVictim();
          if (!victim) return;
          ready.splice(ready.indexOf(victim), 1);
          drop(victim.pick, victim.pick.lane, 'meme-story', `the post's meme story took its slot: ${copy.headline}`);
        }
        ready.push(m);
        memesRecord.added = { key: c.key, headline: copy.headline, templateId: m.meme!.templateId };
        return;
      }
    };
    await scanAddMemeStory();

    /** Rerank order is final (no lead judgment): the slides follow the walk order. */
    const finalOrder = (): Ready[] => [...ready].sort((a, b) => (rankOf.get(a.pick.key) ?? 0) - (rankOf.get(b.pick.key) ?? 0));

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
     * vision check rejected throws before anything is uploaded; without it, vision rejections are only recorded
     * (a failed image always throws, from storeSlideJpegs; see renderClean).
     */
    // Design profile and hook: the ones after the last kept post's (lib/lfd/post.ts LFD_CANVASES, LFD_COVER_HOOKS).
    const prevPost = (
      await d.query<{ canvas: string | null; hook: string | null }>(
        `SELECT render->'slides'->0->>'canvas' AS canvas, render->'slides'->0->'lfdCover'->'hook'->>'text' AS hook FROM lfd.posts WHERE status <> 'rejected' AND slug <> $1 ORDER BY ny_date DESC, created_at DESC LIMIT 1`,
        [slug],
      )
    ).rows[0];
    const canvas = nextLfdCanvas(prevPost?.canvas ?? null, !!prevPost);
    const prevHook = prevPost?.hook ?? null;
    // The AI cover's image once it is made (after the stories are final); every render before that draws today's cover.
    let coverImage: { url: string } | undefined;
    const renderAndStore = async (final: Ready[], replaceBroken: boolean, coverMeme?: { url: string }) => {
      const coverHook = nextLfdCoverHook(prevHook, final.length);
      const render = buildPost(final, d.now, undefined, { ...(coverMeme && !coverImage ? { coverMeme } : {}), canvas, coverHook, ...(coverImage ? { coverImage } : {}) });
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
    let placed = place(finalOrder());
    let final = placed.ready;
    if (final.length === 0) throw new Error('no stories survived');
    // A post never ships a broken image: storeSlideJpegs refuses one before uploading. A story whose image still
    // fails to load is dropped and the post re-rendered; an image no story owns fails the run.
    const renderClean = async (replaceBroken: boolean) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await renderAndStore(final, replaceBroken, placed.coverMeme);
        } catch (err) {
          if (!(err instanceof SlideImagesFailed) || attempt >= 2) throw err;
          const keys = brokenImageKeys(err.fit, final);
          if (!keys.length) throw err;
          for (const key of keys) {
            const [gone] = ready.splice(ready.findIndex((r) => r.pick.key === key), 1);
            if (gone) drops.push({ key, lane: gone.pick.lane, headline: gone.pick.headline, reason: 'image-failed', detail: 'the image still failed to load at the final render' });
          }
          placed = place(final.filter((r) => !keys.includes(r.pick.key)));
          final = placed.ready;
          if (final.length === 0) throw new Error('no stories survived');
        }
      }
    };
    let rendered: Awaited<ReturnType<typeof renderAndStore>>;
    try {
      rendered = await renderClean(true);
    } catch (err) {
      if (!(err instanceof BrokenImages)) throw err;
      // One extra round: each story whose photo failed to load or was rejected gets one more photo search (its
      // picture excluded); a video slide takes the ladder's next rung; a story with nothing is dropped and the walk
      // fills its slot from further down. Then re-render (whatever fails then is recorded).
      const take = (key: string) => {
        const [gone] = ready.splice(ready.findIndex((r) => r.pick.key === key), 1);
        exclude.add(gone!.photo.src);
        return gone!;
      };
      const leave = [...err.keys.map((key) => ({ key, reason: 'image-failed' as const, detail: undefined })), ...err.rejected.map((x) => ({ key: x.key, reason: 'vision-rejected' as const, detail: x.reason }))];
      for (const { key, reason, detail } of leave) {
        const gone = take(key);
        if (gone.photoSource === 'meme') { ready.push(gone); continue; }
        const why = reason === 'image-failed' ? 'failed to load' : `rejected by vision: ${detail ?? ''}`;
        if (gone.photoSource === 'video') {
          const fb = await videoFallback(gone, `video poster ${why}`);
          videoRecord.slides.push({ key, ok: false, error: reason, fallback: fb ? (fb.photoSource === 'meme' ? 'meme' : 'photo') : 'dropped' });
          if (fb) ready.push(fb);
          else drop(gone.pick, gone.pick.lane, reason, detail);
          continue;
        }
        const again = await photoFor(gone.pick, [`photo ${why}: ${gone.photo.src}`]);
        if (again.photo) ready.push({ pick: gone.pick, copy: gone.copy, photo: again.photo, photoSource: again.source, photoTrace: again.trace });
        else drop(gone.pick, gone.pick.lane, reason, detail ? `${detail}; no other photo was found` : 'no other photo was found');
      }
      await fill(1, MAX_ROUNDS);
      await scanAddMemeStory();
      placed = place(finalOrder());
      final = placed.ready;
      if (final.length === 0) throw new Error('no stories survived');
      rendered = await renderClean(false);
    }

    // D19: each video slide becomes an MP4 now that its layout is final. A failure takes the ladder's next rung (meme,
    // then photo) and the post renders again; a video never fails the post. MP4s are kept by slide content, so a
    // re-render that leaves a video slide unchanged doesn't make it twice.
    const composed = new Map<string, LfdSlideVideo>();
    const composeKey = (r: Ready) => [r.pick.key, r.copy.setup, r.copy.headline, r.copy.body, r.photo.src.length, canvas].join('\u0000');
    if (d.video) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const failed: Array<{ r: Ready; error: string }> = [];
        for (const [i, r] of final.entries()) {
          if (r.photoSource !== 'video' || !r.video || composed.has(composeKey(r))) continue;
          try {
            composed.set(composeKey(r), await d.video.slide({ post: rendered.render, position: i + 1, clip: r.video }));
          } catch (err) {
            failed.push({ r, error: err instanceof Error ? err.message : String(err) });
          }
        }
        videoRecord.costUsd = d.video.spent().usd;
        if (!failed.length) break;
        for (const { r, error } of failed) {
          const at = ready.findIndex((x) => x.pick.key === r.pick.key);
          if (at < 0) continue;
          const fb = await videoFallback(r, `the video slide failed: ${error}`);
          videoRecord.slides.push({ key: r.pick.key, ok: false, error, fallback: fb ? (fb.photoSource === 'meme' ? 'meme' : 'photo') : 'dropped' });
          if (fb) ready[at] = fb;
          else {
            ready.splice(at, 1);
            drops.push({ key: r.pick.key, lane: r.pick.lane, headline: r.pick.headline, reason: 'no-photo', detail: `the video slide failed (${error}) and no meme or photo was found` });
          }
        }
        placed = place(finalOrder());
        final = placed.ready;
        if (final.length === 0) throw new Error('no stories survived');
        rendered = await renderClean(false);
      }
    }

    // The AI cover (C7), once, now that the stories are final. It replaces a meme cover too (the meme keeps its own
    // story slide); any failure keeps today's cover (meme or mosaic) and records why. With an image, the post renders once more.
    let aiCover: LfdAiCoverResult;
    {
      aiCover = await makeLfdAiCover(
        {
          jev,
          create: d.create,
          fal: d.aiCover?.fal ?? null,
          fetch: d.aiCover?.fetch ?? ((input, init) => fetch(input, init)),
          upload: d.upload,
          remainingUsd: () => {
            const s = d.spend();
            return d.capUsd - s.claudeUsd - s.jevUsd - coverImageUsd;
          },
          ...(d.aiCover?.wait ? { wait: d.aiCover.wait } : {}),
        },
        {
          stories: final.map((r) => ({ headline: r.copy.headline, body: r.copy.body })),
          photos: final.filter((r) => r.photoSource !== 'meme').map((r) => ({ url: r.photo.src, headline: r.copy.headline, kind: r.photo.kind })),
          prevHook,
          storyCount: final.length,
          objectPath: `lfd/${slug}/cover-ai-${runId.slice(0, 8)}.jpg`,
        },
      );
      coverImageUsd += aiCover.imageUsd;
      if (aiCover.image) {
        coverImage = { url: aiCover.image.url };
        try {
          rendered = await renderClean(false);
        } catch (err) {
          coverImage = undefined;
          aiCover = { ...aiCover, image: undefined, fallback: `the AI cover did not render: ${err instanceof Error ? err.message : String(err)}` };
          rendered = await renderClean(false);
        }
      }
    }
    record.cover = {
      hook: aiCover.hook.text,
      direction: aiCover.direction ?? null,
      prompt: aiCover.prompt ?? null,
      references: aiCover.references ?? null,
      image: aiCover.image ? `storage:${aiCover.image.object}` : null,
      fallback: aiCover.fallback ?? null,
      usd: aiCover.costUsd,
      imageUsd: aiCover.imageUsd,
    };

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
    if (shipped.by === 'model' && caption.lines) await d.closings?.record(runId, caption.lines.question, false);
    const render = { ...rendered.render, caption: shipped.caption };
    // The post row keeps the stored cover image, never the data URL the render drew.
    const coverSlide = render.slides[0];
    if (aiCover.image && coverSlide?.lfdCover?.image) coverSlide.lfdCover.image = { url: `storage:${aiCover.image.object}` };
    await persistEngineMemes(final, slug, render, d.upload);
    const savedVideos = await persistVideos(final, slug, render, slideObjects, (r) => composed.get(composeKey(r)), d.upload, videoRecord.slides);
    const short = final.length < MIN_STORIES;
    const fitProblems = (fit?.problems ?? []).filter((p) => /text fit/.test(p));
    const rerankOf = (key: string) => {
      const g = gradedById.get(key);
      return g ? { cool: g.grade.cool, value: g.grade.value, topTier: g.grade.top_tier } : null;
    };
    const postId = await insertPost(d.query, {
      runId,
      slug,
      nyDate,
      ideaIds: [...new Set(final.flatMap((r) => [r.pick.key, ...r.pick.refs]))],
      // `photo` is the result; `photoAsk` (the old writer's photo request) is empty since the news writer.
      stories: final.map((r, i) => ({
        lane: r.pick.lane, origin: r.pick.origin, url: r.pick.url, outlet: r.pick.sourceName, major: r.pick.major, ...(r.pick.builder != null ? { builder: r.pick.builder } : {}), net: r.pick.net, lead: null, rerank: rerankOf(r.pick.key), leadIndex: leadAt.get(r.pick.key) ?? i,
        ...r.copy,
        photoAsk: r.copy.photo,
        photo: r.photo,
        photoSource: r.photoSource ?? 'finder',
        photoTrace: r.photoTrace ?? [],
        ...(r.meme ? { meme: { ...r.meme, position: i + 1 } } : {}),
        ...(savedVideos.has(r.pick.key) ? { video: savedVideos.get(r.pick.key) } : {}),
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
        const dropped = drops.find((x) => x.key === s.key);
        const repeat = repeats.has(s.key);
        const outcome = inPost.has(s.key)
          ? `in the post${repeat ? ' (the last post already covered it)' : ''}`
          : dropped ? `${dropped.reason}${dropped.detail ? `: ${dropped.detail}` : ''}`
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
    record.picks = final.map((r) => ({ key: r.pick.key, lane: r.pick.lane, headline: r.pick.headline, origin: r.pick.origin, major: r.pick.major, ...(r.pick.builder != null ? { builder: r.pick.builder } : {}), net: r.pick.net, rerank: rerankOf(r.pick.key) }));
    record.stories = final.length;
    // The queue's moves on the stories this post used are spent; a scheduled run uses up the placements it read.
    if (night) {
      const hand = new Set([...night.pins, ...night.placed.keys()]);
      for (const r of final) {
        for (const id of new Set([r.pick.key, ...r.pick.refs])) if (hand.has(id)) await markPromoteUsed(movesQ, 'last_few_days', `${LFD_STORY_IDEA}${id}`);
      }
      if (d.trigger === 'scheduled') await finishNightPlacements(movesQ, 'last_few_days', undefined, night.readAt);
    }
    const spend = d.spend();
    // The video finder's Haiku + Serper (and the band's boxes) sit outside the run budget too; its Jev part goes to Jev.
    const videoSpend = d.video?.spent() ?? { usd: 0, jevUsd: 0 };
    videoRecord.costUsd = videoSpend.usd;
    // recorded false: the run row was no longer running (the worker timed it out); it stays failed.
    // Harvest and photo-finder spend (Serper, Haiku, Jev grades) is outside the run budget's tally: added here so the run total is whole.
    const recorded = await finishRun(d.query, runId, { status: short ? 'partial' : 'ok', stopReason: short ? `short post: only ${final.length} stories` : undefined, claudeUsd: spend.claudeUsd + harvestBudget.usd + photoRecord.usd + coverImageUsd + (videoSpend.usd - videoSpend.jevUsd), jevUsd: spend.jevUsd + videoSpend.jevUsd, record });
    return { ok: true, runId, postId, stories: final.length, short, recorded };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    try {
      const spend = d.spend();
      const videoSpend = d.video?.spent() ?? { usd: 0, jevUsd: 0 };
      await finishRun(d.query, runId, { status: 'failed', error, claudeUsd: spend.claudeUsd + harvestBudget.usd + photoRecord.usd + coverImageUsd + (videoSpend.usd - videoSpend.jevUsd), jevUsd: spend.jevUsd + videoSpend.jevUsd, record });
    } catch (finishErr) {
      return { ok: false, runId, error: `${error} (recording the failure also failed: ${finishErr instanceof Error ? finishErr.message : String(finishErr)})` };
    }
    return { ok: false, runId, error };
  }
}
