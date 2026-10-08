import type { Query } from '@/lib/social/store/pg';

import { calendarDateKey } from './clock';
import { META_GRAPH_VERSION, SOCIAL_TIMEZONE } from './config';
import { INSIGHTS_WARM_MS, graphErrorIsPermission, graphErrorIsToken, insightIsDue, metricsNamedIn, readInsightData } from './insights-rules';

/**
 * Lifetime insights for published carousels, into social.media_insights. The
 * due/settle rules are Trial Reels' (copied in ./insights-rules.ts): every
 * 30 minutes for two days, once a New York day through day 14, then one
 * closing read. A metric Meta rejects for carousels comes back null.
 */

export const CAROUSEL_METRICS = ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'] as const;
export type CarouselReading = Record<(typeof CAROUSEL_METRICS)[number], number | null> & { raw: unknown };

export class InsightsBlockedError extends Error {
  constructor(readonly blocked: 'permission' | 'token', message: string) {
    super(message);
  }
}

export interface CarouselInsightsClient {
  insights(mediaId: string): Promise<CarouselReading>;
}

export function createCarouselInsightsClient(options: { token: string; fetchImpl?: typeof fetch }): CarouselInsightsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

  async function call(mediaId: string, names: string[]): Promise<unknown> {
    const url = new URL(`${base}/${mediaId}/insights`);
    url.searchParams.set('access_token', options.token);
    url.searchParams.set('metric', names.join(','));
    url.searchParams.set('period', 'lifetime');
    const response = await fetchImpl(url);
    const body = (await response.json().catch(() => null)) as { error?: { message?: string; code?: number } } | null;
    const graphError = body?.error ?? null;
    if (!response.ok || graphError) {
      const code = graphError?.code ?? null;
      const detail = graphError?.message ?? `Meta returned ${response.status}.`;
      const message = `Meta returned ${response.status}: ${detail} (code ${code ?? '?'})`;
      if (graphErrorIsToken(code, detail)) throw new InsightsBlockedError('token', message);
      if (graphErrorIsPermission(response.status, code, detail)) throw new InsightsBlockedError('permission', message);
      throw new Error(message);
    }
    return body;
  }

  /** Drops metrics Meta names as unsupported, else splits the list in half (as the reels client does). */
  async function load(mediaId: string, names: string[]): Promise<{ metrics: Record<string, number | null>; bodies: unknown[] }> {
    if (names.length === 0) return { metrics: {}, bodies: [] };
    try {
      const body = await call(mediaId, names);
      const found = readInsightData(body);
      return { metrics: Object.fromEntries(names.map((n) => [n, found[n] ?? null])), bodies: [body] };
    } catch (error) {
      if (error instanceof InsightsBlockedError) throw error;
      const named = metricsNamedIn(error instanceof Error ? error.message : String(error), names);
      if (named.length > 0 && named.length < names.length) {
        const rest = await load(mediaId, names.filter((n) => !named.includes(n)));
        return { metrics: { ...rest.metrics, ...Object.fromEntries(named.map((n) => [n, null])) }, bodies: rest.bodies };
      }
      if (names.length === 1) return { metrics: { [names[0]!]: null }, bodies: [] };
      const mid = Math.ceil(names.length / 2);
      const left = await load(mediaId, names.slice(0, mid));
      const right = await load(mediaId, names.slice(mid));
      return { metrics: { ...left.metrics, ...right.metrics }, bodies: [...left.bodies, ...right.bodies] };
    }
  }

  return {
    async insights(mediaId) {
      const loaded = await load(mediaId, [...CAROUSEL_METRICS]);
      return { ...(Object.fromEntries(CAROUSEL_METRICS.map((n) => [n, loaded.metrics[n] ?? null])) as Record<(typeof CAROUSEL_METRICS)[number], number | null>), raw: { insights: loaded.bodies } };
    },
  };
}

export type CarouselInsightsResult = { considered: number; written: number; blocked: 'permission' | 'token' | null; detail: string | null };

/** Ask Instagram about every published carousel that is due. */
export async function pollCarouselInsights(query: Query, client: CarouselInsightsClient, now = new Date(), limit = 200): Promise<CarouselInsightsResult> {
  const { rows: open } = await query(
    `SELECT id, media_id, finished_at, insights_checked_at FROM social.publish_attempts
      WHERE status = 'published' AND media_id IS NOT NULL AND finished_at IS NOT NULL
        AND finished_at <= $1::timestamptz AND insights_settled_at IS NULL
      ORDER BY (insights_checked_at IS NULL) DESC, finished_at DESC`,
    [now.toISOString()],
  );
  const due = open
    .filter((r) => insightIsDue({ finishedAt: new Date(r.finished_at), checkedAt: r.insights_checked_at ? new Date(r.insights_checked_at) : null, now }))
    .slice(0, limit);
  const nyDate = calendarDateKey(now, SOCIAL_TIMEZONE);
  let written = 0;
  let detail: string | null = null;
  for (const row of due) {
    let reading: CarouselReading;
    try {
      reading = await client.insights(row.media_id);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/access_token=[^&\s]+/gi, 'access_token=(redacted)').slice(0, 500);
      if (error instanceof InsightsBlockedError) return { considered: due.length, written, blocked: error.blocked, detail: message };
      detail ??= message;
      continue;
    }
    if (CAROUSEL_METRICS.some((m) => reading[m] != null)) {
      await query(
        `INSERT INTO social.media_insights (media_id, ny_date, publish_attempt_id, views, reach, likes, comments, saved, shares, total_interactions, raw)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         ON CONFLICT (media_id, ny_date) DO UPDATE SET
           publish_attempt_id = EXCLUDED.publish_attempt_id, captured_at = now(),
           views = COALESCE(EXCLUDED.views, social.media_insights.views),
           reach = COALESCE(EXCLUDED.reach, social.media_insights.reach),
           likes = COALESCE(EXCLUDED.likes, social.media_insights.likes),
           comments = COALESCE(EXCLUDED.comments, social.media_insights.comments),
           saved = COALESCE(EXCLUDED.saved, social.media_insights.saved),
           shares = COALESCE(EXCLUDED.shares, social.media_insights.shares),
           total_interactions = COALESCE(EXCLUDED.total_interactions, social.media_insights.total_interactions),
           raw = EXCLUDED.raw`,
        [row.media_id, nyDate, row.id, reading.views, reading.reach, reading.likes, reading.comments, reading.saved, reading.shares, reading.total_interactions, JSON.stringify(reading.raw ?? {})],
      );
      written += 1;
    }
    const settle = now.getTime() - new Date(row.finished_at).getTime() > INSIGHTS_WARM_MS;
    await query(
      `UPDATE social.publish_attempts
          SET insights_checked_at = $2::timestamptz,
              insights_settled_at = CASE WHEN $3::boolean THEN $2::timestamptz ELSE insights_settled_at END
        WHERE id = $1`,
      [row.id, now.toISOString(), settle],
    );
  }
  return { considered: due.length, written, blocked: null, detail };
}
