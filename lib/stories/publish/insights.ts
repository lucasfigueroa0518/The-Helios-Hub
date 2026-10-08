/**
 * Story insights (plan §7, O-6). Confirmed against Meta's media insights
 * reference, 2026-10-08:
 *
 *   - STORY metrics: reach, views, replies, shares, follows, profile_visits,
 *     total_interactions, and navigation (breakdown story_navigation_action_type:
 *     TAP_FORWARD, TAP_BACK, TAP_EXIT, SWIPE_FORWARD). `impressions` is
 *     deprecated for media after 2024-07-02, so it is not asked for.
 *   - "Story media metrics are only available for 24 hours." Data can lag up
 *     to 48 hours; period is always lifetime. A `story_insights` webhook can
 *     deliver final numbers at expiry (a later option; the poller is first).
 *   - Under 5 viewers → error code 10 "Not enough viewers"; recorded as an
 *     empty capture, not a failure. `replies` reads 0 for viewers in Europe
 *     and Japan.
 *
 * Modeled on lib/reels/media-insights/client.ts: a metric name Meta rejects
 * is dropped and the rest asked again. The token never appears in errors.
 */
import { META_GRAPH_VERSION } from '@/lib/reels/config';
import type { FrameMetrics } from '@/lib/stories/repository';

export const STORY_METRICS = ['reach', 'views', 'replies', 'shares', 'follows', 'profile_visits', 'total_interactions'] as const;

/** The last capture lands an hour before the story expires (24 hours after posting). */
export const FINAL_CAPTURE_AFTER_HOURS = 23;
export const isFinalCapture = (publishedAt: Date, now: Date) => now.getTime() - publishedAt.getTime() >= FINAL_CAPTURE_AFTER_HOURS * 3600_000;

export type StoryInsights = { metrics: FrameMetrics; raw: unknown[]; notEnoughViewers: boolean };

export interface StoryInsightsClient {
  storyInsights(mediaId: string): Promise<StoryInsights>;
}

type GraphBody = { error?: { message?: string; code?: number }; data?: Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown; breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: unknown }> }> } }> };

class GraphCallError extends Error {
  constructor(readonly code: number | null, message: string) {
    super(message);
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Lifetime metric values by name from an insights response. */
export function readMetricValues(body: GraphBody): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const d of body.data ?? []) {
    if (!d.name) continue;
    out[d.name] = num(d.values?.[0]?.value) ?? num(d.total_value?.value);
  }
  return out;
}

/** Navigation counts from the story_navigation_action_type breakdown. */
export function readNavigation(body: GraphBody): Pick<FrameMetrics, 'taps_forward' | 'taps_back' | 'exits' | 'swipe_forward'> {
  const out = { taps_forward: null, taps_back: null, exits: null, swipe_forward: null } as Record<'taps_forward' | 'taps_back' | 'exits' | 'swipe_forward', number | null>;
  const nav = (body.data ?? []).find((d) => d.name === 'navigation');
  for (const r of nav?.total_value?.breakdowns?.[0]?.results ?? []) {
    const key = { TAP_FORWARD: 'taps_forward', TAP_BACK: 'taps_back', TAP_EXIT: 'exits', SWIPE_FORWARD: 'swipe_forward' }[(r.dimension_values?.[0] ?? '').toUpperCase()] as keyof typeof out | undefined;
    if (key) out[key] = num(r.value);
  }
  return out;
}

export function createStoryInsightsClient(opts: { token: string; fetchImpl?: typeof fetch; version?: string }): StoryInsightsClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = `https://graph.facebook.com/${opts.version ?? META_GRAPH_VERSION}`;

  async function call(path: string, params: Record<string, string>): Promise<GraphBody> {
    const url = new URL(`${base}${path}`);
    url.searchParams.set('access_token', opts.token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await doFetch(url);
    const body = (await res.json().catch(() => null)) as GraphBody | null;
    if (!res.ok || body?.error) {
      const code = body?.error?.code ?? null;
      throw new GraphCallError(code, `Meta returned ${res.status}: ${body?.error?.message ?? 'no message'} (code ${code ?? '?'})`);
    }
    return body ?? {};
  }

  async function metrics(mediaId: string, names: string[], raw: unknown[]): Promise<Record<string, number | null>> {
    if (!names.length) return {};
    try {
      const body = await call(`/${mediaId}/insights`, { metric: names.join(','), period: 'lifetime' });
      raw.push(body);
      return readMetricValues(body);
    } catch (err) {
      if (err instanceof GraphCallError && err.code === 10) throw err;
      // Drop a metric Meta names as invalid and ask for the rest.
      const msg = err instanceof Error ? err.message : '';
      const rejected = names.filter((n) => new RegExp(`\\b${n}\\b`).test(msg));
      if (rejected.length && rejected.length < names.length) {
        const rest = await metrics(mediaId, names.filter((n) => !rejected.includes(n)), raw);
        return { ...Object.fromEntries(rejected.map((n) => [n, null])), ...rest };
      }
      throw err;
    }
  }

  return {
    async storyInsights(mediaId) {
      const raw: unknown[] = [];
      try {
        const values = await metrics(mediaId, [...STORY_METRICS], raw);
        let nav = readNavigation({});
        try {
          const body = await call(`/${mediaId}/insights`, { metric: 'navigation', breakdown: 'story_navigation_action_type', metric_type: 'total_value', period: 'lifetime' });
          raw.push(body);
          nav = readNavigation(body);
        } catch (err) {
          if (err instanceof GraphCallError && err.code === 10) throw err;
          raw.push({ navigation_error: err instanceof Error ? err.message : String(err) });
        }
        const m: FrameMetrics = { ...nav };
        for (const n of STORY_METRICS) m[n] = values[n] ?? null;
        return { metrics: m, raw, notEnoughViewers: false };
      } catch (err) {
        if (err instanceof GraphCallError && err.code === 10) return { metrics: {}, raw: [{ error: err.message }], notEnoughViewers: true };
        throw err;
      }
    },
  };
}

export function createLiveStoryInsightsClient(fetchImpl: typeof fetch = fetch): StoryInsightsClient {
  const token = process.env.META_USER_ACCESS_TOKEN;
  if (!token) throw new Error('Meta is not configured: META_USER_ACCESS_TOKEN must be set.');
  return createStoryInsightsClient({ token, fetchImpl });
}
