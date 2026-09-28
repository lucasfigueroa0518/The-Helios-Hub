import { META_GRAPH_VERSION, META_TRENDING_MAX_PAGES } from '@/lib/reels/config';
import type { AudioType } from '@/lib/reels/music/pool';

/**
 * Instagram API with Facebook Login: the Audio API for trending sounds and the
 * content-publishing calls for trial reels (MUSIC_SELECTION_PLAN §3). Both need
 * a user access token (docs, re-checked 2026-09-27), so the Page token in
 * `.env.local` is not used.
 *
 * Everything goes through `MetaClient` so the ingest and publish jobs run
 * offline in tests against a stub.
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

export type ContainerStatus = { statusCode: string; status: string | null };

export interface MetaClient {
  /** Trending sounds of one type, in the order Meta returns them, up to `atLeast` if pages allow. */
  trending(audioType: AudioType, atLeast: number): Promise<IgAudio[]>;
  downloadPreview(url: string): Promise<{ bytes: Buffer; contentType: string | null }>;
  createReelContainer(input: ContainerInput): Promise<string>;
  containerStatus(containerId: string): Promise<ContainerStatus>;
  publishContainer(containerId: string): Promise<string>;
  permalink(mediaId: string): Promise<string | null>;
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

export function createLiveMetaClient(fetchImpl: typeof fetch = fetch): MetaClient {
  const token = process.env.META_USER_ACCESS_TOKEN;
  const igUserId = process.env.META_IG_BUSINESS_ACCOUNT_ID;
  if (!token || !igUserId) throw new MetaNotConfiguredError();
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

  async function call<T>(method: 'GET' | 'POST', path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(path.startsWith('http') ? path : `${base}${path}`);
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

    async containerStatus(containerId) {
      const body = await call<{ status_code?: string; status?: string }>('GET', `/${containerId}`, {
        fields: 'status_code,status',
      });
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
  };
}
