/**
 * Central intake scorecards (Owner B; plan Phase 1 contract, round 4). Each
 * one calls an existing question set UNCHANGED, with the same state shape its
 * home type sends today, on the story's members of its own families only (so
 * the scores match today's). None reads per-night state: story-scoring@4 runs
 * without `already_posted` (see lib/intake/posted.ts).
 */
import type { SystemOneResult, Questions } from '@typesafe-ai/sdk';

import { SCORING_PASS_1 } from '@/lib/reels/jev/questions/scoring-pass1';
import { SCORING_PASS_2 } from '@/lib/reels/jev/questions/scoring-pass2';
import { jevUsd, type JevRequest, type JevRunner } from '@/lib/reels/jev/runner';
import { scoreOneIdea } from '@/lib/reels/pipeline/scoring';
import type { IdeaMaterial } from '@/lib/reels/scoring/store';
import { jevCostUsd, type JevAsk } from '@/lib/social/jev/client';
import * as StoryScoring from '@/lib/social/jev/questions/story-scoring.v4';
import type { IngestArticle, StoryGroup } from '@/lib/social/ingest/select/types';
import { scoreGroups } from '@/lib/social/ingest/select/score';
import { BUILDER, MAJOR_NEWS } from '@/lib/stories/questions';
import { builderScore, majorNewsScore } from '@/lib/stories/scores';

import type { Family, IntakeItem, IntakeJev, IntakeStory, Scorecard, ScorecardId } from './types';

/* ── member helpers ───────────────────────────────────────────────────── */

const ROLE_ORDER = { primary: 0, supporting: 1, merged_duplicate: 2 } as const;
const roleRank = (m: IntakeItem) => ROLE_ORDER[m.role ?? 'supporting'];
const seenMs = (m: IntakeItem) => m.firstSeenAt.getTime();

type Membership = Pick<IntakeItem, 'family' | 'dropReason'> &
  Partial<Pick<IntakeItem, 'feedSlug' | 'feedDropReason' | 'feedSourceName' | 'reelsSourceId' | 'reelsDropReason'>>;

/**
 * Whether a list keeps the item as a member of `family` (review fix 1). Feeds and reels membership is per list
 * (`feed_slug` / `reels_source_id` set, its own drop reason null), whichever list stored the URL first; search and
 * seed follow `family`. Rows from before the membership columns fall back to `family` + `dropReason`.
 */
export function keptIn(m: Membership, family: Family): boolean {
  const dropped = m.dropReason ?? null;
  if (family === 'feeds') return m.feedSlug != null ? (m.feedDropReason ?? null) === null : m.family === 'feeds' && dropped === null;
  if (family === 'reels') return m.reelsSourceId != null ? (m.reelsDropReason ?? null) === null : m.family === 'reels' && dropped === null;
  return m.family === family && dropped === null;
}

const FAMILIES: readonly Family[] = ['reels', 'feeds', 'search', 'seed'];

/** Every family that keeps the item (empty: dropped by all its lists). */
export const keptFamilies = (m: Membership): Family[] => FAMILIES.filter((f) => keptIn(m, f));

/** The story's members kept by at least one of these families. */
export function membersOf(story: IntakeStory, families: readonly Family[]): IntakeItem[] {
  return story.members.filter((m) => families.some((f) => keptIn(m, f)));
}

/** A member as its feed saw it: the feed's outlet name and slug (a reels-first URL keeps the adapter's otherwise). */
export function asFeedMember(m: IntakeItem): IntakeItem {
  return m.feedSlug ? { ...m, sourceName: m.feedSourceName ?? m.sourceName, sourceId: `feed:${m.feedSlug}` } : m;
}

/** The story's kept feed members, each as its feed saw it (story-scoring's outlets and feed slugs). */
export function feedMembersOf(story: IntakeStory): IntakeItem[] {
  return membersOf(story, ['feeds']).map(asFeedMember);
}

/** Primary first, then supporting, then merged duplicates; earliest seen first within a role (reels loadIdeaMaterial order). */
export function byRole(members: readonly IntakeItem[]): IntakeItem[] {
  return [...members].sort((a, b) => roleRank(a) - roleRank(b) || seenMs(a) - seenMs(b));
}

/** The representative: the story's representative key when it is in the list, else the primary, else the earliest. */
export function representativeOf(story: IntakeStory, members: readonly IntakeItem[]): IntakeItem {
  if (members.length === 0) throw new Error(`story ${story.id} has no members for this scorecard`);
  return members.find((m) => m.key === story.representativeKey) ?? byRole(members)[0]!;
}

const distinct = (xs: string[]) => [...new Set(xs.filter((x) => x.length > 0))];
const longestBody = (members: readonly IntakeItem[]) => members.reduce((b, m) => (m.body.length > b.length ? m.body : b), '');
const publishedOf = (m: IntakeItem) => m.publishTime ?? m.firstSeenAt;

function asArticle(m: IntakeItem): IngestArticle {
  return {
    feedSlug: m.sourceId.replace(/^feed:/, ''),
    feedKind: /news\.google\./.test(m.url) ? 'google-news' : 'native',
    source: m.sourceName,
    sourceUrl: m.url,
    headline: m.headline,
    byline: null,
    body: m.body,
    publishedAt: publishedOf(m),
  };
}

/**
 * A social StoryGroup from intake members (the feeds family for story-scoring@4).
 * Outlets are the distinct source names; the body is the most text any member has
 * (social's post-enrichment body); the representative is the primary or earliest.
 */
export function storyGroupOf(story: IntakeStory, members: readonly IntakeItem[]): StoryGroup {
  const rep = representativeOf(story, members);
  const newestFirst = [...members].sort((a, b) => publishedOf(b).getTime() - publishedOf(a).getTime());
  const outlets = distinct(members.map((m) => m.sourceName));
  return {
    id: story.id,
    members: newestFirst.map((m) => ({ url: m.url, outlet: m.sourceName, title: m.headline, publishedAt: publishedOf(m), feedSlug: m.sourceId.replace(/^feed:/, '') })),
    outlets,
    outletCount: outlets.length,
    publishedAt: publishedOf(newestFirst[0]!),
    representative: asArticle(rep),
    articles: byRole(members).map(asArticle),
    body: longestBody(members) || rep.body,
    read: [],
    tried: [],
  };
}

/* ── cost-recording wrappers (the Jev records the run total; these give per-scorecard usd) ── */

function meteredAsk(jev: IntakeJev): { ask: JevAsk; usd: () => number; answers: Record<string, unknown> } {
  const inner = jev.asSocialAsk();
  let usd = 0;
  const answers: Record<string, unknown> = {};
  return {
    ask: async (request, meta) => {
      const res = await inner(request, meta);
      usd += jevCostUsd(res.usage);
      Object.assign(answers, res.answers);
      return res;
    },
    usd: () => usd,
    answers,
  };
}

function meteredRunner(jev: IntakeJev): { runner: JevRunner; usd: () => number; answers: Record<string, unknown> } {
  const inner = jev.asReelsRunner();
  let usd = 0;
  const answers: Record<string, unknown> = {};
  const runner: JevRunner = {
    async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
      const res = await inner.ask(request);
      usd += jevUsd(res.usage.input_tokens);
      answers[request.component] = res.answers;
      return res;
    },
    get callCount() {
      return inner.callCount;
    },
  };
  return { runner, usd: () => usd, answers };
}

/* ── the scorecards ───────────────────────────────────────────────────── */

const ALL_FAMILIES: readonly Family[] = ['reels', 'feeds', 'search', 'seed'];
const BODY_CHARS = 9000; // lib/lfd/pick.ts scoreMajor

/** reels pass 1 + pass 2 (net, blockbuster, bucket) on the reels and search members, as scoreOneIdea does for a stored idea. */
export const REELS_SCORE: Scorecard = {
  id: 'reels-score',
  version: `${SCORING_PASS_1.version}+${SCORING_PASS_2.version}`,
  families: ['reels', 'search'],
  async score(story, jev) {
    const members = byRole(membersOf(story, ['reels', 'search']));
    const idea: IdeaMaterial = {
      id: story.id,
      lastJoinedMs: story.lastJoinedAt.getTime(),
      members: members.map((m) => ({ role: m.role ?? 'supporting', sourceName: m.sourceName, headline: m.headline, body: m.body })),
    };
    const meter = meteredRunner(jev);
    const score = await scoreOneIdea(story.id, meter.runner, idea, null);
    return { answers: meter.answers, result: { kind: 'reels-score', score }, usd: meter.usd() };
  },
};

/** story-scoring@4 on the feeds members, exactly as scoreGroups/judge, with no posted list (so `already_posted` is never asked). */
export const STORY_SCORING: Scorecard = {
  id: 'story-scoring',
  version: StoryScoring.VERSION,
  families: ['feeds'],
  async score(story, jev) {
    const group = storyGroupOf(story, feedMembersOf(story));
    const meter = meteredAsk(jev);
    const [scored] = await scoreGroups([group], meter.ask, []);
    return {
      answers: meter.answers,
      result: { kind: 'story-scoring', status: scored!.status, probSum: scored!.probSum, outletCount: scored!.outletCount, answers: scored!.answers },
      usd: meter.usd(),
    };
  },
};

/** The scoreMajor state (lib/lfd/pick.ts): headline, outlets (representative first), published, story text under untrusted_content. */
export function majorState(story: IntakeStory, members: readonly IntakeItem[]) {
  const rep = representativeOf(story, members);
  const dated = members.map((m) => m.publishTime).filter((d): d is Date => d !== null);
  const published = rep.publishTime ?? dated.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    headline: story.headline || rep.headline,
    outlets: distinct([rep.sourceName, ...members.map((m) => m.sourceName)]),
    published: published ? published.toISOString() : null,
    story: { untrusted_content: (rep.body || longestBody(members)).slice(0, BODY_CHARS) },
  };
}

function oneSetScorecard(id: 'major-news' | 'story-builder', set: typeof MAJOR_NEWS | typeof BUILDER, toScore: (a: Record<string, { noul: number }>) => number): Scorecard {
  return {
    id,
    version: set.version,
    families: ALL_FAMILIES,
    async score(story, jev) {
      const meter = meteredAsk(jev);
      const res = await meter.ask({ state: majorState(story, membersOf(story, ALL_FAMILIES)), questions: set.questions }, { version: set.version, subjectId: story.id });
      const score = toScore(res.answers as Record<string, { noul: number }>);
      const result = id === 'major-news' ? ({ kind: 'major-news', score } as const) : ({ kind: 'story-builder', score } as const);
      return { answers: meter.answers, result, usd: meter.usd() };
    },
  };
}

export const MAJOR_NEWS_CARD: Scorecard = oneSetScorecard('major-news', MAJOR_NEWS, majorNewsScore);
export const BUILDER_CARD: Scorecard = oneSetScorecard('story-builder', BUILDER, builderScore);

/** Every scorecard Owner B builds (reels-screen is per item and lives with the fetch, Owner A). */
export const INTAKE_SCORECARDS: readonly Scorecard[] = [REELS_SCORE, STORY_SCORING, MAJOR_NEWS_CARD, BUILDER_CARD];

export const scorecardById = (cards: readonly Scorecard[], id: ScorecardId) => cards.find((c) => c.id === id);
