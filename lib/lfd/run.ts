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
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import type { PhotoFinder } from '@/lib/stories/photos';

import { grounded, REWRITE_NOTE } from './ground';
import { findPhotos } from './photos';
import { judgedPool, MIN_STORIES, mergeSameEvent, RUNDOWN_POOL, rundownOrder, scoreMajor, Selector, slideOrder, withoutUsed } from './pick';
import { buildPost } from './post';
import { carouselLane, freshFeedLane, lastCarouselRunAt, reelsLane } from './sources';
import { finishRun, insertPost, previousPosts, recentPhotoUrls, startRun, usedIdeaIds } from './store';
import type { Drop, LfdCandidate, LfdWindow, Pick, Ready, StoryCopy } from './types';
import { extendWindow, windowFor } from './window';
import { writeStories } from './write';

export const MIN_TEXT_CHARS = 500;
export const THIN_CHARS = 1500;
export const MAX_ROUNDS = 4;
const PREVIOUS_POSTS = 2;

export type LfdRunDeps = {
  query: HubQuery;
  jev: JevAsk;
  create: MessagesCreate;
  photos: PhotoFinder;
  fetchFeeds: () => Promise<FetchedArticle[]>;
  fetchBody: FetchBody;
  fitCheck: FitCheck;
  upload: (path: string, body: Buffer) => Promise<void>;
  now: Date;
  trigger: 'scheduled' | 'manual';
  capUsd: number;
  /** Claude and Jev spend so far (the CLI wires the run budget and Jev tally here). */
  spend: () => { claudeUsd: number; jevUsd: number };
};

/** Window start as an instant: midnight NY after `after` is close enough for "runs finished since". */
function windowStartIso(w: LfdWindow): string {
  return `${w.after}T04:00:00Z`;
}

async function gather(d: LfdRunDeps, w: LfdWindow, used: Set<string>) {
  const reels = withoutUsed(await reelsLane(d.query, w), used);
  const carousel = withoutUsed(await carouselLane(d.query, windowStartIso(w)), used);
  const last = await lastCarouselRunAt(d.query);
  const since = new Date(last ?? windowStartIso(w));
  const feed = withoutUsed(await freshFeedLane(d.fetchFeeds, since, d.now).catch(() => []), used);
  const judged = await scoreMajor(judgedPool(carousel, reels, feed), d.jev);
  const judgedKeys = new Set(judged.map((c) => c.key));
  const rundownOnly = [...reels].sort(rundownOrder).filter((c) => !judgedKeys.has(c.key)).slice(0, RUNDOWN_POOL);
  const merged = await mergeSameEvent([...judged.sort((a, b) => (b.major ?? 0) - (a.major ?? 0)), ...rundownOnly], d.jev);
  return {
    majors: merged.filter((c) => c.major !== null),
    rundown: merged.filter((c) => c.origin === 'reels' || c.refs.some((r) => reels.some((x) => x.refs.includes(r)))),
    counts: { reels: reels.length, carousel: carousel.length, feed: feed.length, judged: judged.length },
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

export async function runLastFewDays(d: LfdRunDeps): Promise<{ ok: true; runId: string; postId: string; stories: number; short: boolean } | { ok: false; runId: string; error: string }> {
  const nyDate = nyDateKey(d.now);
  const runId = await startRun(d.query, d.trigger, d.capUsd, nyDate);
  const record: Record<string, unknown> = {};
  try {
    const previous = await previousPosts(d.query, PREVIOUS_POSTS);
    const used = usedIdeaIds(previous);
    let window = windowFor(nyDate, previous[0]?.nyDate ?? null);
    let pools = await gather(d, window, used);
    if (distinctEligible(pools) < MIN_STORIES) {
      window = extendWindow(window);
      pools = await gather(d, window, used);
      record.safetyNet = true;
    }
    record.window = window;
    record.pool = pools.counts;

    const selector = new Selector(pools.majors, pools.rundown, previous[0]?.stories ?? [], d.jev);
    let pending: Pick[] = await selector.fill();
    const ready: Ready[] = [];
    const drops: Drop[] = [];
    const exclude = await recentPhotoUrls(d.query, d.now);

    const replace = async (p: Pick, reason: Drop['reason'], next: Pick[]) => {
      drops.push({ key: p.key, lane: p.lane, reason });
      selector.drop(p.key);
      const r = await selector.replace(p.lane);
      if (r) next.push(r);
    };

    for (let round = 0; round < MAX_ROUNDS && pending.length > 0; round++) {
      const next: Pick[] = [];
      const texts: Array<{ pick: Pick; body: string }> = [];
      for (const p of pending) {
        const body = await fullText(d, p);
        if (body) texts.push({ pick: p, body });
        else await replace(p, 'thin-text', next);
      }
      if (texts.length === 0) { pending = next; continue; }

      const written = await writeStories(d.create, texts);
      if (!written.ok) {
        if (round === 0) throw new Error(`writing failed: ${written.detail}`);
        record.writeFailure = written.detail;
        for (const { pick } of texts) drops.push({ key: pick.key, lane: pick.lane, reason: 'write-failed' });
        break;
      }
      const checked: Array<{ pick: Pick; copy: StoryCopy }> = [];
      for (const { pick, body } of texts) {
        let copy = written.stories.find((s) => s.key === pick.key)!;
        if (!(await grounded(d.jev, copy, body))) {
          const again = await writeStories(d.create, [{ pick, body }], REWRITE_NOTE);
          const retry = again.ok ? again.stories[0] : undefined;
          if (!retry || !(await grounded(d.jev, retry, body))) { await replace(pick, 'not-grounded', next); continue; }
          copy = retry;
        }
        checked.push({ pick, copy });
      }

      const found = await findPhotos(d.photos, checked, new Set([...exclude, ...ready.map((r) => r.photo.src)]));
      for (const [i, item] of checked.entries()) {
        const photo = found[i];
        if (photo) ready.push({ ...item, photo });
        else await replace(item.pick, 'no-photo', next);
      }
      pending = next;
    }

    const order = slideOrder(ready.map((r) => r.pick));
    const final = order.map((p) => ready.find((r) => r.pick.key === p.key)!);
    // Spec §4.1: at most 2 setups per post; replacement rounds can add more than normalize's per-call cap.
    let setups = 0;
    for (const r of final) {
      if (!r.copy.setup) continue;
      setups += 1;
      if (setups > 2) r.copy = { ...r.copy, setup: '' };
    }
    const short = final.length < MIN_STORIES;
    const render = buildPost(final, d.now);
    const taken = (await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM lfd.posts WHERE slug = $1`, [`lfd-${nyDate}`])).rows[0]!.n > 0;
    const slug = taken ? `lfd-${nyDate}-${runId.slice(0, 8)}` : `lfd-${nyDate}`;
    let fit: FitResult | null = null;
    const slideObjects = await storeSlideJpegs(slug, render, {
      prefix: 'lfd',
      fitCheck: async (post, opts) => (fit = await d.fitCheck(post, opts)),
      upload: d.upload,
    });
    const fitProblems = ((fit as FitResult | null)?.problems ?? []).filter((p) => /text fit/.test(p));
    const postId = await insertPost(d.query, {
      runId,
      slug,
      nyDate,
      ideaIds: [...new Set(final.flatMap((r) => [r.pick.key, ...r.pick.refs]))],
      stories: final.map((r) => ({ lane: r.pick.lane, origin: r.pick.origin, url: r.pick.url, outlet: r.pick.sourceName, major: r.pick.major, net: r.pick.net, ...r.copy, photo: r.photo })),
      render,
      caption: render.caption,
      slideObjects,
      fitProblems,
      short,
    });
    record.drops = drops;
    record.stories = final.length;
    const spend = d.spend();
    await finishRun(d.query, runId, { status: short ? 'partial' : 'ok', stopReason: short ? `short post: only ${final.length} stories` : undefined, claudeUsd: spend.claudeUsd, jevUsd: spend.jevUsd, record });
    return { ok: true, runId, postId, stories: final.length, short };
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
