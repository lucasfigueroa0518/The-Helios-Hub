/**
 * Instagram Graph calls for Stories (plan §7): image containers with
 * `media_type=STORIES`, their status, publish, and the account's publishing
 * quota. Modeled on lib/reels/music/meta.ts (its client hard-codes REELS
 * and trial params). Content publishing needs the user access token.
 * Tests pass a fetch stub; the token never appears in an error.
 */
import { META_GRAPH_VERSION } from '@/lib/reels/config';

export type ContainerState = 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED' | 'PUBLISHED' | 'UNKNOWN';

export interface StoriesMetaClient {
  createStoryContainer(imageUrl: string): Promise<string>;
  containerStatus(containerId: string): Promise<{ state: ContainerState; status: string | null }>;
  publishContainer(containerId: string): Promise<string>;
  /** Posts published through the API in the last 24 hours, and the cap (100 per Meta's docs). */
  publishingQuota(): Promise<{ used: number; total: number } | null>;
}

export class StoriesMetaNotConfiguredError extends Error {
  constructor() {
    super('Meta is not configured: META_USER_ACCESS_TOKEN and META_IG_BUSINESS_ACCOUNT_ID must be set.');
  }
}

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } };

export function describeGraphError(status: number, body: unknown): string {
  const e = (body as GraphError | null)?.error;
  if (!e) return `Meta returned ${status}.`;
  return `Meta returned ${status}: ${e.message ?? 'no message'} (code ${e.code ?? '?'}${e.error_subcode ? `/${e.error_subcode}` : ''}, trace ${e.fbtrace_id ?? '?'})`;
}

export function createStoriesMetaClient(opts: { token: string; igUserId: string; fetchImpl?: typeof fetch; version?: string }): StoriesMetaClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = `https://graph.facebook.com/${opts.version ?? META_GRAPH_VERSION}`;

  async function call<T>(method: 'GET' | 'POST', path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${base}${path}`);
    const form = new URLSearchParams({ ...params, access_token: opts.token });
    let res: Response;
    if (method === 'GET') {
      for (const [k, v] of form) url.searchParams.set(k, v);
      res = await doFetch(url);
    } else {
      res = await doFetch(url, { method: 'POST', body: form });
    }
    const body = (await res.json().catch(() => null)) as T | GraphError | null;
    if (!res.ok || (body && typeof body === 'object' && 'error' in body && body.error)) throw new Error(describeGraphError(res.status, body));
    return body as T;
  }

  return {
    async createStoryContainer(imageUrl) {
      const body = await call<{ id?: string }>('POST', `/${opts.igUserId}/media`, { media_type: 'STORIES', image_url: imageUrl });
      if (!body.id) throw new Error('Meta created no container id.');
      return body.id;
    },
    async containerStatus(containerId) {
      const body = await call<{ status_code?: string; status?: string }>('GET', `/${containerId}`, { fields: 'status_code,status' });
      const known: ContainerState[] = ['FINISHED', 'IN_PROGRESS', 'ERROR', 'EXPIRED', 'PUBLISHED'];
      const state = known.includes(body.status_code as ContainerState) ? (body.status_code as ContainerState) : 'UNKNOWN';
      return { state, status: body.status ?? null };
    },
    async publishContainer(containerId) {
      const body = await call<{ id?: string }>('POST', `/${opts.igUserId}/media_publish`, { creation_id: containerId });
      if (!body.id) throw new Error('Meta published but returned no media id.');
      return body.id;
    },
    async publishingQuota() {
      const body = await call<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>('GET', `/${opts.igUserId}/content_publishing_limit`, { fields: 'quota_usage,config' });
      const row = body.data?.[0];
      if (!row || typeof row.quota_usage !== 'number') return null;
      return { used: row.quota_usage, total: row.config?.quota_total ?? 100 };
    },
  };
}

export function createLiveStoriesMetaClient(fetchImpl: typeof fetch = fetch): StoriesMetaClient {
  const token = process.env.META_USER_ACCESS_TOKEN;
  const igUserId = process.env.META_IG_BUSINESS_ACCOUNT_ID;
  if (!token || !igUserId) throw new StoriesMetaNotConfiguredError();
  return createStoriesMetaClient({ token, igUserId, fetchImpl });
}
