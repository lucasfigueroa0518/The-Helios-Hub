/**
 * Writer stage (spec §3, §4; prompts file §2–3): one brief → one draft,
 * submitted through submit_draft, checked in code, quotes and numbers
 * filled by ID. One retry when the check fails (spec §7.1 glitch rule).
 *
 * The call itself (caching, check, one retry) is runStructuredCall.
 */
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import { classifyCredit } from '@/lib/social/photos/credit';
import type { OfficialCompany } from '@/lib/social/photos/official';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import type { Brief, BriefError } from '@/lib/social/reporter/brief';
import type { MessagesCreate, TurnUsage } from '@/lib/social/reporter/reporter';

import { draftTextFailures } from '@/lib/social/mechanical/checks';

import { DraftValidationError, SUBMIT_DRAFT_TOOL, checkDraft, fillDraft, type DraftSubmission, type FilledDraft } from './draft';
import { WRITER_SYSTEM, writerUserMessage } from './prompt';
import { MAX_CHECK_RETRIES, runStructuredCall } from './structured-call';


/** Is this subject widely known? Spec §4.1a: yes when it has a Wikidata match. */
export type IsWellKnown = (subject: { name: string; role: string | null }, brief: Brief) => Promise<boolean>;

/** Does this subject have a usable main photo? (Code only: Wikidata match + a usable main image.) */
export type HasPhoto = (subject: { name: string; role: string | null }, brief: Brief) => Promise<boolean>;

/**
 * The brief the Writer sees: the Reporter's JSON with SUBJECTS marked by code
 * (well_known; photo_available, Tommy 2026-10-06), and ARTICLE PHOTOS
 * filtered to those whose credit allows them, so every photo the Writer can
 * request can succeed.
 */
export async function briefForWriter(brief: Brief, isWellKnown: IsWellKnown, hasPhoto: HasPhoto = async () => false, pages: PageReadOk[] = [], officialList?: OfficialCompany[]) {
  const subjects = await Promise.all(
    brief.subjects.map(async (s) => ({
      ...s,
      well_known: await isWellKnown(s, brief).catch(() => false),
      photo_available: await hasPhoto(s, brief).catch(() => false),
    })),
  );
  const organizations = brief.subjects.map((s) => s.name);
  const key = (u: string) => u.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
  /** How the page reader found this photo: in the article body (figure) or as the share image (og:image). */
  const fromOf = (url: string) => pages.flatMap((pg) => pg.photos).find((x) => key(x.src) === key(url))?.from ?? null;
  const usable = brief.article_photos
    .filter((p) => p.url)
    .map((p) => ({ p, v: classifyCredit({ caption: p.caption, credit: p.credit, page: p.page, organizations, officialList }), from: fromOf(p.url!) }))
    .filter((x) => x.v.verdict === 'allowed');
  // Prefer <figure> images over og:image (Tommy, 2026-10-07: og:image is often a title card): a page's
  // og:image is listed only when that page has no usable figure image.
  const pagesWithFigure = new Set(usable.filter((x) => x.from === 'figure').map((x) => x.p.page));
  const article_photos = usable
    .filter((x) => !(x.from === 'og:image' && pagesWithFigure.has(x.p.page)))
    .sort((a, b) => Number(b.from === 'figure') - Number(a.from === 'figure'))
    // Official images (spec §5.1 (a)) carry the company they come from.
    .map((x) => (x.v.credit ? { ...x.p, official_image_of: x.v.credit.replace(/^Image: /, '') } : x.p));
  return { ...brief, subjects, article_photos };
}

const word4 = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map((w) => w.replace(/s$/, '')));

/**
 * The Writer's IMAGE requests (handoff, Tommy 2026-10-06), checked on its
 * first submission only: a subject photo only for a subject marked
 * photo_available, each subject at most once; a stock scene names a
 * physical thing the slide itself mentions.
 */
const KEEP_WORDS = " (never change the slide's words to fit a photo)";

/** The text at a handoff place ("cover" or "slide N"), for the words-stay check. */
function textAt(d: DraftSubmission, where: string): string | null {
  if (where === 'cover') return d.cover_options[d.chosen_cover - 1]?.text ?? null;
  const s = d.slides[Number(where.replace('slide ', '')) - 2];
  return s ? `${s.headline.text}\n${s.body?.text ?? ''}` : null;
}

/**
 * Words never change to fit a photo (Tommy, 2026-10-06): every place whose
 * IMAGE request failed on the first attempt keeps its words on the retry.
 */
export function wordsChangedForPhoto(next: DraftSubmission, first: DraftSubmission, failedPlaces: string[]): BriefError[] {
  return failedPlaces.flatMap((where) => {
    const was = textAt(first, where);
    const now = textAt(next, where);
    return was !== null && now !== null && was !== now
      ? [{ section: `${where}`, message: `the words changed after its IMAGE request failed; restore them and change the request instead (never change a slide's words to fit a photo)` }]
      : [];
  });
}

export function imageHandoffFailures(d: DraftSubmission, brief: Brief, photoSubjects: Set<string> | null): BriefError[] {
  const errors: BriefError[] = [];
  const chosen = d.cover_options[d.chosen_cover - 1]!;
  const requests: Array<{ where: string; image: DraftSubmission['slides'][number]['image']; text: string }> = [
    { where: 'cover', image: chosen.image, text: chosen.text },
    ...d.slides.map((s, i) => {
      const q = s.quote_id ? brief.quotes.find((x) => x.id === s.quote_id)?.text ?? '' : '';
      const n = s.number_ids.map((id) => brief.numbers.find((x) => x.id === id)?.counts ?? '').join(' ');
      return { where: `slide ${i + 2}`, image: s.image, text: [s.headline.text, s.body?.text ?? '', q, n].join(' ') };
    }),
  ];
  const seen = new Map<string, string>();
  for (const r of requests) {
    if (r.image.kind === 'subject') {
      if (photoSubjects && !photoSubjects.has(r.image.value)) errors.push({ section: `${r.where}.image`, message: `${r.image.value} has no usable photo (photo_available: false); change the request to a literal stock scene or none${KEEP_WORDS}` });
      const prev = seen.get(r.image.value);
      if (prev) errors.push({ section: `${r.where}.image`, message: `${r.image.value} is already requested on ${prev}; each subject at most once per post; change this request${KEEP_WORDS}` });
      else seen.set(r.image.value, r.where);
    }
    if (r.image.kind === 'stock') {
      const slideWords = word4(r.text);
      if (![...word4(r.image.value)].some((w) => slideWords.has(w))) {
        errors.push({ section: `${r.where}.image`, message: `stock "${r.image.value}" doesn't name a physical thing this slide mentions; change the request to a scene the slide already mentions, or none${KEEP_WORDS}` });
      }
    }
  }
  // The chosen cover always has an IMAGE (never none); so do the other options.
  d.cover_options.forEach((c, i) => {
    if (c.image.kind === 'none') errors.push({ section: i === d.chosen_cover - 1 ? 'cover.image' : `cover_options[${i}].image`, message: 'a cover always has an IMAGE (never none)' });
  });
  // Quote slides (Tommy, 2026-10-06): IMAGE is the speaker or none.
  d.slides.forEach((s, i) => {
    if (s.type !== 'quote' || s.image.kind === 'none') return;
    const q = brief.quotes.find((x) => x.id === s.quote_id);
    const speaker = q?.speaker_id ? brief.subjects.find((x) => x.id === q.speaker_id)?.name ?? null : null;
    if (s.image.kind !== 'subject' || s.image.value !== speaker) {
      errors.push({ section: `slide ${i + 2}.image`, message: `a quote slide's IMAGE is the speaker${speaker ? ` (subject: ${speaker})` : ''} or none, not ${s.image.kind}${s.image.value ? `: ${s.image.value}` : ''}; change the request${KEEP_WORDS}` });
    }
  });
  // Slide types that show a photo (Tommy, 2026-10-06): article only where the finder draws one (text, landing, image).
  // Stock shows on every other type too (a darkened background on stat slides); quote slides take the speaker (checked above).
  d.slides.forEach((s, i) => {
    if (s.image.kind === 'article' && !['text', 'landing', 'image'].includes(s.type)) {
      errors.push({ section: `slide ${i + 2}.image`, message: `an article photo can't show on a ${s.type} slide (only text, landing and image slides); change the request${KEEP_WORDS}` });
    }
  });
  // One EDIT NOTES line per none, saying why (Tommy, 2026-10-06). The slide after a spread is none by design and needs none.
  const nones = d.slides.filter((s, i) => s.image.kind === 'none' && !d.slides[i - 1]?.spread_with_next).length;
  const noteLines = d.edit_notes.filter((n) => /\bnone\b/i.test(n)).length;
  if (noteLines < nones) errors.push({ section: 'edit_notes', message: `${nones} slide(s) with IMAGE none but ${noteLines} EDIT NOTES line(s) about none; add one line per none saying why nothing physical fits` });
  return errors;
}

export type WriterResult =
  | { ok: true; draft: DraftSubmission; filled: FilledDraft; raw: string; costUsd: number; turns: number; draftRetries: number; retryErrors: string[]; turnUsage: TurnUsage[]; imageRequestsDropped: string[] }
  | { ok: false; reason: 'malformed-output' | 'service-error' | 'refused'; detail: string; raw: string | null; costUsd: number; turns: number; draftRetries: number; retryErrors: string[]; turnUsage: TurnUsage[]; imageRequestsDropped: string[] };

export type WriterDeps = {
  create: MessagesCreate;
  isWellKnown: IsWellKnown;
  /** photo_available marking (handoff); without it every subject is marked false and not checked. */
  hasPhoto?: HasPhoto;
  config?: StageModelConfig;
  /** The pages the Reporter read: tells <figure> images from og:image for ARTICLE PHOTOS. */
  pages?: PageReadOk[];
  /** The official-images allow-list (official.ts); tests may pass their own. */
  officialList?: OfficialCompany[];
};

/** checkDraft (structure and IDs), then the M7 text checks C1–C5 on the filled, fixed draft. */
/**
 * A failing IMAGE request no longer kills a story (Tommy, 2026-10-07): on
 * the Writer's final attempt, every request still failing the handoff check
 * becomes none (the slide text is unchanged) and is logged as
 * image-request-dropped. A spread whose first photo is dropped is no longer
 * a spread. The chosen cover with none keeps its AI-compute fallback (the
 * finder). A missing EDIT NOTES line for a code-dropped none is only logged.
 */
export function dropFailingImageRequests(d: DraftSubmission, failures: BriefError[]): { draft: DraftSubmission; dropped: string[] } {
  const out = structuredClone(d);
  const dropped: string[] = [];
  for (const f of failures) {
    if (f.section === 'edit_notes') {
      dropped.push(`image-request-dropped (log only): ${f.message}`);
      continue;
    }
    const slide = /^slide (\d+)\.image$/.exec(f.section);
    const option = /^cover_options\[(\d+)\]\.image$/.exec(f.section);
    const img = f.section === 'cover.image' ? out.cover_options[out.chosen_cover - 1]!.image : slide ? out.slides[Number(slide[1]) - 2]?.image : option ? out.cover_options[Number(option[1])]?.image : undefined;
    if (!img || img.kind === 'none') {
      if (img) dropped.push(`image-request-dropped: ${f.section.replace(/\.image$/, '')} stays none (${f.message})`);
      continue;
    }
    dropped.push(`image-request-dropped: ${f.section.replace(/\.image$/, '')} ${img.kind}: ${img.value} → none (${f.message})`);
    img.kind = 'none';
    img.value = '';
    if (slide) out.slides[Number(slide[1]) - 2]!.spread_with_next = false;
  }
  return { draft: out, dropped };
}

export function checkWrittenDraft(
  input: unknown,
  brief: Brief,
  attempt: number,
  stage: 'writer' | 'editor' = 'writer',
  photoSubjects: Set<string> | null = null,
  final?: { onDropped: (lines: string[]) => void },
): DraftSubmission {
  let d = checkDraft(input, brief);
  const failures = draftTextFailures(fillDraft(d, brief), brief, attempt, stage);
  const errors = failures.map((f) => ({ section: `${f.id} ${f.where}`, message: f.detail }));
  // Every handoff check runs on every attempt, the final one included (Tommy, 2026-10-06).
  if (stage === 'writer') {
    const handoff = imageHandoffFailures(d, brief, photoSubjects);
    if (final && handoff.length > 0 && errors.length === 0) {
      // Final attempt: drop the failing requests instead of failing the story (Tommy, 2026-10-07).
      const r = dropFailingImageRequests(d, handoff);
      d = checkDraft(r.draft, brief);
      final.onDropped(r.dropped);
    } else {
      errors.push(...handoff);
    }
  }
  if (errors.length > 0) throw new DraftValidationError(errors);
  return d;
}

const safely = <T,>(fn: () => T[]): T[] => {
  try {
    return fn();
  } catch {
    return [];
  }
};

export async function runWriter(brief: Brief, deps: WriterDeps): Promise<WriterResult> {
  const forWriter = await briefForWriter(brief, deps.isWellKnown, deps.hasPhoto, deps.pages ?? [], deps.officialList);
  const photoSubjects = new Set(forWriter.subjects.filter((s) => s.photo_available).map((s) => s.name));
  let first: { draft: DraftSubmission; places: string[] } | null = null;
  let imageRequestsDropped: string[] = [];
  const r = await runStructuredCall({
    create: deps.create,
    config: deps.config ?? STAGE_MODELS.writer,
    system: WRITER_SYSTEM,
    tool: SUBMIT_DRAFT_TOOL,
    user: writerUserMessage(forWriter),
    check: (input, attempt) => {
      // Words stay when a photo request fails: remember the first attempt's failed places.
      const kept = attempt > 1 && first ? safely(() => wordsChangedForPhoto(input as DraftSubmission, first!.draft, first!.places)) : [];
      try {
        const final = attempt > MAX_CHECK_RETRIES ? { onDropped: (lines: string[]) => (imageRequestsDropped = lines) } : undefined;
        const d = checkWrittenDraft(input, brief, attempt, 'writer', deps.hasPhoto ? photoSubjects : null, final);
        if (kept.length) throw new DraftValidationError(kept);
        return d;
      } catch (err) {
        if (!(err instanceof DraftValidationError) || err.errors === kept) throw err;
        if (attempt === 1) {
          const places = [...new Set(err.errors.filter((e) => e.section.endsWith('.image')).map((e) => e.section.replace(/\.image$/, '')))];
          if (places.length) first = { draft: structuredClone(input as DraftSubmission), places };
        }
        throw kept.length ? new DraftValidationError([...err.errors, ...kept]) : err;
      }
    },
  });
  const common = { costUsd: r.costUsd, turns: r.turns, draftRetries: r.retries, retryErrors: r.retryErrors, turnUsage: r.turnUsage, imageRequestsDropped };
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, raw: r.raw, ...common };
  return { ok: true, draft: r.value, filled: fillDraft(r.value, brief), raw: r.raw, ...common };
}
