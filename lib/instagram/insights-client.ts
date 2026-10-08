import { META_GRAPH_VERSION } from './graph';
import { graphErrorIsPermission, graphErrorIsToken, metricsNamedIn, readInsightData } from './insights-rules';

/**
 * Lifetime insights for one published media, any content type: the caller
 * names the metrics. A metric Meta rejects for this media type comes back
 * null (dropped by name, otherwise found by bisecting). The token never
 * appears in an error message.
 */

/** Waiting won't help: the token or the app's permissions have to be fixed. */
export class InsightsBlockedError extends Error {
  constructor(readonly blocked: 'permission' | 'token', message: string) {
    super(message);
  }
}

export class InsightsPermissionError extends InsightsBlockedError {
  constructor(message: string) {
    super('permission', message);
  }
}

export class InsightsTokenError extends InsightsBlockedError {
  constructor(message: string) {
    super('token', message);
  }
}

export type InsightsReading<M extends string> = Record<M, number | null> & { raw: unknown };

export interface InsightsClient<M extends string> {
  insights(mediaId: string): Promise<InsightsReading<M>>;
}

export interface MediaInsightsClient<M extends string> extends InsightsClient<M> {
  /** Plain fields of the media itself (e.g. `is_shared_to_feed`), with the same error rules. */
  fields(mediaId: string, names: readonly string[]): Promise<Record<string, unknown>>;
}

export function createInsightsClient<M extends string>(options: {
  token: string;
  metrics: readonly M[];
  fetchImpl?: typeof fetch;
}): MediaInsightsClient<M> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

  async function call(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${base}${path}`);
    url.searchParams.set('access_token', options.token);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetchImpl(url);
    const body = (await response.json().catch(() => null)) as { error?: { message?: string; code?: number } } | null;
    const graphError = body?.error ?? null;
    if (!response.ok || graphError) {
      const code = graphError?.code ?? null;
      const detail = graphError?.message ?? `Meta returned ${response.status}.`;
      const message = `Meta returned ${response.status}: ${detail} (code ${code ?? '?'})`;
      if (graphErrorIsToken(code, detail)) throw new InsightsTokenError(message);
      if (graphErrorIsPermission(response.status, code, detail)) throw new InsightsPermissionError(message);
      throw new Error(message);
    }
    return body;
  }

  async function load(mediaId: string, names: string[]): Promise<{ metrics: Record<string, number | null>; bodies: unknown[] }> {
    if (names.length === 0) return { metrics: {}, bodies: [] };
    try {
      const body = await call(`/${mediaId}/insights`, { metric: names.join(','), period: 'lifetime' });
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
    async fields(mediaId, names) {
      const body = await call(`/${mediaId}`, { fields: names.join(',') });
      return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    },
  };
}

/** Strip a token that slipped into an error message. */
export function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/access_token=[^&\s]+/gi, 'access_token=(redacted)').slice(0, 500);
}
