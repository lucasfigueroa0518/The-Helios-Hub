/**
 * The weekly event ranking (plan M2): candidates → code terms → Jev event-pick@1 → gates and
 * score → picks per city → ai_events.pool.
 *
 * Rule 2 carve-out (AE-05): an event is asked about once per question-set version. Answers are
 * cached in networking.event_scores and never re-asked; a later run of the same week (or a
 * rebuild) recomputes the score from the cached answers and the current code terms (going
 * counts move), which costs nothing. Only the coming week's candidates are read: there is no
 * sweep of the events table.
 */
import { AI_EVENTS_METROS } from '@/lib/ai-events/types';
import { mapPool } from '@/lib/async-pool';
import { METRO_PROFILES } from '@/lib/networking/cities';
import { mapEvent, type EventRow, type NetworkingQuery } from '@/lib/networking/repository';
import type { EventAnchor, Metro, StoredNetworkingEvent } from '@/lib/networking/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { ScoreBreakdown } from '@/lib/social-hub/types';

import { capCandidates, loadWeekEvents } from './candidates';
import { createNetworkingJev, RUN_CAP_USD } from './jev';
import { normalizeOrgName } from './anchors-roster';
import { partnerMatch } from './partners';
import { chooseCityPicks, extendDeck, organizerKey, RANK_DEPTH, rankCity, type BarTier, type RankInput } from './picks';
import { EVENT_PICK, EVENT_PICK_CALL } from './questions';
import { answerProbabilities, SCORE_FORMULA, SCORE_VERSION, scoreEvent, type EventAnswers, type EventScore } from './score';
import { buildEventState } from './state';
import { loadAnchors } from './tech-weeks';
import { codeTerms, imputeTerms, termMedians, type CodeTerms } from './terms';
import { comingWeek, localDay, weekFromKey, type ComingWeek } from './week';

export const JEV_CONCURRENCY = 6;
export const JEV_COMPONENT = 'event-pick';

export type PoolEvent = RankInput & {
  event: StoredNetworkingEvent;
  metro: Metro;
  /** 1-based order within the city (score, gated last). */
  rank: number;
  breakdown: ScoreBreakdown;
  terms: CodeTerms;
  picked: boolean;
  /** 1-based place among the city's picks (pins first), or null when not picked. */
  pickRank: number | null;
  /** True when the Jev answers came from an earlier run. */
  cached: boolean;
};

export type CityRanking = {
  metro: Metro;
  ranked: PoolEvent[];
  /** In pick order (rank 1 first), at most PICKS_PER_CITY. */
  picks: PoolEvent[];
  /** The post's ranked list: the picks, then the next eligible events, at most RANK_DEPTH (rank order). */
  deck: PoolEvent[];
  /** The history bar tier the picks cleared (AE-28) and its score, null when no bar applied. */
  tier: BarTier;
  bar: number | null;
  /** Scheduled tech/both events in the city's coming week that were not picked. */
  remainingCount: number;
};

export type RankWeekResult = {
  weekKey: string;
  week: ComingWeek;
  cities: CityRanking[];
  /** Events asked about this run, and events whose cached answers were reused. */
  scored: number;
  reused: number;
  /** Events whose Jev call failed (left out of this run's pool; asked again next run). */
  failures: Array<{ eventId: string; error: string }>;
  jev: { calls: number; usd: number };
};

export type RankWeekInput = {
  q: NetworkingQuery;
  /** The Jev transport: liveJevTransport in the worker, a stub in tests. */
  ask: JevTransport;
  /** The week to rank ("2026-W44"); its Monday to Sunday is the window. Defaults to the coming week. */
  weekKey?: string;
  /** The ai_events run paying for the calls (networking.cost_events.run_id). */
  runId: string | null;
  now: Date;
  capUsd?: number;
  metros?: readonly Metro[];
  /** Curated anchors to merge with networking.anchors (tests). Defaults to TECH_WEEKS. */
  curatedAnchors?: readonly EventAnchor[];
  /**
   * False for a rebuild (AE-04): only events with cached answers are ranked and Jev is never
   * asked; an event not scored yet waits for the next build. Defaults to true.
   */
  scoreNew?: boolean;
};

type CachedScore = { event_id: string; answers: EventAnswers | null };
type PoolRow = { event_id: string; pinned_at: Date | string | null; excluded_at: Date | string | null };

export async function rankWeek(input: RankWeekInput): Promise<RankWeekResult> {
  const { q, now } = input;
  // A rebuild names its week; the window follows the key, so a Monday rebuild of the week in
  // progress never ranks the next week's events into it.
  const week = input.weekKey ? weekFromKey(input.weekKey) : comingWeek(now);
  const weekKey = week.weekKey;
  const metros = input.metros ?? AI_EVENTS_METROS;

  const weekEvents = await loadWeekEvents(q, week, metros);
  const anchors = await loadAnchors(q, week.startDate, week.endDate, input.curatedAnchors);
  const poolRows = (await q<PoolRow>(`SELECT event_id, pinned_at, excluded_at FROM ai_events.pool WHERE week_key = $1`, [weekKey])).rows;
  const pinned = new Set(poolRows.filter((r) => r.pinned_at != null).map((r) => r.event_id));
  const excluded = new Set(poolRows.filter((r) => r.excluded_at != null).map((r) => r.event_id));
  const held = new Set([...pinned, ...excluded]);

  type Candidate = { event: StoredNetworkingEvent; terms: CodeTerms; day: string; partner: string | null };
  const ownPast = await loadOwnPastCounts(q, metros, week.startDate);
  const candidates: Candidate[] = [];
  for (const { metro, events } of weekEvents) {
    const raw = capCandidates(events, held).map((event) => {
      const day = localDay(event.startAt, event.timezone || METRO_PROFILES[metro].timezone);
      return { event, day, partner: partnerMatch(event), terms: codeTerms(event, { localDay: day, anchors, ownPast: ownPast(event) }) };
    });
    // AE-31: a missing attendance, demand or track record takes the city's median this week.
    const medians = termMedians(raw.map((c) => c.terms));
    for (const c of raw) candidates.push({ ...c, terms: imputeTerms(c.terms, medians) });
  }

  const ids = candidates.map((c) => c.event.id);
  const cachedRows = ids.length
    ? (
        await q<CachedScore>(
          `SELECT event_id, answers FROM networking.event_scores WHERE set_version = $1 AND event_id = ANY ($2::uuid[])`,
          [EVENT_PICK.version, ids],
        )
      ).rows
    : [];
  const cached = new Map(cachedRows.map((r) => [r.event_id, answerProbabilities(r.answers ?? {})]));

  const jev = createNetworkingJev(input.ask, q, { weekKey, runId: input.runId, capUsd: input.capUsd ?? RUN_CAP_USD });
  const answersById = new Map<string, EventAnswers>(cached);
  const failures: RankWeekResult['failures'] = [];
  const toScore = input.scoreNew === false ? [] : candidates.filter((c) => !cached.has(c.event.id));
  let scored = 0;

  await mapPool(toScore, JEV_CONCURRENCY, async (c) => {
    try {
      const result = await jev.ask({
        component: JEV_COMPONENT,
        sets: EVENT_PICK_CALL.sets,
        questions: EVENT_PICK_CALL.questions,
        state: buildEventState(c.event, week, c.terms),
        eventId: c.event.id,
      });
      const answers = answerProbabilities(result.answers as Record<string, unknown>);
      const s = scoreEvent(answers, c.terms);
      // DO NOTHING: a row for this version is never replaced (AE-05).
      await q(
        `INSERT INTO networking.event_scores (event_id, set_version, answers, gate, score, parts)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb)
         ON CONFLICT (event_id, set_version) DO NOTHING`,
        [c.event.id, EVENT_PICK.version, JSON.stringify(answers), s.gate, s.score, JSON.stringify(s.breakdown.parts)],
      );
      answersById.set(c.event.id, answers);
      scored++;
    } catch (error) {
      failures.push({ eventId: c.event.id, error: error instanceof Error ? error.message : String(error) });
    }
  });

  if (toScore.length > 0 && scored === 0) {
    throw new Error(`event-pick: every Jev call failed (${failures.length}); first: ${failures[0]?.error ?? 'unknown'}`);
  }

  const byMetro = new Map<Metro, PoolEvent[]>();
  for (const c of candidates) {
    const answers = answersById.get(c.event.id);
    // A pin is a person's call whatever the score (AE-04): an event pinned before it was scored
    // (a rebuild asks Jev nothing, or its call failed) still goes in, unscored. Anything else waits.
    const unscoredPin = !answers && pinned.has(c.event.id);
    if (!answers && !unscoredPin) continue;
    const s: EventScore = answers
      ? scoreEvent(answers, c.terms)
      : { gate: null, score: null, breakdown: { formula: SCORE_FORMULA, parts: [], note: 'Not scored yet; in the picks because it is pinned.' } };
    const reused = cached.has(c.event.id);
    if (reused) {
      // Same answers, current code terms: refresh the stored score so the hub reads what ranked.
      await q(
        `UPDATE networking.event_scores SET gate = $3, score = $4, parts = $5::jsonb
          WHERE event_id = $1 AND set_version = $2`,
        [c.event.id, EVENT_PICK.version, s.gate, s.score, JSON.stringify(s.breakdown.parts)],
      );
    }
    const list = byMetro.get(c.event.metro) ?? [];
    list.push({
      eventId: c.event.id,
      score: s.score,
      gate: s.gate,
      organizerKey: organizerKey(c.event),
      startAt: c.event.startAt,
      localDay: c.day,
      going: c.event.guestCount,
      pinned: pinned.has(c.event.id),
      excluded: excluded.has(c.event.id),
      partner: c.partner,
      event: c.event,
      metro: c.event.metro,
      rank: 0,
      breakdown: s.breakdown,
      terms: c.terms,
      picked: false,
      pickRank: null,
      cached: reused,
    });
    byMetro.set(c.event.metro, list);
  }

  const history = await loadScoreHistory(q, metros, weekKey);
  const cities: CityRanking[] = [];
  for (const { metro, events } of weekEvents) {
    const ranked = rankCity(byMetro.get(metro) ?? []);
    ranked.forEach((p, i) => {
      p.rank = i + 1;
    });
    // AE-28: past weeks' v2 scores for the city; until there are enough, this week's count too.
    const past = history.get(metro) ?? [];
    const thisWeek = ranked.filter((p) => p.gate == null && p.score != null).map((p) => p.score!);
    const { picks, tier, bar } = chooseCityPicks(ranked, past.length >= MIN_HISTORY ? past : [...past, ...thisWeek]);
    picks.forEach((p, i) => {
      p.picked = true;
      p.pickRank = i + 1;
    });
    const deck = extendDeck(picks, ranked, RANK_DEPTH);
    cities.push({ metro, ranked, picks, deck, tier, bar, remainingCount: Math.max(0, events.length - picks.length) });
  }

  await writePool(q, weekKey, cities.flatMap((c) => c.ranked));

  return {
    weekKey,
    week,
    cities,
    scored,
    reused: cached.size,
    failures,
    jev: { calls: jev.calls, usd: jev.usd },
  };
}

/**
 * Recomputes the stored score of every pool row of `weekKey` under the current formula from the
 * cached Jev answers (AE-30), with no Jev call. Picks, ranks, pins and excludes are left alone:
 * only score, gate and score_version change, so the history bar compares like with like. Reads
 * only the week's own pool rows (no sweep of the events table).
 */
export async function rescoreWeek(q: NetworkingQuery, weekKey: string): Promise<number> {
  const week = weekFromKey(weekKey);
  const rows = (
    await q<EventRow & { answers: EventAnswers | null }>(
      `SELECT e.*, s.answers
         FROM ai_events.pool p
         JOIN networking.events e ON e.id = p.event_id
         JOIN networking.event_scores s ON s.event_id = p.event_id AND s.set_version = $2
        WHERE p.week_key = $1`,
      [weekKey, EVENT_PICK.version],
    )
  ).rows;
  if (!rows.length) return 0;
  const events = rows.map((r) => ({ event: mapEvent(r, []), answers: answerProbabilities(r.answers ?? {}) }));
  const metros = [...new Set(events.map((e) => e.event.metro))];
  const anchors = await loadAnchors(q, week.startDate, week.endDate);
  const ownPast = await loadOwnPastCounts(q, metros, week.startDate);
  let n = 0;
  for (const metro of metros) {
    const inMetro = events
      .filter((e) => e.event.metro === metro)
      .map((e) => {
        const day = localDay(e.event.startAt, e.event.timezone || METRO_PROFILES[metro].timezone);
        return { ...e, terms: codeTerms(e.event, { localDay: day, anchors, ownPast: ownPast(e.event) }) };
      });
    const medians = termMedians(inMetro.map((e) => e.terms));
    for (const e of inMetro) {
      const s = scoreEvent(e.answers, imputeTerms(e.terms, medians));
      await q(
        `UPDATE ai_events.pool SET score = $3, gate = $4, partner = $5, score_version = $6, updated_at = now()
          WHERE week_key = $1 AND event_id = $2`,
        [weekKey, e.event.id, s.score, s.gate, partnerMatch(e.event), SCORE_VERSION],
      );
      n++;
    }
  }
  return n;
}

/** Past weeks' scores before history alone sets the bar (AE-28). */
export const MIN_HISTORY = 20;

/** Gated-in v2 scores of earlier weeks per city, from ai_events.pool (the score log). */
export async function loadScoreHistory(q: NetworkingQuery, metros: readonly Metro[], weekKey: string): Promise<Map<Metro, number[]>> {
  const rows = (
    await q<{ metro: Metro; score: string | number }>(
      `SELECT metro, score FROM ai_events.pool
        WHERE metro = ANY ($1::text[]) AND week_key < $2 AND score IS NOT NULL AND gate IS NULL
          AND score_version = $3`,
      [metros, weekKey, SCORE_VERSION],
    )
  ).rows;
  const out = new Map<Metro, number[]>();
  for (const r of rows) {
    const list = out.get(r.metro) ?? [];
    list.push(Number(r.score));
    out.set(r.metro, list);
  }
  return out;
}

/**
 * Our own count of an organizer's past events (track record, AE-30), as a lookup per event.
 * Each networking.events row is one event after dedupe. An event is matched by its organizer
 * name, Luma calendar slug and Meetup urlname; those name the same organizer, so the largest
 * count is used, never their sum.
 */
export async function loadOwnPastCounts(
  q: NetworkingQuery,
  metros: readonly Metro[],
  before: string,
): Promise<(e: StoredNetworkingEvent) => number> {
  const rows = (
    await q<{ kind: 'name' | 'luma' | 'meetup'; key: string; n: string | number }>(
      `SELECT kind, key, count(DISTINCT id) AS n FROM (
         SELECT id, 'name' AS kind, organizer_name AS key FROM networking.events
          WHERE metro = ANY ($1::text[]) AND start_at < $2::date AND organizer_name IS NOT NULL
         UNION ALL
         SELECT id, 'luma', signals->>'lumaCalendarSlug' FROM networking.events
          WHERE metro = ANY ($1::text[]) AND start_at < $2::date AND signals->>'lumaCalendarSlug' IS NOT NULL
         UNION ALL
         SELECT id, 'meetup', signals->>'meetupGroupUrlname' FROM networking.events
          WHERE metro = ANY ($1::text[]) AND start_at < $2::date AND signals->>'meetupGroupUrlname' IS NOT NULL
       ) k GROUP BY kind, key`,
      [metros, before],
    )
  ).rows;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.kind}:${r.kind === 'name' ? normalizeOrgName(r.key) : r.key.toLowerCase()}`;
    counts.set(key, (counts.get(key) ?? 0) + Number(r.n));
  }
  return (e) =>
    Math.max(
      e.organizerName ? (counts.get(`name:${normalizeOrgName(e.organizerName)}`) ?? 0) : 0,
      e.signals?.lumaCalendarSlug ? (counts.get(`luma:${e.signals.lumaCalendarSlug.toLowerCase()}`) ?? 0) : 0,
      e.signals?.meetupGroupUrlname ? (counts.get(`meetup:${e.signals.meetupGroupUrlname.toLowerCase()}`) ?? 0) : 0,
    );
}

/**
 * Upserts this run's rows; pinned_* and excluded_* are never touched here (the hub's pool
 * actions own them). Rows of the week that dropped out of the candidates lose their rank and
 * pick but keep the person's pin or exclude.
 */
async function writePool(q: NetworkingQuery, weekKey: string, rows: PoolEvent[]): Promise<void> {
  if (rows.length) {
    await q(
      `INSERT INTO ai_events.pool (week_key, event_id, metro, rank, score, gate, picked, pick_rank, partner, score_version, updated_at)
       SELECT $1, u.event_id, u.metro, u.rank, u.score, u.gate, u.picked, u.pick_rank, u.partner, $10, now()
         FROM unnest($2::uuid[], $3::text[], $4::int[], $5::numeric[], $6::text[], $7::boolean[], $8::int[], $9::text[])
              AS u(event_id, metro, rank, score, gate, picked, pick_rank, partner)
       ON CONFLICT (week_key, event_id) DO UPDATE SET
          metro = EXCLUDED.metro,
          rank = EXCLUDED.rank,
          score = EXCLUDED.score,
          gate = EXCLUDED.gate,
          picked = EXCLUDED.picked,
          pick_rank = EXCLUDED.pick_rank,
          partner = EXCLUDED.partner,
          score_version = EXCLUDED.score_version,
          updated_at = now()`,
      [
        weekKey,
        rows.map((r) => r.eventId),
        rows.map((r) => r.metro),
        rows.map((r) => r.rank),
        rows.map((r) => r.score),
        rows.map((r) => r.gate),
        rows.map((r) => r.picked),
        rows.map((r) => r.pickRank),
        rows.map((r) => r.partner ?? null),
        SCORE_VERSION,
      ],
    );
  }
  await q(
    `UPDATE ai_events.pool SET rank = NULL, picked = false, pick_rank = NULL, updated_at = now()
      WHERE week_key = $1 AND NOT (event_id = ANY ($2::uuid[]))`,
    [weekKey, rows.map((r) => r.eventId)],
  );
}
