/**
 * The `hook` stage for runDay (Hook pass; Tommy, 2026-10-06): on in every
 * daily run since 2026-10-07 (fifth round); --no-hook turns it off.
 *
 * Budgets are measured on the render before photos exist, so each slide
 * gets a placeholder photo of the kind its IMAGE request would produce,
 * under the finder's slot rules (photos/find.ts): subject or article → a
 * subject region (on a quote slide only the speaker, in the round spot);
 * stock → a scene. none → code picks a photo (fifth round: every slide gets
 * one), so it is measured as a subject region, the tightest case; a stat or
 * type-led quote slide as a backdrop. Where the finder later finds nothing,
 * the slide renders text-only, which only leaves more room.
 */
import { measureHookBudgets } from '@/lib/social/hook/budget';
import { runHookPass, type HookDeps, type HookResult } from '@/lib/social/hook/hook';
import { slotFor } from '@/lib/social/photos/design';
import type { Photo } from '@/lib/social/photos/find';
import type { FitCheck } from '@/lib/social/render/fit-check';
import type { FilledDraft, VisualRequest } from '@/lib/social/writer/draft';

import type { PipelineStages } from './stages';

/** Any local image: the budget measures text space, not the photo (the starter set is out, photo spec §6). */
const PLACEHOLDER = '/social/helios-mark.png';

const placeholder = (source: Photo['source'], subject: string | null): Photo => ({ url: PLACEHOLDER, credit: 'placeholder (budget measurement)', source, width: 2048, height: 1536, qid: subject ? 'Q0' : null, subject });

/** The photo kind each slide's request would produce, for measuring. */
export function placeholderPhotos(draft: FilledDraft): { cover: Photo | null; slides: Array<Photo | null> } {
  // People and companies measure as a subject region (the tightest case); scenes, products and events as a scene.
  const forRequest = (v: VisualRequest, slot: 'split' | 'backdrop' | 'quote', speaker: string | null): Photo | null => {
    if (slot === 'backdrop') return placeholder('stock', null);
    if (slot === 'quote') return v.kind === 'person' && v.query === speaker ? placeholder('commons', v.query) : placeholder('stock', null);
    return v.kind === 'person' || v.kind === 'company' ? placeholder('commons', v.query) : v.kind === 'logo' ? placeholder('logo', v.query) : placeholder('stock', null);
  };
  return {
    cover: forRequest(draft.cover_options[draft.chosen_cover - 1]!.visual, 'split', null),
    slides: draft.slides.map((s) => forRequest(s.visual, slotFor(s.type), s.quote?.speaker_subject ?? null)),
  };
}

export function createHookStage(deps: HookDeps & { fitCheck: FitCheck; onResult?: (storyId: string, r: HookResult & { budgets: number[] }) => void }): NonNullable<PipelineStages['hook']> {
  return async (draft, brief) => {
    const meta = { source: brief.parsed.sources[0]?.outlet ?? '', sourceUrl: brief.parsed.sources[0]?.url ?? '', publishedAt: new Date().toISOString() };
    let budgets: number[];
    try {
      budgets = (await measureHookBudgets(draft.filled, placeholderPhotos(draft.filled), meta, deps.fitCheck)).budgets;
    } catch (err) {
      return { ok: false, reasonCode: 'render-failed', detail: `hook budgets: ${err instanceof Error ? err.message : String(err)}`, costUsd: 0 };
    }
    const r = await runHookPass(brief.parsed, draft.submission, budgets, deps);
    deps.onResult?.(draft.storyId, { ...r, budgets });
    if (!r.ok) return { ok: false, reasonCode: r.reason, detail: r.detail, costUsd: r.costUsd };
    return { ok: true, value: { storyId: draft.storyId, submission: r.draft, filled: r.filled }, costUsd: r.costUsd };
  };
}
