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
 *
 *   shared photo finder (CI-30, optional): when the run's carousel switch is
 *      'shared', lib/photos fills each slot first under one post budget
 *      ($0.30); today's finder then fills only the slots it left empty, with
 *      the shared picks excluded and kept. C6, the swap rounds, the review and
 *      the output shape are unchanged. Its spend counts in this stage's cost.
 */
import type { PhotoBank } from '@/lib/media-library/bank';
import { createJevTally, jevCostUsd, type JevAsk } from '@/lib/social/jev/client';
import { checkDroppedText, checkPhotoCredit } from '@/lib/social/mechanical/checks';
import type { findPhotos } from '@/lib/photos/find';
import type { needsForDraft } from '@/lib/photos/needs';
import type { PhotoNeed as PhotoNeedArg, PhotoDeps as SharedPhotoDeps, PhotoProfile } from '@/lib/photos/types';
import { coverRequest, photosForDraft, type DraftPhotos } from '@/lib/social/photos/design';
import type { IdentityCache } from '@/lib/social/photos/p18';
import type { UsedPhotoLog } from '@/lib/social/photos/used-photos';
import type { Photo, PhotoDeps, PhotoTrace } from '@/lib/social/photos/find';
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { DEFAULT_ICON, isIcon } from '@/lib/social/render/icons';
import type { FilledDraft } from '@/lib/social/writer/draft';
import type { Photo as SharedPhoto } from '@/lib/stories/render/types';
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
  /** The shared photo finder (CI-30), resolved once per run by live-stages: null or absent = today's finder only. */
  sharedPhotos?: () => Promise<SharedPhotoStep | null>;
};

/** The shared finder for a run whose carousel switch is 'shared'. `find`/`needs` default to lib/photos (tests stub them). */
export type SharedPhotoStep = { profile: PhotoProfile; deps: SharedPhotoDeps; find?: typeof findPhotos; needs?: typeof needsForDraft };

/**
 * A shared pick as a carousel photo. The shared finder's news photos come from the web (story pages, search), so C6
 * judges them as article photos: the credit must be an allowed one (open licence, government, a SUBJECTS company).
 */
export function carouselPhoto(p: SharedPhoto): Photo {
  return { url: p.src, credit: p.credit, source: 'article', width: null, height: null, qid: null, subject: null };
}

/** Why a shared pick can't go on a carousel slide (then today's finder fills it), or null when it can. */
export function sharedPickProblem(p: SharedPhoto, where: string, brief: Brief): string | null {
  // A logo card needs its plate (light/dark, from the logo's luminance), which only today's logo lane reads.
  if (p.kind === 'logo') return 'a logo (a logo card needs its plate; today\'s logo lane sets it)';
  const c6 = checkPhotoCredit(carouselPhoto(p), where, brief);
  return c6.length ? `C6: ${c6.map((f) => f.detail).join('; ')}` : null;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 160);

type PhotoHistory = NonNullable<Parameters<typeof photosForDraft>[4]>;

/**
 * Shared mode: the shared finder over every slot (one post budget), then today's finder over the slots it left
 * empty only, with the shared picks excluded. Today's finder sees a draft of just those slots: the cover when it is
 * empty (cover rules and promotion as today), else the first empty non-quote, non-stat slide leads as a plain frame
 * (no cover rules, so no promotion steals a slide). Never throws over the shared finder.
 */
export async function sharedThenToday(
  step: SharedPhotoStep,
  filled: FilledDraft,
  brief: Brief,
  pages: PageReadOk[],
  deps: PhotoDeps,
  history: PhotoHistory,
): Promise<{ photos: DraftPhotos; usd: number }> {
  const n = filled.slides.length + 1;
  const where = (i: number) => (i === 0 ? 'cover' : `slide ${i + 1}`);
  const chosen = filled.cover_options[filled.chosen_cover - 1]!;
  const icon = (name: string | undefined) => (isIcon(name) ? name : DEFAULT_ICON);
  const shared: Array<PhotoTrace | null> = Array.from({ length: n }, () => null);
  const notes: string[][] = Array.from({ length: n }, () => []);
  const budget = { usd: 0, capUsd: step.profile.capUsd };
  try {
    const needsMod = await import('@/lib/photos/needs');
    const find = step.find ?? (await import('@/lib/photos/find')).findPhotos;
    const wanted = (step.needs ?? needsMod.needsForDraft)(filled, brief).flatMap(({ slot, need }) => {
      const i = needsMod.draftSlotIndex(slot);
      return i !== null && i < n ? [{ i, need }] : [];
    });
    // The carousel's own rules (no logo, C6) go into the find, so a refused pick gives way to the next-ranked one.
    const slotOf = new Map(wanted.map((w) => [w.need, w.i]));
    const accept = (p: SharedPhoto, need: PhotoNeedArg) => sharedPickProblem(p, where(slotOf.get(need) ?? 0), brief);
    const found = await find(wanted.map((w) => w.need), step.profile, step.deps, { exclude: history.recent ?? new Set(), budget, accept });
    wanted.forEach(({ i }, k) => {
      const steps = [...(found.traces[k] ?? [])];
      const p = found.photos[k] ?? null;
      const problem = p ? sharedPickProblem(p, where(i), brief) : null;
      if (!p || problem) {
        notes[i]!.push(...steps, `shared: ${problem ? `${p!.src.slice(0, 80)} can't be used: ${problem}` : 'no photo'} → today's finder`);
        return;
      }
      const s = i === 0 ? null : filled.slides[i - 1]!;
      shared[i] = { request: s ? s.visual : coverRequest(chosen.visual), photo: carouselPhoto(p), via: 'article', icon: icon(s ? s.icon : chosen.icon), identity: null, steps, alternates: [] };
    });
  } catch (err) {
    notes[0]!.push(`shared: error ${errText(err)} → today's finder`);
  }
  notes[0]!.unshift(`shared: $${budget.usd.toFixed(4)} of the post's $${budget.capUsd.toFixed(2)} spent`);

  const empty = shared.flatMap((t, i) => (t ? [] : [i]));
  let at: number[] = [];
  let today: DraftPhotos | null = null;
  if (empty.length) {
    const recent = new Set([...(history.recent ?? []), ...shared.flatMap((t) => (t?.photo ? [t.photo.url] : []))]);
    let reduced: FilledDraft;
    let plainCover = false;
    if (empty[0] === 0) {
      at = empty;
      reduced = { ...filled, slides: empty.slice(1).map((i) => filled.slides[i - 1]!) };
    } else {
      const lead = empty.find((i) => !['quote', 'stat'].includes(filled.slides[i - 1]!.type)) ?? empty[0]!;
      at = [lead, ...empty.filter((i) => i !== lead)];
      const s = filled.slides[lead - 1]!;
      const first = { ...chosen, text: s.headline.text, visual: s.visual, fallback_visual: s.fallback_visual, alt_visuals: s.alt_visuals, subject_ids: s.subject_ids, icon: s.icon };
      reduced = { ...filled, cover: s.headline.text, cover_options: filled.cover_options.map((c, k) => (k === filled.chosen_cover - 1 ? first : c)), slides: at.slice(1).map((i) => filled.slides[i - 1]!) };
      plainCover = true;
    }
    today = await photosForDraft(reduced, brief, pages, deps, { ...history, recent, plainCover });
  }
  const todayTraces = today ? [today.cover, ...today.slides] : [];
  const traces = shared.slice();
  at.forEach((i, k) => {
    const t = todayTraces[k]!;
    traces[i] = { ...t, steps: [...notes[i]!, ...t.steps] };
  });
  for (const [i, t] of shared.entries()) if (t && notes[i]!.length) t.steps.unshift(...notes[i]!);
  // The 7-day rule exempts some lanes (headshots) on inner slides, and today's pick state can't see the shared picks:
  // a slide today's finder gave a shared pick takes its next runner-up not in the post, else its icon (a quote: type-led).
  const sharedUrls = new Set(shared.flatMap((t) => (t?.photo ? [t.photo.url] : [])));
  for (const i of at) {
    const t = traces[i]!;
    if (!t.photo || !sharedUrls.has(t.photo.url)) continue;
    const inPost = new Set(traces.flatMap((x) => (x?.photo ? [x.photo.url] : [])));
    const next = t.alternates.find((c) => !inPost.has(c.url)) ?? null;
    const to = next ? next.source : filled.slides[i - 1]?.type === 'quote' ? 'type-led' : 'icon';
    t.steps.push(`shared: today's pick is a shared pick on another slide → ${next ? `next runner-up (${next.source})` : to}`);
    t.photo = next;
    t.via = to as PhotoTrace['via'];
  }
  const all = traces as PhotoTrace[];
  // The bank's record keeps render positions (1 = the cover): today's positions map back to the post's.
  const vetted = (today?.vetted ?? []).map((v) => ({ ...v, slide: (at[v.slide - 1] ?? v.slide - 1) + 1 }));
  return { photos: { cover: all[0]!, slides: all.slice(1), costUsd: today?.costUsd ?? { tags: 0, vision: 0 }, vetted }, usd: budget.usd };
}

/** The image URLs the render check could not load, each once (its `image failed to load: <src>` problems). */
export function failedImageUrls(problems: readonly string[]): string[] {
  const urls = problems.flatMap((p) => {
    const m = /^image failed to load: (.+)$/.exec(p);
    return m ? [m[1]!] : [];
  });
  return [...new Set(urls)];
}

/** Photos the render check may swap out before it gives up on a story: a bad photo costs a slide's photo, never the post. */
const MAX_IMAGE_SWAP_ROUNDS = 2;

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
    const { bank, sharedPhotos, ...photoDeps } = deps;
    const finderDeps = { ...photoDeps, jev, ...(bank?.reader ? { bank: bank.reader } : {}) };
    const history = { recent, lastUsed, identities: deps.identitiesFor?.(draft.storyId), storyDate: story.publishedAt.toISOString().slice(0, 10) };
    // CI-30: the shared finder first when the run's carousel switch is 'shared' (else today's call, unchanged).
    const step = sharedPhotos ? await sharedPhotos().catch(() => null) : null;
    let sharedUsd = 0;
    let photos: DraftPhotos;
    if (step) {
      const r = await sharedThenToday(step, draft.filled, brief.parsed, brief.pages, finderDeps, history);
      photos = r.photos;
      sharedUsd = r.usd;
    } else {
      photos = await photosForDraft(draft.filled, brief.parsed, brief.pages, finderDeps, history);
    }
    // The sheet tags and close-up checks are Claude calls (counted by the run budget's guard); shown under design too.
    const photoUsd = photos.costUsd.tags + photos.costUsd.vision;
    // The shared finder's Serper + Haiku spend is outside the run budget's guard: this stage's cost carries it.
    const ownUsd = () => tally.costUsd + sharedUsd;
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
    // A photo the render check could not load (a host refusing a hotlink, a slow one; 2026-10-12: a Wikimedia headshot
    // set a whole story aside and used up the night's attempts) goes, and its slide takes its next runner-up that
    // passed every check, else its icon background (a quote slide: type-led). Checked again, at most twice; nothing
    // here costs a model call.
    for (let round = 0; round < MAX_IMAGE_SWAP_ROUNDS; round++) {
      const failed = new Set(failedImageUrls(fit.problems));
      if (failed.size === 0) break;
      const swapped = new Set<number>();
      for (const [i, t] of traces.entries()) {
        if (!t.photo || !failed.has(t.photo.url)) continue;
        const gone = t.photo;
        const inPost = new Set(traces.flatMap((x) => (x.photo ? [x.photo.url] : [])));
        const next = t.alternates.find((c) => !failed.has(c.url) && !inPost.has(c.url) && checkPhotoCredit(c, i === 0 ? 'cover' : `slide ${i + 1}`, brief.parsed).length === 0) ?? null;
        const to = next ? next.source : draft.filled.slides[i - 1]?.type === 'quote' ? 'type-led' : 'icon';
        photoReplacements.push(`${i === 0 ? 'cover' : `slide ${i + 1}`}: image failed to load at render (${gone.url.slice(0, 80)}) → ${next ? `the next runner-up (${next.source})` : to}`);
        t.steps.push(`render check: image failed to load → ${next ? `next runner-up (${next.source}) ${next.credit.slice(0, 40)}` : to}`);
        t.photo = next;
        t.via = next ? (next.source as typeof t.via) : (to as typeof t.via);
        swapped.add(i + 1);
      }
      if (swapped.size === 0) break;
      // The swapped slides take the default layout (the chosen one was for the photo that went); the rest stay.
      const redrawn = { cover: photos.cover.photo, slides: photos.slides.map((t) => t.photo), icons: traces.map((t) => t.icon) };
      const plain = toRenderPost(draft.filled, redrawn, meta);
      render = { ...render, slides: render.slides.map((sl, i) => (swapped.has(i + 1) ? plain.slides[i]! : sl)) };
      fit = await deps.fitCheck(render);
    }
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
      return { ok: false, reasonCode: 'render-failed', detail, costUsd: ownUsd() };
    }
    // M8b: keep the face-centred crops the check chose, so the preview draws the same thing.
    for (const f of fit.focus ?? []) {
      const sl = render.slides[f.slide - 1];
      if (f.focus && sl && sl.photoUrl === f.photo) sl.photoFocus = f.focus;
    }
    // C7: every text field of the final draft is on its rendered slide.
    const dropped = checkDroppedText(draft.filled, fit.slideText);
    if (dropped.length > 0) {
      return { ok: false, reasonCode: 'render-failed', detail: dropped.map((f) => `C7 ${f.where}: ${f.detail}`).join('; '), costUsd: ownUsd() };
    }
    // The render review (photo spec §5b): settings only; the fit and C7 checks hold after every fix.
    let reviewLog: string[] = [];
    if (deps.review) {
      const r = await deps.review({ post: render, storyId: draft.storyId, traces, fit, fitCheck: deps.fitCheck });
      render = r.post;
      reviewLog = r.log;
      const after = checkDroppedText(draft.filled, r.fit.slideText);
      if (!r.fit.ok || after.length) return { ok: false, reasonCode: 'render-failed', detail: `after the render review: ${[...r.fit.problems, ...after.map((f) => f.detail)].join('; ')}`, costUsd: ownUsd() };
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
        costUsd: ownUsd() + photoUsd,
      },
      costUsd: ownUsd() + photoUsd,
    };
  };
}
