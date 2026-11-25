/**
 * Pure mappers from each type's own photo request to the shared finder's PhotoNeed (PHASE3-CONTRACT.md, Owner A).
 * Adopters and the comparison script build needs only through these.
 */
import type { Pick as LfdPick, StoryCopy } from '@/lib/lfd/types';
import type { Brief } from '@/lib/social/reporter/brief';
import type { FilledDraft, VisualRequest } from '@/lib/social/writer/draft';
import type { PhotoRequest } from '@/lib/stories/photos';

import type { PhotoNeed, PhotoSubject, Specificity } from './types';

const SUBJECT_KINDS = new Set(['person', 'company', 'logo', 'product']);

/** 'subject' for person/company/logo/product asks, else 'story'. */
export function specificityFor(kind: string): Specificity {
  return SUBJECT_KINDS.has(kind.trim().toLowerCase()) ? 'subject' : 'story';
}

const webUrls = (urls: readonly (string | null | undefined)[]) => [...new Set(urls.filter((u): u is string => !!u && /^https?:\/\//i.test(u)))];

/** The outlet from a URL's host ("www.theverge.com" → "theverge.com"), or null. */
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || null;
  } catch {
    return null;
  }
}

const dayOf = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);

/** Subjects without blanks or repeats (by name, case-insensitive), first one kept. */
function cleanSubjects(subjects: readonly PhotoSubject[]): PhotoSubject[] {
  const seen = new Set<string>();
  const out: PhotoSubject[] = [];
  for (const s of subjects) {
    const name = s.name.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, type: s.type });
  }
  return out;
}

/** A product ask names the product in its query; it becomes the need's product subject (the harvest's product wants). */
const productSubject = (kind: string, query: string): PhotoSubject[] => (kind === 'product' && query.trim() ? [{ name: query.trim(), type: 'product' }] : []);

/** A Stories / LFD finder request (lib/stories/photos.ts PhotoRequest) as a need. */
export function needFromRequest(req: PhotoRequest, id: string, extra: { headline?: string; brief?: string; sourceName?: string | null } = {}): PhotoNeed {
  const storyUrls = webUrls(req.sourceUrls ?? []);
  const copy = req.copy ?? '';
  return {
    id,
    headline: extra.headline ?? copy,
    brief: (extra.brief ?? '').slice(0, 1200),
    copy,
    query: req.query ?? '',
    kind: req.kind ?? '',
    subjects: cleanSubjects([...(req.subjects ?? []), ...productSubject(req.kind ?? '', req.query ?? '')]),
    storyUrls,
    sourceName: extra.sourceName !== undefined ? extra.sourceName : hostOf(storyUrls[0]),
    storyDate: dayOf(req.storyDate),
    specificity: specificityFor(req.kind ?? ''),
    ...(req.cover ? { cover: true } : {}),
  };
}

/** One Last Few Days slide (its pick and written copy) as a need. */
export function needForLfd(pick: LfdPick, copy: StoryCopy, id: string): PhotoNeed {
  const storyUrls = webUrls([pick.url]);
  return {
    id,
    headline: copy.headline || pick.headline,
    brief: ([copy.setup, copy.body].filter(Boolean).join(' ') || pick.body).slice(0, 1200),
    copy: copy.headline,
    query: copy.photo.query,
    kind: copy.photo.kind,
    subjects: cleanSubjects([...copy.photo.subjects, ...productSubject(copy.photo.kind, copy.photo.query)]),
    storyUrls,
    sourceName: pick.sourceName || hostOf(storyUrls[0]),
    storyDate: dayOf(pick.eventDate ?? pick.publishedAt),
    specificity: specificityFor(copy.photo.kind),
  };
}

/** The design stage's slot names (lib/social/pipeline/design-stage.ts): 'cover', then 'slide 2', 'slide 3', … */
export const DRAFT_COVER_SLOT = 'cover';
/** Slot name for index `i` into [cover, ...draft.slides] (the design stage's traces order). */
export const draftSlotName = (i: number): string => (i === 0 ? DRAFT_COVER_SLOT : `slide ${i + 1}`);
/** Index into [cover, ...draft.slides] for a slot name, or null. 'slide N' is draft.slides[N - 2]. */
export function draftSlotIndex(slot: string): number | null {
  if (slot === DRAFT_COVER_SLOT) return 0;
  const m = /^slide (\d+)$/.exec(slot);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 2 ? n - 1 : null;
}

/**
 * A carousel draft's needs: the cover (the chosen cover option's visual, `cover: true`), then each slide's visual,
 * slot names as the design stage's own. A cover that asks for a logo asks for the company instead (design.ts
 * coverRequest: no logo-only covers).
 */
export function needsForDraft(draft: FilledDraft, brief: Brief): Array<{ slot: string; need: PhotoNeed }> {
  const storyUrls = webUrls(brief.sources.map((s) => s.url));
  const sourceName = brief.sources.find((s) => /^https?:\/\//i.test(s.url))?.outlet ?? hostOf(storyUrls[0]);
  const storyDate = dayOf(brief.sources.find((s) => dayOf(s.date))?.date) ?? dayOf(brief.events.find((e) => dayOf(e.date))?.date);
  const text = [brief.the_news.text, ...brief.why_it_matters.map((w) => w.text)].filter(Boolean).join(' ').slice(0, 1200);
  const byId = new Map(brief.subjects.map((s) => [s.id, s]));
  const byName = new Map(brief.subjects.map((s) => [s.name.toLowerCase(), s]));
  const asSubject = (s: Brief['subjects'][number]): PhotoSubject => ({ name: s.name, type: s.type === 'person' ? 'person' : 'organization' });
  const subjectsFor = (visual: VisualRequest, ids: readonly string[] | undefined, speaker: string | null): PhotoSubject[] => {
    const named = byName.get(visual.query.trim().toLowerCase());
    const spoke = speaker ? byName.get(speaker.toLowerCase()) : undefined;
    const listed = (ids ?? []).map((id) => byId.get(id)).filter((s): s is Brief['subjects'][number] => !!s);
    return cleanSubjects([...(named ? [asSubject(named)] : []), ...(spoke ? [asSubject(spoke)] : []), ...listed.map(asSubject), ...productSubject(visual.kind, visual.query)]);
  };
  const need = (slot: string, visual: VisualRequest, copy: string, ids: readonly string[] | undefined, speaker: string | null, cover: boolean): { slot: string; need: PhotoNeed } => ({
    slot,
    need: {
      id: slot,
      headline: draft.cover,
      brief: text,
      copy,
      query: visual.query,
      kind: visual.kind,
      subjects: subjectsFor(visual, ids, speaker),
      storyUrls,
      sourceName,
      storyDate,
      specificity: specificityFor(visual.kind),
      ...(cover ? { cover: true } : {}),
    },
  });
  const chosen = draft.cover_options[(draft.chosen_cover ?? 1) - 1] ?? draft.cover_options[0];
  const out: Array<{ slot: string; need: PhotoNeed }> = [];
  if (chosen) {
    const visual: VisualRequest = chosen.visual.kind === 'logo' ? { kind: 'company', query: chosen.visual.query } : chosen.visual;
    out.push(need(DRAFT_COVER_SLOT, visual, draft.cover, chosen.subject_ids, null, true));
  }
  draft.slides.forEach((s, i) => {
    const copy = [s.headline.text, s.body?.text].filter(Boolean).join(' ');
    out.push(need(draftSlotName(i + 1), s.visual, copy, s.subject_ids, s.quote?.speaker_subject ?? null, false));
  });
  return out;
}
