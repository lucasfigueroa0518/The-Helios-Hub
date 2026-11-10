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
  /**
   * The ids of the account's media still on the profile, back to `since`. Archived and deleted
   * posts are not in this list (checked 2026-10-13: archived reels drop out and their ids no
   * longer load). Read only.
   */
  liveMediaIds?(since: Date): Promise<Set<string>>;
}

/** One Instagram post as the nightly photo read sees it (lib/photos/ig-sync.ts). */
export type IgMediaChild = { id: string; mediaType: string | null; mediaUrl: string | null };
export type IgMedia = {
  id: string;
  surface: 'feed' | 'story';
  timestamp: string;
  caption: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  children: IgMediaChild[];
};

/** Read-only listings for matching published posts back to the posts we built. */
export interface IgMediaListing {
  /** Feed posts (carousels, images, reels) back to `since`, newest first. */
  feedMedia(since: Date): Promise<IgMedia[]>;
  /** The stories live now (Instagram keeps them 24 hours). */
  liveStories(): Promise<IgMedia[]>;
}

export const IG_MEDIA_FIELDS = 'id,timestamp,caption,media_type,media_url,thumbnail_url,permalink,children{id,media_type,media_url}';

type RawMedia = {
  id: string;
  timestamp?: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  children?: { data?: Array<{ id: string; media_type?: string; media_url?: string }> };
};
type MediaPage = { data?: RawMedia[]; paging?: { next?: string } };

const toMedia = (m: RawMedia, surface: IgMedia['surface']): IgMedia => ({
  id: m.id,
  surface,
  timestamp: m.timestamp ?? '',
  caption: m.caption ?? null,
  mediaType: m.media_type ?? null,
  mediaUrl: m.media_url ?? null,
  thumbnailUrl: m.thumbnail_url ?? null,
  permalink: m.permalink ?? null,
  children: (m.children?.data ?? []).map((c) => ({ id: c.id, mediaType: c.media_type ?? null, mediaUrl: c.media_url ?? null })),
});

/** The listings on one Graph transport. Bounded: at most `maxPages` pages of 50. */
export function createMediaListing(call: GraphCall, igUserId: string, maxPages = 10): IgMediaListing {
  async function pages(first: string, surface: IgMedia['surface'], since: Date | null): Promise<IgMedia[]> {
    const out: IgMedia[] = [];
    let next: string | null = first;
    for (let page = 0; next && page < maxPages; page += 1) {
      const body: MediaPage = await call('GET', next, next.startsWith('http') ? {} : { fields: IG_MEDIA_FIELDS, limit: '50' });
      const data = body.data ?? [];
      let pastSince = false;
      for (const m of data) {
        const at = Date.parse(m.timestamp ?? '');
        if (since && Number.isFinite(at) && at < since.getTime()) {
          pastSince = true;
          continue;
        }
        out.push(toMedia(m, surface));
      }
      next = pastSince ? null : body.paging?.next ?? null;
    }
    return out;
  }
  return {
    feedMedia: (since) => pages(`/${igUserId}/media`, 'feed', since),
    liveStories: () => pages(`/${igUserId}/stories`, 'story', null),
  };
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
): { call: GraphCall; igUserId: string; ops: InstagramContainerOps; listing: IgMediaListing } {
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
    async liveMediaIds(since) {
      const ids = new Set<string>();
      let next: string | null = `/${igUserId}/media`;
      // Newest first; stop once a page reaches back past `since` (or after 20 pages).
      for (let page = 0; next && page < 20; page += 1) {
        const body: { data?: { id: string; timestamp?: string }[]; paging?: { next?: string } } = await call('GET', next, next.startsWith('http') ? {} : { fields: 'id,timestamp', limit: '100' });
        const data = body.data ?? [];
        for (const m of data) ids.add(m.id);
        const oldest = data.length ? Date.parse(data[data.length - 1].timestamp ?? '') : NaN;
        next = Number.isFinite(oldest) && oldest < since.getTime() ? null : body.paging?.next ?? null;
      }
      return ids;
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

  return { call, igUserId, ops, listing: createMediaListing(call, igUserId) };
}
