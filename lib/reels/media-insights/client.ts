import { META_GRAPH_VERSION } from '@/lib/reels/config';
import { MetaNotConfiguredError } from '@/lib/reels/music/meta';
import {
  INSIGHT_METRICS,
  graphErrorIsPermission,
  graphErrorIsToken,
  metricsNamedIn,
  readInsightData,
  readingFromMetrics,
  readSharedToFeed,
  type ReelInsightReading,
} from '@/lib/reels/media-insights/parse';

/**
 * Lifetime insights for one published reel. Tests pass a fetch stub.
 * The token stays in the query string and never in an error message.
 */

export class InsightsPermissionError extends Error {
  readonly blocked = 'permission' as const;
}

export class InsightsTokenError extends Error {
  readonly blocked = 'token' as const;
}

export class InsightsGraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'InsightsGraphError';
  }
}

export interface InsightsClient {
  reelInsights(mediaId: string): Promise<ReelInsightReading>;
}

type GraphErrorBody = { error?: { message?: string; code?: number } };

export function createInsightsClient(options: { token: string; fetchImpl?: typeof fetch; version?: string }): InsightsClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `https://graph.facebook.com/${options.version ?? META_GRAPH_VERSION}`;

  async function call(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(path.startsWith('http') ? path : `${base}${path}`);
    url.searchParams.set('access_token', options.token);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetchImpl(url);
    const body = (await response.json().catch(() => null)) as GraphErrorBody | null;
    const graphError = body && typeof body === 'object' && body.error ? body.error : null;
    if (!response.ok || graphError) {
      const code = graphError?.code ?? null;
      const detail = graphError?.message ?? `Meta returned ${response.status}.`;
      const message = `Meta returned ${response.status}: ${detail} (code ${code ?? '?'})`;
      if (graphErrorIsToken(code, detail)) throw new InsightsTokenError(message);
      if (graphErrorIsPermission(response.status, code, detail)) throw new InsightsPermissionError(message);
      throw new InsightsGraphError(response.status, code, message);
    }
    return body;
  }

  async function loadMetrics(mediaId: string, names: string[]): Promise<{ metrics: Record<string, number | null>; bodies: unknown[] }> {
    if (names.length === 0) return { metrics: {}, bodies: [] };
    try {
      const body = await call(`/${mediaId}/insights`, { metric: names.join(','), period: 'lifetime' });
      const found = readInsightData(body);
      const metrics: Record<string, number | null> = {};
      for (const name of names) metrics[name] = found[name] ?? null;
      return { metrics, bodies: [body] };
    } catch (error) {
      if (error instanceof InsightsPermissionError || error instanceof InsightsTokenError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const named = metricsNamedIn(message, names);
      if (named.length > 0 && named.length < names.length) {
        const rest = await loadMetrics(mediaId, names.filter((name) => !named.includes(name)));
        const metrics = { ...rest.metrics };
        for (const name of named) metrics[name] = null;
        return { metrics, bodies: rest.bodies };
      }
      if (names.length === 1) return { metrics: { [names[0]!]: null }, bodies: [] };
      const mid = Math.ceil(names.length / 2);
      const left = await loadMetrics(mediaId, names.slice(0, mid));
      const right = await loadMetrics(mediaId, names.slice(mid));
      return { metrics: { ...left.metrics, ...right.metrics }, bodies: [...left.bodies, ...right.bodies] };
    }
  }

  return {
    async reelInsights(mediaId) {
      const loaded = await loadMetrics(mediaId, [...INSIGHT_METRICS]);
      let sharedToFeed: boolean | null = null;
      let media: unknown = null;
      try {
        media = await call(`/${mediaId}`, { fields: 'is_shared_to_feed' });
        sharedToFeed = readSharedToFeed(media && typeof media === 'object' ? (media as { is_shared_to_feed?: unknown }).is_shared_to_feed : null);
      } catch (error) {
        if (error instanceof InsightsPermissionError || error instanceof InsightsTokenError) throw error;
        sharedToFeed = null;
      }
      return readingFromMetrics(loaded.metrics, sharedToFeed, { insights: loaded.bodies, media });
    },
  };
}

export function createLiveInsightsClient(fetchImpl: typeof fetch = fetch): InsightsClient {
  const token = process.env.META_USER_ACCESS_TOKEN;
  if (!token || !process.env.META_IG_BUSINESS_ACCOUNT_ID) throw new MetaNotConfiguredError();
  return createInsightsClient({ token, fetchImpl });
}
