/**
 * Writer stage (spec §3, §4; prompts file §2–3): one brief → one draft,
 * submitted through submit_draft, checked in code, quotes and numbers
 * filled by ID. One retry when the check fails (spec §7.1 glitch rule).
 *
 * The call itself (caching, check, one retry) is runStructuredCall.
 */
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import { classifyCredit } from '@/lib/social/photos/credit';
import type { Brief, BriefError } from '@/lib/social/reporter/brief';
import type { MessagesCreate, TurnUsage } from '@/lib/social/reporter/reporter';

import { draftTextFailures } from '@/lib/social/mechanical/checks';

import { DraftValidationError, SUBMIT_DRAFT_TOOL, checkDraft, fillDraft, type DraftSubmission, type FilledDraft } from './draft';
import { WRITER_SYSTEM, writerUserMessage } from './prompt';
import { runStructuredCall } from './structured-call';


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
export async function briefForWriter(brief: Brief, isWellKnown: IsWellKnown, hasPhoto: HasPhoto = async () => false) {
  const subjects = await Promise.all(
    brief.subjects.map(async (s) => ({
      ...s,
      well_known: await isWellKnown(s, brief).catch(() => false),
      photo_available: await hasPhoto(s, brief).catch(() => false),
    })),
  );
  const organizations = brief.subjects.map((s) => s.name);
  const article_photos = brief.article_photos.filter(
    (p) => p.url && classifyCredit({ caption: p.caption, credit: p.credit, page: p.page, organizations }).verdict === 'allowed',
  );
  return { ...brief, subjects, article_photos };
}

const word4 = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map((w) => w.replace(/s$/, '')));

/**
 * The Writer's IMAGE requests (handoff, Tommy 2026-10-06), checked on its
 * first submission only: a subject photo only for a subject marked
 * photo_available, each subject at most once; a stock scene names a
 * physical thing the slide itself mentions.
 */
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
      if (photoSubjects && !photoSubjects.has(r.image.value)) errors.push({ section: `${r.where}.image`, message: `${r.image.value} has no usable photo (photo_available: false); request a literal stock scene or none` });
      const prev = seen.get(r.image.value);
      if (prev) errors.push({ section: `${r.where}.image`, message: `${r.image.value} is already requested on ${prev}; each subject at most once per post` });
      else seen.set(r.image.value, r.where);
    }
    if (r.image.kind === 'stock') {
      const slideWords = word4(r.text);
      if (![...word4(r.image.value)].some((w) => slideWords.has(w))) {
        errors.push({ section: `${r.where}.image`, message: `stock "${r.image.value}" doesn't name a physical thing this slide mentions` });
      }
    }
  }
  // One EDIT NOTES line per none, saying why (Tommy, 2026-10-06). The slide after a spread is none by design and needs none.
  const nones = d.slides.filter((s, i) => s.image.kind === 'none' && !d.slides[i - 1]?.spread_with_next).length;
  const noteLines = d.edit_notes.filter((n) => /\bnone\b/i.test(n)).length;
  if (noteLines < nones) errors.push({ section: 'edit_notes', message: `${nones} slide(s) with IMAGE none but ${noteLines} EDIT NOTES line(s) about none; add one line per none saying why nothing physical fits` });
  return errors;
}

export type WriterResult =
  | { ok: true; draft: DraftSubmission; filled: FilledDraft; raw: string; costUsd: number; turns: number; draftRetries: number; retryErrors: string[]; turnUsage: TurnUsage[] }
  | { ok: false; reason: 'malformed-output' | 'service-error' | 'refused'; detail: string; raw: string | null; costUsd: number; turns: number; draftRetries: number; retryErrors: string[]; turnUsage: TurnUsage[] };

export type WriterDeps = {
  create: MessagesCreate;
  isWellKnown: IsWellKnown;
  /** photo_available marking (handoff); without it every subject is marked false and not checked. */
  hasPhoto?: HasPhoto;
  config?: StageModelConfig;
};

/** checkDraft (structure and IDs), then the M7 text checks C1–C5 on the filled, fixed draft. */
export function checkWrittenDraft(input: unknown, brief: Brief, attempt: number, stage: 'writer' | 'editor' = 'writer', photoSubjects: Set<string> | null = null): DraftSubmission {
  const d = checkDraft(input, brief);
  const failures = draftTextFailures(fillDraft(d, brief), brief, attempt, stage);
  const errors = failures.map((f) => ({ section: `${f.id} ${f.where}`, message: f.detail }));
  if (stage === 'writer' && attempt <= 1) errors.push(...imageHandoffFailures(d, brief, photoSubjects));
  if (errors.length > 0) throw new DraftValidationError(errors);
  return d;
}

export async function runWriter(brief: Brief, deps: WriterDeps): Promise<WriterResult> {
  const forWriter = await briefForWriter(brief, deps.isWellKnown, deps.hasPhoto);
  const photoSubjects = new Set(forWriter.subjects.filter((s) => s.photo_available).map((s) => s.name));
  const r = await runStructuredCall({
    create: deps.create,
    config: deps.config ?? STAGE_MODELS.writer,
    system: WRITER_SYSTEM,
    tool: SUBMIT_DRAFT_TOOL,
    user: writerUserMessage(forWriter),
    check: (input, attempt) => checkWrittenDraft(input, brief, attempt, 'writer', deps.hasPhoto ? photoSubjects : null),
  });
  const common = { costUsd: r.costUsd, turns: r.turns, draftRetries: r.retries, retryErrors: r.retryErrors, turnUsage: r.turnUsage };
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, raw: r.raw, ...common };
  return { ok: true, draft: r.value, filled: fillDraft(r.value, brief), raw: r.raw, ...common };
}
