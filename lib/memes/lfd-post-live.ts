/**
 * The worker's live wiring for memes in a Last Few Days post (lib/memes/lfd-post.ts): Claude, Jev, the meme
 * renderer, the slide render and the slide bucket. Network modules load only when a post gets memes; tests never
 * call this (CLAUDE.md Rule 1).
 */
import type { HubQuery } from '@/lib/social-hub/db';

import type { CarryOutDeps } from '@/lib/lfd/worker';

export function liveMemesForPost(query: HubQuery, log: (message: string, fields?: Record<string, unknown>) => void): NonNullable<CarryOutDeps['memes']> {
  return async (postId, { capUsd }) => {
    const { addMemesToPost } = await import('./lfd-post');
    const { openMemeRenderer } = await import('./render');
    const { newAnthropic } = await import('@/lib/anthropic-client');
    const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
    const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
    const { checkRenderFit } = await import('@/lib/social/render/fit-check');
    const { storeSlideJpegs } = await import('@/lib/social/overnight/slides');
    const { mediaBucket } = await import('@/lib/media-bucket');
    const { SLIDE_BUCKET } = await import('@/lib/social/overnight/config');
    const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
    const bucket = mediaBucket(SLIDE_BUCKET);
    const tally = createJevTally();
    const res = await addMemesToPost(
      {
        query,
        create: liveMessagesCreate(newAnthropic()),
        jev: capped(tallied(createJevAsk(), tally), tally, 0.1),
        openRenderer: openMemeRenderer,
        fitCheck: checkRenderFit,
        upload: (p, body, type) => bucket.upload(p, body, type),
        fetchBody: fetchBodyLive,
        storeSlides: (slug, render) => storeSlideJpegs(slug, render as never, { prefix: 'lfd', fitCheck: checkRenderFit, upload: (p, b) => bucket.upload(p, b, 'image/jpeg') }),
        now: () => new Date(),
        log,
        capUsd,
      },
      postId,
    );
    return { ...res, costUsd: res.costUsd + tally.costUsd };
  };
}
