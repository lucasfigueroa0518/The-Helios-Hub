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
import { UNTRUSTED_MAX_CHARS, type TipCandidate } from '@/lib/field-notes/sources/candidate';
import { enrichItem, type EnrichDeps, type EnrichMode } from '@/lib/field-notes/sources/enrich';
import { FIELD_NOTES_SCORE } from '@/lib/field-notes/sources/questions';
import { scoreCandidate } from '@/lib/field-notes/sources/score';
import type { TipSourceKind } from '@/lib/field-notes/types';
import type { AdapterItem } from '@/lib/reels/types';
import { hubFeedSlug } from '@/lib/carousels/hub-sources';
import { BUILDER, MAJOR_NEWS } from '@/lib/stories/questions';
import { builderScore, majorNewsScore } from '@/lib/stories/scores';

import type { Family, IntakeItem, IntakeJev, IntakeQuery, IntakeStory, Scorecard, ScorecardId } from './types';

/* ── member helpers ───────────────────────────────────────────────────── */

const ROLE_ORDER = { primary: 0, supporting: 1, merged_duplicate: 2 } as const;
const roleRank = (m: IntakeItem) => ROLE_ORDER[m.role ?? 'supporting'];
const seenMs = (m: IntakeItem) => m.firstSeenAt.getTime();

/** Field Notes' trusted metadata for an item (column `field_notes_meta`): its registry source and the candidate's item metadata. */
export type FieldNotesMeta = {
  kind: TipSourceKind;
  label: string;
  /** TipCandidate.item (no scraped text); dates arrive as ISO strings from jsonb. */
  item: Record<string, unknown>;
  /** The registry entry's enrichment (README or linked page), or null. */
  enrich: EnrichMode | null;
  publishedAt: string | null;
};

/**
 * Phase 2 helper type: an item as read from the store, with its Field Notes membership. `fieldNotesSourceId` is the
 * SOURCE_REGISTRY entry id (set on every item a Field Notes source carries, including one a reels adapter or a feed
 * stored first); a 'field-notes' family item also has `sourceId` = `field-notes:<entry id>`.
 */
export type FieldNotesMember = IntakeItem & { fieldNotesSourceId?: string | null; fieldNotesMeta?: FieldNotesMeta | null };

type Membership = Pick<IntakeItem, 'family' | 'dropReason'> &
  Partial<Pick<IntakeItem, 'feedSlug' | 'feedDropReason' | 'feedSourceName' | 'reelsSourceId' | 'reelsDropReason'>> & { fieldNotesSourceId?: string | null };

/**
 * Whether a list keeps the item as a member of `family` (review fix 1). Feeds and reels membership is per list
 * (`feed_slug` / `reels_source_id` set, its own drop reason null), whichever list stored the URL first; search and
 * seed follow `family`. Rows from before the membership columns fall back to `family` + `dropReason`.
 */
export function keptIn(m: Membership, family: Family): boolean {
  const dropped = m.dropReason ?? null;
  if (family === 'feeds') return m.feedSlug != null ? (m.feedDropReason ?? null) === null : m.family === 'feeds' && dropped === null;
  if (family === 'reels') return m.reelsSourceId != null ? (m.reelsDropReason ?? null) === null : m.family === 'reels' && dropped === null;
  // Field Notes never drops an item at fetch time (its own AI gate is part of the score).
  if (family === 'field-notes') return m.fieldNotesSourceId != null || m.family === 'field-notes';
  return m.family === family && dropped === null;
}

const FAMILIES: readonly Family[] = ['reels', 'feeds', 'search', 'seed', 'field-notes'];

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

/**
 * Phase 2 (carousel parity): today's carousel also scores the reels primary adapters' items as articles (hub
 * sources, feed slug `reels-<adapter id>`, lib/carousels/hub-sources.ts). story-scoring reads the kept feed members
 * as their feed saw them plus the kept reels members (not search deposits) as the carousel's hub articles.
 */
export function carouselMembersOf(story: IntakeStory): IntakeItem[] {
  return membersOf(story, ['feeds', 'reels']).map((m) =>
    keptIn(m, 'feeds') ? asFeedMember(m) : { ...m, sourceId: `feed:${hubFeedSlug(m.reelsSourceId ?? m.sourceId)}` },
  );
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
  // Reels' own seeds are scored like a stored idea (legacy addReelSeed scores on entry); other orders' seeds are not.
  families: ['reels', 'search', 'seed'],
  keepMember: (m) => m.family !== 'seed' || m.sourceId === 'seed:reels',
  async score(story, jev) {
    const members = byRole(membersOf(story, ['reels', 'search', 'seed']).filter((m) => REELS_SCORE.keepMember!(m)));
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

/**
 * story-scoring@4 on the feeds members plus the reels members (the carousel's hub articles; Phase 2 parity), exactly
 * as scoreGroups/judge, with no posted list (so `already_posted` is never asked).
 */
export const STORY_SCORING: Scorecard = {
  id: 'story-scoring',
  version: StoryScoring.VERSION,
  families: ['feeds', 'reels'],
  async score(story, jev) {
    const group = storyGroupOf(story, carouselMembersOf(story));
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

/* ── field-notes-score (Phase 2, Owner A) ─────────────────────────────── */

const dateOrNull = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** The story's Field Notes member: a 'field-notes' family item first, else the first item a Field Notes source carries. */
export function fieldNotesMemberOf(story: IntakeStory): FieldNotesMember | null {
  const members = membersOf(story, ['field-notes']) as FieldNotesMember[];
  return members.find((m) => m.family === 'field-notes') ?? members[0] ?? null;
}

/** The raw adapter item behind a Field Notes member (text = the stored headline and body; metadata from field_notes_meta). */
export function fieldNotesAdapterItem(m: FieldNotesMember): AdapterItem {
  const meta = (m.fieldNotesMeta?.item ?? {}) as Record<string, unknown>;
  return {
    ...(meta as Partial<AdapterItem>),
    canonicalUrl: m.key,
    headline: m.headline,
    body: m.body,
    publishTime: dateOrNull(meta.publishTime) ?? m.publishTime,
  };
}

/**
 * The TipCandidate a Field Notes member stands for, as Field Notes' collect built it: registry kind and label
 * (never scraped), the canonical link, and the scraped title and body only in untrustedContent. Null when the
 * item carries no Field Notes metadata.
 */
export function fieldNotesCandidateOf(m: FieldNotesMember): TipCandidate | null {
  const meta = m.fieldNotesMeta;
  if (!meta) return null;
  const { headline: _h, body: _b, author: _a, byline: _y, rawPayload: _r, canonicalUrl: _c, ...item } = fieldNotesAdapterItem(m);
  return {
    sourceUrl: m.key,
    sourceKind: meta.kind,
    sourceLabel: meta.label,
    publishedAt: meta.publishedAt ?? (m.publishTime ? m.publishTime.toISOString() : null),
    item,
    untrustedContent: `${m.headline}\n\n${m.body}`.trim().slice(0, UNTRUSTED_MAX_CHARS),
  };
}

/** A JevTransport over the intake Jev (its cap and cost bucket), for Field Notes' scoreCandidate. */
function fieldNotesTransport(jev: IntakeJev, meter: { usd: number; answers: Record<string, unknown> }, subjectId: string) {
  const runner = jev.asReelsRunner();
  return {
    async systemOne<const Q extends Questions>(state: Parameters<JevRunner['ask']>[0]['state'], questions: Q): Promise<SystemOneResult<Q>> {
      const res = await runner.ask({ component: FIELD_NOTES_SCORE.version, state, sets: [FIELD_NOTES_SCORE], questions, runId: null, sourceId: subjectId });
      meter.usd += jevUsd(res.usage.input_tokens);
      Object.assign(meter.answers, res.answers);
      return res;
    },
  };
}

export type FieldNotesCardOptions = {
  /** README / linked-page fetchers (default: Field Notes' live fetchers, loaded only when an item is enriched). */
  enrich?: EnrichDeps | (() => Promise<EnrichDeps>);
  /** The store, to keep an enriched body on the item (Field Notes saves item.body as the tip text). */
  query?: IntakeQuery;
  /** "Today" for the score state (default: the New York date of now). */
  today?: () => string;
};

/** Field Notes' live enrichment fetchers (lib/field-notes/live.ts), loaded on first use: never in tests. */
async function liveEnrichDeps(): Promise<EnrichDeps> {
  const [{ fetchText, fetchPageFollowingRedirects }, { PAGE_MAX_BYTES }] = await Promise.all([
    import('@/lib/reels/net/http'),
    import('@/lib/field-notes/sources/enrich'),
  ]);
  return {
    fetchText: (url) => fetchText(url, { retries: 0, timeoutMs: 15_000, maxBytes: PAGE_MAX_BYTES }),
    fetchPage: (url) => fetchPageFollowingRedirects(url, { retries: 0, timeoutMs: 15_000, blockPrivate: true, maxBytes: PAGE_MAX_BYTES }),
  };
}

const nyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export type FieldNotesScorecard = Scorecard & {
  /** The same card, keeping enriched bodies on the items through `query` (run.ts binds the run's store). */
  withQuery(query: IntakeQuery): FieldNotesScorecard;
};

export const isFieldNotesScorecard = (card: Scorecard): card is FieldNotesScorecard =>
  card.id === 'field-notes-score' && typeof (card as Partial<FieldNotesScorecard>).withQuery === 'function';

/**
 * field-notes-score@3 on the story's one Field Notes member, through Field Notes' own scoreCandidate (wording
 * unchanged). The body is enriched (README or linked page, per its source) only for an item this card scores, and
 * the enriched body is kept on the item. Never reads field_notes.tips (per-type state): Field Notes drops links it
 * already stored at pick time. The per-run cap (MAX_SCORED_PER_RUN, in scoringOrder) is applied by the run
 * (lib/intake/field-notes-cap.ts) before this card is called.
 */
export function fieldNotesCard(opts: FieldNotesCardOptions = {}): FieldNotesScorecard {
  let enrichDeps: Promise<EnrichDeps> | null = null;
  const getEnrich = () => (enrichDeps ??= typeof opts.enrich === 'function' ? opts.enrich() : Promise.resolve(opts.enrich ?? null).then((d) => d ?? liveEnrichDeps()));
  return {
    id: 'field-notes-score',
    version: FIELD_NOTES_SCORE.version,
    families: ['field-notes'],
    withQuery: (query) => fieldNotesCard({ ...opts, query }),
    async score(story, jev) {
      const member = fieldNotesMemberOf(story);
      if (!member) throw new Error(`story ${story.id} has no Field Notes member`);
      let item = member;
      const mode = member.fieldNotesMeta?.enrich ?? null;
      if (mode) {
        const raw = fieldNotesAdapterItem(member);
        const enriched = await enrichItem(raw, mode, await getEnrich());
        if (enriched !== raw && enriched.body.length > member.body.length) {
          item = { ...member, body: enriched.body };
          await opts.query?.query(`UPDATE intake.items SET body = $2 WHERE key = $1`, [member.key, enriched.body]);
        }
      }
      const candidate = fieldNotesCandidateOf(item);
      if (!candidate) throw new Error(`story ${story.id}: its Field Notes member has no source metadata`);
      const meter = { usd: 0, answers: {} as Record<string, unknown> };
      const scored = await scoreCandidate(candidate, { transport: fieldNotesTransport(jev, meter, story.id), today: (opts.today ?? nyToday)() });
      return {
        answers: meter.answers,
        result: {
          kind: 'field-notes-score',
          score: scored.score,
          tags: { leaf: scored.leaf, want: scored.want, tier: scored.tier, purposes: scored.purposes, fresh: scored.fresh },
          answers: scored.answers,
        },
        usd: meter.usd,
      };
    },
  };
}

export const FIELD_NOTES_CARD: FieldNotesScorecard = fieldNotesCard();

/** Every scorecard the intake runs (reels-screen is per item and lives with the fetch, Owner A). */
export const INTAKE_SCORECARDS: readonly Scorecard[] = [REELS_SCORE, STORY_SCORING, MAJOR_NEWS_CARD, BUILDER_CARD, FIELD_NOTES_CARD];

export const scorecardById = (cards: readonly Scorecard[], id: ScorecardId) => cards.find((c) => c.id === id);
