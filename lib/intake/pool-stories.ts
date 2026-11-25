/**
 * The IG Stories pool (Morning Download, Free vs. Paid) read
 * from the central intake instead of the reels slate and the carousel run
 * (Phase 1, round 4: the three series no longer depend on Reels or Carousels
 * having run). Same shapes and the same selection rules as the legacy reads in
 * lib/stories/sources/{reels,carousel}.ts, so the builds downstream don't change.
 *
 *   morning().reels     ↔ morningDownloadReels: "timely" = the story's first reels/search
 *                         member was first seen in the last successful main run or later
 *                         (as the LFD reels lane), and a reels-score; no Warning / Callout;
 *                         top 10 by net + every blockbuster
 *   morning().carousel  ↔ morningDownloadCarousel: story-scoring 'qualified', touched in
 *                         the last 30 h, minus what the per-order posted check flags
 *                         against the carousel's posted list; shortlist order first
 *   leads()             ↔ freeToolLeads: Ball Knowledge (14 days) + GitHub Trending items
 *                         (a bounded read of that source's items, no drop filter, as legacy)
 *   carouselRunAt()     the last successful intake run's start: a newer run refreshes the pool again
 *
 * Pure reads (CLAUDE.md rule 2): listStories over a bounded window, never a
 * sweep. The one model call is the posted check (story-scoring@4's
 * `already_posted`, moved to read time), on the qualified stories only.
 */
import * as Scoring from '@/lib/social/jev/questions/story-scoring.v4';
import type { ScoredGroup } from '@/lib/social/ingest/select/types';
import { rankQualified, spreadByCompany } from '@/lib/social/ingest/select/rank';
import type { PoolReads } from '@/lib/stories/pool';
import { MD_REELS_TOP, NOT_NEWS_BUCKETS, storyKey, type StoryCandidate, type ToolLead } from '@/lib/stories/sources/reels';

import { postedCheck as livePostedCheck, readCarouselPosted as liveReadCarouselPosted } from './posted';
import { lastRuns as liveLastRuns, listSourceItems as liveListSourceItems, listStories as liveListStories } from './read';
import { byRole, feedMembersOf, membersOf, storyGroupOf } from './scorecards';
import type { IntakeItem, IntakeJev, IntakeQuery, LastRuns, ListStories, PostedCheck, ScoredStory } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Legacy windows (lib/stories/sources): carousel runs of the last 30 h; Free vs. Paid 14 days. */
export const MD_CAROUSEL_HOURS = 30;
export const FVP_DAYS = 14;
export const FVP_LIMIT = 15;
export const GITHUB_TRENDING = 'github-trending';

export type IntakePoolDeps = {
  /** The posted check's Jev (a function so it is made only when a qualified story needs checking). */
  jev?: IntakeJev | (() => IntakeJev);
  listStories?: ListStories;
  lastRuns?: LastRuns;
  postedCheck?: PostedCheck;
  readCarouselPosted?: (q: IntakeQuery, now: Date) => Promise<string[]>;
  /** One source's recent items (GitHub Trending for Free vs. Paid); read.ts listSourceItems. */
  listSourceItems?: (q: IntakeQuery, sourceId: string, since: Date, limit: number) => Promise<IntakeItem[]>;
  /**
   * Optional: the photo a carousel post already placed for a story (S-29), by storyKey of the post's story id. An
   * output of another type, read when there and never waited on (round 4); the caller supplies it (lib/stories).
   */
  carouselPhotos?: () => Promise<CarouselPhotos>;
};

export type CarouselPhotos = Map<string, { url: string; credit: string; storyId: string }>;

/** A Stories candidate's link back to its intake story: the stored scores Morning Download's lead queue reads. */
export type IntakeRef = NonNullable<StoryCandidate['intake']>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const nyDate = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(at);
/** The canonical URL: the item key when it is one, else the item's link. */
const canonical = (m: IntakeItem) => (/^https?:\/\//i.test(m.key) ? m.key : m.url);

export function intakeRef(s: ScoredStory): IntakeRef {
  // Every member's storyKey, so the used-key check matches a story shown under another member's link (as LFD refs do).
  const memberKeys = [...new Set(s.members.flatMap((m) => [storyKey(canonical(m)), storyKey(m.url)]))];
  return { storyId: s.id, major: s.scores['major-news'] ?? null, builder: s.scores['story-builder'] ?? null, eventDate: iso(s.eventDate), memberKeys };
}

/* ── the reels side (reels-score: net, blockbuster, bucket) ───────────── */

/** The reels idea's primary member: the reels/search member with role primary, else the first by role. */
function reelsPrimary(s: ScoredStory): IntakeItem | null {
  const members = byRole(membersOf(s, ['reels', 'search']));
  return members.find((m) => m.role === 'primary') ?? members[0] ?? null;
}

/** toCandidate (sources/reels.ts) over an intake story: the primary reels member's link, headline, outlet and text. */
export function reelsCandidate(s: ScoredStory): StoryCandidate | null {
  const m = reelsPrimary(s);
  const score = s.scores['reels-score'];
  if (!m || !score) return null;
  const url = canonical(m);
  return {
    key: storyKey(url),
    origin: 'reels',
    ref: s.id,
    headline: m.headline,
    sourceName: m.sourceName,
    url,
    body: m.body,
    publishedAt: iso(m.publishTime),
    nativeScore: score.net,
    blockbuster: score.blockbuster,
    intake: intakeRef(s),
  };
}

const netOf = (s: ScoredStory) => s.scores['reels-score']?.net ?? null;
const byNetDesc = (a: ScoredStory, b: ScoredStory) => (netOf(b) ?? -Infinity) - (netOf(a) ?? -Infinity);

/** When the story's reels side was first seen: the earliest first-seen of its kept reels/search members (null: none). */
/**
 * Legacy parity (reels resetTimelyFlags, D-059): an idea is timely when a source joined or was stored again in
 * tonight's run. Intake equivalent: the latest sighting of the story's kept reels/search members.
 */
export function reelsLastSeen(s: ScoredStory): Date | null {
  const members = membersOf(s, ['reels', 'search']);
  return members.length ? new Date(Math.max(...members.map((m) => m.lastSeenAt.getTime()))) : null;
}

/** morningDownloadReels: timely (a reels/search member seen in tonight's main run or later), not Warning / Callout, top MD_REELS_TOP by net plus every blockbuster below them. */
export function selectMorningReels(stories: readonly ScoredStory[], timelyFrom: Date): StoryCandidate[] {
  const rows = stories
    .filter((s) => s.scores['reels-score'] && (reelsLastSeen(s)?.getTime() ?? -Infinity) >= timelyFrom.getTime())
    .filter((s) => !(NOT_NEWS_BUCKETS as readonly string[]).includes(s.scores['reels-score']!.chosenBucket ?? ''))
    .sort(byNetDesc);
  const top = rows.slice(0, MD_REELS_TOP);
  const extra = rows.slice(MD_REELS_TOP).filter((s) => s.scores['reels-score']!.blockbuster > 0);
  return [...top, ...extra].map(reelsCandidate).filter((c): c is StoryCandidate => c !== null);
}

/** A reels bucket over a window, newest day first and then by net (freeToolLeads order). */
function bucketed(stories: readonly ScoredStory[], bucket: string, since: Date): ScoredStory[] {
  return stories
    .filter((s) => s.scores['reels-score']?.chosenBucket === bucket && s.lastJoinedAt.getTime() >= since.getTime())
    .sort((a, b) => nyDate(b.lastJoinedAt).localeCompare(nyDate(a.lastJoinedAt)) || byNetDesc(a, b));
}

/** freeToolLeads: Ball Knowledge ideas of the last 14 days (15), then GitHub Trending items of the last 14 days (15), newest first. */
export function selectLeads(stories: readonly ScoredStory[], now: Date, trendingItems: readonly IntakeItem[] = []): ToolLead[] {
  const since = new Date(now.getTime() - FVP_DAYS * DAY);
  const ideas = bucketed(stories, 'ball_knowledge', since)
    .slice(0, FVP_LIMIT)
    .flatMap((s) => {
      const m = reelsPrimary(s);
      return m ? [{ origin: 'reels' as const, ref: s.id, name: m.headline, url: canonical(m), description: m.body.slice(0, 600) }] : [];
    });
  const seen = new Set<string>();
  // The source's own items (any drop reason, grouped or not, as the legacy read), not story members.
  const trending = trendingItems
    .filter((m) => m.firstSeenAt.getTime() > since.getTime() && (seen.has(m.key) ? false : (seen.add(m.key), true)))
    .sort((a, b) => b.firstSeenAt.getTime() - a.firstSeenAt.getTime())
    .slice(0, FVP_LIMIT)
    .map((m) => ({ origin: 'github' as const, ref: m.key, name: m.headline, url: canonical(m), description: m.body.slice(0, 600) }));
  return [...ideas, ...trending];
}

/* ── the carousel side (story-scoring@4 on the feeds members) ─────────── */

type Ranked = ScoredGroup & { story: ScoredStory };

/** The social ScoredGroup the carousel would have ranked: the feeds members as one group, with the stored story-scoring result. */
function asScoredGroup(s: ScoredStory): Ranked | null {
  const sc = s.scores['story-scoring'];
  const feeds = feedMembersOf(s);
  if (!sc || !feeds.length) return null;
  const passes = Scoring.ENGAGEMENT_IDS.filter((id) => (sc.answers[id] ?? 0) >= Scoring.THRESHOLDS.BONUS_MIN).length;
  return { ...storyGroupOf(s, feeds), answers: sc.answers, status: sc.status, passes, probSum: sc.probSum, outletCount: sc.outletCount, story: s };
}

/** The carousel's order (rank.ts): qualified, probSum → outlets → newest, the top spread across companies. */
export function rankCarousel(stories: readonly ScoredStory[]): Ranked[] {
  const groups = stories.map(asScoredGroup).filter((g): g is Ranked => g !== null);
  return spreadByCompany(rankQualified(groups)) as Ranked[];
}

/**
 * groupToCandidate (sources/carousel.ts) over an intake story: newest outlet first, the most text any member has, passes
 * as the native score. With a carousel photo for any member, the photo comes along and `ref` is that post's story id
 * (the used-photo check reads it), as morningDownloadCarousel does.
 */
export function carouselCandidate(g: Ranked, photos?: CarouselPhotos): StoryCandidate {
  const s = g.story;
  const feeds = feedMembersOf(s);
  const rep = feeds.find((m) => m.key === s.representativeKey) ?? byRole(feeds)[0]!;
  const url = canonical(rep);
  const newestFirst = [...new Set(g.members.map((m) => m.outlet).filter(Boolean))];
  const photo = photos?.size ? feeds.map((m) => photos.get(storyKey(canonical(m))) ?? photos.get(storyKey(m.url))).find(Boolean) ?? null : undefined;
  return {
    key: storyKey(url),
    origin: 'carousel',
    ref: photo ? photo.storyId : url,
    headline: rep.headline || s.headline,
    sourceName: newestFirst[0] ?? rep.sourceName ?? 'unknown',
    url,
    body: g.body,
    publishedAt: iso(g.publishedAt),
    nativeScore: g.passes,
    alsoFrom: newestFirst.slice(1),
    ...(photo === undefined ? {} : { photo: photo ? { url: photo.url, credit: photo.credit } : null }),
    intake: intakeRef(s),
  };
}

/** morningDownloadCarousel: qualified and touched in the last 30 h, minus already posted, shortlist (rank) order. */
export function selectMorningCarousel(stories: readonly ScoredStory[], posted: ReadonlySet<string>, now: Date, photos?: CarouselPhotos): StoryCandidate[] {
  const since = now.getTime() - MD_CAROUSEL_HOURS * HOUR;
  const fresh = stories.filter((s) => s.lastJoinedAt.getTime() >= since || s.firstSeenAt.getTime() >= since);
  return rankCarousel(fresh.filter((s) => !posted.has(s.id))).map((g) => carouselCandidate(g, photos));
}

/* ── the reads ────────────────────────────────────────────────────────── */

export function intakePoolReads(q: IntakeQuery, now: Date, deps: IntakePoolDeps = {}): PoolReads {
  const list = deps.listStories ?? liveListStories;
  const runs = deps.lastRuns ?? liveLastRuns;
  const check = deps.postedCheck ?? livePostedCheck;
  const readPosted = deps.readCarouselPosted ?? liveReadCarouselPosted;
  const sourceItems = deps.listSourceItems ?? liveListSourceItems;
  const jev = () => {
    const j = typeof deps.jev === 'function' ? deps.jev() : deps.jev;
    if (!j) throw new Error('intake pool: no Jev for the posted check');
    return j;
  };
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

  return {
    morning: async () => {
      const last = await runs(q);
      const timelyFrom = last.main?.startedAt ?? null;
      const [reelsSide, carouselSide] = await Promise.all([
        // A story seen again tonight may have joined long ago (legacy timely), so read a bounded 14-day window and filter.
        timelyFrom ? list(q, { since: daysAgo(14), needScores: ['reels-score'] }) : Promise.resolve([]),
        list(q, { since: new Date(now.getTime() - MD_CAROUSEL_HOURS * HOUR), families: ['feeds'], needScores: ['story-scoring'] }),
      ]);
      const qualified = carouselSide.filter((s) => s.scores['story-scoring']?.status === 'qualified');
      const headlines = qualified.length ? await readPosted(q, now) : [];
      const posted = headlines.length ? await check(qualified, headlines, jev()) : new Set<string>();
      const photos = qualified.length && deps.carouselPhotos ? await deps.carouselPhotos().catch(() => undefined) : undefined;
      return { reels: timelyFrom ? selectMorningReels(reelsSide, timelyFrom) : [], carousel: selectMorningCarousel(qualified, posted, now, photos) };
    },
    leads: async () => {
      const [ideas, trending] = await Promise.all([
        list(q, { since: daysAgo(FVP_DAYS), needScores: ['reels-score'] }),
        sourceItems(q, GITHUB_TRENDING, daysAgo(FVP_DAYS), FVP_LIMIT * 2),
      ]);
      return selectLeads(ideas, now, trending);
    },
    carouselRunAt: async () => {
      const last = await runs(q);
      const at = [last.main?.startedAt, last.topup?.startedAt].filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0];
      return at ? at.toISOString() : null;
    },
  };
}
