/**
 * Stage transcripts for creator-pipeline runs.
 *
 * Every stage's raw output for every post, including each fact-check round,
 * lives here so debugging a bad post starts at "which stage caused it"
 * without a re-run. Persists as one JSONB blob per article on
 * `helios_social.article_queue.pipeline_v2_debug`.
 */

import { dbQuery } from '@/lib/db';

import type { CheckError } from './code-checks';
import type { Brief, ParsedPost, FactCheckResult } from './parse';

export type StageUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  webSearchRequests?: number;
  approxCostUsd: number;
};

export type FactCheckRound = {
  round: number;
  /** Snapshot of the post being checked in this round (parsed EDITED POST). */
  post: ParsedPost;
  caption: string;
  codeCheckErrorsBeforeFactCheck?: CheckError[];
  captionCheckErrorsBeforeFactCheck?: CheckError[];
  numberTraceErrorsBeforeFactCheck?: CheckError[];
  factCheck: FactCheckResult;
  factCheckRaw: string;
  /** Fact-checker stage stop_reason(s) for this round's call. */
  stopReasons: string[];
  usage: StageUsage;
};

export type PipelineV2Debug = {
  version: 2;
  articleId: string;
  startedAt: string;
  finishedAt?: string;
  reporter?: {
    brief: Brief;
    briefRaw: string;
    /** stop_reason of every Reporter turn, in order (end_turn, pause_turn, tool_use, max_tokens, …). */
    stopReasons: string[];
    usage: StageUsage;
  };
  sources?: Array<{
    url: string;
    resolvedUrl?: string;
    ok: boolean;
    error?: string;
    /** Truncated to first 500 chars for the debug blob; full text is not persisted. */
    textPreview?: string;
    length?: number;
  }>;
  /**
   * Brief-image validation results. `kept` are the images that passed
   * both the credit-name check and the HEAD content-type check;
   * `dropped` are the ones filtered out before the Writer saw them.
   */
  imageValidation?: {
    kept: Array<{ number: number; link: string; credit: string }>;
    dropped: Array<{ number: number; link: string; credit: string; reason: string }>;
  };
  /**
   * Which brief.sources entries survived the "substantive source" filter
   * for the caption's "Source:" line. See orchestrate.ts §2c.
   */
  substantiveSources?: {
    thresholdChars: number;
    keptCount: number;
    droppedCount: number;
    keptUrls: string[];
  };
  /**
   * Image step result. Per docs/IMAGES-V1-HANDOFF.md §Place and credit,
   * every choice records the subject / Wikidata id / Commons file / license
   * so a reviewer can confirm provenance in seconds. `error` is set when
   * the whole step failed (non-fatal — the post ships type-only).
   */
  imageStep?: {
    selected?: Array<{
      slide: 'cover' | number;
      wikidataId: string;
      label: string;
      commonsFile: string;
      license: string;
      author: string;
      source: 'cache' | 'wikimedia';
    }>;
    report?: unknown[];
    visionCalls?: number;
    error?: string;
  };
  draft?: {
    post: ParsedPost;
    raw: string;
    stopReasons: string[];
    usage: StageUsage;
  };
  edited?: {
    post: ParsedPost;
    raw: string;
    editNotes: string[] | null;
    stopReasons: string[];
    usage: StageUsage;
  };
  caption?: {
    caption: string;
    raw: string;
    stopReasons: string[];
    usage: StageUsage;
  };
  rounds: FactCheckRound[];
  /** Fired when we entered a repair sub-round (CHECK ERRORS or FIX NOTES). */
  repairs: Array<{
    round: number;
    stage: 'editor' | 'caption' | 'writer';
    reason: string;
    usage: StageUsage;
  }>;
  /** Terminal state written when the pipeline exits. */
  outcome: {
    status: 'shipped' | 'needs_human_review' | 'failed';
    reason?: string;
    totalCostUsd: number;
  };
};

export async function persistDebug(articleId: string, debug: PipelineV2Debug): Promise<void> {
  await dbQuery(
    `UPDATE helios_social.article_queue
        SET pipeline_v2_debug = $1::jsonb
      WHERE id = $2`,
    [JSON.stringify(debug), articleId],
  );
}

export async function persistDebugAndCompose(
  articleId: string,
  debug: PipelineV2Debug,
  columns: {
    renderPostJson?: unknown;
    renderSlug?: string;
    composeStatus: 'composed' | 'compose_failed' | 'needs_human_review';
    composeError?: string;
  },
): Promise<void> {
  await dbQuery(
    `UPDATE helios_social.article_queue
        SET pipeline_v2_debug = $1::jsonb,
            render_post_json   = COALESCE($2::jsonb, render_post_json),
            render_slug        = COALESCE($3::text, render_slug),
            compose_status     = $4::text,
            compose_error      = $5::text
      WHERE id = $6`,
    [
      JSON.stringify(debug),
      columns.renderPostJson ? JSON.stringify(columns.renderPostJson) : null,
      columns.renderSlug ?? null,
      columns.composeStatus,
      columns.composeError ?? null,
      articleId,
    ],
  );
}
