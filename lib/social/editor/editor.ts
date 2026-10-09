/**
 * Editor stage (spec §4.1; prompts file §4): reads the Writer's draft as
 * the target reader, cuts and sharpens, never adds facts. Returns the same
 * submit_draft shape (Tommy, 2026-10-05).
 *
 * The code check is the Writer's checkDraft plus the parts of the prompt's
 * POWERS line that code can see without judgment: the Editor may not use a
 * quote, number or claim-tag ID the Writer didn't, and may not ask for a
 * visual the Writer didn't; it may swap a slide's visual for its fallback (a
 * cut; sixth round, Tommy 2026-10-07). One retry on failure, like every stage.
 */
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import type { Brief, BriefError } from '@/lib/social/reporter/brief';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import { DraftValidationError, SUBMIT_DRAFT_TOOL, fillDraft, type DraftSubmission, type VisualRequest } from '@/lib/social/writer/draft';
import { checkWrittenDraft, defaultIcons, pruneSubjectTags, type SubjectKinds } from '@/lib/social/writer/writer';
import { rescueOverLength } from '@/lib/social/writer/shorten';
import { runStructuredCall, type StructuredFailure } from '@/lib/social/writer/structured-call';
import type { TurnUsage } from '@/lib/social/reporter/reporter';
import type { FilledDraft } from '@/lib/social/writer/draft';

import { EDITOR_SYSTEM, editorUserMessage } from './prompt';

const visualKey = (v: VisualRequest) => `${v.kind}:${v.query.trim().toLowerCase()}`;

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
    visuals: new Set([...d.cover_options, ...d.slides].flatMap((x) => [visualKey(x.visual), visualKey(x.fallback_visual)])),
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
  // The Editor may swap a visual for its fallback (a cut); never ask for one the Writer didn't (Tommy, 2026-10-07).
  for (const key of e.visuals) if (!w.visuals.has(key)) errors.push({ section: 'powers', message: `visual "${key}" wasn't in the Writer's draft (you may only swap a slide's visual for its fallback)` });
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
  let common = { costUsd: r.costUsd, turns: r.turns, retries: r.retries, retryErrors: r.retryErrors, turnUsage: r.turnUsage };
  let value = r.ok ? r.value : null;
  if (!r.ok && r.reason === 'malformed-output') {
    // Lines still over their limit after the retry: one small call shortens them instead of losing the story.
    const rescue = await rescueOverLength(r.raw, deps.create, (input) => {
      const edited = checkWrittenDraft(input, brief, 2, 'editor');
      checkEditorPowers(writerDraft, edited);
      return edited;
    });
    common = { ...common, costUsd: common.costUsd + rescue.costUsd, turnUsage: [...common.turnUsage, ...rescue.turnUsage], retryErrors: rescue.note ? [...common.retryErrors, rescue.note] : common.retryErrors };
    value = rescue.value;
  }
  if (!value) return { ok: false, reason: r.ok ? 'malformed-output' : r.reason, detail: r.ok ? 'no draft' : r.detail, raw: r.ok ? null : r.raw, ...common };
  // Tags re-checked right after the Editor (Tommy, 2026-10-07): code, no retry. A tag the edited
  // words no longer name is removed and logged; the words and the requests stay as the Editor left them.
  const t = pruneSubjectTags(value, brief, deps.subjectKinds ?? null);
  // An icon the Editor dropped or changed to one not on the list falls back to the default (logged).
  const ic = defaultIcons(t.draft);
  return { ok: true, draft: ic.draft, filled: fillDraft(ic.draft, brief), raw: r.ok ? r.raw : JSON.stringify(value, null, 2), ...common, tagsDropped: [...t.dropped, ...ic.dropped] };
}
