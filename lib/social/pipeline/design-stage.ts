/**
 * The `design` stage for runDay (plan M5 + M6): basic photos for the
 * chosen cover and every story slide, then the render Post the local
 * preview draws. Cost is Jev's identity checks only (fractions of a cent);
 * Wikidata, Commons and Openverse are free.
 */
import { createJevTally, jevCostUsd, type JevAsk } from '@/lib/social/jev/client';
import { photosForDraft } from '@/lib/social/photos/design';
import type { PhotoDeps } from '@/lib/social/photos/find';
import { toRenderPost } from '@/lib/social/render/from-draft';

import type { PipelineStages } from './stages';

export function createDesignStage(deps: PhotoDeps): PipelineStages['design'] {
  return async (draft, brief, story) => {
    const tally = createJevTally();
    const jev: JevAsk = async (req, meta) => {
      const res = await deps.jev(req, meta);
      tally.costUsd += jevCostUsd(res.usage);
      return res;
    };
    const photos = await photosForDraft(draft.filled, brief.parsed, brief.pages, { ...deps, jev });
    const render = toRenderPost(
      draft.filled,
      { cover: photos.cover.photo, slides: photos.slides.map((t) => t.photo) },
      { source: brief.parsed.sources[0]?.outlet ?? story.outlets[0] ?? '', sourceUrl: brief.parsed.sources[0]?.url ?? story.url, publishedAt: story.publishedAt.toISOString() },
    );
    return {
      ok: true,
      value: { storyId: draft.storyId, title: draft.filled.cover, render, photos: [photos.cover, ...photos.slides], stages: [], costUsd: tally.costUsd },
      costUsd: tally.costUsd,
    };
  };
}
