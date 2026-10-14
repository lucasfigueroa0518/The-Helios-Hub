/**
 * Photos for a whole draft (photo spec §4, sixth round; Tommy 2026-10-07):
 *
 *   1. search   every request of the post (the cover and each slide: the
 *               visual and its fallback) → at most 2 ranked candidates each
 *               (find.ts searchVisual, rank.ts)
 *   2. sheet    every candidate on numbered contact sheets (sheet.ts)
 *   3. tags     one Haiku call per sheet: words per tile and the stock-rule
 *               flags, in tile order (tag-sheet.ts)
 *   4. fit      Jev: do an unverified tile's tags show what was asked for
 *               in the story's sense (photo-fit@2; the homonym guard)
 *   5. pick     per slide, in order: the best passing candidate, then the
 *               second, then the fallback's, then the icon (pick.ts). Jev
 *               checks each slide's shortlist against what the slide says
 *               and against the photos already in the post (photo-slide@2);
 *               no photo or person appears twice.
 *
 * One shared context per post: each subject is identity-checked once (the
 * cache is shared with the Writer's availability flags), each company's pool
 * fetched once, and no photo lands on two neighbouring slides.
 *
 * The photo bank (DECISIONS_LOG D49): `vetted` lists what the checks learned
 * about every candidate they looked at (vetted.ts), as pure data for the
 * design stage to offer to the bank. The vision check is wrapped in a
 * recorder for that; the pick is unchanged.
 */
import * as PhotoFit from '@/lib/social/jev/questions/photo-fit.v2';
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { DEFAULT_ICON, isIcon } from '@/lib/social/render/icons';
import type { FilledDraft, VisualRequest } from '@/lib/social/writer/draft';

import { articlePhotosFor } from './article-list';
import { newSearchContext, searchVisual, type Candidate, type ChainStep, type PhotoDeps, type PhotoSlot, type PhotoTrace } from './find';
import type { SubjectType } from './identity';
import type { IdentityCache } from './p18';
import { choosePivots } from './pivot';
import { newPickState, pickForSlide, type PickSlot, type PickWords, type Scored } from './pick';
import { buildSheets } from './sheet';
import { ICON_SCENES, tuning } from './tuning';
import type { TileTag } from './tag-sheet';
import { recordVision, vettedForSlide, type VettedPhoto } from './vetted';

/** Where a slide type draws its photo (the review). */
export function slotFor(type: FilledDraft['slides'][number]['type']): PhotoSlot {
  return type === 'stat' ? 'backdrop' : type === 'quote' ? 'quote' : 'split';
}

export type DraftPhotos = {
  cover: PhotoTrace;
  slides: PhotoTrace[];
  costUsd: { tags: number; vision: number };
  /** Every candidate a check looked at, with its outcome (the photo bank's input; pure data). */
  vetted: VettedPhoto[];
};

/** Each subject's type: the identity check's (already cached by the Writer's lookup), else the Reporter's mark. */
export async function subjectKinds(brief: Brief, identities?: IdentityCache): Promise<Map<string, SubjectType | null>> {
  const out = new Map<string, SubjectType | null>(brief.subjects.map((s) => [s.name, s.type ?? null]));
  for (const [name, pending] of identities ?? []) {
    const id = await pending.catch(() => null);
    if (id?.type) out.set(name, id.type);
  }
  return out;
}

type Place = { slot: PickSlot; icon: string; tags: string[]; requests: VisualRequest[]; alts: VisualRequest[]; words: PickWords };

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * No logo-only covers (Tommy and Lucas, 2026-10-14): a cover that asks for a logo searches the company's other looks
 * instead (its CEO, headquarters, official and article images). Replaces the 2026-10-12 cover rotation, which did the
 * same only once every logo had been a cover that week. Every other request is unchanged.
 */
export function coverRequest(request: VisualRequest): VisualRequest {
  return request.kind === 'logo' ? { kind: 'company', query: request.query } : request;
}

export async function photosForDraft(
  draft: FilledDraft,
  brief: Brief,
  pages: PageReadOk[],
  deps: PhotoDeps,
  history: { recent?: Set<string>; lastUsed?: Map<string, string>; identities?: IdentityCache; storyDate?: string | null; plainCover?: boolean } = {},
): Promise<DraftPhotos> {
  // `plainCover`: the first place is a frame like the others, not a cover (a Stories set whose first frame is a story),
  // so the cover rules (no logo, the 1080 floor, promotion) don't apply to it.
  const coverRules = !history.plainCover;
  const asCover = (r: VisualRequest) => (coverRules ? coverRequest(r) : r);
  const kinds = await subjectKinds(brief, history.identities);
  const ctx = newSearchContext(brief, pages, { recent: history.recent, lastUsed: history.lastUsed, identities: history.identities, kinds, photos: articlePhotosFor(brief, pages, kinds), storyDate: history.storyDate ?? null });
  // The vision check, recorded (same answers) so the bank knows which candidates passed or failed it.
  const recorder = recordVision(deps.vision);
  deps = { ...deps, vision: recorder.vision };
  const icon = (name: string | undefined) => (isIcon(name) ? name : DEFAULT_ICON);
  const chosen = draft.cover_options[draft.chosen_cover - 1]!;
  const places: Place[] = [
    { slot: { kind: coverRules ? 'cover' : 'story', speaker: null }, icon: icon(chosen.icon), tags: chosen.subject_ids ?? [], requests: [asCover(chosen.visual), asCover(chosen.fallback_visual)], alts: (chosen.alt_visuals ?? []).map(asCover), words: { position: 1, headline: draft.cover, body: '' } },
    ...draft.slides.map((s, i): Place => ({
      slot: { kind: s.type === 'stat' ? 'stat' : s.type === 'quote' ? 'quote' : 'story', speaker: s.quote?.speaker_subject ?? null },
      icon: icon(s.icon),
      tags: s.subject_ids ?? [],
      requests: [s.visual, s.fallback_visual],
      alts: s.alt_visuals ?? [],
      words: { position: i + 2, headline: s.headline.text, body: [s.body?.text, s.quote ? `"${s.quote.text}" (${s.quote.speaker})` : null, ...s.numbers.map((n) => `${n.value} ${n.counts}`)].filter(Boolean).join(' ') },
    })),
  ];

  // 1. Search every request, in order (the identity and pool caches are shared).
  const found = [];
  for (const [i, p] of places.entries()) {
    const perRequest = [];
    for (const request of p.requests) perRequest.push({ request, ...(await searchVisual(request, ctx, deps, { cover: i === 0, tags: p.tags })) });
    found.push(perRequest);
  }

  // 2–3. Every candidate on the contact sheets; Haiku tags each tile.
  const urls = [...new Set(found.flat().flatMap((r) => r.candidates.map((c) => c.url)))];
  const tagsByUrl = new Map<string, TileTag>();
  const sheetSteps: string[] = [];
  let tagUsd = 0;
  if (deps.tagSheet && urls.length) {
    for (const sheet of await buildSheets(urls, { http: deps.http })) {
      const r = await deps.tagSheet(sheet.png, sheet.urls.length);
      tagUsd += r.costUsd;
      if (!r.ok) {
        sheetSteps.push(`sheet tags: ${r.error} → those tiles untagged (an unverified winner still gets its close-up check)`);
        continue;
      }
      r.tiles.forEach((t, i) => tagsByUrl.set(sheet.urls[i]!, t));
      sheetSteps.push(`sheet tags: ${r.tiles.length} tiles ($${r.costUsd.toFixed(4)})${sheet.failed.length ? `; tiles ${sheet.failed.join(', ')} didn't load` : ''}`);
    }
  }

  // 4. Jev: do an unverified tile's tags show what its request asked for?
  const fitByKey = new Map<string, number>();
  const toFit = found.flat().flatMap((r) => r.candidates.filter((c) => !c.verified && tagsByUrl.has(c.url)).map((c) => ({ c, request: r.request })));
  for (let k = 0; k < toFit.length; k += PhotoFit.MAX_TILES) {
    const batch = toFit.slice(k, k + PhotoFit.MAX_TILES);
    try {
      const answers = await PhotoFit.photoFitScores(deps.jev, batch.map(({ c, request }) => ({ request_kind: request.kind, request: request.query, tags: tagsByUrl.get(c.url)!.tags })), brief.the_news.text);
      batch.forEach(({ c, request }, j) => fitByKey.set(`${c.url}|${request.query}`, answers[j]!));
    } catch (err) {
      sheetSteps.push(`fit check error: ${errText(err)} → those tiles unchecked (their close-up check still runs)`);
    }
  }

  // 5. The pick, slide by slide.
  const state = newPickState();
  const subjects = brief.subjects.map((s) => s.name);
  let visionUsd = ctx.spend.visionUsd;
  const traces: PhotoTrace[] = [];
  const vetted: VettedPhoto[] = [];
  for (const [i, p] of places.entries()) {
    const requests = found[i]!.map((r) => ({
      request: r.request,
      scored: r.candidates.map((cand: Candidate): Scored => ({ cand, tags: tagsByUrl.get(cand.url) ?? null, fit: fitByKey.get(`${cand.url}|${r.request.query}`) ?? null })),
    }));
    let out = await pickForSlide({ slot: p.slot, requests, words: p.words }, state, deps, subjects, PhotoFit.THRESHOLDS.FIT_MIN, brief.the_news.text);
    visionUsd += out.visionUsd;
    try {
      vetted.push(...vettedForSlide({ slide: i + 1, requests: found[i]!.map((r) => ({ request: r.request, candidates: r.candidates })), winner: out.winner?.cand ?? null, alternates: out.alternates, tagsByUrl, fitByKey, verdicts: recorder.verdicts, fitMin: PhotoFit.THRESHOLDS.FIT_MIN }));
    } catch {
      // The bank's record never changes the post.
    }
    const searchSteps = found[i]!.flatMap((r) => r.steps);
    // Pivot (tuning.ts): both requests left the slide without a photo → Jev picks which of the Writer's alt visuals
    // (other parts of the slide's own copy) are worth searching; each is searched and picked like any request.
    if (!out.winner && tuning().pivot && deps.jev && p.slot.kind !== 'quote' && p.alts.length) {
      const tried = found[i]!.map((r) => ({ request: r.request, outcome: r.candidates.length ? 'candidates found but none passed the checks' : 'no candidates found' }));
      const pivot = await choosePivots({ jev: deps.jev, story: brief.the_news.text, slide: { position: p.words.position, kind: p.slot.kind, headline: p.words.headline, body: p.words.body }, alts: p.alts, tried, photosInPost: state.picked });
      searchSteps.push(...pivot.steps);
      if (pivot.chosen.length) {
        const searched = [];
        for (const request of pivot.chosen) {
          const r = await searchVisual(request, ctx, deps, { cover: i === 0, tags: p.tags });
          searchSteps.push(`pivot → ${request.kind}: "${request.query}"`, ...r.steps);
          searched.push({ request, scored: r.candidates.map((cand): Scored => ({ cand, tags: null, fit: null })) });
        }
        const again = await pickForSlide({ slot: p.slot, requests: searched, words: p.words }, state, deps, subjects, PhotoFit.THRESHOLDS.FIT_MIN, brief.the_news.text);
        visionUsd += again.visionUsd;
        // The bank also learns what the pivot's checks saw (same shape as the first requests').
        try {
          vetted.push(...vettedForSlide({ slide: i + 1, requests: searched.map((r) => ({ request: r.request, candidates: r.scored.map((x) => x.cand) })), winner: again.winner?.cand ?? null, alternates: again.alternates, tagsByUrl, fitByKey, verdicts: recorder.verdicts, fitMin: PhotoFit.THRESHOLDS.FIT_MIN }));
        } catch {
          // The bank's record never changes the post.
        }
        out = again.winner ? { ...again, steps: [...out.steps, ...again.steps] } : { ...out, steps: [...out.steps, ...again.steps] };
      }
    }
    // Icon scene (tuning.ts): both requests left the slide without a photo → one more search for its icon's plain scene.
    const iconScene = ICON_SCENES[p.icon];
    if (!out.winner && tuning().iconScenes && p.slot.kind !== 'quote' && iconScene) {
      const request: VisualRequest = { kind: 'thematic', query: iconScene };
      const extra = await searchVisual(request, ctx, deps, { cover: i === 0 });
      const again = await pickForSlide({ slot: p.slot, requests: [{ request, scored: extra.candidates.map((cand): Scored => ({ cand, tags: null, fit: null })) }], words: p.words, slideFitMin: tuning().iconSceneFitMin }, state, deps, subjects, PhotoFit.THRESHOLDS.FIT_MIN, brief.the_news.text);
      visionUsd += again.visionUsd;
      searchSteps.push(`icon scene (${p.icon}) → "${iconScene}"`, ...extra.steps);
      out = again.winner ? { ...again, steps: [...out.steps, ...again.steps] } : { ...out, steps: [...out.steps, ...again.steps] };
    }
    const identity = found[i]!.find((r) => r.identity)?.identity ?? null;
    traces.push({
      request: out.request,
      photo: out.winner?.cand ?? null,
      via: out.via,
      icon: p.icon,
      identity,
      steps: [...searchSteps, ...(i === 0 ? sheetSteps : []), ...out.steps],
      alternates: out.alternates,
      ...(out.winner?.tags ? { tags: out.winner.tags.tags } : {}),
      ...(out.visionUsd ? { visionUsd: out.visionUsd } : {}),
    });
  }
  // Promotion (Tommy and Lucas, 2026-10-14): a cover nothing could fill takes the best inner photo that clears the
  // cover's floor and suits the cover's words (the same pick: size, close-up, photo-slide@2), and that slide takes its
  // next runner-up, else its icon. Measured over a week: every carousel had an inner photo of at least 1080.
  const cover = traces[0]!;
  const inner = traces.slice(1).flatMap((t, k) => (t.photo && (t.photo as Candidate).lane !== 'logo' ? [{ at: k + 1, cand: t.photo as Candidate }] : []));
  if (coverRules && !cover.photo && inner.length) {
    const out = await pickForSlide(
      { slot: places[0]!.slot, requests: [{ request: cover.request, scored: inner.map(({ cand }): Scored => ({ cand, tags: null, fit: null })) }], words: places[0]!.words },
      { ...newPickState(), closeUps: state.closeUps },
      deps,
      subjects,
      PhotoFit.THRESHOLDS.FIT_MIN,
      brief.the_news.text,
    );
    visionUsd += out.visionUsd;
    const from = out.winner ? inner.find((x) => x.cand.url === out.winner!.cand.url) : undefined;
    if (from) {
      const slide = traces[from.at]!;
      const inPost = new Set(traces.flatMap((t) => (t.photo ? [t.photo.url] : [])));
      const next = slide.alternates.find((c) => !inPost.has(c.url)) ?? null;
      const to = next ? (next.source as ChainStep) : places[from.at]!.slot.kind === 'quote' ? 'type-led' : 'icon';
      traces[0] = { ...cover, photo: from.cand, via: from.cand.lane, steps: [...cover.steps, `promotion: nothing passed for the cover → slide ${from.at + 1}'s photo`, ...out.steps] };
      slide.steps.push(`promotion: this photo went to the cover → ${next ? `next runner-up (${next.source})` : to}`);
      slide.photo = next;
      slide.via = to;
    } else {
      cover.steps.push('promotion: no inner photo clears the cover', ...out.steps);
    }
  }
  return { cover: traces[0]!, slides: traces.slice(1), costUsd: { tags: tagUsd, vision: visionUsd }, vetted };
}
