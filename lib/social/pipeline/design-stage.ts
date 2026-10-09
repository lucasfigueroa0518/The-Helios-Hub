/**
 * The `design` stage for runDay (photo spec §4–§5b; plan M8): the photo
 * chain for the chosen cover and every story slide, the render Post, the
 * render checks, then the render review (when given).
 *
 *   C6 photo credit / licence / agency → that slide's photo goes; it shows
 *      its icon background (a quote slide: type-led). Logged.
 *   render fit, C7 dropped text → set aside as `render-failed`. A person
 *      photo placed full bleed whose face ends up under text goes back to
 *      the split layout first (photo spec §4), and the post re-renders once.
 *   render review (photo spec §5b, optional): one Haiku review of the
 *      contact sheet; its fixes change slide settings only, never text.
 *   photo bank (DECISIONS_LOG D49, optional): right after C6, the finder's
 *      vetted photos are offered to the bank. `offer` is synchronous and
 *      returns nothing; a bank that throws changes nothing here.
 *
 * AI spend here: Jev (identity, stock pre-screen; counted in this stage's
 * cost), the vision checks and the render review (counted by the run budget).
 */
import type { PhotoBank } from '@/lib/media-library/bank';
import { createJevTally, jevCostUsd, type JevAsk } from '@/lib/social/jev/client';
import { checkDroppedText, checkPhotoCredit } from '@/lib/social/mechanical/checks';
import { photosForDraft } from '@/lib/social/photos/design';
import type { IdentityCache } from '@/lib/social/photos/p18';
import type { UsedPhotoLog } from '@/lib/social/photos/used-photos';
import type { PhotoDeps } from '@/lib/social/photos/find';
import type { FitCheck, FitResult } from '@/lib/social/render/fit-check';
import { toRenderPost } from '@/lib/social/render/from-draft';
import { chooseLayout } from '@/lib/social/render/layout';
import type { Post } from '@/lib/social/render/types';

import type { PipelineStages } from './stages';

/** The render review (photo spec §5b), injected so tests and runs without it skip it. */
export type RenderReviewStep = (input: { post: Post; storyId: string; traces: import('@/lib/social/photos/find').PhotoTrace[]; fit: FitResult; fitCheck: FitCheck }) => Promise<{ post: Post; fit: FitResult; log: string[] }>;

/**
 * `fitCheck` is the render-fit check (every element inside the slide);
 * live runs pass `checkRenderFit`, tests a stub.
 */
export type DesignDeps = Omit<PhotoDeps, 'bank'> & {
  fitCheck: FitCheck;
  /** The photo bank (DECISIONS_LOG D49): vetted photos are offered to it; its reader is a finder source (gated by its settings). */
  bank?: PhotoBank;
  /** The used-photo log (7-day rule); empty when not given (tests). */
  usedLog?: UsedPhotoLog;
  now?: () => Date;
  /** Identity results per story, shared with the Writer's availability flags. */
  identitiesFor?: (storyId: string) => IdentityCache;
  review?: RenderReviewStep;
};

const facesUnderText = (fit: FitResult) => new Set(fit.problems.flatMap((p) => { const m = /^slide (\d+) faces: .* covers a face$/.exec(p); return m ? [Number(m[1])] : []; }));

export function createDesignStage(deps: DesignDeps): PipelineStages['design'] {
  // Photos picked earlier in this run (Tommy, 2026-10-07: both PREVIEW covers got the same microchip).
  const usedThisRun = new Set<string>();
  return async (draft, brief, story) => {
    const tally = createJevTally();
    const jev: JevAsk = async (req, meta) => {
      const res = await deps.jev(req, meta);
      tally.costUsd += jevCostUsd(res.usage);
      return res;
    };
    const now = deps.now?.() ?? new Date();
    // The used-photo check: the last 7 days (the log) plus every photo picked earlier in this run.
    const recent = new Set([...(deps.usedLog ? await deps.usedLog.recent(now) : []), ...usedThisRun]);
    const lastUsed = deps.usedLog ? await deps.usedLog.lastUsed() : new Map<string, string>();
    // The story's date ranks dated photos (photo spec §4 step 3).
    const { bank, ...photoDeps } = deps;
    const photos = await photosForDraft(draft.filled, brief.parsed, brief.pages, { ...photoDeps, jev, ...(bank?.reader ? { bank: bank.reader } : {}) }, { recent, lastUsed, identities: deps.identitiesFor?.(draft.storyId), storyDate: story.publishedAt.toISOString().slice(0, 10) });
    // The sheet tags and close-up checks are Claude calls (counted by the run budget's guard); shown under design too.
    const photoUsd = photos.costUsd.tags + photos.costUsd.vision;
    // C6: never ship a photo without an allowed, credited licence. A failing photo goes; the slide shows its icon.
    const traces = [photos.cover, ...photos.slides];
    const photoReplacements: string[] = [];
    for (const [i, t] of traces.entries()) {
      const failures = t.photo ? checkPhotoCredit(t.photo, i === 0 ? 'cover' : `slide ${i + 1}`, brief.parsed) : [];
      if (failures.length === 0) continue;
      const to = draft.filled.slides[i - 1]?.type === 'quote' ? 'type-led' : 'icon';
      photoReplacements.push(`C6 ${failures[0]!.where}: ${failures.map((f) => f.detail).join('; ')} → ${to}`);
      t.steps.push(`C6 dropped: ${failures.map((f) => f.detail).join('; ')} → ${to}`);
      t.photo = null;
      t.via = to;
    }
    // The photo bank (D49): never blocking, never changing the post.
    try {
      bank?.offer({
        runKind: 'carousel',
        runRef: draft.storyId,
        subjects: brief.parsed.subjects.map((s) => s.name),
        organizations: brief.parsed.subjects.filter((s) => s.type === 'organization').map((s) => s.name),
        items: photos.vetted,
        at: now,
      });
    } catch {
      // ignored: the bank is best effort
    }
    const meta = { source: brief.parsed.sources[0]?.outlet ?? story.outlets[0] ?? '', sourceUrl: brief.parsed.sources[0]?.url ?? story.url, publishedAt: story.publishedAt.toISOString() };
    // Jev's layout (slide buckets spec): the spread, then a variant per slide.
    const drawn = { cover: photos.cover.photo, slides: photos.slides.map((t) => t.photo), icons: traces.map((t) => t.icon) };
    const layout = await chooseLayout(draft.filled, { cover: photos.cover, slides: photos.slides }, jev);
    let render = toRenderPost(draft.filled, drawn, meta, layout);
    let fit = await deps.fitCheck(render);
    // A person photo full bleed whose face ends up under text: the split layout instead (photo spec §4), one re-render.
    const bleedFaces = [...facesUnderText(fit)].filter((n) => render.slides[n - 1]?.photoBleed);
    if (bleedFaces.length) {
      render = { ...render, slides: render.slides.map((s, i) => (bleedFaces.includes(i + 1) ? { ...s, photoBleed: false, ...(s.layoutVariant === 'image' ? { layoutVariant: 'text' as const, photoPlacement: 'top' as const } : {}) } : s)) };
      photoReplacements.push(...bleedFaces.map((n) => `slide ${n}: a face under text on the full-bleed photo → split layout`));
      fit = await deps.fitCheck(render);
    }
    // A variant whose slide fails the render check: that slide takes the default layout, one re-render (logged).
    const failingSlides = new Set([...fit.problems.flatMap((p) => { const m = /^slide (\d+) /.exec(p); return m ? [Number(m[1])] : []; }), ...fit.violations.map((v) => v.slide)].filter((n) => render.slides[n - 1]?.template));
    if (failingSlides.size) {
      const plain = toRenderPost(draft.filled, drawn, meta);
      layout.log.push(...[...failingSlides].map((n) => `slide ${n}: failed the render check under ${render.slides[n - 1]?.template ?? 'its layout'} → the default layout`));
      render = { ...render, slides: render.slides.map((sl, i) => (failingSlides.has(i + 1) && sl.template ? plain.slides[i]! : sl)) };
      fit = await deps.fitCheck(render);
    }
    if (!fit.ok) {
      const detail = [...fit.problems, ...fit.violations.map((v) => `slide ${v.slide} ${v.element} outside the slide (${JSON.stringify(v.over)}): "${v.text}"`)].join('; ');
      return { ok: false, reasonCode: 'render-failed', detail, costUsd: tally.costUsd };
    }
    // M8b: keep the face-centred crops the check chose, so the preview draws the same thing.
    for (const f of fit.focus ?? []) {
      const sl = render.slides[f.slide - 1];
      if (f.focus && sl && sl.photoUrl === f.photo) sl.photoFocus = f.focus;
    }
    // C7: every text field of the final draft is on its rendered slide.
    const dropped = checkDroppedText(draft.filled, fit.slideText);
    if (dropped.length > 0) {
      return { ok: false, reasonCode: 'render-failed', detail: dropped.map((f) => `C7 ${f.where}: ${f.detail}`).join('; '), costUsd: tally.costUsd };
    }
    // The render review (photo spec §5b): settings only; the fit and C7 checks hold after every fix.
    let reviewLog: string[] = [];
    if (deps.review) {
      const r = await deps.review({ post: render, storyId: draft.storyId, traces, fit, fitCheck: deps.fitCheck });
      render = r.post;
      reviewLog = r.log;
      const after = checkDroppedText(draft.filled, r.fit.slideText);
      if (!r.fit.ok || after.length) return { ok: false, reasonCode: 'render-failed', detail: `after the render review: ${[...r.fit.problems, ...after.map((f) => f.detail)].join('; ')}`, costUsd: tally.costUsd };
    }
    for (const sl of render.slides) if (sl.photoUrl) usedThisRun.add(sl.photoUrl);
    return {
      ok: true,
      value: {
        storyId: draft.storyId,
        title: draft.filled.cover,
        render,
        photos: traces,
        checks: { fixes: draft.mechanical?.fixes ?? [], warnings: draft.mechanical?.warnings ?? [], photoReplacements, layout: layout.log, ...(deps.review ? { renderReview: reviewLog } : {}) },
        stages: [],
        costUsd: tally.costUsd + photoUsd,
      },
      costUsd: tally.costUsd + photoUsd,
    };
  };
}
