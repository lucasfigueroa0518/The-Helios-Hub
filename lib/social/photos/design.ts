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
 *               (photo-fit@1; the homonym guard)
 *   5. pick     per slide, in order: the best passing candidate, then the
 *               second, then the fallback's, then the icon (pick.ts)
 *
 * One shared context per post: each subject is identity-checked once (the
 * cache is shared with the Writer's availability flags), each company's pool
 * fetched once, and no photo lands on two neighbouring slides.
 */
import * as PhotoFit from '@/lib/social/jev/questions/photo-fit.v1';
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { DEFAULT_ICON, isIcon } from '@/lib/social/render/icons';
import type { FilledDraft, VisualRequest } from '@/lib/social/writer/draft';

import { articlePhotosFor } from './article-list';
import { newSearchContext, searchVisual, type Candidate, type PhotoDeps, type PhotoSlot, type PhotoTrace } from './find';
import type { SubjectType } from './identity';
import type { IdentityCache } from './p18';
import { newPickState, pickForSlide, type PickSlot, type Scored } from './pick';
import { buildSheets } from './sheet';
import type { TileTag } from './tag-sheet';

/** Where a slide type draws its photo (the hook budgets and the review). */
export function slotFor(type: FilledDraft['slides'][number]['type']): PhotoSlot {
  return type === 'stat' ? 'backdrop' : type === 'quote' ? 'quote' : 'split';
}

export type DraftPhotos = { cover: PhotoTrace; slides: PhotoTrace[]; costUsd: { tags: number; vision: number } };

/** Each subject's type: the identity check's (already cached by the Writer's lookup), else the Reporter's mark. */
export async function subjectKinds(brief: Brief, identities?: IdentityCache): Promise<Map<string, SubjectType | null>> {
  const out = new Map<string, SubjectType | null>(brief.subjects.map((s) => [s.name, s.type ?? null]));
  for (const [name, pending] of identities ?? []) {
    const id = await pending.catch(() => null);
    if (id?.type) out.set(name, id.type);
  }
  return out;
}

type Place = { slot: PickSlot; icon: string; tags: string[]; requests: VisualRequest[] };

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function photosForDraft(
  draft: FilledDraft,
  brief: Brief,
  pages: PageReadOk[],
  deps: PhotoDeps,
  history: { recent?: Set<string>; lastUsed?: Map<string, string>; identities?: IdentityCache; storyDate?: string | null } = {},
): Promise<DraftPhotos> {
  const kinds = await subjectKinds(brief, history.identities);
  const ctx = newSearchContext(brief, pages, { recent: history.recent, identities: history.identities, kinds, photos: articlePhotosFor(brief, pages, kinds), storyDate: history.storyDate ?? null });
  const icon = (name: string | undefined) => (isIcon(name) ? name : DEFAULT_ICON);
  const chosen = draft.cover_options[draft.chosen_cover - 1]!;
  const places: Place[] = [
    { slot: { kind: 'cover', speaker: null }, icon: icon(chosen.icon), tags: chosen.subject_ids ?? [], requests: [chosen.visual, chosen.fallback_visual] },
    ...draft.slides.map((s): Place => ({
      slot: { kind: s.type === 'stat' ? 'stat' : s.type === 'quote' ? 'quote' : 'story', speaker: s.quote?.speaker_subject ?? null },
      icon: icon(s.icon),
      tags: s.subject_ids ?? [],
      requests: [s.visual, s.fallback_visual],
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
      const answers = await PhotoFit.photoFitScores(deps.jev, batch.map(({ c, request }) => ({ request_kind: request.kind, request: request.query, tags: tagsByUrl.get(c.url)!.tags })));
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
  for (const [i, p] of places.entries()) {
    const requests = found[i]!.map((r) => ({
      request: r.request,
      scored: r.candidates.map((cand: Candidate): Scored => ({ cand, tags: tagsByUrl.get(cand.url) ?? null, fit: fitByKey.get(`${cand.url}|${r.request.query}`) ?? null })),
    }));
    const out = await pickForSlide({ slot: p.slot, requests }, state, deps, subjects, PhotoFit.THRESHOLDS.FIT_MIN);
    visionUsd += out.visionUsd;
    const searchSteps = found[i]!.flatMap((r) => r.steps);
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
  return { cover: traces[0]!, slides: traces.slice(1), costUsd: { tags: tagUsd, vision: visionUsd } };
}
