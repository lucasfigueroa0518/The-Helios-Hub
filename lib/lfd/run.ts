// lib/lfd/run.ts
/**
 * One Last Few Days run (spec §3–§6): window → sources → pick → full text →
 * write → fact check → photos → render → JPEGs → a review post. A story that
 * fails a step is replaced from its own lane, then the rundown. The post is
 * never skipped: fewer than 5 stories saves it marked short.
 */
import { MAJOR_NEWS_BAR } from '@/lib/stories/build/morning-download';
import { nyDateKey } from '@/lib/reels/scoring/decide';
import type { HubQuery } from '@/lib/social-hub/db';
import type { FetchedArticle } from '@/lib/social/ingest/fetch-feeds';
import type { FetchBody } from '@/lib/social/ingest/select/enrich';
import type { JevAsk } from '@/lib/social/jev/client';
import { storeSlideJpegs } from '@/lib/social/overnight/slides';
import type { FitCheck, FitResult } from '@/lib/social/render/fit-check';
import type { PageRead } from '@/lib/social/reporter/read-page';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import type { PhotoFinder } from '@/lib/stories/photos';

import { grounded, REWRITE_NOTE } from './ground';
import { leadImage } from './lead-image';
import { findPhotos, REFUSED_ICON_SCENE } from './photos';
import { judgedPool, MIN_STORIES, mergeSameEvent, RUNDOWN_POOL, rundownOrder, scoreMajor, Selector, slideOrder, withoutUsed } from './pick';
import { buildPost } from './post';
import { carouselLane, freshFeedLane, lastCarouselRunAt, reelsLane } from './sources';
import { adoptRun, finishRun, insertPost, previousPosts, recentPhotoUrls, startRun, usedIdeaIds } from './store';
import type { Drop, LfdCandidate, LfdWindow, Pick, Ready, StoryCopy } from './types';
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
  upload: (path: string, body: Buffer) => Promise<void>;
  now: Date;
  trigger: 'scheduled' | 'manual';
  capUsd: number;
  /** Claude and Jev spend so far (the CLI wires the run budget and Jev tally here). */
  spend: () => { claudeUsd: number; jevUsd: number };
  /** A run the worker already claimed (lfd.runs status running): it is adopted instead of inserting a new row. */
  runId?: string;
};

/** Window start as an instant: midnight NY after `after` is close enough for "runs finished since". */
function windowStartIso(w: LfdWindow): string {
  return `${w.after}T04:00:00Z`;
}

async function gather(d: LfdRunDeps, w: LfdWindow, used: Set<string>, known: ReadonlyMap<string, number> = new Map()) {
  const reels = withoutUsed(await reelsLane(d.query, w), used);
  const carousel = withoutUsed(await carouselLane(d.query, windowStartIso(w)), used);
  const last = await lastCarouselRunAt(d.query);
  const since = new Date(last ?? windowStartIso(w));
  let feedError: string | undefined;
  const fresh = await freshFeedLane(d.fetchFeeds, since, d.now).catch((err: unknown) => {
    feedError = err instanceof Error ? err.message : String(err);
    return [];
  });
  const feed = withoutUsed(fresh, used);
  const judged = await scoreMajor(judgedPool(carousel, reels, feed), d.jev, known);
  const judgedKeys = new Set(judged.map((c) => c.key));
  const rundownOnly = [...reels].sort(rundownOrder).filter((c) => !judgedKeys.has(c.key)).slice(0, RUNDOWN_POOL);
  const merged = await mergeSameEvent([...judged.sort((a, b) => (b.major ?? 0) - (a.major ?? 0)), ...rundownOnly], d.jev);
  return {
    majors: merged.filter((c) => c.major !== null),
    rundown: merged.filter((c) => c.origin === 'reels' || c.refs.some((r) => reels.some((x) => x.refs.includes(r)))),
    counts: { reels: reels.length, carousel: carousel.length, feed: feed.length, judged: judged.length },
    /** Every major-news score judged so far, by key: a re-gather reuses these instead of judging again. */
    scores: new Map([...known, ...judged.map((c) => [c.key, c.major ?? 0] as const)]),
    feedError,
  };
}

/** Distinct stories that could be picked: above-bar majors plus the rundown, deduped by key and shared refs. */
function distinctEligible(pools: { majors: LfdCandidate[]; rundown: LfdCandidate[] }): number {
  const seen = new Set<string>();
  let n = 0;
  for (const c of [...pools.majors.filter((m) => (m.major ?? 0) >= MAJOR_NEWS_BAR), ...pools.rundown]) {
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
    const previous = await previousPosts(d.query, PREVIOUS_POSTS);
    const used = usedIdeaIds(previous);
    let window = windowFor(nyDate, previous[0]?.nyDate ?? null);
    let pools = await gather(run, window, used);
    if (distinctEligible(pools) < MIN_STORIES) {
      window = extendWindow(window);
      pools = await gather(run, window, used, pools.scores);
      record.safetyNet = true;
    }
    record.window = window;
    record.pool = pools.counts;
    if (pools.feedError) record.feedError = pools.feedError;

    const selector = new Selector(pools.majors, pools.rundown, previous[0]?.stories ?? [], jev);
    const queueRow = (c: LfdCandidate) => ({ key: c.key, headline: c.headline, major: c.major, net: c.net });
    record.queues = { major: selector.top('major', QUEUE_TOP).map(queueRow), rundown: selector.top('rundown', QUEUE_TOP).map(queueRow) };
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
    const exclude = await recentPhotoUrls(d.query, d.now);

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
        if (body) texts.push({ pick: p, body });
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
      const leads: Array<Awaited<ReturnType<typeof leadImage>>> = [];
      for (const item of checked) {
        const lead = await leadImage(readPage, item.pick, taken);
        if (lead) taken.add(lead.photo.src);
        leads.push(lead);
      }
      const rest = checked.filter((_, i) => !leads[i]);
      const found = await findPhotos(d.photos, rest, taken);
      let k = 0;
      for (const [i, item] of checked.entries()) {
        const lead = leads[i];
        if (lead) {
          ready.push({ ...item, photo: lead.photo, photoSource: 'lead', photoTrace: [lead.note] });
          continue;
        }
        const photo = found.photos[k];
        const photoTrace = found.traces[k] ?? [];
        k += 1;
        if (photo) ready.push({ ...item, photo, photoSource: 'finder', photoTrace });
        else await replace(item.pick, 'no-photo', next, photoTrace.includes(REFUSED_ICON_SCENE) ? REFUSED_ICON_SCENE : undefined);
      }
      return next;
    };

    const unfinished = (left: Pick[]) => {
      for (const p of left) drops.push({ key: p.key, lane: p.lane, headline: p.headline, reason: 'unfinished' });
    };
    for (let round = 0; round < MAX_ROUNDS && pending.length > 0; round++) pending = await runRound(pending, round);
    unfinished(pending);

    const finalOrder = (): Ready[] => {
      const order = slideOrder(ready.map((r) => r.pick));
      const final = order.map((p) => ready.find((r) => r.pick.key === p.key)!);
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
    const renderAndStore = async (final: Ready[], replaceBroken: boolean) => {
      const render = buildPost(final, d.now);
      let fit: FitResult | null = null;
      const visionProblems: string[] = [];
      const slideObjects = await storeSlideJpegs(slug, render, {
        prefix: 'lfd',
        fitCheck: async (post, opts) => {
          const result = await d.fitCheck(post, opts);
          fit = result;
          const broken = replaceBroken ? brokenImageKeys(result, final) : [];
          const rejected = opts?.screenshotDir ? await visionCheck(final, opts.screenshotDir, new Set(broken)) : [];
          if (replaceBroken && (broken.length || rejected.length)) throw new BrokenImages(broken, rejected.map((x) => ({ key: x.r.pick.key, reason: x.reason })));
          visionProblems.push(...rejected.map((x) => `vision: ${x.r.copy.headline}: ${x.reason}`));
          return result;
        },
        upload: d.upload,
      });
      return { render, slideObjects, fit: fit as FitResult | null, visionProblems };
    };

    let final = finalOrder();
    if (final.length === 0) throw new Error('no stories survived');
    let rendered: Awaited<ReturnType<typeof renderAndStore>>;
    try {
      rendered = await renderAndStore(final, true);
    } catch (err) {
      if (!(err instanceof BrokenImages)) throw err;
      // One extra round: drop each story whose photo failed to load or was rejected, replace it, re-render (whatever fails then is recorded).
      // A rejected article lead image first gets one finder search for the same story; only if that finds nothing is the story dropped.
      const next: Pick[] = [];
      const take = (key: string) => {
        const [gone] = ready.splice(ready.findIndex((r) => r.pick.key === key), 1);
        exclude.add(gone!.photo.src);
        return gone!;
      };
      const isLead = (key: string) => ready.find((r) => r.pick.key === key)?.photoSource === 'lead';
      const leadRejected = err.rejected.filter((x) => isLead(x.key)).map((x) => ({ gone: take(x.key), reason: x.reason }));
      const leave = [...err.keys.map((key) => ({ key, reason: 'image-failed' as const, detail: undefined })), ...err.rejected.filter((x) => !leadRejected.some((l) => l.gone.pick.key === x.key)).map((x) => ({ key: x.key, reason: 'vision-rejected' as const, detail: x.reason }))];
      for (const { key, reason, detail } of leave) await replace(take(key).pick, reason, next, detail);
      if (leadRejected.length) {
        const again = await findPhotos(d.photos, leadRejected.map(({ gone }) => ({ pick: gone.pick, copy: gone.copy })), new Set([...exclude, ...ready.map((r) => r.photo.src)]));
        for (const [j, { gone, reason }] of leadRejected.entries()) {
          const photo = again.photos[j];
          const photoTrace = [`lead image rejected by vision: ${reason}: ${gone.photo.src}`, ...(again.traces[j] ?? [])];
          if (photo) ready.push({ pick: gone.pick, copy: gone.copy, photo, photoSource: 'finder', photoTrace });
          else await replace(gone.pick, 'vision-rejected', next, photoTrace.includes(REFUSED_ICON_SCENE) ? `${reason}; finder: ${REFUSED_ICON_SCENE}` : `${reason}; the finder found no photo`);
        }
      }
      if (next.length) unfinished(await runRound(next, MAX_ROUNDS));
      final = finalOrder();
      if (final.length === 0) throw new Error('no stories survived');
      rendered = await renderAndStore(final, false);
    }

    const { render, slideObjects, fit, visionProblems } = rendered;
    const short = final.length < MIN_STORIES;
    const fitProblems = (fit?.problems ?? []).filter((p) => /text fit/.test(p));
    const postId = await insertPost(d.query, {
      runId,
      slug,
      nyDate,
      ideaIds: [...new Set(final.flatMap((r) => [r.pick.key, ...r.pick.refs]))],
      // `photo` is the result; the writer's request (copy.photo) is kept as `photoAsk` so the review screen sees both.
      stories: final.map((r) => ({
        lane: r.pick.lane, origin: r.pick.origin, url: r.pick.url, outlet: r.pick.sourceName, major: r.pick.major, net: r.pick.net,
        ...r.copy,
        photoAsk: r.copy.photo,
        photo: r.photo,
        photoSource: r.photoSource ?? 'finder',
        photoTrace: r.photoTrace ?? [],
      })),
      render,
      caption: render.caption,
      slideObjects,
      fitProblems,
      renderProblems: [...renderProblemsOf(fit), ...visionProblems],
      short,
    });
    record.picks = final.map((r) => ({ key: r.pick.key, lane: r.pick.lane, headline: r.pick.headline, origin: r.pick.origin, major: r.pick.major, net: r.pick.net }));
    record.stories = final.length;
    const spend = d.spend();
    // recorded false: the run row was no longer running (the worker timed it out); it stays failed.
    const recorded = await finishRun(d.query, runId, { status: short ? 'partial' : 'ok', stopReason: short ? `short post: only ${final.length} stories` : undefined, claudeUsd: spend.claudeUsd, jevUsd: spend.jevUsd, record });
    return { ok: true, runId, postId, stories: final.length, short, recorded };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    try {
      const spend = d.spend();
      await finishRun(d.query, runId, { status: 'failed', error, claudeUsd: spend.claudeUsd, jevUsd: spend.jevUsd, record });
    } catch (finishErr) {
      return { ok: false, runId, error: `${error} (recording the failure also failed: ${finishErr instanceof Error ? finishErr.message : String(finishErr)})` };
    }
    return { ok: false, runId, error };
  }
}
