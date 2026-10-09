/**
 * The pivot (Lucas, 2026-10-09): a slide whose visual and fallback found no
 * usable photo tries its `alt_visuals` next (the Writer's other ideas drawn
 * from the slide's own copy). One Jev call (photo-pivot@1) decides which are
 * worth searching; design.ts searches and picks them like any request.
 */
import * as PhotoPivot from '@/lib/social/jev/questions/photo-pivot.v1';
import type { JevAsk } from '@/lib/social/jev/client';
import type { VisualRequest } from '@/lib/social/writer/draft';

const keyOf = (v: VisualRequest) => `${v.kind}:${v.query.trim().toLowerCase()}`;
const label = (v: VisualRequest) => `${v.kind}: ${v.query}`;

/** The alt visuals still worth asking about: non-empty, not already tried, no repeats, at most MAX_OPTIONS. Pure. */
export function pivotOptions(alts: VisualRequest[] | undefined, tried: VisualRequest[]): VisualRequest[] {
  const seen = new Set(tried.map(keyOf));
  const out: VisualRequest[] = [];
  for (const alt of alts ?? []) {
    if (!alt.query.trim() || seen.has(keyOf(alt))) continue;
    seen.add(keyOf(alt));
    out.push(alt);
    if (out.length === PhotoPivot.MAX_OPTIONS) break;
  }
  return out;
}

export type PivotInput = {
  jev: JevAsk;
  story: string;
  slide: PhotoPivot.PivotState['slide'];
  alts: VisualRequest[] | undefined;
  /** The requests already run for this slide, with how each ended. */
  tried: Array<{ request: VisualRequest; outcome: string }>;
  photosInPost: PhotoPivot.PivotState['photos_already_in_post'];
};

/** The alt visuals to search, best first (empty when none qualify or Jev errors); `steps` for the trace. */
export async function choosePivots(input: PivotInput): Promise<{ chosen: VisualRequest[]; steps: string[] }> {
  const options = pivotOptions(input.alts, input.tried.map((t) => t.request));
  if (!options.length) return { chosen: [], steps: [] };
  const state: PhotoPivot.PivotState = {
    story: input.story,
    slide: input.slide,
    tried: input.tried.map((t) => ({ request: label(t.request), outcome: t.outcome })),
    photos_already_in_post: input.photosInPost,
    options: options.map((o) => ({ request: label(o) })),
  };
  try {
    const scores = await PhotoPivot.photoPivotScores(input.jev, state, `${input.slide.headline.slice(0, 60)} #${input.slide.position}`);
    const chosen = PhotoPivot.keepPivots(options, scores);
    const detail = options.map((o, k) => `${label(o)} belongs ${scores[k]!.belongs.toFixed(2)} different ${scores[k]!.different.toFixed(2)} best ${scores[k]!.best.toFixed(2)}`).join('; ');
    return { chosen, steps: [`pivot check ${PhotoPivot.VERSION}: ${detail}${chosen.length ? '' : ' → none worth searching'}`] };
  } catch (err) {
    return { chosen: [], steps: [`pivot check ${PhotoPivot.VERSION}: error (${err instanceof Error ? err.message : String(err)}) → no pivot`] };
  }
}
