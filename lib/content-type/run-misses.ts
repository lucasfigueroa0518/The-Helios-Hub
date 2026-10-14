import type { ProgressItem } from '@/lib/content-type/progress';
import type { HubQuery } from '@/lib/social-hub/db';
import { nyDateOf } from '@/lib/social-hub/time';
import type { Vertical } from '@/lib/social-hub/types';
import type { QuotaCandidate } from '@/lib/social-hub/views/day-rank';
import { SERIES_LABEL } from '@/lib/stories/render/copy';

/**
 * "Run didn't finish" (Content page Phase B, B6): today's runs (New York
 * date) that ended without content, read from the records each type already
 * writes. Read only; no worker change.
 *
 *   Explainers  the topic's latest render failed, requested today        → that idea's card
 *   Stories     today's set was skipped, or failed while being built     → that series' card
 *   Reels       the idea's finish request failed today                   → that idea's card
 *   Carousels   today's latest daily run failed                          → every empty carousel card
 *
 * A Stories set that failed after it had a minute failed while posting: it was
 * made, so it is not a run that didn't finish.
 */
export type RunMiss = { key: string | null; title: string; detail: string | null };
export type RunMisses = Record<Vertical, RunMiss[]>;

export const NO_MISSES: RunMisses = { reels: [], carousels: [], explainers: [], stories: [] };
export const MISS_TITLE = 'Run didn’t finish';

const DETAIL_MAX = 140;
const short = (text: string | null | undefined): string | null => {
  const t = text?.trim();
  if (!t) return null;
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX - 1)}…` : t;
};
const SERIES: Record<string, string> = SERIES_LABEL;

export async function readRunMisses(q: HubQuery, now = new Date()): Promise<RunMisses> {
  const today = nyDateOf(now)!;
  // A type whose tables can't be read shows no line; the card keeps "Not made yet".
  const read = <T,>(p: Promise<{ rows: T[] }>): Promise<T[]> => p.then((r) => r.rows).catch(() => [] as T[]);
  const [explainers, stories, reels, carousels] = await Promise.all([
    read(q<{ key: string; reason: string | null }>(
      `SELECT j.topic_id::text AS key, j.error AS reason
         FROM explainers.jobs j
        WHERE j.id IN (SELECT DISTINCT ON (topic_id) id FROM explainers.jobs ORDER BY topic_id, requested_at DESC, seq DESC)
          AND j.status = 'failed'
          AND (j.requested_at AT TIME ZONE 'America/New_York')::date = $1::date`,
      [today],
    )),
    read(q<{ key: string; status: string; reason: string | null }>(
      `SELECT series AS key, status, error AS reason
         FROM stories.sets
        WHERE ny_date = $1::date
          AND (status = 'skipped' OR (status = 'failed' AND publish_at IS NULL))
        ORDER BY updated_at DESC`,
      [today],
    )),
    read(q<{ key: string; reason: string | null }>(
      `SELECT post_idea_id::text AS key, error AS reason
         FROM reels.finish_requests
        WHERE status = 'failed' AND (updated_at AT TIME ZONE 'America/New_York')::date = $1::date`,
      [today],
    )),
    read(q<{ status: string; trigger: string; reason: string | null }>(
      `SELECT status, trigger, error AS reason
         FROM social.runs
        WHERE kind = 'daily' AND (requested_at AT TIME ZONE 'America/New_York')::date = $1::date
        ORDER BY requested_at DESC
        LIMIT 1`,
      [today],
    )),
  ]);
  return {
    explainers: explainers.map((r) => ({ key: r.key, title: MISS_TITLE, detail: short(r.reason) })),
    reels: reels.map((r) => ({ key: r.key, title: MISS_TITLE, detail: short(r.reason) })),
    stories: stories.map((r) => {
      const why = short(r.reason);
      return { key: r.key, title: MISS_TITLE, detail: `${SERIES[r.key] ?? r.key}: ${r.status}${why ? `, ${why}` : ''}` };
    }),
    carousels: carousels
      .filter((r) => r.status === 'failed')
      .map((r) => ({
        key: null,
        title: r.trigger === 'scheduled' ? 'Tonight’s carousel run didn’t finish' : 'The carousel run didn’t finish',
        detail: short(r.reason),
      })),
  };
}

/** The miss an empty card shows: never on a card with content or with a run in flight. */
export function missFor(c: QuotaCandidate, misses: RunMisses, run: ProgressItem | null): RunMiss | null {
  if (c.post || run) return null;
  const list = misses[c.vertical] ?? [];
  if (c.vertical === 'carousels') return list[0] ?? null;
  if (c.vertical === 'stories') return c.seriesId ? list.find((m) => m.key === c.seriesId) ?? null : null;
  const ideaId = c.idea?.id;
  if (!ideaId) return null;
  return list.find((m) => m.key != null && (ideaId === m.key || ideaId.endsWith(`:${m.key}`))) ?? null;
}
