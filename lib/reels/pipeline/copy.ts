import Anthropic from '@anthropic-ai/sdk';

import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { COPY_MODEL } from '@/lib/reels/config';
import {
  COPY_CALLS_PER_IDEA,
  buildCopyVariants,
  flattenCopyCalls,
  type CopyLineScore,
  type DraftCall,
} from '@/lib/reels/copy/pick';
import { chooseFullStoryLine, decideFullStory } from '@/lib/reels/copy/full-story';
import { checkCopy, publishCopy } from '@/lib/reels/copy/report';
import { scoreCopyLine } from '@/lib/reels/copy/score';
import { loadCopyTargets, saveIdeaCopy, type CopyTarget } from '@/lib/reels/copy/store';
import { writeCopy, type CopyClient } from '@/lib/reels/copy/writer';
import { createLiveJevRunner } from '@/lib/reels/jev/client';
import type { JevRunner } from '@/lib/reels/jev/runner';
import { compareIdeaRank } from '@/lib/reels/pipeline/order';
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
  /** Ideas whose copy was written, for the whole-reel flow (D-192). */
  writtenIdeaIds?: string[];
  failed: number;
  usd: number;
  failures: string[];
};

/**
 * D-195. After scoring, each selected idea gets two writer calls. Each call
 * returns two on-screen lines and one caption. Jev scores the lines, and the
 * reel keeps the winning line with that call's caption. No retry: a failed
 * idea is stored with its error and shown on the Scores tab.
 */
export async function writeSlateCopy(
  runId: string,
  slateId: string,
  deps?: { client?: CopyClient; signal?: AbortSignal; jev?: JevRunner },
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
  const writtenIdeaIds: string[] = [];
  let usd = 0;
  const failures: string[] = [];

  for (const target of targets) {
    const outcome = await writeTargetCopy(client, runId, slateId, target, deps);
    usd += outcome.usd;
    if (outcome.ok) {
      written += 1;
      writtenIdeaIds.push(target.postIdeaId);
    }
    else failures.push(`rank ${target.rank ?? '?'}: ${outcome.error ?? 'unknown error'}`);
  }

  const rankOf = new Map(targets.map((target) => [target.postIdeaId, target.rank]));
  writtenIdeaIds.sort((a, b) => compareIdeaRank(rankOf.get(a) ?? null, rankOf.get(b) ?? null));

  return {
    status: failures.length === 0 ? 'ok' : 'partial',
    written,
    writtenIdeaIds,
    failed: failures.length,
    usd,
    failures,
  };
}

export type IdeaCopyOutcome = {
  ok: boolean;
  usd: number;
  error: string | null;
  onScreenCopy: string | null;
  caption: string | null;
};

/**
 * One idea, from the Scores tab. The click is the authorization; this still
 * refuses to call the model when P-10 is not approved.
 */
const failed = (error: string): IdeaCopyOutcome => ({
  ok: false,
  usd: 0,
  error,
  onScreenCopy: null,
  caption: null,
});

export async function writeIdeaCopy(
  runId: string | null,
  slateId: string,
  postIdeaId: string,
  deps?: { client?: CopyClient; signal?: AbortSignal; jev?: JevRunner },
): Promise<IdeaCopyOutcome> {
  if (!copyPromptApproved()) return failed('The P-10 writer prompt is not approved.');
  if (!deps?.client && !process.env.ANTHROPIC_API_KEY) return failed('ANTHROPIC_API_KEY is not set.');
  const targets = await loadCopyTargets(slateId, { postIdeaId });
  const target = targets[0];
  if (!target) return failed('This post idea has no winning bucket and framework to write from.');
  const client: CopyClient = deps?.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return writeTargetCopy(client, runId, slateId, target, deps);
}

function messageCost(message: Anthropic.Message): { inputTokens: number; outputTokens: number; usd: number } {
  const priced = priceAnthropicMessages([message], { modelId: COPY_MODEL, fallbackCacheTtl: '5m' });
  return {
    inputTokens:
      priced.uncached_input_tokens +
      priced.cache_read_input_tokens +
      priced['cache_creation.ephemeral_5m_input_tokens'] +
      priced['cache_creation.ephemeral_1h_input_tokens'],
    outputTokens: priced.output_tokens,
    usd: Number(priced.costUsd),
  };
}

function knownUrls(target: CopyTarget): string[] {
  return [...new Set(target.members.flatMap((member) => [member.url, ...member.citationUrls]))];
}

/**
 * Two writer calls, then the Jev pick, then the caption cue. The cue is one
 * of the bucket's eight lines, with a hand pointing down drawn after it.
 * Exported for the copy canary, which runs this without flipping the nightly
 * approval flag. A failed cue judgment leaves the cue off and still saves the copy.
 */
export async function writeTargetCopy(
  client: CopyClient,
  runId: string | null,
  slateId: string,
  target: CopyTarget,
  deps?: { signal?: AbortSignal; jev?: JevRunner },
): Promise<IdeaCopyOutcome> {
  const jev = deps?.jev ?? createLiveJevRunner();
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  const drafts: DraftCall[] = [];
  let promptVersion = '';

  for (let index = 0; index < COPY_CALLS_PER_IDEA; index += 1) {
    const result = await writeCopy(
      client,
      { bucket: target.bucket, framework: target.framework, members: target.members },
      deps?.signal,
    );
    promptVersion = result.version;
    if (result.message) {
      const priced = messageCost(result.message);
      inputTokens += priced.inputTokens;
      outputTokens += priced.outputTokens;
      cost += priced.usd;
      await recordCost({
        runId,
        vendor: 'anthropic',
        component: 'copy-caption',
        inputTokens: priced.inputTokens,
        outputTokens: priced.outputTokens,
        usd: priced.usd,
      });
    }
    drafts.push({ call: result.call, error: result.error });
  }

  const base = {
    slateId,
    postIdeaId: target.postIdeaId,
    runId,
    promptVersion,
    model: COPY_MODEL,
    bucket: target.bucket,
    framework: target.framework,
    inputTokens,
    outputTokens,
    usd: cost,
  };

  if (!drafts.some((draft) => draft.call)) {
    const { variants } = buildCopyVariants(drafts, null);
    const error = drafts.map((draft, index) => `Call ${index + 1}: ${draft.error ?? 'no copy'}`).join(' ');
    await saveIdeaCopy({ ...base, report: null, checks: null, variants, error });
    return { ok: false, usd: cost, error, onScreenCopy: null, caption: null };
  }

  let raw: CopyLineScore[];
  try {
    const lines = flattenCopyCalls(drafts);
    raw = await Promise.all(
      lines.map((line) =>
        scoreCopyLine(jev, { onScreenCopy: line.onScreenCopy, postIdeaId: target.postIdeaId, runId }),
      ),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const { variants } = buildCopyVariants(drafts, null);
    const message = `Copy pick failed: ${detail}`;
    await saveIdeaCopy({ ...base, report: null, checks: null, variants, error: message });
    return { ok: false, usd: cost, error: message, onScreenCopy: null, caption: null };
  }

  const { variants, winner } = buildCopyVariants(drafts, raw);
  if (!winner) {
    const message = 'Copy pick did not choose a line.';
    await saveIdeaCopy({ ...base, report: null, checks: null, variants, error: message });
    return { ok: false, usd: cost, error: message, onScreenCopy: null, caption: null };
  }

  const report = publishCopy(winner.call, winner.onScreenCopy);
  let fullStoryCue: string | null = null;
  try {
    const show = await decideFullStory(jev, {
      onScreenCopy: report.onScreenCopy,
      caption: report.caption,
      postIdeaId: target.postIdeaId,
      runId,
    });
    if (show) {
      fullStoryCue = await chooseFullStoryLine(jev, {
        bucket: target.bucket,
        onScreenCopy: report.onScreenCopy,
        caption: report.caption,
        postIdeaId: target.postIdeaId,
        runId,
      });
    }
  } catch {
    fullStoryCue = null;
  }
  await saveIdeaCopy({
    ...base,
    report,
    checks: checkCopy(report, target.bucket, knownUrls(target)),
    variants,
    error: null,
    fullStoryBelow: fullStoryCue != null,
    fullStoryCue,
  });
  return { ok: true, usd: cost, error: null, onScreenCopy: report.onScreenCopy, caption: report.caption };
}
