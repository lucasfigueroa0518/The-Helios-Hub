import { META_GRAPH_VERSION } from './config';

/**
 * Instagram carousel publishing (Instagram API with Facebook Login): one
 * image container per slide (`is_carousel_item`), one CAROUSEL parent with
 * the caption, a status poll, then `media_publish`. Same account and token as
 * Trial Reels; the small `call()` is a copy of the one in
 * lib/reels/music/meta.ts so the two clients never change each other.
 *
 * Everything goes through `CarouselMetaClient` so the publish job runs
 * offline in tests against a stub.
 */

export type ContainerStatus = { statusCode: string; status: string | null };
export type PublishingLimit = { quotaUsage: number; quotaTotal: number | null };

export interface CarouselMetaClient {
  createImageItem(imageUrl: string): Promise<string>;
  createCarousel(children: string[], caption: string): Promise<string>;
  containerStatus(containerId: string): Promise<ContainerStatus>;
  publishContainer(containerId: string): Promise<string>;
  permalink(mediaId: string): Promise<string | null>;
  /** The shared account's rolling 24-hour publishing quota (docs/social-overnight.md). */
  publishingLimit(): Promise<PublishingLimit>;
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

export function createLiveCarouselClient(fetchImpl: typeof fetch = fetch): CarouselMetaClient {
  const token = process.env.META_USER_ACCESS_TOKEN;
  const igUserId = process.env.META_IG_BUSINESS_ACCOUNT_ID;
  if (!token || !igUserId) {
    throw new Error('Meta is not configured: META_USER_ACCESS_TOKEN and META_IG_BUSINESS_ACCOUNT_ID must be set.');
  }
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

  async function call<T>(method: 'GET' | 'POST', p: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${base}${p}`);
    const form = new URLSearchParams({ ...params, access_token: token! });
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
  }

  return {
    async createImageItem(imageUrl) {
      const body = await call<{ id?: string }>('POST', `/${igUserId}/media`, { image_url: imageUrl, is_carousel_item: 'true' });
      if (!body.id) throw new Error('Meta created no carousel item id.');
      return body.id;
    },

    async createCarousel(children, caption) {
      const body = await call<{ id?: string }>('POST', `/${igUserId}/media`, {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption,
      });
      if (!body.id) throw new Error('Meta created no carousel container id.');
      return body.id;
    },

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
}
