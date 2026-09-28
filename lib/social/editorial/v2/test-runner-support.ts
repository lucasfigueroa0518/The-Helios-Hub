/**
 * Support types + helpers for the local test runner script
 * (`scripts/social_v2_test.ts`). Extracted so the summary-builder and the
 * deps-wrapping logic are unit-testable without touching filesystem, DB, or
 * the Anthropic SDK.
 */

import type { OrchestrateDeps, OrchestrateResult } from './orchestrate';
import type { PipelineV2Debug, StageUsage } from './log';
import type { ReporterOutput } from './reporter';
import type { FetchPageResult } from './tools/fetch-page';
import type { FetchedSource } from './writer';

/* ── Captured artifacts (what the runner writes to disk) ───────────────── */

export type CapturedRun = {
  result: OrchestrateResult;
  /** Whatever the pipeline would have persisted to the DB — captured, not written. */
  debug: PipelineV2Debug | null;
  composeStatus: string | null;
  composeError: string | null;
  renderPostJson: unknown | null;
  renderSlug: string | null;
  /** The Reporter's full output (for --from-brief re-runs). */
  reporterOutput: ReporterOutput | null;
  /** The full source texts fetched during the run (for --from-brief re-runs). */
  fetchedSources: FetchedSource[];
};

/** Shape saved to brief.json for later --from-brief usage. */
export type CachedBrief = {
  reporterOutput: ReporterOutput;
  sourceTexts: FetchedSource[];
};

/* ── Deps wrappers ─────────────────────────────────────────────────────── */

/**
 * Wrap the "real" deps so we capture:
 *   - runReporter's ReporterOutput (needed to regenerate brief.json)
 *   - every fetchPage's ok result (needed to regenerate brief.json's
 *     sourceTexts, since debug.sources only stores a 500-char preview)
 *   - the persistDebugAndCompose call args (debug + columns) — but SUPPRESS
 *     the actual DB write. The runner writes to disk instead.
 *
 * `baseDeps` are the real defaults injected by orchestrate.ts.
 */
export function wrapDepsForCapture(baseDeps: Partial<OrchestrateDeps>): {
  deps: Partial<OrchestrateDeps>;
  captured: CapturedRun;
} {
  const captured: CapturedRun = {
    result: { ok: false, status: 'failed', costUsd: 0, stagesRun: [] },
    debug: null,
    composeStatus: null,
    composeError: null,
    renderPostJson: null,
    renderSlug: null,
    reporterOutput: null,
    fetchedSources: [],
  };

  const wrappedReporter = baseDeps.runReporter
    ? async (input: Parameters<NonNullable<OrchestrateDeps['runReporter']>>[0]) => {
        const out = await baseDeps.runReporter!(input);
        captured.reporterOutput = out;
        return out;
      }
    : undefined;

  const wrappedFetchPage = baseDeps.fetchPage
    ? async (url: string): Promise<FetchPageResult> => {
        const r = await baseDeps.fetchPage!(url);
        if (r.ok) {
          captured.fetchedSources.push({ url: r.url, title: r.title, text: r.text });
        }
        return r;
      }
    : undefined;

  const capturingPersist = async (
    _id: string,
    debug: PipelineV2Debug,
    columns: {
      renderPostJson?: unknown;
      renderSlug?: string;
      composeStatus: 'composed' | 'compose_failed' | 'needs_human_review';
      composeError?: string;
    },
  ): Promise<void> => {
    captured.debug = debug;
    captured.composeStatus = columns.composeStatus;
    captured.composeError = columns.composeError ?? null;
    captured.renderPostJson = columns.renderPostJson ?? null;
    captured.renderSlug = columns.renderSlug ?? null;
    // DO NOT call the real persistDebugAndCompose. Test runner writes files
    // instead so the DB stays untouched.
  };

  return {
    deps: {
      ...(wrappedReporter ? { runReporter: wrappedReporter } : {}),
      ...(wrappedFetchPage ? { fetchPage: wrappedFetchPage } : {}),
      persistDebugAndCompose: capturingPersist,
    },
    captured,
  };
}

/**
 * Build deps that replay a cached brief instead of running Reporter +
 * fetchPage live. `runReporter` returns the cached ReporterOutput
 * verbatim; `fetchPage` returns cached source text for any URL that
 * appeared in the cached brief. Unknown URLs get an error result so the
 * orchestrator bails to needs_human_review — the runner should have all
 * sources cached from the original run.
 */
export function buildFromBriefDeps(cached: CachedBrief): Partial<OrchestrateDeps> {
  const byUrl = new Map(cached.sourceTexts.map((s) => [s.url, s]));
  return {
    runReporter: async () => cached.reporterOutput,
    fetchPage: async (url: string): Promise<FetchPageResult> => {
      const s = byUrl.get(url);
      if (!s) return { ok: false, url, error: 'URL not in cached brief.json' };
      return { ok: true, url, resolvedUrl: url, title: s.title ?? null, byline: null, text: s.text };
    },
  };
}

/* ── Summary builder ───────────────────────────────────────────────────── */

/**
 * Turn a captured run into a human-readable markdown transcript that shows
 * every stage's cost, every field's character count, every code-check error,
 * every fact-check round + flags, and the outcome. This is what a reviewer
 * reads to answer "which stage caused this to look wrong."
 */
export function buildSummaryMarkdown(captured: CapturedRun, meta: {
  articleId: string;
  articleHeadline: string;
  runId: string;
  usedFromBrief: boolean;
}): string {
  const debug = captured.debug;
  const lines: string[] = [];

  lines.push(`# v2 pipeline run — ${meta.runId}`);
  lines.push('');
  lines.push(`- Article: \`${meta.articleId}\` — ${meta.articleHeadline}`);
  lines.push(`- From-brief mode: ${meta.usedFromBrief ? 'yes (Reporter + fetchPage stubbed from cached brief.json)' : 'no (full pipeline)'}`);
  lines.push(`- Status: **${captured.result.status}**`);
  if (captured.result.reason) lines.push(`- Reason: ${captured.result.reason}`);
  lines.push(`- Total cost: **$${captured.result.costUsd.toFixed(4)}**`);
  if (captured.renderSlug) lines.push(`- Render slug (NOT persisted): \`${captured.renderSlug}\``);
  lines.push(`- Stages run: ${captured.result.stagesRun.join(' → ') || '(none)'}`);
  lines.push('');

  if (!debug) {
    lines.push('## Debug transcript');
    lines.push('_No debug object captured — pipeline exited before persist._');
    return lines.join('\n');
  }

  // Reporter
  if (debug.reporter) {
    lines.push('## Reporter');
    lines.push('');
    lines.push(`- Stop reasons: \`${debug.reporter.stopReasons.join(', ')}\``);
    lines.push(`- ${formatUsage(debug.reporter.usage)}`);
    lines.push('');
    lines.push('### BRIEF (raw, as returned)');
    lines.push('```');
    lines.push(debug.reporter.briefRaw.trim());
    lines.push('```');
    lines.push('');
  }

  // Sources
  if (debug.sources && debug.sources.length > 0) {
    lines.push('## Source fetches');
    for (const s of debug.sources) {
      if (s.ok) lines.push(`- ✅ ${s.url} (${s.length} chars${s.resolvedUrl && s.resolvedUrl !== s.url ? `, resolved to ${s.resolvedUrl}` : ''})`);
      else lines.push(`- ❌ ${s.url} — ${s.error}`);
    }
    lines.push('');
  }

  // Image validation
  if (debug.imageValidation) {
    lines.push('## Brief-image validation');
    lines.push(`- Kept: ${debug.imageValidation.kept.length}`);
    for (const img of debug.imageValidation.kept) {
      lines.push(`  - IMAGE ${img.number}: credit "${img.credit}", link ${img.link}`);
    }
    lines.push(`- Dropped: ${debug.imageValidation.dropped.length}`);
    for (const d of debug.imageValidation.dropped) {
      lines.push(`  - IMAGE ${d.number}: ${d.reason}`);
    }
    lines.push('');
  }

  // Draft
  if (debug.draft) {
    lines.push('## Writer — DRAFT');
    lines.push(`- Stop reasons: \`${debug.draft.stopReasons.join(', ')}\``);
    lines.push(`- ${formatUsage(debug.draft.usage)}`);
    lines.push('');
    lines.push('### Slides');
    lines.push(formatPostWithLengths(debug.draft.post));
    lines.push('');
  }

  // Edited (initial editor pass)
  if (debug.edited) {
    lines.push('## Editor — EDITED POST');
    lines.push(`- Stop reasons: \`${debug.edited.stopReasons.join(', ')}\``);
    lines.push(`- ${formatUsage(debug.edited.usage)}`);
    if (debug.edited.editNotes && debug.edited.editNotes.length > 0) {
      lines.push('- Edit notes:');
      for (const n of debug.edited.editNotes) lines.push(`  - ${n}`);
    }
    lines.push('');
    lines.push('### Slides (post-editor)');
    lines.push(formatPostWithLengths(debug.edited.post));
    lines.push('');
  }

  // Caption
  if (debug.caption) {
    lines.push('## Caption');
    lines.push(`- Stop reasons: \`${debug.caption.stopReasons.join(', ')}\``);
    lines.push(`- ${formatUsage(debug.caption.usage)}`);
    lines.push(`- Character count (as returned): **${debug.caption.caption.length}**`);
    lines.push('');
    lines.push('```');
    lines.push(debug.caption.caption.trim());
    lines.push('```');
    lines.push('');
  }

  // Repairs (chronological, all rounds)
  if (debug.repairs.length > 0) {
    lines.push('## Repair attempts (all rounds)');
    for (const r of debug.repairs) {
      lines.push(`- **Round ${r.round}** [${r.stage}] — ${r.reason}. ${formatUsage(r.usage)}`);
    }
    lines.push('');
  }

  // Fact-check rounds
  if (debug.rounds.length > 0) {
    lines.push('## Fact-check rounds');
    for (const round of debug.rounds) {
      lines.push('');
      lines.push(`### Round ${round.round} — verdict: **${round.factCheck.verdict}**`);
      if (round.codeCheckErrorsBeforeFactCheck && round.codeCheckErrorsBeforeFactCheck.length > 0) {
        lines.push('#### Slide code-check errors going into this round');
        for (const e of round.codeCheckErrorsBeforeFactCheck) lines.push(`- [${e.kind}] ${e.message}`);
      }
      if (round.captionCheckErrorsBeforeFactCheck && round.captionCheckErrorsBeforeFactCheck.length > 0) {
        lines.push('#### Caption code-check errors going into this round');
        for (const e of round.captionCheckErrorsBeforeFactCheck) lines.push(`- [${e.kind}] ${e.message}`);
      }
      if (round.numberTraceErrorsBeforeFactCheck && round.numberTraceErrorsBeforeFactCheck.length > 0) {
        lines.push('#### Number-trace errors going into this round');
        for (const e of round.numberTraceErrorsBeforeFactCheck) lines.push(`- ${e.message}`);
      }
      lines.push(`- Fact-checker: stop_reasons \`${round.stopReasons.join(', ')}\`, ${formatUsage(round.usage)}`);
      if (round.factCheck.flags.length > 0) {
        lines.push('#### Flags');
        for (const f of round.factCheck.flags) {
          lines.push(`- **${f.size}** — ${f.where}`);
          lines.push(`  - TEXT: ${f.text}`);
          lines.push(`  - PROBLEM: ${f.problem}`);
          lines.push(`  - SOURCES SAY: ${f.sourcesSay}`);
        }
      }
    }
    lines.push('');
  }

  // Final render (would-have-shipped)
  if (captured.renderPostJson) {
    lines.push('## Final Post JSON (would have shipped — NOT persisted)');
    lines.push('');
    lines.push('_See `transcript.json` under `columns.renderPostJson`._');
    lines.push('');
  }

  // Cost summary
  lines.push('## Cost summary');
  lines.push(`- Reporter: ${debug.reporter ? `$${debug.reporter.usage.approxCostUsd.toFixed(4)}` : 'n/a'}`);
  lines.push(`- Writer (initial): ${debug.draft ? `$${debug.draft.usage.approxCostUsd.toFixed(4)}` : 'n/a'}`);
  lines.push(`- Editor (initial): ${debug.edited ? `$${debug.edited.usage.approxCostUsd.toFixed(4)}` : 'n/a'}`);
  lines.push(`- Caption (initial): ${debug.caption ? `$${debug.caption.usage.approxCostUsd.toFixed(4)}` : 'n/a'}`);
  const factCheckCost = debug.rounds.reduce((s, r) => s + r.usage.approxCostUsd, 0);
  lines.push(`- Fact-checker (${debug.rounds.length} round${debug.rounds.length === 1 ? '' : 's'}): $${factCheckCost.toFixed(4)}`);
  const repairCost = debug.repairs.reduce((s, r) => s + r.usage.approxCostUsd, 0);
  lines.push(`- Repairs (${debug.repairs.length}): $${repairCost.toFixed(4)}`);
  lines.push(`- **Total: $${debug.outcome.totalCostUsd.toFixed(4)}**`);

  return lines.join('\n');
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function formatUsage(u: StageUsage): string {
  const websearches = u.webSearchRequests ? `, ${u.webSearchRequests} web_search` : '';
  return `cost $${u.approxCostUsd.toFixed(4)} (in ${u.inputTokens}, cache_read ${u.cacheReadTokens}, cache_write ${u.cacheWriteTokens}, out ${u.outputTokens}${websearches})`;
}

/**
 * Render a ParsedPost with per-field character counts inline so the reviewer
 * can spot every over-limit field at a glance.
 */
function formatPostWithLengths(post: import('./parse').ParsedPost): string {
  const out: string[] = [];
  const coverText = post.cover.text ?? '';
  out.push(`- **COVER** (${coverText.length} chars, limit 100)`);
  out.push(`  - TEXT: ${coverText}`);
  out.push(`  - HIGHLIGHT: ${post.cover.highlight || '(none)'}`);
  out.push(`  - IMAGE: ${post.cover.image || '(none)'}`);
  for (const s of post.slides) {
    out.push(`- **SLIDE ${s.position}**`);
    if (s.headline) out.push(`  - HEADLINE (${s.headline.length} chars, limit 60): ${s.headline}`);
    if (s.body) out.push(`  - BODY (${s.body.length} chars, limit 220): ${s.body}`);
    if (s.bigNumber) out.push(`  - BIG NUMBER (${s.bigNumber.length} chars, limit 12): ${s.bigNumber}`);
    if (s.highlight) out.push(`  - HIGHLIGHT: ${s.highlight}`);
    if (s.image) out.push(`  - IMAGE: ${s.image}`);
  }
  out.push(`- **FOLLOW** (${post.follow.length} chars, limit 100): ${post.follow}`);
  return out.join('\n');
}
