/**
 * Publishing one Story set (plan §7). The Graph API has no scheduled publish
 * for Stories; the worker is the clock and calls this at the set's minute.
 *
 *   1. Quota: the account gate (lib/instagram/account-gate.ts, D44) must find
 *      room for every frame above the account's reserve, or nothing is
 *      published. The same rule every content type posts under.
 *   2. Containers: one per frame (signed URL to its JPEG), then wait until
 *      every container is FINISHED (Meta: poll at most once a minute, up to
 *      five minutes). A video frame (AI Trivia's MP4) gets a `video_url`
 *      container from a URL signed for two hours, and a set with one polls
 *      every 10 seconds for up to 10 minutes, as Reels do. A container that
 *      errors or expires stops the set before anything goes live.
 *   3. Publish in order, a few seconds apart. A frame that still fails after
 *      retries stops the set; frames already live stay live (the API can't
 *      take them down) and the result says what went out.
 *
 * Side effects go through callbacks so the worker records each step as it
 * happens (a crash mid-set leaves an accurate record).
 */
import { checkAccountQuota } from '@/lib/instagram/account-gate';
import type { SpineQuery } from '@/lib/social-hub/spine';
import type { StoriesMetaClient } from '@/lib/stories/publish/meta';
import type { StoriesStorage } from '@/lib/stories/storage';

/** `media` 'video': storagePath is an MP4 (stories.frames.media); default 'image'. */
export type PublishFrame = { id: string; seq: number; storagePath: string; media?: 'image' | 'video' };

/** Image containers: Meta asks for at most one status check a minute, for up to five minutes. */
export const IMAGE_POLL = { everyMs: 60_000, maxPolls: 5, signSeconds: 3600 } as const;
/** Video containers take longer to process: every 10 s for up to 10 minutes (lib/reels/music/publish.ts), signed for 2 h. */
export const VIDEO_POLL = { everyMs: 10_000, maxPolls: 60, signSeconds: 7200 } as const;

export type PublishDeps = {
  meta: StoriesMetaClient;
  storage: StoriesStorage;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  onContainer?: (frameId: string, containerId: string) => Promise<void>;
  onPublished?: (frameId: string, mediaId: string, at: Date) => Promise<void>;
  /** Overrides of the cadence (IMAGE_POLL, or VIDEO_POLL when the set has a video frame); tests shorten them. */
  pollEveryMs?: number;
  maxPolls?: number;
  /** Pause between frames so they land in order. */
  gapMs?: number;
  publishAttempts?: number;
  /** Where the gate reads the account's reserve and records its reading (social_hub); default reserve without it. */
  gateQuery?: SpineQuery | null;
};

export type PublishOutcome =
  | { ok: true; mediaIds: string[] }
  | { ok: false; stage: 'quota' | 'container' | 'publish'; error: string; published: Array<{ frameId: string; mediaId: string }> };

export async function publishSet(frames: PublishFrame[], deps: PublishDeps): Promise<PublishOutcome> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());
  const ordered = [...frames].sort((a, b) => a.seq - b.seq);
  if (!ordered.length) return { ok: false, stage: 'container', error: 'no frames', published: [] };

  // 1. Quota: one frame is one post (the account gate, D44).
  try {
    const gate = await checkAccountQuota({ ops: deps.meta, need: ordered.length, query: deps.gateQuery ?? null });
    if (!gate.ok) return { ok: false, stage: 'quota', error: `${gate.message} ${ordered.length} frames to post.`, published: [] };
  } catch (err) {
    // The quota read failing is not a reason to skip a set; publish will fail loudly if the cap is hit.
    void err;
  }

  // 2. Containers.
  const containers: string[] = [];
  const cadence = ordered.some((f) => f.media === 'video') ? VIDEO_POLL : IMAGE_POLL;
  const maxPolls = deps.maxPolls ?? cadence.maxPolls;
  try {
    for (const f of ordered) {
      if (f.media === 'video') {
        const url = await deps.storage.sign(f.storagePath, VIDEO_POLL.signSeconds);
        containers.push(await deps.meta.createStoryVideoContainer(url));
      } else {
        const url = await deps.storage.sign(f.storagePath, IMAGE_POLL.signSeconds);
        containers.push(await deps.meta.createStoryContainer(url));
      }
      await deps.onContainer?.(f.id, containers[containers.length - 1]!);
    }
    const pending = new Set(containers);
    for (let poll = 0; pending.size && poll < maxPolls; poll++) {
      for (const id of [...pending]) {
        const s = await deps.meta.containerStatus(id);
        if (s.state === 'FINISHED') pending.delete(id);
        else if (s.state === 'ERROR' || s.state === 'EXPIRED') throw new Error(`container ${id} ${s.state}${s.status ? `: ${s.status}` : ''}`);
      }
      if (pending.size) await sleep(deps.pollEveryMs ?? cadence.everyMs);
    }
    if (pending.size) throw new Error(`${pending.size} container(s) not ready after ${maxPolls} checks`);
  } catch (err) {
    return { ok: false, stage: 'container', error: err instanceof Error ? err.message : String(err), published: [] };
  }

  // 3. Publish in order.
  const published: Array<{ frameId: string; mediaId: string }> = [];
  for (const [i, f] of ordered.entries()) {
    let mediaId: string | null = null;
    let last = '';
    for (let attempt = 1; attempt <= (deps.publishAttempts ?? 3) && !mediaId; attempt++) {
      try {
        mediaId = await deps.meta.publishContainer(containers[i]!);
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
        if (attempt < (deps.publishAttempts ?? 3)) await sleep(2000 * attempt);
      }
    }
    if (!mediaId) return { ok: false, stage: 'publish', error: `frame ${f.seq}: ${last}`, published };
    published.push({ frameId: f.id, mediaId });
    await deps.onPublished?.(f.id, mediaId, now());
    if (i < ordered.length - 1) await sleep(deps.gapMs ?? 4000);
  }
  return { ok: true, mediaIds: published.map((p) => p.mediaId) };
}
