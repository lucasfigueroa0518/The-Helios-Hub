/**
 * Editor stage (spec §4.1; prompts file §4): reads the Writer's draft as
 * the target reader, cuts and sharpens, never adds facts. Returns the same
 * submit_draft shape (Tommy, 2026-10-05).
 *
 * The code check is the Writer's checkDraft plus the parts of the prompt's
 * POWERS line that code can see without judgment: the Editor may not use a
 * quote, number or claim-tag ID the Writer didn't, and may not request an
 * image the Writer didn't; it may change one to none (a cut) (Tommy,
 * 2026-10-06). One retry on failure, like every stage.
 */
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import type { Brief, BriefError } from '@/lib/social/reporter/brief';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { DraftValidationError, SUBMIT_DRAFT_TOOL, fillDraft, type DraftSubmission, type ImageRequest } from '@/lib/social/writer/draft';
import { checkWrittenDraft, pruneSubjectTags, type SubjectKinds } from '@/lib/social/writer/writer';
import { runStructuredCall, type StructuredFailure } from '@/lib/social/writer/structured-call';
import type { TurnUsage } from '@/lib/social/reporter/reporter';
import type { FilledDraft } from '@/lib/social/writer/draft';

import { EDITOR_SYSTEM, editorUserMessage } from './prompt';

const imageKey = (i: ImageRequest) => (i.kind === 'none' ? 'none:' : `${i.kind}:${i.value}`);

function idsOf(d: DraftSubmission) {
  const tags = new Set<string>();
  d.cover_options.forEach((c) => c.facts.forEach((f) => tags.add(f)));
  d.slides.forEach((s) => {
    s.headline.facts.forEach((f) => tags.add(f));
    s.body?.facts.forEach((f) => tags.add(f));
  });
  d.caption.facts.forEach((f) => tags.add(f));
  return {
    tags,
    quotes: new Set(d.slides.flatMap((s) => (s.quote_id ? [s.quote_id] : []))),
    numbers: new Set(d.slides.flatMap((s) => s.number_ids)),
    slideImages: new Set(d.slides.map((s) => imageKey(s.image))),
    coverImages: new Set(d.cover_options.map((c) => imageKey(c.image))),
  };
}

/** Cut-and-sharpen only, as far as code can see it. */
export function checkEditorPowers(writer: DraftSubmission, edited: DraftSubmission): void {
  const w = idsOf(writer);
  const e = idsOf(edited);
  const errors: BriefError[] = [];
  for (const id of e.quotes) if (!w.quotes.has(id)) errors.push({ section: 'powers', message: `quote ${id} wasn't in the Writer's draft (the Editor never adds facts)` });
  for (const id of e.numbers) if (!w.numbers.has(id)) errors.push({ section: 'powers', message: `number ${id} wasn't in the Writer's draft` });
  for (const id of e.tags) if (!w.tags.has(id)) errors.push({ section: 'powers', message: `claim tag ${id} wasn't in the Writer's draft` });
  // The Editor may change an IMAGE to none (a cut); never add or change one (Tommy, 2026-10-06).
  for (const key of e.slideImages) if (key !== 'none:' && !w.slideImages.has(key)) errors.push({ section: 'powers', message: `slide image "${key}" wasn't in the Writer's draft (you may only change an IMAGE to none)` });
  for (const key of e.coverImages) if (!w.coverImages.has(key)) errors.push({ section: 'powers', message: `cover image "${key}" wasn't in the Writer's draft` });
  if (errors.length > 0) throw new DraftValidationError(errors);
}

export type EditorResult =
  | { ok: true; draft: DraftSubmission; filled: FilledDraft; raw: string; costUsd: number; turns: number; retries: number; retryErrors: string[]; turnUsage: TurnUsage[]; tagsDropped: string[] }
  | { ok: false; reason: StructuredFailure; detail: string; raw: string | null; costUsd: number; turns: number; retries: number; retryErrors: string[]; turnUsage: TurnUsage[] };

/** `subjectKinds`: each subject's type, for the tag re-check's naming rule (unknown: full names only). */
export type EditorDeps = { create: MessagesCreate; config?: StageModelConfig; subjectKinds?: SubjectKinds };

export async function runEditor(brief: Brief, writerDraft: DraftSubmission, deps: EditorDeps): Promise<EditorResult> {
  const r = await runStructuredCall({
    create: deps.create,
    config: deps.config ?? STAGE_MODELS.editor,
    system: EDITOR_SYSTEM,
    tool: SUBMIT_DRAFT_TOOL,
    user: editorUserMessage(writerDraft, brief),
    check: (input, attempt) => {
      const edited = checkWrittenDraft(input, brief, attempt, 'editor');
      checkEditorPowers(writerDraft, edited);
      return edited;
    },
  });
  const common = { costUsd: r.costUsd, turns: r.turns, retries: r.retries, retryErrors: r.retryErrors, turnUsage: r.turnUsage };
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, raw: r.raw, ...common };
  // Tags re-checked right after the Editor (Tommy, 2026-10-07): code, no retry. A tag the edited
  // words no longer name is removed and logged; the words and the requests stay as the Editor left them.
  const t = pruneSubjectTags(r.value, brief, deps.subjectKinds ?? null);
  return { ok: true, draft: t.draft, filled: fillDraft(t.draft, brief), raw: r.raw, ...common, tagsDropped: t.dropped };
}
