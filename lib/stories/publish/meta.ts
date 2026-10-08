/**
 * Instagram Graph calls for Stories (plan §7): image containers with
 * `media_type=STORIES`, their status, publish, and the account's publishing
 * quota. The transport (calls, errors, version) is the shared one
 * (lib/instagram/graph.ts, D44); this file keeps Stories' own container and
 * the shapes the Stories worker reads. Content publishing needs the user
 * access token. Tests pass a fetch stub; the token never appears in an error.
 */
import { createGraph, MetaNotConfiguredError, type InstagramContainerOps } from '@/lib/instagram/graph';

export type ContainerState = 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED' | 'PUBLISHED' | 'UNKNOWN';

export interface StoriesMetaClient extends Pick<InstagramContainerOps, 'publishingLimit'> {
  createStoryContainer(imageUrl: string): Promise<string>;
  containerStatus(containerId: string): Promise<{ state: ContainerState; status: string | null }>;
  publishContainer(containerId: string): Promise<string>;
  /** Posts published through the API in the last 24 hours, and the cap (100 per Meta's docs). */
  publishingQuota(): Promise<{ used: number; total: number } | null>;
}

/** Kept for callers that catch it by name; it is the shared not-configured error. */
export const StoriesMetaNotConfiguredError = MetaNotConfiguredError;

export function createStoriesMetaClient(opts: { token: string; igUserId: string; fetchImpl?: typeof fetch }): StoriesMetaClient {
  const { call, igUserId, ops } = createGraph(opts.fetchImpl ?? fetch, { token: opts.token, igUserId: opts.igUserId });
  return {
    async createStoryContainer(imageUrl) {
      const body = await call<{ id?: string }>('POST', `/${igUserId}/media`, { media_type: 'STORIES', image_url: imageUrl });
      if (!body.id) throw new Error('Meta created no container id.');
      return body.id;
    },
    async containerStatus(containerId) {
      const { statusCode, status } = await ops.containerStatus(containerId);
      const known: ContainerState[] = ['FINISHED', 'IN_PROGRESS', 'ERROR', 'EXPIRED', 'PUBLISHED'];
      const state = known.includes(statusCode as ContainerState) ? (statusCode as ContainerState) : 'UNKNOWN';
      return { state, status };
    },
    publishContainer: ops.publishContainer,
    publishingLimit: ops.publishingLimit,
    async publishingQuota() {
      const { quotaUsage, quotaTotal } = await ops.publishingLimit();
      return { used: quotaUsage, total: quotaTotal ?? 100 };
    },
  };
}

export function createLiveStoriesMetaClient(fetchImpl: typeof fetch = fetch): StoriesMetaClient {
  const token = process.env.META_USER_ACCESS_TOKEN;
  const igUserId = process.env.META_IG_BUSINESS_ACCOUNT_ID;
  if (!token || !igUserId) throw new StoriesMetaNotConfiguredError();
  return createStoriesMetaClient({ token, igUserId, fetchImpl });
}
