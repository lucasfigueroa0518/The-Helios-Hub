/**
 * Instagram Graph transport shared by every content type (docs/social-overnight.md):
 * one account, one user token, one error describer. Each type keeps only its
 * own container payload (carousel children, trial reel params, explainer reel,
 * story frame) on top of `call`; tests/instagram-payloads.test.ts pins them.
 */

import { META_GRAPH_VERSION } from './graph-version';

export { META_GRAPH_VERSION };

export type ContainerStatus = { statusCode: string; status: string | null };
export type PublishingLimit = { quotaUsage: number; quotaTotal: number | null };

/** The steps every container goes through after it is created. */
export interface InstagramContainerOps {
  containerStatus(containerId: string): Promise<ContainerStatus>;
  publishContainer(containerId: string): Promise<string>;
  permalink(mediaId: string): Promise<string | null>;
  /** The account's rolling 24-hour publishing quota, shared by every content type. */
  publishingLimit(): Promise<PublishingLimit>;
}

export class MetaNotConfiguredError extends Error {
  constructor() {
    super('Meta is not configured: META_USER_ACCESS_TOKEN and META_IG_BUSINESS_ACCOUNT_ID must be set.');
  }
}

export function metaConfigured(): boolean {
  return Boolean(process.env.META_USER_ACCESS_TOKEN && process.env.META_IG_BUSINESS_ACCOUNT_ID);
}

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } };

/** Params only; the token never goes into anything that gets logged. */
function describeGraphError(status: number, body: unknown): string {
  const error = (body as GraphError | null)?.error;
  if (!error) return `Meta returned ${status}.`;
  return `Meta returned ${status}: ${error.message ?? 'no message'} (code ${error.code ?? '?'}${error.error_subcode ? `/${error.error_subcode}` : ''}, trace ${error.fbtrace_id ?? '?'})`;
}

/** `path` is relative to the pinned version, or a full Graph URL (a paging link). */
export type GraphCall = <T>(method: 'GET' | 'POST', path: string, params: Record<string, string>) => Promise<T>;

export function createGraph(
  fetchImpl: typeof fetch = fetch,
  /** Explicit credentials (a client built with its own token in tests); the env otherwise. */
  creds?: { token: string; igUserId: string },
): { call: GraphCall; igUserId: string; ops: InstagramContainerOps } {
  const token = creds?.token ?? process.env.META_USER_ACCESS_TOKEN;
  const igUserId = creds?.igUserId ?? process.env.META_IG_BUSINESS_ACCOUNT_ID;
  if (!token || !igUserId) throw new MetaNotConfiguredError();
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

  const call: GraphCall = async <T>(method: 'GET' | 'POST', p: string, params: Record<string, string>) => {
    const url = new URL(p.startsWith('http') ? p : `${base}${p}`);
    const form = new URLSearchParams({ ...params, access_token: token });
    let response: Response;
    if (method === 'GET') {
      for (const [key, value] of form) url.searchParams.set(key, value);
      response = await fetchImpl(url);
    } else {
      response = await fetchImpl(url, { method: 'POST', body: form });
    }
    const body = (await response.json().catch(() => null)) as T | GraphError | null;
    if (!response.ok || (body && typeof body === 'object' && 'error' in body && body.error)) {
      throw new Error(describeGraphError(response.status, body));
    }
    return body as T;
  };

  const ops: InstagramContainerOps = {
    async containerStatus(containerId) {
      const body = await call<{ status_code?: string; status?: string }>('GET', `/${containerId}`, { fields: 'status_code,status' });
      return { statusCode: body.status_code ?? 'UNKNOWN', status: body.status ?? null };
    },
    async publishContainer(containerId) {
      const body = await call<{ id?: string }>('POST', `/${igUserId}/media_publish`, { creation_id: containerId });
      if (!body.id) throw new Error('Meta published but returned no media id.');
      return body.id;
    },
    async permalink(mediaId) {
      const body = await call<{ permalink?: string }>('GET', `/${mediaId}`, { fields: 'permalink' });
      return body.permalink ?? null;
    },
    async publishingLimit() {
      const body = await call<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
        'GET',
        `/${igUserId}/content_publishing_limit`,
        { fields: 'quota_usage,config' },
      );
      const row = body.data?.[0];
      return { quotaUsage: row?.quota_usage ?? 0, quotaTotal: row?.config?.quota_total ?? null };
    },
  };

  return { call, igUserId, ops };
}
