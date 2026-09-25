import Anthropic from '@anthropic-ai/sdk';

import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { COPY_MODEL } from '@/lib/reels/config';
import { loadCopyTargets, saveIdeaCopy, type CopyTarget } from '@/lib/reels/copy/store';
import { writeCopy, type CopyClient } from '@/lib/reels/copy/writer';
import { recordCost } from '@/lib/reels/repository';

/**
 * R6 gate. The writer prompt (P-10) produces nothing until Lucas approves the
 * wording and the flag is set where the run happens.
 */
export function copyPromptApproved(): boolean {
  return process.env.REELS_COPY_PROMPT_APPROVED === 'true';
}

export type CopySummary = {
  status: 'skipped' | 'ok' | 'partial';
  written: number;
  failed: number;
  usd: number;
  failures: string[];
};

/**
 * D-090. After scoring, write one on-screen copy and one caption for each of
 * the slate's selected ideas. No retry: a failed idea is stored with its error
 * and shown on the Scores tab.
 */
export async function writeSlateCopy(
  runId: string,
  slateId: string,
  deps?: { client?: CopyClient; signal?: AbortSignal },
): Promise<CopySummary> {
  if (!copyPromptApproved()) {
    return { status: 'skipped', written: 0, failed: 0, usd: 0, failures: [] };
  }
  if (!deps?.client && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set.');
  }
  const client: CopyClient = deps?.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const targets = await loadCopyTargets(slateId);
  let written = 0;
  let usd = 0;
  const failures: string[] = [];

  for (const target of targets) {
    const outcome = await writeLoadedCopy(client, runId, slateId, target, deps?.signal);
    usd += outcome.usd;
    if (outcome.ok) written += 1;
    else failures.push(`rank ${target.rank ?? '?'}: ${outcome.error ?? 'unknown error'}`);
  }

  return {
    status: failures.length === 0 ? 'ok' : 'partial',
    written,
    failed: failures.length,
    usd,
    failures,
  };
}

export type IdeaCopyOutcome = {
  ok: boolean;
  usd: number;
  error: string | null;
};

/**
 * One idea, from the Scores tab. The click is the authorization; this still
 * refuses to call the model when P-10 is not approved.
 */
export async function writeIdeaCopy(
  runId: string | null,
  slateId: string,
  postIdeaId: string,
  deps?: { client?: CopyClient; signal?: AbortSignal },
): Promise<IdeaCopyOutcome> {
  if (!copyPromptApproved()) {
    return { ok: false, usd: 0, error: 'The P-10 writer prompt is not approved.' };
  }
  if (!deps?.client && !process.env.ANTHROPIC_API_KEY) {
    return { ok: false, usd: 0, error: 'ANTHROPIC_API_KEY is not set.' };
  }
  const targets = await loadCopyTargets(slateId, { postIdeaId });
  const target = targets[0];
  if (!target) {
    return {
      ok: false,
      usd: 0,
      error: 'This post idea has no winning bucket and framework to write from.',
    };
  }
  const client: CopyClient = deps?.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return writeLoadedCopy(client, runId, slateId, target, deps?.signal);
}

async function writeLoadedCopy(
  client: CopyClient,
  runId: string | null,
  slateId: string,
  target: CopyTarget,
  signal?: AbortSignal,
): Promise<IdeaCopyOutcome> {
  const result = await writeCopy(
    client,
    { bucket: target.bucket, framework: target.framework, members: target.members },
    signal,
  );

  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  if (result.message) {
    const priced = priceAnthropicMessages([result.message], {
      modelId: COPY_MODEL,
      fallbackCacheTtl: '5m',
    });
    inputTokens =
      priced.uncached_input_tokens +
      priced.cache_read_input_tokens +
      priced['cache_creation.ephemeral_5m_input_tokens'] +
      priced['cache_creation.ephemeral_1h_input_tokens'];
    outputTokens = priced.output_tokens;
    cost = Number(priced.costUsd);
    await recordCost({
      runId,
      vendor: 'anthropic',
      component: 'copy-caption',
      inputTokens,
      outputTokens,
      usd: cost,
    });
  }

  await saveIdeaCopy({
    slateId,
    postIdeaId: target.postIdeaId,
    runId,
    promptVersion: result.version,
    model: COPY_MODEL,
    bucket: target.bucket,
    framework: target.framework,
    report: result.report,
    checks: result.checks,
    error: result.error,
    inputTokens,
    outputTokens,
    usd: cost,
  });

  return { ok: result.report != null, usd: cost, error: result.report ? null : result.error };
}
