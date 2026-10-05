/**
 * Writer stage (spec §3, §4; prompts file §2–3): one brief → one draft,
 * submitted through submit_draft, checked in code, quotes and numbers
 * filled by ID. One retry when the check fails (spec §7.1 glitch rule).
 *
 * Prompt caching: tools (submit_draft, cached) → system (static, cached) →
 * user message (the per-story brief). The Claude client is injected.
 */
import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import type { Brief } from '@/lib/social/reporter/brief';
import type { MessagesCreate, TurnUsage } from '@/lib/social/reporter/reporter';

import { DraftValidationError, SUBMIT_DRAFT_TOOL, checkDraft, fillDraft, type DraftSubmission, type FilledDraft } from './draft';
import { WRITER_SYSTEM, writerUserMessage } from './prompt';

export const WRITER_TOOLS: Anthropic.ToolUnion[] = [withToolCache(SUBMIT_DRAFT_TOOL)];
export const MAX_DRAFT_RETRIES = 1;
const MAX_TOKENS = 16_000;

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

export async function runWriter(brief: Brief, deps: WriterDeps): Promise<WriterResult> {
  const config = deps.config ?? STAGE_MODELS.writer;
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: writerUserMessage(await briefForWriter(brief, deps.isWellKnown)) },
  ];
  const responses: MessageUsageLike[] = [];
  const turnUsage: TurnUsage[] = [];
  let draftRetries = 0;
  /** The check errors that triggered each retry (logged). */
  const retryErrors: string[] = [];
  const cost = () => Number(priceAnthropicMessages(responses, { modelId: config.model }).costUsd);
  const fail = (reason: 'malformed-output' | 'service-error' | 'refused', detail: string, raw: string | null, turns: number): WriterResult =>
    ({ ok: false, reason, detail, raw, costUsd: cost(), turns, draftRetries, retryErrors, turnUsage });

  for (let turn = 1; turn <= 1 + MAX_DRAFT_RETRIES; turn++) {
    let res: Anthropic.Message;
    try {
      res = await deps.create({
        model: config.model,
        max_tokens: MAX_TOKENS,
        system: cachedSystemText(WRITER_SYSTEM),
        tools: WRITER_TOOLS,
        messages,
        output_config: { effort: config.effort },
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      return fail('service-error', `Claude call failed: ${err instanceof Error ? err.message : String(err)}`, null, turn);
    }
    responses.push(res as unknown as MessageUsageLike);
    turnUsage.push({
      turn,
      stopReason: res.stop_reason,
      usage: res.usage,
      costUsd: Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: config.model }).costUsd),
    });
    if (res.stop_reason === 'refusal') return fail('refused', 'refusal', null, turn);
    if (res.stop_reason === 'max_tokens') return fail('malformed-output', 'draft cut off at max_tokens', null, turn);

    messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });
    const submit = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_DRAFT_TOOL.name);
    const raw = submit ? JSON.stringify(submit.input, null, 2) : null;
    let detail: string;
    if (submit) {
      try {
        const draft = checkDraft(submit.input, brief);
        return { ok: true, draft, filled: fillDraft(draft, brief), raw: raw!, costUsd: cost(), turns: turn, draftRetries, retryErrors, turnUsage };
      } catch (err) {
        detail = err instanceof DraftValidationError ? err.message : `draft check failed: ${String(err)}`;
      }
    } else {
      detail = 'ended without calling submit_draft';
    }
    if (draftRetries >= MAX_DRAFT_RETRIES) return fail('malformed-output', detail, raw, turn);
    draftRetries++;
    retryErrors.push(detail);
    // One retry with the errors (glitch rule): as the tool result, or as a note when no tool was called.
    messages.push({
      role: 'user',
      content: submit
        ? [{ type: 'tool_result', tool_use_id: submit.id, is_error: true, content: `The draft failed the check. Fix these and call submit_draft again:\n${detail}` }]
        : 'Call submit_draft with the finished draft.',
    });
  }
  return fail('malformed-output', 'no draft', null, 1 + MAX_DRAFT_RETRIES);
}
