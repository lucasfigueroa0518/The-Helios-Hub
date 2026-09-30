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
   * Cost-cut #2: how the source payload sent to LLM stages was capped.
   * Number-trace and quote checks still run against the full fetched texts.
   */
  sourceTrim?: {
    keptSources: number;
    droppedSources: number;
    perSourceChars: Array<{ url: string; chars: number }>;
  };
  /**
   * enforceStructure — deterministic pre-Editor pass. Records every
   * merge / drop / renumber so the reviewer can see what code did
   * before the model saw the draft.
   */
  enforceStructure?: {
    log: string[];
    needsEditor:
      | { kind: 'rhythm'; violatingPairs: Array<[number, number]> }
      | { kind: 'variety'; distinctKinds: number; needed: number }
      | null;
  };
  /**
   * Brief-integrity gate — quotes cut from THE STORY because they didn't
   * appear in any fetched source's text. Thin-brief judgment happens
   * downstream by counting the Writer's slide output.
   */
  briefIntegrity?: {
    droppedQuotes: Array<{ quote: string; reason: string }>;
  };
  /**
   * Post-PASS soft-repair loop: how many Editor / Caption trim passes ran
   * to clear char_limit / highlight_substring / rhythm errors after
   * fact-check PASS, the total $ they cost, which slides they rewrote,
   * and the verdict of the targeted re-fact-check that re-verifies
   * changed slides against the sources.
   */
  softRepair?: {
    runs: number;
    cap: number;
    costUsd: number;
    changedSlides: number[];
    reFactCheck: {
      verdict: FactCheckResult['verdict'];
      flags: FactCheckResult['flags'];
      changedSlides: number[];
      usage: StageUsage;
      raw: string;
    } | null;
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
      subject: string;
      label: string;
      commonsFile: string;
      storageUrl: string;
      license: string;
      licenseUrl: string | null;
      author: string;
      credit: string;
      isPortrait: boolean;
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
  /**
   * The exact post + caption the pipeline handed off to the renderer or
   * to the human-review UI. Written at both terminal paths (bail + ship)
   * so summaries and preview renders agree on "what render sees". Prior
   * to 2026-09-29 the render fell back to `edited.post` (initial editor
   * pass) whenever the pipeline bailed to human review, which produced
   * previews that disagreed with the FINAL post in the summary — three
   * text slides in a row on the Suleyman run when the FINAL post had
   * alternating text/quote. This field is the single source of truth.
   */
  finalPost?: ParsedPost;
  finalCaption?: string;
  /**
   * Snapshot of the "approved outline" — the sequence of slide kinds
   * from the post the Editor first saw (Writer draft after
   * enforce-structure's deterministic pre-fix). Used by the
   * outline_kind_mismatch check at the final gate to catch cases where
   * the Editor silently restructured the post (e.g., changed a stat
   * slide to a text slide during a repair round). Kinds only — not
   * copy — so the reviewer can see structural drift at a glance.
   */
  approvedOutline?: Array<{ position: number; kind: string }>;
  /**
   * Cover-fit gate result (2026-09-29 late second pass). Records whether
   * the pre-render Playwright cover-fit check ran on this run and what
   * it returned, so the summary can say plainly "cover-fit: ran, ok" /
   * "cover-fit: ran, failed — <reason>" / "cover-fit: skipped
   * (HELIOS_V2_COVER_FIT not set)".
   */
  coverFit?: {
    ran: boolean;
    ok?: boolean;
    reason?: string;
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
