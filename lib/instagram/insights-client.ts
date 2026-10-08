import { META_GRAPH_VERSION } from './graph';
import { graphErrorIsPermission, graphErrorIsToken, metricsNamedIn, readInsightData } from './insights-rules';

/**
 * Lifetime insights for one published media, any content type: the caller
 * names the metrics. A metric Meta rejects for this media type comes back
 * null (the same drop-or-bisect as lib/reels/media-insights/client.ts). The
 * token never appears in an error message.
 */

export class InsightsBlockedError extends Error {
  constructor(readonly blocked: 'permission' | 'token', message: string) {
    super(message);
  }
}

export type InsightsReading<M extends string> = Record<M, number | null> & { raw: unknown };

export interface InsightsClient<M extends string> {
  insights(mediaId: string): Promise<InsightsReading<M>>;
}

export function createInsightsClient<M extends string>(options: {
  token: string;
  metrics: readonly M[];
  fetchImpl?: typeof fetch;
}): InsightsClient<M> {
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
      const loaded = await load(mediaId, [...options.metrics]);
      const metrics = Object.fromEntries(options.metrics.map((n) => [n, loaded.metrics[n] ?? null])) as Record<M, number | null>;
      return { ...metrics, raw: { insights: loaded.bodies } };
    },
  };
}

/** Strip a token that slipped into an error message. */
export function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/access_token=[^&\s]+/gi, 'access_token=(redacted)').slice(0, 500);
}
