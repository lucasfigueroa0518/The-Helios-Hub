import { createGraph, type InstagramContainerOps } from '@/lib/instagram/graph';
import { META_TRENDING_MAX_PAGES } from '@/lib/reels/config';
import type { AudioType } from '@/lib/reels/music/pool';

export { MetaNotConfiguredError, metaConfigured, type ContainerStatus } from '@/lib/instagram/graph';

/**
 * Instagram API with Facebook Login: the Audio API for trending sounds and the
 * content-publishing calls for trial reels (MUSIC_SELECTION_PLAN §3). Both need
 * a user access token (docs, re-checked 2026-09-27), so the Page token in
 * `.env.local` is not used.
 *
 * Everything goes through `MetaClient` so the ingest and publish jobs run
 * offline in tests against a stub. The Graph transport and the status /
 * publish / permalink steps are the shared ones (lib/instagram/graph.ts); this
 * file keeps only what is Trial Reels': the Audio API and the trial container.
 */

/** One sound as `/ig_audio` returns it. Nothing about genre, mood, or BPM. */
export type IgAudio = {
  audio_id: string;
  audio_type?: AudioType;
  title?: string | null;
  display_artist?: string | null;
  duration_in_ms?: number | null;
  download_url?: string | null;
  ig_username?: string | null;
  profile_picture_url?: string | null;
  cover_artwork_thumbnail_uri?: string | null;
  is_ads_eligible?: boolean | null;
  on_platform_audio_preview_link?: string | null;
};

export type ContainerInput = {
  videoUrl: string;
  caption: string;
  audioId: string;
  audioVolume: number;
  videoVolume: number;
  graduationStrategy: string;
  /** OPEN-3 is undecided, so null leaves the field off the request. */
  shareToFeed: boolean | null;
};

export interface MetaClient extends Pick<InstagramContainerOps, 'containerStatus' | 'publishContainer' | 'permalink'> {
  /** Trending sounds of one type, in the order Meta returns them, up to `atLeast` if pages allow. */
  trending(audioType: AudioType, atLeast: number): Promise<IgAudio[]>;
  downloadPreview(url: string): Promise<{ bytes: Buffer; contentType: string | null }>;
  createReelContainer(input: ContainerInput): Promise<string>;
}

export function createLiveMetaClient(fetchImpl: typeof fetch = fetch): MetaClient {
  const { call, igUserId, ops } = createGraph(fetchImpl);

  return {
    async trending(audioType, atLeast) {
      // Spike 1 (2026-09-28): the list comes back under `audio`, not `data`, 25
      // per page, and paging carries only an `after` cursor, never a `next` link.
      type Page = { audio?: IgAudio[]; data?: IgAudio[]; paging?: { cursors?: { after?: string } } };
      const out: IgAudio[] = [];
      const seen = new Set<string>();
      let after: string | undefined;
      for (let pages = 1; pages <= META_TRENDING_MAX_PAGES; pages += 1) {
        const page = await call<Page>('GET', '/ig_audio', {
          audio_type: audioType,
          user_id: igUserId,
          ...(after ? { after } : {}),
        });
        const items = page.audio ?? page.data ?? [];
        // Pages can overlap by a sound; keep its first (higher) position.
        for (const item of items) {
          if (seen.has(item.audio_id)) continue;
          seen.add(item.audio_id);
          out.push(item);
        }
        after = page.paging?.cursors?.after;
        if (items.length === 0 || !after || out.length >= atLeast) break;
      }
      return out;
    },

    async downloadPreview(url) {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`Preview download failed (${response.status}).`);
      return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') };
    },

    async createReelContainer(input) {
      const params: Record<string, string> = {
        media_type: 'REELS',
        video_url: input.videoUrl,
        caption: input.caption,
        audio_configuration: JSON.stringify({
          audio_id: input.audioId,
          audio_volume: input.audioVolume,
          video_volume: input.videoVolume,
        }),
        trial_params: JSON.stringify({ graduation_strategy: input.graduationStrategy }),
      };
      if (input.shareToFeed != null) params.share_to_feed = String(input.shareToFeed);
      const body = await call<{ id?: string }>('POST', `/${igUserId}/media`, params);
      if (!body.id) throw new Error('Meta created no container id.');
      return body.id;
    },

    containerStatus: ops.containerStatus,
    publishContainer: ops.publishContainer,
    permalink: ops.permalink,
  };
}
