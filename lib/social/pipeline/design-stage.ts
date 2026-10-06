/**
 * The `design` stage for runDay (plan M5 + M6 + M7 photo/render checks): basic photos for the
 * chosen cover and every story slide, then the render Post the local
 * preview draws. Cost is Jev's identity checks only (fractions of a cent);
 * Wikidata, Commons and Openverse are free.
 */
import { createJevTally, jevCostUsd, type JevAsk } from '@/lib/social/jev/client';
import { checkDroppedText, checkPhotoCredit } from '@/lib/social/mechanical/checks';
import { photosForDraft } from '@/lib/social/photos/design';
import { pickStarter } from '@/lib/social/photos/starter-set';
import type { PhotoDeps } from '@/lib/social/photos/find';
import type { FitCheck } from '@/lib/social/render/fit-check';
import { toRenderPost } from '@/lib/social/render/from-draft';

import type { PipelineStages } from './stages';

/**
 * `fitCheck` is the render-fit check (every element inside the slide);
 * live runs pass `checkRenderFit`, tests a stub. Then the M7 checks that
 * need photos or the render (spec §6):
 *   C6 photo credit / licence / agency → that photo is replaced by the next
 *      starter-set photo (logged); set aside only if the starter set runs out
 *   render fit, C7 dropped text → set aside as `render-failed`
 */
export function createDesignStage(deps: PhotoDeps & { fitCheck: FitCheck }): PipelineStages['design'] {
  return async (draft, brief, story) => {
    const tally = createJevTally();
    const jev: JevAsk = async (req, meta) => {
      const res = await deps.jev(req, meta);
      tally.costUsd += jevCostUsd(res.usage);
      return res;
    };
    const photos = await photosForDraft(draft.filled, brief.parsed, brief.pages, { ...deps, jev });
    // C6: never ship a photo without an allowed, credited licence.
    const traces = [photos.cover, ...photos.slides];
    const used = new Set(traces.flatMap((t) => (t.photo ? [t.photo.url] : [])));
    const photoReplacements: string[] = [];
    for (const [i, t] of traces.entries()) {
      const failures = t.photo ? checkPhotoCredit(t.photo, i === 0 ? 'cover' : `slide ${i + 1}`, brief.parsed) : [];
      if (failures.length === 0) continue;
      const starter = pickStarter(used);
      if (!starter) return { ok: false, reasonCode: 'render-failed', detail: `C6 ${failures.map((f) => f.detail).join('; ')}; starter set used up`, costUsd: tally.costUsd };
      used.add(starter.url);
      photoReplacements.push(`C6 ${failures[0]!.where}: ${failures.map((f) => f.detail).join('; ')} → ${starter.url}`);
      t.steps.push(`C6 replaced: ${failures.map((f) => f.detail).join('; ')} → starter set ${starter.url}`);
      t.photo = starter;
      t.via = 'starter';
    }
    const render = toRenderPost(
      draft.filled,
      { cover: photos.cover.photo, slides: photos.slides.map((t) => t.photo) },
      { source: brief.parsed.sources[0]?.outlet ?? story.outlets[0] ?? '', sourceUrl: brief.parsed.sources[0]?.url ?? story.url, publishedAt: story.publishedAt.toISOString() },
    );
    const fit = await deps.fitCheck(render);
    if (!fit.ok) {
      const detail = [...fit.problems, ...fit.violations.map((v) => `slide ${v.slide} ${v.element} outside the slide (${JSON.stringify(v.over)}): "${v.text}"`)].join('; ');
      return { ok: false, reasonCode: 'render-failed', detail, costUsd: tally.costUsd };
    }
    // C7: every text field of the final draft is on its rendered slide.
    const dropped = checkDroppedText(draft.filled, fit.slideText);
    if (dropped.length > 0) {
      return { ok: false, reasonCode: 'render-failed', detail: dropped.map((f) => `C7 ${f.where}: ${f.detail}`).join('; '), costUsd: tally.costUsd };
    }
    return {
      ok: true,
      value: {
        storyId: draft.storyId,
        title: draft.filled.cover,
        render,
        photos: traces,
        checks: { fixes: draft.mechanical?.fixes ?? [], warnings: draft.mechanical?.warnings ?? [], photoReplacements },
        stages: [],
        costUsd: tally.costUsd,
      },
      costUsd: tally.costUsd,
    };
  };
}
