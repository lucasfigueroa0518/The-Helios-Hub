/**
 * One AI Events run (plan M4, AE-29): rank the week (lib/networking/pick: Jev event-pick@1 for
 * events not scored yet, under the run cap) → ranked picks per city (pins, then partners, then the
 * history bar) → per post city (Miami, then Boston) the look draw (AE-13), the ranked post built by
 * code (lib/ai-events/post.ts), its slide JPEGs (storeSlideJpegs, prefix ai-events; any fit problem
 * throws before anything is uploaded) and its ai_events.posts row in review. A rebuild re-renders
 * each city's post from the cached scores (no Jev call) and keeps its look. No Claude call
 * anywhere in this type.
 *
 * The engine never finishes the run row: the worker (lib/ai-events/worker.ts) books the slot,
 * publishes the calendar snapshot and records the outcome and its spend.
 */
import { addCalendarDays } from '@/lib/instagram/window';
import { METRO_PROFILES } from '@/lib/networking/cities';
import { rankWeek, type RankWeekInput, type RankWeekResult } from '@/lib/networking/pick/rank';
import { weekFromKey } from '@/lib/networking/pick/week';
import { fillMissingCoverUrls } from '@/lib/networking/covers';
import { publicAccess, publicTags, safeHttpUrl } from '@/lib/networking/public-snapshot';
import type { StoredNetworkingEvent } from '@/lib/networking/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { HubQuery } from '@/lib/social-hub/db';
import { storeSlideJpegs } from '@/lib/social/overnight/slides';
import type { FitCheck, FitResult } from '@/lib/social/render/fit-check';
import type { Post as RenderPost } from '@/lib/social/render/types';

import type { BarTier } from '@/lib/networking/pick/picks';

import { AI_EVENTS_POST_METROS, AI_EVENTS_SLIDE_PREFIX, type AiEventsPostMetro } from './config';
import { isLook, LOOK_HISTORY, pickLook, type Look } from './looks';
import { buildAiEventsCityPost } from './post';
import { freeSlug, insertPost, recentDraws, updatePostRender, weekPost, type RunKind, type WeekPost } from './store';
import { AI_EVENTS_CITIES, AI_EVENTS_METROS, type AiEventsMetro, type CityPicks, type PickedEvent } from './types';

export type AiEventsEngineDeps = {
  query: HubQuery;
  /** The Jev transport (live: liveJevTransport; tests: a stub). rankWeek wraps it with the run cap and the cost log. */
  ask: JevTransport;
  fitCheck: FitCheck;
  upload: (objectPath: string, body: Buffer) => Promise<void>;
  now: Date;
  /** Math.random's shape, for the hook and look draws. */
  rand?: () => number;
  /** The ranking (tests may pass a stub). */
  rank?: (input: RankWeekInput) => Promise<RankWeekResult>;
};

/** `metros`: the post cities to make (the Sunday clock passes the ones with no post yet); all by default. */
export type AiEventsRunInput = { runId: string; kind: RunKind; weekKey: string; capUsd: number; metros?: readonly AiEventsPostMetro[] };

/** What the run record keeps per city: the picks, and what the hub needs to explain them. */
type CitySummary = {
  metro: AiEventsMetro;
  ranked: number;
  picks: Array<{ eventId: string; title: string; score: number | null; pinned: boolean; partner: string | null }>;
  remaining: number;
  /** The history bar tier and score the picks cleared (AE-28). */
  tier: BarTier | null;
  bar: number | null;
};

export type AiEventsRunRecord = {
  kind: RunKind;
  weekKey: string;
  scored?: number;
  reused?: number;
  failures?: Array<{ eventId: string; error: string }>;
  jev?: { calls: number; usd: number };
  cities?: CitySummary[];
};

/** One city's saved post (AE-29). */
export type SavedCityPost = { metro: AiEventsPostMetro; postId: string; created: boolean; look: Look; renderVersion: number; slides: number; tier: BarTier };

export type AiEventsRunResult =
  | {
      ok: true;
      outcome: 'saved';
      /** In posting order (Miami, then Boston); a city without enough picks has none. */
      posts: SavedCityPost[];
      /** Cities left without a post this run, and why. */
      skipped: Array<{ metro: AiEventsPostMetro; note: string }>;
      postDate: string;
      jevUsd: number;
      record: AiEventsRunRecord;
    }
  | { ok: true; outcome: 'skipped'; note: string; jevUsd: number; record: AiEventsRunRecord }
  | { ok: false; error: string; jevUsd: number; record: AiEventsRunRecord };

/** The Sunday a week's post goes out: the day before its Monday (AE-08). */
export function postDateFor(weekKey: string): string {
  return addCalendarDays(weekFromKey(weekKey).startDate, -1);
}

/** A ranked event as the post builder reads it, or null when it has no usable RSVP link. */
export function toPickedEvent(e: StoredNetworkingEvent): PickedEvent | null {
  if (!(AI_EVENTS_METROS as readonly string[]).includes(e.metro)) return null;
  const rsvpUrl = safeHttpUrl(e.canonicalUrl) ?? e.listings.map((l) => safeHttpUrl(l.url)).find(Boolean) ?? null;
  if (!rsvpUrl) return null;
  return {
    id: e.id,
    title: e.title,
    start: new Date(e.startAt).toISOString(),
    end: e.endAt ? new Date(e.endAt).toISOString() : null,
    timezone: e.timezone || METRO_PROFILES[e.metro].timezone,
    metro: e.metro as AiEventsMetro,
    organizer: e.organizerName || e.hostName || null,
    venue: e.venueName || null,
    city: e.city || null,
    price: { free: e.isFree === true, minCents: e.priceMinCents ?? null, maxCents: e.priceMaxCents ?? null, currency: e.priceCurrency || null },
    access: publicAccess(e),
    soldOut: e.isSoldOut === true,
    waitlist: e.waitlistActive === true,
    going: e.guestCount ?? null,
    rsvpUrl,
    signals: { format: null, tags: publicTags(e.sourceTags ?? []) },
    image: safeHttpUrl(e.signals?.coverUrl) ?? null,
  };
}

/**
 * The ranking's ranked list per city (the picks, then deeper ranks for the post's spotlights), in
 * post order (AE-02); a city with no picks stays, with none. `remainingCount` counts past the list.
 */
export function cityPicksOf(rank: RankWeekResult): CityPicks[] {
  return AI_EVENTS_METROS.map((metro) => {
    const city = rank.cities.find((c) => c.metro === metro);
    const deck = city?.deck ?? city?.picks ?? [];
    const picks = deck.map((p) => toPickedEvent(p.event)).filter((p): p is PickedEvent => p !== null);
    const total = (city?.picks.length ?? 0) + (city?.remainingCount ?? 0);
    return { metro, picks, remainingCount: Math.max(0, total - picks.length) };
  });
}

function summarize(rank: RankWeekResult): CitySummary[] {
  return AI_EVENTS_METROS.map((metro) => {
    const city = rank.cities.find((c) => c.metro === metro);
    return {
      metro,
      ranked: city?.ranked.length ?? 0,
      picks: (city?.picks ?? []).map((p) => ({ eventId: p.eventId, title: p.event.title, score: p.score, pinned: p.pinned, partner: p.partner ?? null })),
      remaining: city?.remainingCount ?? 0,
      tier: city?.tier ?? null,
      bar: city?.bar ?? null,
    };
  });
}

/** Every problem the fit-check found (text fit, bounds, fonts, images), as one list. */
function fitProblems(result: FitResult): string[] {
  return [
    ...result.problems,
    ...result.violations.map((v) => `slide ${v.slide} bounds: ${v.element} "${v.text}" over ${JSON.stringify(v.over)}`),
  ];
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The hook column for ranked city posts: their cover copy is fixed, so there is no hook draw (AE-29). */
export const RANKED_HOOK = 'ranked';

export async function runAiEvents(d: AiEventsEngineDeps, input: AiEventsRunInput): Promise<AiEventsRunResult> {
  const { query: q } = d;
  const week = weekFromKey(input.weekKey);
  const record: AiEventsRunRecord = { kind: input.kind, weekKey: week.weekKey };
  const existing = new Map<AiEventsPostMetro, WeekPost | null>();
  for (const metro of AI_EVENTS_POST_METROS) existing.set(metro, await weekPost(q, week.weekKey, metro));
  const wanted = input.metros ?? AI_EVENTS_POST_METROS;
  const open = AI_EVENTS_POST_METROS.filter((m) => wanted.includes(m) && (!existing.get(m) || existing.get(m)!.status === 'review'));
  if (!open.length) {
    return { ok: true, outcome: 'skipped', note: `The week's posts are already past review; nothing was changed.`, jevUsd: 0, record };
  }

  let rank: RankWeekResult;
  try {
    rank = await (d.rank ?? rankWeek)({
      q,
      ask: d.ask,
      weekKey: week.weekKey,
      runId: input.runId,
      now: d.now,
      capUsd: input.capUsd,
      scoreNew: input.kind !== 'rebuild',
    });
  } catch (error) {
    return { ok: false, error: `ranking failed: ${errorText(error)}`, jevUsd: 0, record };
  }
  const jevUsd = rank.jev.usd;
  Object.assign(record, { scored: rank.scored, reused: rank.reused, failures: rank.failures.slice(0, 10), jev: rank.jev, cities: summarize(rank) });

  const deckEvents = rank.cities.flatMap((city) => (city.deck ?? city.picks).map((pick) => pick.event));
  await fillMissingCoverUrls(q, deckEvents);
  const cities = cityPicksOf(rank);
  const postDate = postDateFor(week.weekKey);
  const posts: SavedCityPost[] = [];
  const skipped: Array<{ metro: AiEventsPostMetro; note: string }> = [];

  try {
    for (const metro of open) {
      const city = cities.find((c) => c.metro === metro);
      const ranking = rank.cities.find((c) => c.metro === metro);
      if (!city || city.picks.length < 2) {
        skipped.push({ metro, note: `${AI_EVENTS_CITIES[metro].short} has fewer than 2 ranked events this week, so there is no post.` });
        continue;
      }
      const own = existing.get(metro) ?? null;
      // A rebuild keeps the post's look; a new post draws one not used by the last 2 posts (AE-13).
      let look: Look;
      if (own && isLook(own.look)) look = own.look;
      else look = pickLook((await recentDraws(q, LOOK_HISTORY)).looks, { rand: d.rand });

      const render: RenderPost = buildAiEventsCityPost({
        weekKey: week.weekKey,
        weekStart: week.startDate,
        weekEnd: week.endDate,
        metro,
        picks: city.picks,
        totalCount: city.picks.length + city.remainingCount,
        look,
      });
      const slug = own?.slug ?? (await freeSlug(q, week.weekKey, metro));
      const renderVersion = own ? own.renderVersion + 1 : 1;
      // A new folder per render, so a rebuild never serves an older JPEG from a cache.
      const slideObjects = await storeSlideJpegs(`${slug}/v${renderVersion}`, render, {
        prefix: AI_EVENTS_SLIDE_PREFIX,
        fitCheck: async (post, opts) => {
          const result = await d.fitCheck(post, opts);
          const problems = fitProblems(result);
          if (problems.length) throw new Error(`the ${metro} render has ${problems.length} problem(s): ${problems.slice(0, 5).join('; ')}`);
          return result;
        },
        upload: d.upload,
      });
      const tier = ranking?.tier ?? 'gates';
      const saved = { runId: input.runId, eventIds: city.picks.map((p) => p.id), cities: [city], render, caption: render.caption, slideObjects, metro, barTier: tier };
      let postId: string;
      if (own) {
        if (!(await updatePostRender(q, own.id, renderVersion, saved))) throw new Error(`the ${metro} post ${own.id} left review while it was rebuilt`);
        postId = own.id;
      } else {
        postId = await insertPost(q, slug, { ...saved, weekKey: week.weekKey, nyDate: postDate, hook: RANKED_HOOK, look });
      }
      posts.push({ metro, postId, created: !own, look, renderVersion, slides: slideObjects.length, tier });
    }
  } catch (error) {
    return { ok: false, error: errorText(error), jevUsd, record };
  }
  if (!posts.length) {
    return { ok: true, outcome: 'skipped', note: skipped.map((s) => s.note).join(' ') || 'No city post was made.', jevUsd, record };
  }
  return { ok: true, outcome: 'saved', posts, skipped, postDate, jevUsd, record };
}
