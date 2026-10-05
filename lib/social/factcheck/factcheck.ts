/**
 * Fact-checker stage, Claude comparison version (spec §4.2, §10; prompts
 * file §5). One pass, no loop: Claude submits flags, code checks them and
 * applies the fixes (flags.ts).
 */
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import type { Brief } from '@/lib/social/reporter/brief';
import type { MessagesCreate, TurnUsage } from '@/lib/social/reporter/reporter';
import type { DraftSubmission, FilledDraft } from '@/lib/social/writer/draft';
import { runStructuredCall, type StructuredFailure } from '@/lib/social/writer/structured-call';

import { SUBMIT_FLAGS_TOOL, applyFlags, checkFlags, type FixOutcome, type FlagsSubmission } from './flags';
import { FACTCHECK_SYSTEM, factCheckUserMessage } from './prompt';

export type FactCheckResult =
  | { ok: true; flags: FlagsSubmission; outcome: FixOutcome; raw: string; costUsd: number; turns: number; retries: number; retryErrors: string[]; turnUsage: TurnUsage[] }
  | { ok: false; reason: StructuredFailure; detail: string; raw: string | null; costUsd: number; turns: number; retries: number; retryErrors: string[]; turnUsage: TurnUsage[] };

export type FactCheckDeps = { create: MessagesCreate; config?: StageModelConfig };

export async function runFactCheck(
  brief: Brief,
  edited: { submission: DraftSubmission; filled: FilledDraft },
  deps: FactCheckDeps,
): Promise<FactCheckResult> {
  // The Fact-checker reads what the reader will see: all 3 covers, quotes and numbers filled in.
  const { cover: _chosenText, ...readerView } = edited.filled;
  const r = await runStructuredCall({
    create: deps.create,
    config: deps.config ?? STAGE_MODELS['fact-checker'],
    system: FACTCHECK_SYSTEM,
    tool: SUBMIT_FLAGS_TOOL,
    user: factCheckUserMessage(readerView, brief),
    check: (input) => checkFlags(input, edited.filled, brief),
  });
  const common = { costUsd: r.costUsd, turns: r.turns, retries: r.retries, retryErrors: r.retryErrors, turnUsage: r.turnUsage };
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, raw: r.raw, ...common };
  return { ok: true, flags: r.value, outcome: applyFlags(edited.submission, r.value, brief), raw: r.raw, ...common };
}
