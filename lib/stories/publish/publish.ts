/**
 * Publishing one Story set (plan §7). The Graph API has no scheduled publish
 * for Stories; the worker is the clock and calls this at the set's minute.
 *
 *   1. Quota: the account's API publishing cap (100 posts per 24 hours) must
 *      have room for every frame, or nothing is published.
 *   2. Containers: one per frame (signed URL to its JPEG), then wait until
 *      every container is FINISHED (Meta: poll at most once a minute, up to
 *      five minutes). A container that errors or expires stops the set before
 *      anything goes live.
 *   3. Publish in order, a few seconds apart. A frame that still fails after
 *      retries stops the set; frames already live stay live (the API can't
 *      take them down) and the result says what went out.
 *
 * Side effects go through callbacks so the worker records each step as it
 * happens (a crash mid-set leaves an accurate record).
 */
import type { StoriesMetaClient } from '@/lib/stories/publish/meta';
import type { StoriesStorage } from '@/lib/stories/storage';

export type PublishFrame = { id: string; seq: number; storagePath: string };

export type PublishDeps = {
  meta: StoriesMetaClient;
  storage: StoriesStorage;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  onContainer?: (frameId: string, containerId: string) => Promise<void>;
  onPublished?: (frameId: string, mediaId: string, at: Date) => Promise<void>;
  /** Meta: check status no more than once a minute, for up to five minutes. */
  pollEveryMs?: number;
  maxPolls?: number;
  /** Pause between frames so they land in order. */
  gapMs?: number;
  publishAttempts?: number;
};

export type PublishOutcome =
  | { ok: true; mediaIds: string[] }
  | { ok: false; stage: 'quota' | 'container' | 'publish'; error: string; published: Array<{ frameId: string; mediaId: string }> };

export async function publishSet(frames: PublishFrame[], deps: PublishDeps): Promise<PublishOutcome> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());
  const ordered = [...frames].sort((a, b) => a.seq - b.seq);
  if (!ordered.length) return { ok: false, stage: 'container', error: 'no frames', published: [] };

  // 1. Quota.
  try {
    const q = await deps.meta.publishingQuota();
    if (q && q.total - q.used < ordered.length) {
      return { ok: false, stage: 'quota', error: `publishing quota: ${q.used}/${q.total} used in 24 hours, ${ordered.length} frames to post`, published: [] };
    }
  } catch (err) {
    // The quota read failing is not a reason to skip a set; publish will fail loudly if the cap is hit.
    void err;
  }

  // 2. Containers.
  const containers: string[] = [];
  try {
    for (const f of ordered) {
      const url = await deps.storage.sign(f.storagePath, 3600);
      const id = await deps.meta.createStoryContainer(url);
      containers.push(id);
      await deps.onContainer?.(f.id, id);
    }
    const pending = new Set(containers);
    for (let poll = 0; pending.size && poll < (deps.maxPolls ?? 5); poll++) {
      for (const id of [...pending]) {
        const s = await deps.meta.containerStatus(id);
        if (s.state === 'FINISHED') pending.delete(id);
        else if (s.state === 'ERROR' || s.state === 'EXPIRED') throw new Error(`container ${id} ${s.state}${s.status ? `: ${s.status}` : ''}`);
      }
      if (pending.size) await sleep(deps.pollEveryMs ?? 60_000);
    }
    if (pending.size) throw new Error(`${pending.size} container(s) not ready after ${deps.maxPolls ?? 5} checks`);
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
