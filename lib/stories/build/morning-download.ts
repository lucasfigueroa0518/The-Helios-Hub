/**
 * Helios Morning Download (plan §5.1; S-03, S-14, S-15, S-22, S-29), on the locked news chain
 * (planning/MD-LFD Revisions/WIRING-CONTRACT.md, Phase 2 Owner D, 2026-11-24).
 *
 *   pool       the series' open ideas in stories.pool (lib/stories/pool.ts); drop what another set of the same date
 *              holds (R13). Intake mode: one intake story's reels and carousel sides are one story (code, no Jev)
 *   develop    Bald-Eagle 2026-11-12 (D2, D5; WC6): a story we ran (its intake story at any age; a key-only story in
 *              the last SAID_DAYS days) is a candidate again only with articles first seen after it posted and
 *              md-development@1 `new_event` ≥ DEVELOPMENT_BAR; it then carries what we already said
 *              (lib/stories/md-development.ts), which the writer reads as we_already_said
 *   outlets    intake mode: the big direct-feed outlets carrying each story in the last 24 h (lib/intake/outlets.ts),
 *              shown to the shortlist with the story's own outlets
 *   shortlist  lib/news-ranker/shortlist: one Jev R8 call per story, best first; the top SHORTLIST_TOP go on
 *   spin-offs  lib/news-ranker/repeats (SAME_EVENT): a top story that is a different article about a story we ran
 *              goes through the development test above and stays out unless it is a real new development
 *   rerank     lib/news-ranker/rerank (news-rerank@1, Opus): grades, duplicates, crowds, top tier, the editor's angle;
 *              the window label is the New York date
 *   cleanup    lib/news-ranker/posts: duplicates and crowds out (their URLs feed the photo finder); the first
 *              CHECK_DEPTH are checked for media
 *   media      per checked story in parallel: lib/news-photos findStoryPhoto (the carousel's own photo, S-29, joins
 *              as an extra candidate; the used-photo ledger and size floor hold, WC12) and the video finder
 *   verdict    WC3: golden video, good photo or good video → good; usable photo → usable; else none
 *   choose     choosePosts: walk in rerank order, stop at the first story that is not top tier, post top-tier stories
 *              with good media; under 2, usable (then media-less, WC5) checked stories fill in rank order. A golden
 *              video never carries a story past the top-tier stop (WC1)
 *   write      lib/news-writer writeStories('md'): blind angles → the editor's angles → write → Haiku fact check, one
 *              rewrite for failed facts and over-cap copy (WC9). The frame reads "<headline>. <body>" so the
 *              renderer bolds the headline; the source line is code's ("via <outlet>")
 *   frames     the media ladder (golden video → photo → good video, mdMedia); a photo is fitted to the band
 *              (fitToBand: decideBand + bandFrame) and stored, Photo.contained set (the renderer's CONTAINED_FADE).
 *              The cover peeks at the story photos and rotates its headline (MC14, MC16)
 */
import crypto from 'node:crypto';

import { checkWindow, choosePosts, cleanup, type MediaVerdict } from '@/lib/news-ranker/posts';
import { rerank, RERANK_ID, RERANK_MODEL } from '@/lib/news-ranker/rerank';
import { findSpinOffs } from '@/lib/news-ranker/repeats';
import { shortlist, SHORTLIST_ID, SHORTLIST_TOP, type ChainStory } from '@/lib/news-ranker/shortlist';
import { keepWithMedia, mdMedia, type MdMedia } from '@/lib/news-ranker/media-ladder';
import { leadOf, MAJOR_NEWS_BAR } from '@/lib/news-ranker/scores';
import { offerToBank } from '@/lib/news-photos/bank-offer';
import { fitToBand, findStoryPhoto, type BandFit, type Candidate, type GradedPhoto, type PhotoResult } from '@/lib/news-photos';
import { WRITER_ID, WRITER_MODEL, writeStories } from '@/lib/news-writer';
import { nextOpenerPromise } from '@/lib/stories/render/copy';
import type { FrameData, Photo, StoryData } from '@/lib/stories/render/types';
import { recordCost, sameDayKeys, type NewCandidate } from '@/lib/stories/repository';
import { morningDownloadCarousel, recentPhotoUses } from '@/lib/stories/sources/carousel';
import { dedupe, morningDownloadReels, type StoryCandidate } from '@/lib/stories/sources/reels';
import { OUTLET_WINDOW_HOURS, outletCounts, type OutletSignal } from '@/lib/intake/outlets';
import { developmentTest, newArticlesSince, readWhatWeSaid, saidAbout, type Said } from '@/lib/stories/md-development';
import { MD_VIDEO_CONCURRENCY } from '@/lib/stories/video';
import type { VideoFind } from '@/lib/video-finder/find';
import { lastOpenerPromise, nextBackdrop, openerDate, shortIds, toFrames, type BuildDeps, type BuildResult, type NewsChainDeps } from './common';

// The weights, bars and namesIn live in lib/news-ranker/scores.ts (shared with LFD and the intake); re-exported for old importers.
export { GROUNDING_BAR, MAJOR_NEWS_BAR, MAJOR_NEWS_WEIGHTS, namesIn, SAME_EVENT_BAR, majorNewsScore } from '@/lib/news-ranker/scores';
export const MAX_STORIES = 5;
export const MIN_STORIES = 2;
/** The old intake lead queue's builder limit; kept for scripts/intake/replay.ts and its tests, not on the build path. */
export const MAX_BUILDERS = 2;
const BODY_CHARS = 9000; // ~1,500 words (plan §5.1)
/** Stories whose photo is looked for at once (each grades its candidates in parallel). */
const PHOTO_CONCURRENCY = 4;
/** The band photo's signed URL lives this long (the render reads it; the frame's own JPEG replaces it after). */
const PHOTO_URL_SEC = 7 * 86_400;

/** What bandPhotoFor needs: the original's fetcher, the band's Jev, the upscaler, a temp dir and the stories bucket. */
export type BandPhotoDeps = {
  fetchImage: (url: string) => Promise<Buffer | null>;
  jev: import('@/lib/news-photos').PhotoJev;
  upscaler: import('@/lib/news-photos/band').PhotoUpscaler | null;
  tmpDir: string;
  storage: Pick<import('@/lib/stories/storage').StoriesStorage, 'upload' | 'sign'>;
};

/**
 * The band photo (D24 revised, WC11) for a picked photo: the original (else the graded JPEG) fitted with fitToBand
 * (decideBand), stored under the set and signed; `contained` for the renderer's CONTAINED_FADE. `onFit` sees the fit
 * (its Jev cost) before the upload. Shared by the build and the Social Hub's photo swap. Throws on a failure.
 */
export async function bandPhotoFor(pick: Pick<GradedPhoto, 'src' | 'credit' | 'jpeg'>, d: BandPhotoDeps, setId: string, storyKey: string, onFit?: (fit: BandFit) => Promise<unknown> | void): Promise<{ photo: Photo; step: string }> {
  const original = await d.fetchImage(pick.src).catch(() => null);
  const fit = await fitToBand(original ?? pick.jpeg, { jev: d.jev, upscaler: d.upscaler, tmpDir: d.tmpDir });
  await onFit?.(fit);
  const slug = crypto.createHash('sha1').update(`${storyKey} ${pick.src}`).digest('hex').slice(0, 12);
  const path = `sets/${setId}/photos/${slug}.jpg`;
  await d.storage.upload(path, fit.jpeg, 'image/jpeg');
  const src = await d.storage.sign(path, PHOTO_URL_SEC);
  return {
    photo: { src, sourceUrl: pick.src, credit: pick.credit, kind: 'scene', ...(fit.contained ? { contained: true } : {}) },
    step: `band: ${fit.contained ? 'contained' : 'cover'}${fit.upscaled ? ', upscaled' : ''}${fit.note ? ` (${fit.note})` : ''}`,
  };
}

export type Sources = { reels: () => Promise<StoryCandidate[]>; carousel: () => Promise<StoryCandidate[]> };

/* ── The pre-chain picks (S-04, Bald-Eagle D6). Not on the build path since the news chain (2026-11-24); kept for
   scripts/intake/replay.ts and the lab tests that compare against them. ── */

/** S-04: every story that clears the bar, up to 5; fewer than 2 clear → the top 2 anyway. */
export function chooseStories<T extends { score: number }>(ranked: T[]): T[] {
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const clear = sorted.filter((c) => c.score >= MAJOR_NEWS_BAR).slice(0, MAX_STORIES);
  return clear.length >= MIN_STORIES ? clear : sorted.slice(0, MIN_STORIES);
}

type Leadable = { score: number; intake?: StoryCandidate['intake'] };

/** The lane a story leads in (intake mode): its major score against the major bar, its builder score against the builder bar. */
export function leadFor(c: Leadable, now: Date) {
  return leadOf({ major: c.score, builder: c.intake?.builder ?? null, eventDate: c.intake?.eventDate ? new Date(c.intake.eventDate) : null }, now);
}

/** Intake mode: the stories that lead in a lane, best margin first. */
export function leadQueue<T extends Leadable>(ranked: T[], now: Date): Array<{ c: T; lead: NonNullable<ReturnType<typeof leadFor>> }> {
  return ranked
    .map((c) => ({ c, lead: leadFor(c, now) }))
    .filter((x): x is { c: T; lead: NonNullable<ReturnType<typeof leadFor>> } => x.lead !== null)
    .sort((a, b) => b.lead.margin - a.lead.margin);
}

/** One lead queue, up to 5, builders at most MAX_BUILDERS; fewer than 2 lead → the best major scores fill to 2. */
export function chooseLeads<T extends Leadable & { key?: string }>(ranked: T[], now: Date, order?: readonly string[]): T[] {
  const at = (c: { key?: string }) => {
    const i = order && c.key !== undefined ? order.indexOf(c.key) : -1;
    return i < 0 ? Infinity : i;
  };
  const queue = leadQueue(ranked, now).sort((a, b) => at(a.c) - at(b.c) || b.lead.margin - a.lead.margin);
  const picked: T[] = [];
  let builders = 0;
  for (const { c, lead } of queue) {
    if (picked.length >= MAX_STORIES) break;
    if (lead.lane === 'builder') {
      if (builders >= MAX_BUILDERS) continue;
      builders++;
    }
    picked.push(c);
  }
  if (picked.length >= MIN_STORIES) return picked;
  const rest = [...ranked].sort((a, b) => b.score - a.score).filter((c) => !picked.includes(c));
  return [...picked, ...rest].slice(0, MIN_STORIES);
}

/* ── The build ── */

async function eachLimited<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]!); }));
}

/** A story we ran that is back for a new event (Bald-Eagle D2): what we said, the new articles' text, the Jev reading. */
type Returning = { said: Said; text: string; newEvent: number };

/** The intake stories a candidate stands for: its own and, for a development of a story we ran, that story's. */
function storyIdsOf(c: StoryCandidate, r: Returning | undefined): string[] {
  return [...new Set([c.intake?.storyId, r?.said.storyId].filter((x): x is string => Boolean(x)))];
}

/** The source text the chain reads: a returning story's new articles first, then its own text. */
function textOf(c: StoryCandidate, returning: ReadonlyMap<string, Returning>): string {
  const r = returning.get(c.key);
  return r ? `New since we ran it:\n${r.text}\n\nEarlier coverage:\n${c.body}` : c.body;
}

/** Intake mode: two candidates of one intake story (its reels and its carousel side) are one story, merged in code (no Jev). */
function mergeSameIntakeStory(pool: StoryCandidate[]): StoryCandidate[] {
  const first = new Map<string, StoryCandidate>();
  const out: StoryCandidate[] = [];
  for (const c of pool) {
    const id = c.intake?.storyId;
    const keep = id ? first.get(id) : undefined;
    if (!keep) {
      if (id) first.set(id, c);
      out.push(c);
      continue;
    }
    // The carousel side comes first (photo, outlets); the reels side adds its outlet and blockbuster.
    keep.alsoFrom = [...(keep.alsoFrom ?? []), c.sourceName];
    keep.blockbuster = Math.max(keep.blockbuster ?? 0, c.blockbuster ?? 0);
    if (!keep.photo && c.photo) keep.photo = c.photo;
  }
  return out;
}

/** WC3: the media verdict the walk reads. A golden or good video counts as good (it never reorders); a usable photo is usable. */
export function mdVerdict(m: { video: VideoFind['tier'] | 'none'; photo: GradedPhoto['tier'] | 'none' }): MediaVerdict {
  if (m.video === 'golden' || m.photo === 'good' || m.video === 'good') return 'good';
  if (m.photo === 'usable') return 'usable';
  return 'none';
}

/** The frame's line: the writer's headline (a final period added if missing) then its body, so splitLead bolds the headline. */
export function frameCopy(headline: string, body: string): string {
  const h = headline.trim();
  return `${/[.!?]["”’)]?$/.test(h) ? h : `${h}.`} ${body.trim()}`.trim();
}

export async function buildMorningDownload(deps: BuildDeps, sources?: Sources): Promise<BuildResult> {
  const news: NewsChainDeps | undefined = deps.news;
  const pooled = deps.pool;
  const src: Sources =
    sources ??
    (pooled
      ? { reels: async () => pooled.stories.filter((c) => c.origin === 'reels'), carousel: async () => pooled.stories.filter((c) => c.origin === 'carousel') }
      : { reels: () => morningDownloadReels(deps.sourceDb, deps.nyDate), carousel: () => morningDownloadCarousel(deps.sourceDb, deps.now) });
  const log: string[] = [];
  const candidates: NewCandidate[] = [];
  const cost = (vendor: 'anthropic' | 'jev', component: string, usd: number, model?: string) =>
    usd > 0 ? recordCost(deps.db, { setId: deps.setId, vendor, component, usd, ...(model ? { model } : {}) }) : Promise.resolve();
  // R13: another live set of this date holds it → out, no test. Earlier days go through the development test below.
  const sameDay = await sameDayKeys(deps.db, 'morning_download', deps.nyDate, deps.setId);
  const [reels, carousel] = await Promise.all([src.reels().catch(() => []), src.carousel().catch(() => [])]);
  // An intake story is held when any member's key is (its link can change between nights), as LFD refs do.
  let pool = dedupe([...carousel, ...reels]).filter((c) => !sameDay.has(c.key) && !(c.intake?.memberKeys ?? []).some((k) => sameDay.has(k)));
  if (deps.intake) pool = mergeSameIntakeStory(pool);

  // What we said: by key over the last SAID_DAYS days, and by intake story id at any age (bounded by today's ids).
  // Fails closed: with pool rows reopened on refresh, an empty "what we said" would let every story we ran back in
  // untested. A failed read fails the set (shows on Health) rather than repeat what already went out.
  const said: Said[] = await readWhatWeSaid(deps.db, deps.now, deps.nyDate, { storyIds: pool.flatMap((c) => (c.intake?.storyId ? [c.intake.storyId] : [])) }).catch((err) => {
    throw new Error(`Morning Download: what we said is unreadable (${err instanceof Error ? err.message : String(err)}); not building a set that could repeat stories`);
  });

  // Bald-Eagle D2/D5 (WC6): a story we ran comes back only for a new event; it then carries what we already said.
  const returning = new Map<string, Returning>();
  const readArticles = (ids: readonly string[], since: Date) => newArticlesSince(deps.sourceDb, ids, since);
  const unblocked: StoryCandidate[] = [];
  for (const c of pool) {
    const s = saidAbout(c, said);
    if (!s) { unblocked.push(c); continue; }
    const v = await developmentTest({ jev: deps.jev, setId: deps.setId, said: s, storyIds: c.intake?.storyId ? [c.intake.storyId] : [], readArticles });
    if (!v.back) {
      candidates.push({ origin: c.origin, ref: c.ref, payload: { headline: c.headline, url: c.url, source: c.sourceName, native: c.nativeScore }, jev: null, score: null, chosen: false, reason: v.reason });
      log.push(`develop: "${c.headline.slice(0, 60)}" out: ${v.reason}`);
      continue;
    }
    returning.set(c.key, { said: s, text: v.text, newEvent: v.newEvent });
    log.push(`develop: "${c.headline.slice(0, 60)}" back (new_event ${v.newEvent.toFixed(2)}, ${v.articles.length} new article(s))`);
    unblocked.push(c);
  }
  pool = unblocked;
  if (pool.length < MIN_STORIES) return { ok: false, skip: `only ${pool.length} new stories in the pool`, candidates };

  // Outlet signal (Bald-Eagle D7): big direct-feed outlets in the last 24 h, shown to the shortlist with the story's own.
  let outlets = new Map<string, OutletSignal>();
  if (deps.intake) {
    const groups = new Map(pool.map((c) => [c.key, storyIdsOf(c, returning.get(c.key))]));
    outlets = await outletCounts(deps.sourceDb, groups, new Date(deps.now.getTime() - OUTLET_WINDOW_HOURS * 3_600_000)).catch((err) => {
      log.push(`outlets: unreadable (${err instanceof Error ? err.message : String(err)})`);
      return new Map<string, OutletSignal>();
    });
  }

  if (!news) return { ok: false, skip: 'the news chain is not wired (no news deps)', candidates };

  // The chain sees short ids ("s1", …), never the story keys: a model does not echo a 300-character Google News slug intact.
  const { items, byId } = shortIds(pool, 's');
  const chain: ChainStory[] = items.map(({ id, item: c }) => ({
    id,
    headline: c.headline,
    text: textOf(c, returning).slice(0, BODY_CHARS),
    outlets: [...new Set([c.sourceName, ...(c.alsoFrom ?? []), ...(outlets.get(c.key)?.outlets ?? [])])],
    published: c.publishedAt,
    url: c.url,
  }));

  // Shortlist (Jev R8) → rerank (Opus) over the top SHORTLIST_TOP.
  const sl = await shortlist(chain, { jev: news.jevAsk, component: 'md-shortlist' });
  await cost('jev', SHORTLIST_ID, sl.costUsd);
  log.push(`shortlist: ${sl.ranked.length} of ${chain.length} scored; top ${Math.min(SHORTLIST_TOP, sl.ranked.length)} to the rerank`);
  const shortScore = new Map(sl.ranked.map((s) => [s.id, s]));

  // Spin-offs: a different article about a story we ran. SAME_EVENT on the shortlist's top (pairs sharing a name) against
  // the latest of each story we said with a headline; a hit goes through the development test and stays out unless it
  // is a real new development.
  const latestSaid = [...new Map([...said].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime()).map((s) => [s.storyId ?? s.key, s])).values()].filter((s) => s.headline);
  const unsaid = sl.ranked.slice(0, SHORTLIST_TOP).filter((s) => { const c = byId.get(s.id)!; return !returning.has(c.key) && !saidAbout(c, said); });
  const spin = await findSpinOffs(unsaid.map((s) => ({ id: s.id, headline: s.headline, text: s.text })), latestSaid, { jev: news.jevAsk, component: 'md-spin-off' });
  await cost('jev', 'md-spin-off', spin.costUsd);
  const spunOut = new Set<string>();
  for (const [id, s] of spin.hits) {
    const c = byId.get(id)!;
    const v = await developmentTest({ jev: deps.jev, setId: deps.setId, said: s, storyIds: c.intake?.storyId ? [c.intake.storyId] : [], readArticles });
    if (!v.back) {
      const reason = `spin-off of a story we ran; ${v.reason.replace(/^ran before; /, '')}`;
      spunOut.add(id);
      candidates.push({ origin: c.origin, ref: c.ref, payload: { headline: c.headline, url: c.url, source: c.sourceName, native: c.nativeScore }, jev: null, score: null, chosen: false, reason });
      log.push(`develop: "${c.headline.slice(0, 60)}" out: ${reason}`);
      continue;
    }
    returning.set(c.key, { said: s, text: v.text, newEvent: v.newEvent });
    log.push(`develop: "${c.headline.slice(0, 60)}" back (spin-off, new_event ${v.newEvent.toFixed(2)}, ${v.articles.length} new article(s))`);
  }
  // A spin-off that is back reads its new articles first, as any returning story does.
  const top = sl.ranked.slice(0, SHORTLIST_TOP).filter((s) => !spunOut.has(s.id))
    .map((s) => (spin.hits.has(s.id) ? { ...s, text: textOf(byId.get(s.id)!, returning).slice(0, BODY_CHARS) } : s));
  const rr = await rerank(top, { create: news.create, windowLabel: deps.nyDate });
  await cost('anthropic', RERANK_ID, rr.costUsd, RERANK_MODEL);
  const graded = new Map(rr.graded.map((g) => [g.id, g]));
  const { kept, merged } = cleanup(rr.graded);
  const window = checkWindow(kept);
  log.push(`rerank: ${rr.graded.length} graded, ${kept.length} after cleanup; checked ${window.map((g) => `${g.id}${g.grade.top_tier ? '*' : ''}`).join(' ')}`);

  // Media for the checked stories, photos and videos side by side.
  const uses = await recentPhotoUses(deps.sourceDb, deps.now).catch(() => new Map<string, Set<string>>());
  const photoOf = new Map<string, PhotoResult>();
  const videos = new Map<string, VideoFind>();
  await Promise.all([
    eachLimited(window, PHOTO_CONCURRENCY, async (g) => {
      const c = byId.get(g.id)!;
      // CI-32 (WC12) + Bald-Eagle D3: a photo another post published or holds is out; the carousel's own photo stays for its own story.
      const usedReason = (url: string) => {
        const by = [...(uses.get(url) ?? [])].filter((id) => id !== c.ref);
        return by.length ? `held by ${by[0]}` : null;
      };
      const extra: Candidate[] = c.photo ? [{ src: c.photo.url, source: 'extra', credit: c.photo.credit }] : [];
      const r = await findStoryPhoto(
        { id: g.id, headline: g.headline, text: g.text, url: g.url, duplicateUrls: (merged.get(g.id) ?? []).map((d) => d.url) },
        { ...news.photo, create: news.create, usedReason },
        { extra },
      ).catch((err): PhotoResult => ({ id: g.id, tier: 'none', pick: null, brief: null, costUsd: 0, log: [`photo finder failed: ${err instanceof Error ? err.message : String(err)}`] }));
      photoOf.set(g.id, r);
    }),
    deps.video
      ? eachLimited(window, MD_VIDEO_CONCURRENCY, async (g) => {
        const c = byId.get(g.id)!;
        const f = await deps.video!.find({ id: c.key, headline: c.headline, url: c.url, body: textOf(c, returning).slice(0, 3000), eventDate: c.intake?.eventDate ?? c.publishedAt?.slice(0, 10) ?? null })
          .catch((err) => (log.push(`video: ${c.headline.slice(0, 50)} failed: ${err instanceof Error ? err.message : String(err)}`), null));
        if (f) videos.set(g.id, f);
      })
      : Promise.resolve(),
  ]);
  await cost('jev', 'news-photos', [...photoOf.values()].reduce((s, r) => s + r.costUsd, 0));
  // One photo shows once a day: a lower-ranked story that picked the same picture loses it.
  const picked = new Set<string>();
  for (const g of window) {
    const r = photoOf.get(g.id);
    if (!r?.pick) continue;
    if (picked.has(r.pick.src)) { r.log.push(`pick dropped: a higher-ranked story shows ${r.pick.src}`); photoOf.set(g.id, { ...r, tier: 'none', pick: null }); continue; }
    picked.add(r.pick.src);
  }
  const verdict = (id: string) => mdVerdict({ video: videos.get(id)?.tier ?? 'none', photo: photoOf.get(id)?.pick?.tier ?? 'none' });
  const postIds = choosePosts(kept, verdict, { min: MIN_STORIES, max: MAX_STORIES });
  log.push(`media: ${window.map((g) => `${g.id} ${verdict(g.id)}`).join(', ')}; posts ${postIds.join(' ') || 'none'}`);
  if (deps.video) log.push(`video: checked ${window.length}, golden ${[...videos.values()].filter((v) => v.tier === 'golden').length}, good ${[...videos.values()].filter((v) => v.tier === 'good').length}`);

  // Candidate rows for every story the chain saw; `posted` is filled once the frames are final.
  const posted = new Set<string>();
  const candidateRows = (): NewCandidate[] => [
    ...candidates,
    ...items.filter(({ id }) => !spunOut.has(id)).map(({ id, item: c }) => {
      const s = shortScore.get(id);
      const g = graded.get(id);
      const reason = posted.has(id) ? null
        : !s ? 'shortlist call failed'
          : !g ? 'below the shortlist'
            : g.grade.duplicate_of ? `duplicate of ${byId.get(g.grade.duplicate_of)?.key ?? g.grade.duplicate_of}`
              : !kept.includes(g) ? 'crowded out by a higher-ranked story'
                : !window.includes(g) ? 'below the check window'
                  : postIds.includes(id) ? 'dropped after the pick (writer or media)'
                    : `not posted (${g.grade.top_tier ? 'top tier' : 'not top tier'}, media ${verdict(id)})`;
      return {
        origin: c.origin, ref: c.ref, payload: { headline: c.headline, url: c.url, source: c.sourceName, native: c.nativeScore },
        jev: s ? { shortlist_cool: s.cool, shortlist_value: s.value, shortlist_final: s.final, ...(g ? { cool: g.grade.cool, value: g.grade.value, top_tier: g.grade.top_tier ? 1 : 0 } : {}) } : null,
        score: g ? g.grade.cool + g.grade.value : (s?.final ?? null), chosen: posted.has(id), reason,
      };
    }),
  ];
  if (postIds.length < MIN_STORIES) return { ok: false, skip: `only ${postIds.length} story(ies) to post after the rerank`, candidates: candidateRows() };

  // Write (W12 writer, editor angles = the rerank's).
  const posts = postIds.map((id) => graded.get(id)!);
  const wr = await writeStories(
    'md',
    posts.map((g) => ({ key: g.id, headline: g.headline, text: g.text, weAlreadySaid: returning.get(byId.get(g.id)!.key)?.said.headline ?? null })),
    Object.fromEntries(posts.map((g) => [g.id, g.grade.angle])),
    { create: news.create },
  );
  await cost('anthropic', WRITER_ID, wr.costUsd, WRITER_MODEL);
  log.push(...wr.log.map((l) => `writer: ${l}`));
  let written = wr.written;
  if (written.length < MIN_STORIES) return { ok: false, skip: `only ${written.length} story(ies) passed the fact check`, candidates: candidateRows() };

  // The band photo (D24 revised, WC11): fitted, stored, `contained` for the renderer's CONTAINED_FADE.
  const bandPhoto = async (id: string, pick: GradedPhoto, steps: string[]): Promise<Photo | null> => {
    try {
      const band = { fetchImage: news.photo.fetchImage, jev: news.photo.jev, upscaler: news.upscaler, tmpDir: news.tmpDir, storage: news.storage };
      const { photo, step } = await bandPhotoFor(pick, band, deps.setId, byId.get(id)!.key, (fit) => cost('jev', 'news-photos-band', fit.costUsd));
      steps.push(step);
      return photo;
    } catch (err) {
      steps.push(`band fit failed (${err instanceof Error ? err.message : String(err)}); no photo`);
      return null;
    }
  };

  // The media ladder (D16): golden video → photo → good video → the story drops (unless the day would fall under
  // MIN_STORIES; then the best-ranked media-less stories stay as type frames, WC5).
  const storyFrames: StoryData[] = [];
  const photoLog: Array<{ frame: string; picked?: string; steps: string[] }> = [];
  const media: Array<MdMedia | null> = [];
  for (const [i, w] of written.entries()) {
    const c = byId.get(w.key)!;
    const found = videos.get(w.key);
    const pick = photoOf.get(w.key)?.pick ?? null;
    const steps = [...(photoOf.get(w.key)?.log ?? [])];
    let frame: StoryData = { role: 'story', headline: frameCopy(w.headline, w.body), source: { verb: 'via', name: c.sourceName } };
    let shown: string | undefined;
    let m = mdMedia({ video: found?.tier ?? 'none', photo: Boolean(pick) });
    if (m === 'video') {
      const stored = found?.clip && deps.video
        ? await deps.video.store(found.clip, found.tier === 'golden' ? 'golden' : 'good', c.key).catch((err) => (steps.push(`video: could not fit or store the clip: ${err instanceof Error ? err.message : String(err)}`), null))
        : null;
      if (stored && found?.clip) {
        frame = { ...frame, photo: stored.poster, video: stored.video };
        shown = found.clip.sourceUrl;
        steps.push(`video: ${found.tier} clip (${stored.video.fit} fit, ${stored.video.seconds}s) from ${found.clip.site}: ${found.clip.sourceUrl}`);
      } else m = pick ? 'photo' : null;
    }
    if (m === 'photo' && pick) {
      const photo = await bandPhoto(w.key, pick, steps);
      if (photo) { frame = { ...frame, photo }; shown = pick.src; } else m = null;
    }
    storyFrames.push(frame);
    media.push(m);
    photoLog.push({ frame: `story ${i + 1}`, ...(shown ? { picked: shown } : {}), steps });
  }
  const keep = keepWithMedia(media, MIN_STORIES);
  const noMedia = written.filter((_, i) => !keep.includes(i));
  if (noMedia.length) log.push(`media: dropped ${noMedia.length} story(ies) with no photo or video: ${noMedia.map((s) => s.headline.slice(0, 40)).join(' | ')}`);
  written = keep.map((i) => written[i]!);
  const frames = keep.map((i) => storyFrames[i]!);
  const photoFrames = keep.map((i, n) => ({ ...photoLog[i]!, frame: `story ${n + 1}` }));
  for (const w of written) posted.add(w.key);

  // The photo bank (D49): each posted story's shown pick as `picked` at its slide (cover 1, story k at k + 1), its
  // runner-ups and every other checked story's finds as `passed`. Synchronous and best effort: never fails the build.
  if (news.bank) {
    const runRef = `stories-build:${deps.now.toISOString()}`;
    const slideOf = new Map(written.map((w, n) => [w.key, n + 2] as const));
    for (const g of window) {
      const r = photoOf.get(g.id);
      const slide = slideOf.get(g.id) ?? 0;
      const shown = slide > 0 && Boolean(r?.pick) && photoFrames[slide - 2]?.picked === r!.pick!.src;
      offerToBank(news.bank, r, { runRef, slide, posted: shown, headline: g.headline, at: deps.now }, (line) => log.push(line));
    }
  }

  // The cover shows every story's own photo, blurred under a question mark (MC14); it draws no opener photo.
  // Its headline rotates on from the last set's (MC16).
  const promise = nextOpenerPromise(await lastOpenerPromise(deps.db, deps.setId), frames.length);
  const data: FrameData[] = [{ role: 'opener', date: openerDate(deps.nyDate), storyCount: frames.length, promise, peek: frames.map((f) => f.photo ?? null) }, ...frames, { role: 'closer' }];
  const backdrop = await nextBackdrop(deps.db, 'morning_download', deps.setId);
  const keyOf = (id: string) => byId.get(id)!.key;
  return {
    ok: true,
    payload: {
      // storyId and the headline here are what a later set reads as "what we said" (md-development.ts) until this set publishes.
      stories: written.map((w, n) => {
        const c = byId.get(w.key)!;
        const g = graded.get(w.key)!;
        const r = returning.get(c.key);
        const big = outlets.get(c.key);
        return {
          key: c.key, headline: frames[n]!.headline, url: c.url, source: c.sourceName, score: g.grade.cool + g.grade.value, top_tier: g.grade.top_tier, angle: w.angle, angle_from: w.chosen,
          ...(c.intake?.storyId ? { storyId: c.intake.storyId } : {}), ...(big ? { big_outlets: big.outlets } : {}),
          ...(r ? { we_already_said: { headline: r.said.headline, posted_at: r.said.postedAt.toISOString(), new_event: r.newEvent } } : {}),
        };
      }),
      pool: pool.length,
      ...(wr.dropped.length ? { writer_dropped: wr.dropped.map((d) => ({ key: keyOf(d.key), reason: d.reason })) } : {}),
      ...(wr.over.length ? { writer_over_cap: wr.over.map(keyOf) } : {}),
      log,
      photo_log: photoFrames,
      ...(deps.video ? { video_log: [...videos.entries()].map(([id, v]) => ({ key: keyOf(id), tier: v.tier, candidates: v.candidates, usd: Math.round(v.costUsd * 10_000) / 10_000, ...(v.clip ? { clip: v.clip.sourceUrl, site: v.clip.site } : {}), trace: v.trace.slice(0, 12) })) } : {}),
    },
    frames: toFrames(data, backdrop),
    candidates: candidateRows(),
    historyKeys: written.map((w) => keyOf(w.key)),
  };
}
