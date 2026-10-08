import { createGraph, type InstagramContainerOps } from '@/lib/instagram/graph';

export { metaConfigured } from '@/lib/instagram/graph';

/**
 * Explainer Reels go out as regular reels (shared to the feed, not trial
 * reels): music and voice are already in the MP4, so there is no
 * audio_configuration. Then the shared status poll and `media_publish`.
 */
export interface ReelMetaClient extends InstagramContainerOps {
  createReel(input: { videoUrl: string; caption: string; shareToFeed: boolean }): Promise<string>;
}

export function createLiveReelClient(fetchImpl: typeof fetch = fetch): ReelMetaClient {
  const { call, igUserId, ops } = createGraph(fetchImpl);
  return {
    ...ops,
    async createReel(input) {
      const body = await call<{ id?: string }>('POST', `/${igUserId}/media`, {
        media_type: 'REELS',
        video_url: input.videoUrl,
        caption: input.caption,
        share_to_feed: String(input.shareToFeed),
      });
      if (!body.id) throw new Error('Meta created no reel container id.');
      return body.id;
    },
  };
}
