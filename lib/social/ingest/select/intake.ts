/**
 * Carousel selection in intake mode (Central Intake Phase 2, Owner C;
 * planning/Central Intake/PHASE2-CONTRACT.md):
 *
 *   intake stories carrying a story-scoring@4 result (listOrderStories 'carousel')
 *   → today's code filters on their members → freshness window → posted check
 *   at pick time (lib/intake/posted.ts) → rankQualified → mergeSameEvent
 *   → spreadByCompany → pickWinners → shortlist read top-up, as select.ts
 *
 * No feed or hub-adapter fetch and no groupArticles / scoreGroups Jev calls:
 * the intake grouped and scored the stories. The Jev calls left are the ones
 * that depend on tonight (the posted check, same-event folding, the
 * different-story pick), as in Phase 1's pool reads. The result has the
 * legacy Selection shape, so `social.runs.record.selection` keeps its shape:
 * each story becomes buildGroup's group over its members (id = the first-choice
 * member's URL), as groupArticles makes it.
 *
 * Feed health comes from the latest successful intake run's per-source
 * results (IntakeRunRecord.sources), one row per carousel feed and hub
 * adapter, as buildFeedHealth writes today.
 */
import { mapPool } from '@/lib/async-pool';
import { hubFeedSlug } from '@/lib/carousels/hub-sources';
import { postedCheck as livePostedCheck } from '@/lib/intake/posted';
import { lastRuns } from '@/lib/intake/read';
import { asFeedMember, keptIn, storyGroupOf, STORY_SCORING } from '@/lib/intake/scorecards';
import type { IntakeItem, IntakeJev, IntakeQuery, IntakeRunRecord, PostedCheck, ScorecardId, ScoredStory } from '@/lib/intake/types';
import type { FeedConfig } from '@/lib/social/feeds';
import { createJevTally, tallied, type JevAsk, type JevTally } from '@/lib/social/jev/client';
import * as Scoring from '@/lib/social/jev/questions/story-scoring.v4';
import { dayKey } from '@/lib/social/pipeline/set-aside-log';

import { codeFilterReason, contentFarmReason } from './code-filters';
import { mergeSameEvent } from './dedupe';
import { enrichGroup, THIN_BODY_CHARS, topUpReadSources, type FetchBody } from './enrich';
import type { FeedHealthEntry } from './feed-health';
import type { PostedStories } from './posted';
import { pickWinners, rankQualified, spreadByCompany, WINNERS } from './rank';
import { buildGroup } from './group';
import { judge } from './score';
import type { Selection } from './select';
import type { ScoredGroup, SkipEntry, StoryGroup } from './types';
import { inWindow, windowHours, WIDENED_HOURS } from './window';

/** Owner A's read (lib/intake/read.ts): the order's stories since `since`, with the scores asked for. */
export type ListOrderStories = (
  q: IntakeQuery,
  order: 'carousel',
  input: { since: Date; needScores?: readonly ScorecardId[] },
) => Promise<ScoredStory[]>;

export type IntakePool = { stories: ScoredStory[]; record: IntakeRunRecord | null };

/** The latest successful intake run's record (main or top-up, whichever is newer; lib/intake/read.ts lastRuns). */
export async function readLatestIntakeRecord(q: IntakeQuery): Promise<IntakeRunRecord | null> {
  const { main, topup } = await lastRuns(q);
  const newest = [main, topup].filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  if (!newest) return null;
  const { rows } = await q.query<{ record: IntakeRunRecord | string | null }>(`SELECT record FROM intake.runs WHERE id = $1`, [newest.id]);
  const raw = rows[0]?.record ?? null;
  return typeof raw === 'string' ? (JSON.parse(raw) as IntakeRunRecord) : raw;
}

/**
 * The pool the carousel reads in intake mode: stories touched in the widened window (48 h) that carry a story-scoring
 * result. Throws when the story read fails (the caller falls back to today's path); a failed run-record read only
 * costs feed health.
 */
export async function readIntakePool(
  deps: { query: IntakeQuery; listOrderStories: ListOrderStories; readRunRecord?: (q: IntakeQuery) => Promise<IntakeRunRecord | null> },
  now: Date,
): Promise<IntakePool> {
  const since = new Date(now.getTime() - WIDENED_HOURS * 3_600_000);
  const stories = await deps.listOrderStories(deps.query, 'carousel', { since, needScores: ['story-scoring'] });
  let record: IntakeRunRecord | null = null;
  try {
    record = await (deps.readRunRecord ?? readLatestIntakeRecord)(deps.query);
  } catch {
    record = null;
  }
  return { stories, record };
}

/* ── stories as the carousel's groups ─────────────────────────────────── */

/** A member as the carousel saw it: a feed member as its feed, a reels-adapter member as its hub feed (`reels-<id>`). */
export function carouselMember(m: IntakeItem): IntakeItem {
  if (keptIn(m, 'feeds')) return asFeedMember(m);
  return { ...m, sourceId: `feed:${hubFeedSlug(m.reelsSourceId ?? m.sourceId)}` };
}

/** The members story-scoring read (its families), as the carousel saw them. */
export function carouselMembersOf(story: ScoredStory): IntakeItem[] {
  return story.members.filter((m) => STORY_SCORING.families.some((f) => keptIn(m, f))).map(carouselMember);
}

const publishedOf = (m: IntakeItem) => m.publishTime ?? m.firstSeenAt;

type Entry = { story: ScoredStory; group: ScoredGroup | null; skips: Array<SkipEntry & { at: Date }>; newest: Date };

/** enrichGroup's page reader, never called here: it reads only when no member has THIN_BODY_CHARS of text. */
const NO_FETCH: FetchBody = async () => {
  throw new Error('carousel intake selection fetches no page while scoring');
};

/**
 * One intake story as the ScoredGroup selection would have made: today's code filters drop members (each logged as
 * selection logs it), the group is buildGroup's (id = the first-choice member's URL, outlets by outletName), the representative and
 * read members are enrichGroup's when a member already has enough text (the intake stored its enriched text; no
 * fetch), and judge() reads the stored story-scoring answers (no Jev call). A story with only thin text keeps its
 * members untried, so the shortlist top-up may still read their pages for the Reporter, as today.
 */
export async function intakeEntry(story: ScoredStory): Promise<Entry> {
  const kept: IntakeItem[] = [];
  const skips: Entry['skips'] = [];
  for (const m of carouselMembersOf(story)) {
    const reason = codeFilterReason(m.headline) ?? contentFarmReason({ headline: m.headline, source: m.sourceName, sourceUrl: m.url });
    if (reason) skips.push({ id: m.url, reason, stage: 'code-filter', at: publishedOf(m) });
    else kept.push(m);
  }
  const newest = story.members.length ? new Date(Math.max(...story.members.map((m) => publishedOf(m).getTime()))) : story.lastJoinedAt;
  const sc = story.scores['story-scoring'];
  if (!sc || kept.length === 0) return { story, group: null, skips, newest };
  // groupArticles' own group over the members (id, members, outlets, preference order), without its Jev pairing.
  const grouped: StoryGroup = buildGroup(storyGroupOf(story, kept).articles);
  const best = grouped.articles.reduce((a, b) => (b.body.length > a.body.length ? b : a));
  const enriched = best.body.length >= THIN_BODY_CHARS ? await enrichGroup(grouped, NO_FETCH) : { ...grouped, representative: best, body: best.body || grouped.body };
  return { story, group: judge(enriched, sc.answers), skips, newest: grouped.publishedAt };
}

/* ── feed health from the intake run record ───────────────────────────── */

/**
 * One row per carousel feed, then per hub adapter, as buildFeedHealth: `fetched` is what the intake fetched from that
 * source, `inWindow` how many of the carousel pool's members from it fall in tonight's window, and a source that
 * fetched nothing or failed is flagged. A source the record does not name counts as 0 (flagged).
 */
export function intakeFeedHealth(
  record: IntakeRunRecord | null,
  opts: { feeds: readonly FeedConfig[]; adapterNames: ReadonlyMap<string, string>; groups: readonly ScoredGroup[]; now: Date; hours: number },
): FeedHealthEntry[] {
  if (!record) return [];
  const day = dayKey(opts.now);
  const bySource = new Map(record.sources.map((s) => [s.id, s]));
  const members = opts.groups.flatMap((g) => g.members);
  const row = (sourceId: string, slug: string, name: string): FeedHealthEntry => {
    const s = bySource.get(sourceId);
    const fetched = s?.fetched ?? 0;
    const inWin = members.filter((m) => m.feedSlug === slug && inWindow(m, opts.now, opts.hours)).length;
    return { day, slug, name, fetched, inWindow: inWin, flagged: fetched === 0 || Boolean(s?.error) };
  };
  return [
    ...opts.feeds.filter((f) => !f.slug.startsWith('reels-')).map((f) => row(`feed:${f.slug}`, f.slug, f.name)),
    ...[...opts.adapterNames].map(([id, name]) => row(id, hubFeedSlug(id), name)),
  ];
}

/* ── selection ────────────────────────────────────────────────────────── */

/** The run's JevAsk as the intake's Jev, for the posted check (its cost lands on the carousel's tally, as today). */
export function socialAskAsIntakeJev(ask: JevAsk): IntakeJev {
  return {
    asSocialAsk: () => ask,
    asReelsRunner: () => {
      throw new Error('carousel selection: no reels runner');
    },
    usd: 0,
    calls: 0,
  };
}

export type IntakeSelectInput = IntakePool & {
  feeds: readonly FeedConfig[];
  adapterNames?: ReadonlyMap<string, string>;
  now: Date;
  jev: JevAsk;
  posted: PostedStories;
  fetchBody: FetchBody;
  postedCheck?: PostedCheck;
  tally?: JevTally;
};

export async function selectIntakeStories(input: IntakeSelectInput): Promise<Selection> {
  const tally = input.tally ?? createJevTally();
  const jev = tallied(input.jev, tally);
  const check = input.postedCheck ?? livePostedCheck;
  const postedHeadlines = await input.posted.recentHeadlines(input.now);

  // One group per representative URL (a group's id), newest-touched story first.
  const seen = new Set<string>();
  const entries = (await Promise.all(input.stories.map(intakeEntry))).filter((e) => {
    if (!e.group) return true;
    if (seen.has(e.group.id)) return false;
    seen.add(e.group.id);
    return true;
  });
  const storyOf = new Map(entries.flatMap((e) => (e.group ? [[e.group.id, e.story] as const] : [])));

  // The posted check, once per story across both passes.
  const checked = new Set<string>();
  const posted = new Set<string>();

  async function run(widened: boolean) {
    const hours = windowHours(input.now, widened);
    const fresh = entries.filter((e) => inWindow({ publishedAt: e.newest }, input.now, hours));
    const skipped: SkipEntry[] = fresh.flatMap((e) => e.skips.filter((s) => inWindow({ publishedAt: s.at }, input.now, hours)).map(({ at: _at, ...s }) => s));
    const groups = fresh.flatMap((e) => (e.group ? [e.group] : []));
    const toCheck = groups.filter((g) => g.status === 'qualified' && !checked.has(g.id));
    if (toCheck.length && postedHeadlines.length) {
      const hits = await check(toCheck.map((g) => storyOf.get(g.id)!), postedHeadlines, socialAskAsIntakeJev(jev));
      for (const g of toCheck) if (hits.has(storyOf.get(g.id)!.id)) posted.add(g.id);
    }
    for (const g of toCheck) checked.add(g.id);
    const scored = groups.map((g): ScoredGroup => (posted.has(g.id) ? { ...g, status: 'skipped', reason: Scoring.POSTED_ID } : g));
    for (const g of scored) {
      if (g.status !== 'qualified') skipped.push({ id: g.id, reason: `${g.status}: ${g.reason}`, stage: 'scoring' });
    }
    return { hours, scored, skipped, ranked: rankQualified(scored) };
  }

  let widened = false;
  let pass = await run(false);
  if (pass.ranked.length < WINNERS && pass.hours < windowHours(input.now, true)) {
    widened = true;
    pass = await run(true);
  }

  const deduped = await mergeSameEvent(pass.ranked, jev);
  const picks = await pickWinners(spreadByCompany(deduped.ranked), jev);
  // Shortlist only, as select.ts: read more members so the Reporter gets up to 4 starting sources.
  const topped = new Map(
    (await mapPool(picks.shortlist, 4, (g) => topUpReadSources(g, input.fetchBody))).map((g) => [g.id, g as ScoredGroup]),
  );
  const top = (g: ScoredGroup) => topped.get(g.id) ?? g;
  picks.shortlist = picks.shortlist.map(top);
  picks.winners = picks.winners.map(top);
  picks.backups = picks.backups.map(top);
  return {
    windowHours: pass.hours,
    widened,
    feedHealth: intakeFeedHealth(input.record, {
      feeds: input.feeds,
      adapterNames: input.adapterNames ?? new Map(),
      groups: entries.flatMap((e) => (e.group ? [e.group] : [])),
      now: input.now,
      hours: pass.hours,
    }),
    scored: pass.scored,
    skipped: pass.skipped,
    ...picks,
    merged: deduped.merged,
    jevCalls: tally.calls,
    jevInputTokens: tally.inputTokens,
    costUsd: tally.costUsd,
  };
}
