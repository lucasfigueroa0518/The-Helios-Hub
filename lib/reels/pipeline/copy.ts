import Anthropic from '@anthropic-ai/sdk';

import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { COPY_MODEL, FULL_STORY_CUE_ENABLED } from '@/lib/reels/config';
import type { CopyInput } from '@/lib/reels/copy/assemble';
import {
  COPY_CALLS_PER_IDEA,
  buildCopyVariants,
  flattenCopyCalls,
  rewriteLines,
  type CopyLineJudgment,
  type CopyVariants,
  type DraftCall,
  type FlattenedCopyLine,
} from '@/lib/reels/copy/pick';
import { decideFullStory } from '@/lib/reels/copy/full-story';
import { checkCopy, publishCopy, type CopyCall, type CopyReport } from '@/lib/reels/copy/report';
import { judgeCopyLine } from '@/lib/reels/copy/score';
import { loadCopyTargets, saveIdeaCopy, type CopyTarget } from '@/lib/reels/copy/store';
import { findReelLock } from '@/lib/reels/locks';
import { writeCopy, type CopyClient, type CopyResult } from '@/lib/reels/copy/writer';
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
 * returns two on-screen lines and one caption. Jev judges the lines, and the
 * reel keeps the winning line with that call's caption. When no line clears
 * the copy gate, one rewrite call sees the scores and adds two more lines
 * (D-216). A failed idea is stored with its error in the copy history, keeps
 * any earlier ok copy, and shows on the Scores tab (D-220).
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
  /** The shipped line cleared the copy gate. */
  passed: boolean;
  /** Jev scored the lines. A writer failure is not a miss, and it draws no penalty. */
  judged: boolean;
  variants: CopyVariants | null;
  usd: number;
  error: string | null;
  onScreenCopy: string | null;
  caption: string | null;
  promptVersion: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/**
 * One idea, from the Scores tab. The click is the authorization; this still
 * refuses to call the model when P-10 is not approved.
 */
const failed = (error: string): IdeaCopyOutcome => ({
  ok: false,
  passed: false,
  judged: false,
  variants: null,
  usd: 0,
  error,
  onScreenCopy: null,
  caption: null,
  promptVersion: '',
  model: COPY_MODEL,
  inputTokens: 0,
  outputTokens: 0,
});

export async function writeIdeaCopy(
  runId: string | null,
  slateId: string,
  postIdeaId: string,
  deps?: { client?: CopyClient; signal?: AbortSignal; jev?: JevRunner },
): Promise<IdeaCopyOutcome> {
  if (!copyPromptApproved()) return failed('The P-10 writer prompt is not approved.');
  const lock = await findReelLock(slateId, postIdeaId);
  if (lock) return failed(`This reel is locked for ${lock.nyDate} and stays as it is.`);
  if (!deps?.client && !process.env.ANTHROPIC_API_KEY) return failed('ANTHROPIC_API_KEY is not set.');
  const targets = await loadCopyTargets(slateId, { postIdeaId });
  const target = targets[0];
  if (!target) return failed('This post idea has no winning bucket and framework to write from.');
  const client: CopyClient = deps?.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return writeTargetCopy(client, runId, slateId, target, deps);
}

function messageCost(message: Anthropic.Message, model: string): { inputTokens: number; outputTokens: number; usd: number } {
  const priced = priceAnthropicMessages([message], { modelId: model, fallbackCacheTtl: '5m' });
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

/** Last step of a saved copy. A failed judgment leaves the cue off. */
async function captionCue(
  jev: JevRunner,
  input: { onScreenCopy: string; caption: string; postIdeaId: string; runId: string | null },
): Promise<string | null> {
  if (!FULL_STORY_CUE_ENABLED) return null;
  try {
    return await decideFullStory(jev, input);
  } catch {
    return null;
  }
}

/**
 * Two writer calls, then the Jev pick, then at most one rewrite, then the
 * caption cue. The cue is the fixed line "Full story below" when that line
 * reads well under this copy. A failed cue judgment leaves the cue off and
 * still saves the copy.
 */
export async function writeTargetCopy(
  client: CopyClient,
  runId: string | null,
  slateId: string,
  target: CopyTarget,
  deps?: {
    signal?: AbortSignal;
    jev?: JevRunner;
    /** Offline tests swap in recorders for the two database writes. */
    save?: typeof saveIdeaCopy;
    cost?: typeof recordCost;
    /** The Sonnet release this attempt calls. Defaults to the pinned fallback. */
    model?: string;
    /** The idea that opens a slot gets one rewrite. A replacement idea does not. */
    rewrite?: boolean;
    /**
     * A single idea from the Scores tab still ships its nearest miss. A
     * generation slot does not: a miss is demoted and the next idea tries.
     */
    shipMiss?: boolean;
  },
): Promise<IdeaCopyOutcome> {
  const jev = deps?.jev ?? createLiveJevRunner();
  const save = deps?.save ?? saveIdeaCopy;
  const logCost = deps?.cost ?? recordCost;
  const model = deps?.model ?? COPY_MODEL;
  const allowRewrite = deps?.rewrite !== false;
  const shipMiss = deps?.shipMiss !== false;
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  const drafts: DraftCall[] = [];
  let promptVersion = '';
  const input: CopyInput = { bucket: target.bucket, framework: target.framework, members: target.members };

  const account = async (result: CopyResult, component: 'copy-caption' | 'copy-rewrite') => {
    promptVersion = result.version;
    if (!result.message) return;
    const priced = messageCost(result.message, model);
    inputTokens += priced.inputTokens;
    outputTokens += priced.outputTokens;
    cost += priced.usd;
    await logCost({
      runId,
      vendor: 'anthropic',
      component,
      inputTokens: priced.inputTokens,
      outputTokens: priced.outputTokens,
      usd: priced.usd,
    });
  };

  const judge = (lines: readonly FlattenedCopyLine[]): Promise<CopyLineJudgment[]> =>
    Promise.all(
      lines.map((line) =>
        judgeCopyLine(jev, {
          onScreenCopy: line.onScreenCopy,
          caption: line.call.caption,
          postIdeaId: target.postIdeaId,
          runId,
        }),
      ),
    );

  for (let index = 0; index < COPY_CALLS_PER_IDEA; index += 1) {
    const result = await writeCopy(client, input, deps?.signal, model);
    await account(result, 'copy-caption');
    drafts.push({ kind: 'draft', call: result.call, error: result.error });
  }

  const base = () => ({
    slateId,
    postIdeaId: target.postIdeaId,
    runId,
    promptVersion,
    model,
    bucket: target.bucket,
    framework: target.framework,
    inputTokens,
    outputTokens,
    usd: cost,
  });

  const fail = async (variants: CopyVariants, error: string): Promise<IdeaCopyOutcome> => {
    const replaced = await save({ ...base(), report: null, checks: null, variants, error });
    const message = replaced ? error : `${error} The earlier ok copy stays.`;
    return {
      ok: false,
      passed: false,
      judged: variants.winnerEligible != null,
      variants,
      usd: cost,
      error: message,
      onScreenCopy: null,
      caption: null,
      promptVersion,
      model,
      inputTokens,
      outputTokens,
    };
  };

  if (!drafts.some((draft) => draft.call)) {
    const { variants } = buildCopyVariants(drafts, null, target.bucket);
    return fail(variants, drafts.map((draft, index) => `Call ${index + 1}: ${draft.error ?? 'no copy'}`).join(' '));
  }

  let judgments: CopyLineJudgment[];
  try {
    judgments = await judge(flattenCopyCalls(drafts));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const { variants } = buildCopyVariants(drafts, null, target.bucket);
    return fail(variants, `Copy pick failed: ${detail}`);
  }

  let picked = buildCopyVariants(drafts, judgments, target.bucket);
  if (allowRewrite && picked.winner && !picked.winner.eligible) {
    const rewrite = await writeCopy(
      client,
      { ...input, rewriteOf: rewriteLines(picked.variants.lines) },
      deps?.signal,
      model,
    );
    await account(rewrite, 'copy-rewrite');
    if (rewrite.call) {
      const rewriteCall = rewrite.call;
      try {
        const added = await judge(flattenCopyCalls([{ call: rewriteCall, error: null }]));
        drafts.push({ kind: 'rewrite', call: rewriteCall, error: null });
        judgments = [...judgments, ...added];
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        drafts.push({ kind: 'rewrite', call: null, error: `Rewrite pick failed: ${detail}` });
      }
    } else {
      drafts.push({ kind: 'rewrite', call: null, error: rewrite.error });
    }
    picked = buildCopyVariants(drafts, judgments, target.bucket);
  }

  const { variants, winner } = picked;
  if (!winner) return fail(variants, 'Copy pick did not choose a line.');
  if (!winner.eligible && !shipMiss) return fail(variants, 'No on-screen copy cleared the bar.');

  const report = publishCopy(winner.call, winner.onScreenCopy);
  const fullStoryCue = await captionCue(jev, {
    onScreenCopy: report.onScreenCopy,
    caption: report.caption,
    postIdeaId: target.postIdeaId,
    runId,
  });
  await save({
    ...base(),
    report,
    checks: checkCopy(report, target.bucket, knownUrls(target)),
    variants,
    error: null,
    fullStoryBelow: fullStoryCue != null,
    fullStoryCue,
  });
  return {
    ok: true,
    passed: winner.eligible,
    judged: true,
    variants,
    usd: cost,
    error: null,
    onScreenCopy: report.onScreenCopy,
    caption: report.caption,
    promptVersion,
    model,
    inputTokens,
    outputTokens,
  };
}

/** Publish one already-judged line. A generation uses this for the best of four misses. */
export async function shipStoredCopy(
  runId: string | null,
  slateId: string,
  target: CopyTarget,
  variants: CopyVariants,
  lineIndex: number,
  accounting: Pick<IdeaCopyOutcome, 'promptVersion' | 'model' | 'inputTokens' | 'outputTokens' | 'usd'>,
  deps?: { jev?: JevRunner; save?: typeof saveIdeaCopy },
): Promise<IdeaCopyOutcome> {
  const line = variants.lines[lineIndex];
  if (!line) return failed('The graded line is not in the copy that was judged.');
  const working = variants.calls[line.callIndex]?.working ?? {
    hookDrafts: [],
    copyDraft: '',
    captionDraft: '',
    remainingPatterns: [],
  };
  const call: CopyCall = {
    onScreenCopies: [line.onScreenCopy, line.onScreenCopy],
    viewerStake: line.viewerStake,
    caption: line.caption,
    callToAction: line.callToAction,
    hashtags: line.hashtags,
    sources: line.sources,
    working,
  };
  const report: CopyReport = publishCopy(call, line.onScreenCopy);
  const jev = deps?.jev ?? createLiveJevRunner();
  const save = deps?.save ?? saveIdeaCopy;
  const fullStoryCue = await captionCue(jev, {
    onScreenCopy: report.onScreenCopy,
    caption: report.caption,
    postIdeaId: target.postIdeaId,
    runId,
  });
  await save({
    slateId,
    postIdeaId: target.postIdeaId,
    runId,
    promptVersion: accounting.promptVersion,
    model: accounting.model,
    bucket: target.bucket,
    framework: target.framework,
    inputTokens: accounting.inputTokens,
    outputTokens: accounting.outputTokens,
    usd: accounting.usd,
    report,
    checks: checkCopy(report, target.bucket, knownUrls(target)),
    variants,
    error: null,
    fullStoryBelow: fullStoryCue != null,
    fullStoryCue,
  });
  return {
    ok: true,
    passed: line.eligible === true,
    judged: true,
    variants,
    usd: accounting.usd,
    error: null,
    onScreenCopy: report.onScreenCopy,
    caption: report.caption,
    promptVersion: accounting.promptVersion,
    model: accounting.model,
    inputTokens: accounting.inputTokens,
    outputTokens: accounting.outputTokens,
  };
}
