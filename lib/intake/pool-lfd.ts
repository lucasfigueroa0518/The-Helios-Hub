/**
 * Last Few Days on the central intake (Phase 1, Owner D). The three legacy
 * lanes of lib/lfd/sources.ts, rebuilt from pre-scored intake stories so LFD no
 * longer depends on Reels or Carousels having run. Pure reads (listStories) plus
 * the per-order posted check on the carousel lane; nothing here scores a story
 * or writes a row (CLAUDE.md Rule 2).
 *
 * Mirror of the legacy rules:
 * - reels ↔ REELS_LANE_SQL: stories carrying a reels-score whose FIRST night (the
 *   NY date the first reels/search member joined) is in after < night ≤ through.
 *   net/blockbuster are the BEST any reels-score of the story reached (score.ts keeps
 *   best_net / best_blockbuster across re-scores), as legacy took the best across nights.
 * - carousel ↔ carouselLane: per night in after ≤ night ≤ through whose 3:00 AM NY
 *   cut has settled (CAROUSEL_SETTLE_MINUTES), feed stories with a feed member published in the carousel
 *   run's lookback (windowHours) before the cut, story-scoring 'qualified', minus
 *   carousel-posted (postedCheck against readCarouselPosted), ranked rankQualified →
 *   spreadByCompany, top CAROUSEL_TOP. Newest night first.
 * - feed ↔ freshFeedLane: feed members published after the latest night cut
 *   (at most FEED_FLOOR_HOURS back), newest first, FEED_TOP. Code filters were
 *   applied at fetch (dropped items never join a story).
 * Keys are storyKey(url) of the lane's representative member (the legacy key
 * scheme); refs carry the story id and every member's storyKey, so the used-idea
 * and archive checks still match posts made on the legacy path.
 */
import { nyDateKey } from '@/lib/reels/scoring/decide';
import { zonedTime } from '@/lib/instagram/clock';
import { CAROUSEL_TOP, FEED_FLOOR_HOURS, FEED_TOP } from '@/lib/lfd/sources';
import type { LfdCandidate, LfdWindow, Origin } from '@/lib/lfd/types';
import { shiftDate } from '@/lib/lfd/window';
import { rankQualified, spreadByCompany, SPREAD_PER_COMPANY, SPREAD_TOP } from '@/lib/social/ingest/select/rank';
import type { ScoredGroup } from '@/lib/social/ingest/select/types';
import { windowHours } from '@/lib/social/ingest/select/window';
import { companyKey } from '@/lib/social/ingest/select/companies';
import { storyKey } from '@/lib/stories/sources/reels';

import { feedMembersOf, membersOf } from './scorecards';
import type { Family, IntakeItem, IntakeJev, IntakeQuery, ListStories, PostedCheck, ScoredStory } from './types';

/** The carousel daily run's clock (docs/social-overnight.md: 3:00 AM NY). Each night's shortlist is cut here. */
export const CAROUSEL_CUT_HOUR_NY = 3;
/**
 * A night counts once its cut is this far behind the run. The scheduled LFD run starts at that same 3:00 cut,
 * in the carousel run's place (LFD-02), so legacy had no carousel shortlist for that night and its fresh feed
 * covered it instead; a later manual run sees the night as a carousel night, as legacy did after the 3:00 run.
 */
export const CAROUSEL_SETTLE_MINUTES = 60;
const HOUR = 3_600_000;
const settled = (cut: Date, now: Date) => cut.getTime() <= now.getTime() - CAROUSEL_SETTLE_MINUTES * 60_000;

export type IntakeLaneDeps = {
  listStories: ListStories;
  postedCheck: PostedCheck;
  readCarouselPosted: (q: IntakeQuery, now: Date) => Promise<string[]>;
};

export type IntakeLanes = { reels: LfdCandidate[]; carousel: LfdCandidate[]; feed: LfdCandidate[] };

const REELS_FAMILIES: readonly Family[] = ['reels', 'search'];

/** The story's kept members of a lane (fix 1: membership per list, so a URL on a reels adapter AND a feed is in both). */
const live = (s: ScoredStory, lane: 'reels' | 'feeds'): IntakeItem[] => (lane === 'feeds' ? feedMembersOf(s) : membersOf(s, REELS_FAMILIES));
const publishedOf = (m: IntakeItem) => m.publishTime ?? m.firstSeenAt;
const roleRank = (m: IntakeItem) => (m.role === 'primary' ? 0 : m.role === 'supporting' ? 1 : 2);

/** The lane's representative: the story's representative key when in the subset, else the primary, else the earliest seen. */
function representative(s: ScoredStory, members: readonly IntakeItem[]): IntakeItem {
  return members.find((m) => m.key === s.representativeKey) ?? [...members].sort((a, b) => roleRank(a) - roleRank(b) || a.firstSeenAt.getTime() - b.firstSeenAt.getTime())[0]!;
}

/** The 3:00 AM NY instant of a YYYY-MM-DD night. */
function cutOf(nyDate: string): Date {
  const [y, m, d] = nyDate.split('-').map(Number);
  return zonedTime(y!, m!, d!, CAROUSEL_CUT_HOUR_NY);
}

function midnightOf(nyDate: string): Date {
  const [y, m, d] = nyDate.split('-').map(Number);
  return zonedTime(y!, m!, d!, 0);
}

function candidate(s: ScoredStory, members: IntakeItem[], origin: Origin, extra: Partial<LfdCandidate> = {}): LfdCandidate {
  const rep = representative(s, members);
  const outlets = [...new Set(members.map((m) => m.sourceName).filter(Boolean))];
  const body = members.reduce((best, m) => (m.body.length > best.length ? m.body : best), rep.body);
  return {
    key: storyKey(rep.url),
    refs: [...new Set([s.id, ...s.members.map((m) => storyKey(m.url))])],
    origin,
    headline: rep.headline,
    sourceName: rep.sourceName,
    url: rep.url,
    body: origin === 'reels' ? rep.body : body,
    publishedAt: rep.publishTime?.toISOString() ?? null,
    net: null,
    blockbuster: 0,
    firstSeen: null,
    alsoFrom: outlets.filter((o) => o !== rep.sourceName),
    major: s.scores['major-news'] ?? null,
    builder: s.scores['story-builder'] ?? null,
    eventDate: s.eventDate ? s.eventDate.toISOString() : null,
    ...(s.yours ? { yours: true } : {}),
    ...extra,
  };
}

/** Reels lane (REELS_LANE_SQL): first reels night in the window; blockbusters first, then net. */
export function reelsLaneOf(stories: readonly ScoredStory[], w: LfdWindow): LfdCandidate[] {
  const out: LfdCandidate[] = [];
  for (const s of stories) {
    const score = s.scores['reels-score'];
    if (!score) continue;
    const members = live(s, 'reels');
    if (members.length === 0) continue;
    const first = nyDateKey(new Date(Math.min(...members.map((m) => m.firstSeenAt.getTime()))));
    if (!(first > w.after && first <= w.through)) continue;
    const net = s.reelsBest?.net ?? score.net;
    const blockbuster = Number(s.reelsBest?.blockbuster ?? score.blockbuster) || 0;
    out.push(candidate(s, members, 'reels', { net, blockbuster, firstSeen: first }));
  }
  return out.sort((a, b) => b.blockbuster - a.blockbuster || (b.net ?? -Infinity) - (a.net ?? -Infinity));
}

/** The carousel nights a run at `now` would have seen: after ≤ night ≤ through, cut already passed, newest first. */
export function carouselNights(w: LfdWindow, now: Date): Array<{ night: string; cut: Date; hours: number }> {
  const out: Array<{ night: string; cut: Date; hours: number }> = [];
  for (let night = w.through; night >= w.after; night = shiftDate(night, -1)) {
    const cut = cutOf(night);
    if (!settled(cut, now)) continue;
    out.push({ night, cut, hours: windowHours(cut, false) });
  }
  return out;
}

type Qualified = { story: ScoredStory; feeds: IntakeItem[]; group: ScoredGroup };

function asGroup(s: ScoredStory, feeds: IntakeItem[], newest: Date): ScoredGroup | null {
  const sc = s.scores['story-scoring'];
  if (!sc) return null;
  const rep = representative(s, feeds);
  return {
    id: s.id,
    members: [],
    outlets: [],
    outletCount: sc.outletCount,
    publishedAt: newest,
    representative: { headline: rep.headline } as ScoredGroup['representative'],
    articles: [],
    body: '',
    read: [],
    tried: [],
    answers: sc.answers,
    status: sc.status,
    passes: 0,
    probSum: sc.probSum,
  } as unknown as ScoredGroup;
}

/** True once `ranked` (already free of posted stories) fills spreadByCompany's top `top` places. */
function headFull(ranked: readonly ScoredGroup[], top: number): boolean {
  const counts = new Map<string, number>();
  let head = 0;
  for (const g of ranked) {
    const key = companyKey(g.representative.headline);
    if (key && (counts.get(key) ?? 0) >= SPREAD_PER_COMPANY) continue;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    head += 1;
    if (head >= top) return true;
  }
  return false;
}

/**
 * Carousel lane: per night, qualified feed stories in that night's lookback, minus posted, ranked and spread, top 10.
 * The posted check (one Jev call per story) is asked in rank order, a batch at a time, only until the night's top is settled.
 */
export async function carouselLaneOf(
  stories: readonly ScoredStory[],
  w: LfdWindow,
  now: Date,
  isPosted: (batch: ScoredStory[]) => Promise<Set<string>>,
): Promise<LfdCandidate[]> {
  const checked = new Map<string, boolean>();
  const out: LfdCandidate[] = [];
  for (const { cut, hours } of carouselNights(w, now)) {
    const from = cut.getTime() - hours * HOUR;
    const inNight: Qualified[] = [];
    for (const s of stories) {
      const feeds = live(s, 'feeds');
      const window = feeds.filter((m) => {
        const t = publishedOf(m).getTime();
        return t > from && t <= cut.getTime() && m.firstSeenAt.getTime() <= cut.getTime();
      });
      if (window.length === 0) continue;
      const newest = new Date(Math.max(...window.map((m) => publishedOf(m).getTime())));
      const group = asGroup(s, feeds, newest);
      if (group) inNight.push({ story: s, feeds, group });
    }
    const byId = new Map(inNight.map((x) => [x.story.id, x]));
    const ranked = rankQualified(inNight.map((x) => x.group));
    // Ask the posted check in rank order, a batch at a time, until spreadByCompany's top is settled.
    let i = 0;
    const kept = () => ranked.slice(0, i).filter((g) => checked.get(g.id) === false);
    while (i < ranked.length && !headFull(kept(), Math.min(CAROUSEL_TOP, SPREAD_TOP))) {
      const batch = ranked.slice(i, i + CAROUSEL_TOP).filter((g) => !checked.has(g.id));
      if (batch.length) {
        const posted = await isPosted(batch.map((g) => byId.get(g.id)!.story));
        for (const g of batch) checked.set(g.id, posted.has(g.id));
      }
      i = Math.min(i + CAROUSEL_TOP, ranked.length);
    }
    for (const g of spreadByCompany(kept()).slice(0, CAROUSEL_TOP)) {
      const x = byId.get(g.id)!;
      out.push(candidate(x.story, x.feeds, 'carousel'));
    }
  }
  return out.filter((c) => c.headline);
}

/** The latest settled carousel-night cut (the legacy "last carousel run"). */
export function lastCut(now: Date): Date {
  const today = nyDateKey(now);
  const cut = cutOf(today);
  return settled(cut, now) ? cut : cutOf(shiftDate(today, -1));
}

/** Feed lane: feed stories with a member published since the last night's cut (≤ 48 h back), newest first, top 20. */
export function feedLaneOf(stories: readonly ScoredStory[], now: Date, limit = FEED_TOP): LfdCandidate[] {
  const floor = Math.max(lastCut(now).getTime(), now.getTime() - FEED_FLOOR_HOURS * HOUR);
  const rows: Array<{ c: LfdCandidate; at: number }> = [];
  for (const s of stories) {
    const feeds = live(s, 'feeds');
    const fresh = feeds.filter((m) => publishedOf(m).getTime() > floor && publishedOf(m).getTime() <= now.getTime());
    if (fresh.length === 0) continue;
    const at = Math.max(...fresh.map((m) => publishedOf(m).getTime()));
    rows.push({ c: candidate(s, feeds, 'feed'), at });
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, limit).map((r) => r.c);
}

async function defaultDeps(): Promise<IntakeLaneDeps> {
  const [{ listStories }, { postedCheck, readCarouselPosted }] = await Promise.all([import('./read'), import('./posted')]);
  return { listStories, postedCheck, readCarouselPosted };
}

/**
 * The three LFD lanes from the intake. One read (listStories since the earliest bound any lane needs), the
 * per-order posted check on the carousel lane's qualified stories (Jev, only as deep as the top 10 per night),
 * no other model call. `deps` is for tests; live it is A's listStories and B's posted check.
 */
export async function intakeLanes(q: IntakeQuery, window: LfdWindow, now: Date, jev: IntakeJev, deps?: Partial<IntakeLaneDeps>): Promise<IntakeLanes> {
  const full = Boolean(deps?.listStories && deps.postedCheck && deps.readCarouselPosted);
  const d: IntakeLaneDeps = full ? (deps as IntakeLaneDeps) : { ...(await defaultDeps()), ...deps };
  const nights = carouselNights(window, now);
  const oldestCarousel = nights.length ? Math.min(...nights.map((n) => n.cut.getTime() - n.hours * HOUR)) : Infinity;
  const since = new Date(Math.min(midnightOf(shiftDate(window.after, 1)).getTime(), oldestCarousel, now.getTime() - FEED_FLOOR_HOURS * HOUR));
  const stories = await d.listStories(q, { since, until: now, families: ['reels', 'search', 'feeds'] });
  let postedList: string[] | null = null;
  const isPosted = async (batch: ScoredStory[]) => {
    postedList ??= await d.readCarouselPosted(q, now);
    return d.postedCheck(batch, postedList, jev);
  };
  return {
    reels: reelsLaneOf(stories, window),
    carousel: await carouselLaneOf(stories, window, now, isPosted),
    feed: feedLaneOf(stories, now),
  };
}
