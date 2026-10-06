/**
 * Editor stage (spec §4.1; prompts file §4): reads the Writer's draft as
 * the target reader, cuts and sharpens, never adds facts. Returns the same
 * submit_draft shape (Tommy, 2026-10-05).
 *
 * The code check is the Writer's checkDraft plus the parts of the prompt's
 * POWERS line that code can see without judgment: the Editor may not use a
 * quote, number or claim-tag ID the Writer didn't, and may not request an
 * image the Writer didn't ("Don't touch IMAGE lines except to drop them
 * with a cut slide"). One retry on failure, like every stage.
 */
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import type { Brief, BriefError } from '@/lib/social/reporter/brief';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { DraftValidationError, SUBMIT_DRAFT_TOOL, fillDraft, type DraftSubmission, type ImageRequest } from '@/lib/social/writer/draft';
import { checkWrittenDraft } from '@/lib/social/writer/writer';
import { runStructuredCall, type StructuredFailure } from '@/lib/social/writer/structured-call';
import type { TurnUsage } from '@/lib/social/reporter/reporter';
import type { FilledDraft } from '@/lib/social/writer/draft';

import { EDITOR_SYSTEM, editorUserMessage } from './prompt';

const imageKey = (i: ImageRequest) => `${i.kind}:${i.value}`;

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
  for (const key of e.slideImages) if (!w.slideImages.has(key)) errors.push({ section: 'powers', message: `slide image "${key}" wasn't in the Writer's draft (don't touch IMAGE lines)` });
  for (const key of e.coverImages) if (!w.coverImages.has(key)) errors.push({ section: 'powers', message: `cover image "${key}" wasn't in the Writer's draft` });
  if (errors.length > 0) throw new DraftValidationError(errors);
}

export type EditorResult =
  | { ok: true; draft: DraftSubmission; filled: FilledDraft; raw: string; costUsd: number; turns: number; retries: number; retryErrors: string[]; turnUsage: TurnUsage[] }
  | { ok: false; reason: StructuredFailure; detail: string; raw: string | null; costUsd: number; turns: number; retries: number; retryErrors: string[]; turnUsage: TurnUsage[] };

export type EditorDeps = { create: MessagesCreate; config?: StageModelConfig };

export async function runEditor(brief: Brief, writerDraft: DraftSubmission, deps: EditorDeps): Promise<EditorResult> {
  const r = await runStructuredCall({
    create: deps.create,
    config: deps.config ?? STAGE_MODELS.editor,
    system: EDITOR_SYSTEM,
    tool: SUBMIT_DRAFT_TOOL,
    user: editorUserMessage(writerDraft, brief),
    check: (input, attempt) => {
      const edited = checkWrittenDraft(input, brief, attempt);
      checkEditorPowers(writerDraft, edited);
      return edited;
    },
  });
  const common = { costUsd: r.costUsd, turns: r.turns, retries: r.retries, retryErrors: r.retryErrors, turnUsage: r.turnUsage };
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, raw: r.raw, ...common };
  return { ok: true, draft: r.value, filled: fillDraft(r.value, brief), raw: r.raw, ...common };
}
