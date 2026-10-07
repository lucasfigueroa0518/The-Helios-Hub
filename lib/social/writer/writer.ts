/**
 * Writer stage (spec §3, §4; prompts file §2–3): one brief → one draft,
 * submitted through submit_draft, checked in code, quotes and numbers
 * filled by ID. One retry when the check fails (spec §7.1 glitch rule).
 *
 * The call itself (caching, check, one retry) is runStructuredCall.
 */
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import type { Brief } from '@/lib/social/reporter/brief';
import type { MessagesCreate, TurnUsage } from '@/lib/social/reporter/reporter';

import { draftTextFailures } from '@/lib/social/mechanical/checks';

import { DraftValidationError, SUBMIT_DRAFT_TOOL, checkDraft, fillDraft, type DraftSubmission, type FilledDraft } from './draft';
import { WRITER_SYSTEM, writerUserMessage } from './prompt';
import { runStructuredCall } from './structured-call';


/** Is this subject widely known? Spec §4.1a: yes when it has a Wikidata match. */
export type IsWellKnown = (subject: { name: string; role: string | null }, brief: Brief) => Promise<boolean>;

/** The brief the Writer sees: the Reporter's JSON with SUBJECTS marked well_known by code. */
export async function briefForWriter(brief: Brief, isWellKnown: IsWellKnown) {
  const subjects = await Promise.all(
    brief.subjects.map(async (s) => ({ ...s, well_known: await isWellKnown(s, brief).catch(() => false) })),
  );
  return { ...brief, subjects };
}

export type WriterResult =
  | { ok: true; draft: DraftSubmission; filled: FilledDraft; raw: string; costUsd: number; turns: number; draftRetries: number; retryErrors: string[]; turnUsage: TurnUsage[] }
  | { ok: false; reason: 'malformed-output' | 'service-error' | 'refused'; detail: string; raw: string | null; costUsd: number; turns: number; draftRetries: number; retryErrors: string[]; turnUsage: TurnUsage[] };

export type WriterDeps = {
  create: MessagesCreate;
  isWellKnown: IsWellKnown;
  config?: StageModelConfig;
};

/** checkDraft (structure and IDs), then the M7 text checks C1–C5 on the filled, fixed draft. */
export function checkWrittenDraft(input: unknown, brief: Brief, attempt: number, stage: 'writer' | 'editor' = 'writer'): DraftSubmission {
  const d = checkDraft(input, brief);
  const failures = draftTextFailures(fillDraft(d, brief), brief, attempt, stage);
  if (failures.length > 0) throw new DraftValidationError(failures.map((f) => ({ section: `${f.id} ${f.where}`, message: f.detail })));
  return d;
}

export async function runWriter(brief: Brief, deps: WriterDeps): Promise<WriterResult> {
  const r = await runStructuredCall({
    create: deps.create,
    config: deps.config ?? STAGE_MODELS.writer,
    system: WRITER_SYSTEM,
    tool: SUBMIT_DRAFT_TOOL,
    user: writerUserMessage(await briefForWriter(brief, deps.isWellKnown)),
    check: (input, attempt) => checkWrittenDraft(input, brief, attempt),
  });
  const common = { costUsd: r.costUsd, turns: r.turns, draftRetries: r.retries, retryErrors: r.retryErrors, turnUsage: r.turnUsage };
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, raw: r.raw, ...common };
  return { ok: true, draft: r.value, filled: fillDraft(r.value, brief), raw: r.raw, ...common };
}
