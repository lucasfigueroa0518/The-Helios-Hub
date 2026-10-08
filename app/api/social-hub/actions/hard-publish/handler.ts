import { isUuid, type ActionSpec } from '@/lib/social-hub/action-route';

type Queued = { queued: boolean; note?: string; status?: number };
type Deps = {
  reelsForcePost: (videoJobId: string) => Promise<Queued>;
  carouselHardPublish: (query: never, postId: string) => Promise<Queued>;
  socialQuery: () => Promise<unknown>;
  explainerHardPublish: (db: never, jobId: string, by: string) => Promise<Queued>;
  explainersDb: () => Promise<unknown>;
  storiesPublishNow: (db: never, setId: string) => Promise<unknown>;
  storiesDb: unknown;
};

export type HardPublishBody = { vertical: 'reels' | 'carousels' | 'explainers' | 'stories'; ref: string };

const VERTICALS = new Set(['reels', 'carousels', 'explainers', 'stories']);

/**
 * Hard publish (SH-15, SH-17): post now, skipping the slot, and it counts
 * as approval for every type. Each vertical's own function (P2-M3):
 * Trial Reels `forcePost(videoJobId)`, Carousels `hardPublishPost(q, postId)`,
 * Explainers `hardPublishJob(db, jobId, by)`, Stories `publishNow(db, setId)`.
 * Quota: each worker still refuses with fewer than 5 posts left.
 */
export function hardPublish(deps: Deps): ActionSpec<HardPublishBody> {
  return {
    flag: 'hardPublish',
    parse: (b) => {
      const body = b as { vertical?: unknown; ref?: unknown } | null;
      if (!isUuid(body?.ref) || !VERTICALS.has(String(body.vertical))) return null;
      return { vertical: body.vertical as HardPublishBody['vertical'], ref: body.ref };
    },
    run: async ({ vertical, ref }, ctx) => {
      if (vertical === 'stories') {
        await deps.storiesPublishNow(deps.storiesDb as never, ref);
        return { ok: true, note: 'Approved and queued to publish now.' };
      }
      const out = vertical === 'reels'
        ? await deps.reelsForcePost(ref)
        : vertical === 'carousels'
          ? await deps.carouselHardPublish((await deps.socialQuery()) as never, ref)
          : await deps.explainerHardPublish((await deps.explainersDb()) as never, ref, ctx.email);
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.', status: out.status };
    },
  };
}
