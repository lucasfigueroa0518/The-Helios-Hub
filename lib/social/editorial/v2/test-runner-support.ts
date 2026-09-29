/**
 * Support types + helpers for the local test runner script
 * (`scripts/social_v2_test.ts`). Extracted so the summary-builder and the
 * deps-wrapping logic are unit-testable without touching filesystem, DB, or
 * the Anthropic SDK.
 */

import type { OrchestrateDeps, OrchestrateResult } from './orchestrate';
import type { PipelineV2Debug, StageUsage } from './log';
import { runReporter as defaultRunReporter, type ReporterOutput } from './reporter';
import { fetchPage as defaultFetchPage, type FetchPageResult } from './tools/fetch-page';
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

  // ALWAYS wrap runReporter + fetchPage — even when the caller passes an
  // empty baseDeps (the "full pipeline" mode). Falling back to the real
  // defaults means the runner captures Reporter output and every
  // fetchPage result no matter which mode it runs in. Fix for the run-4
  // "brief.json was NOT written" bug: previously the wrapper omitted these
  // keys when baseDeps didn't provide them, so the orchestrator's own
  // defaults ran unwrapped and the run couldn't be replayed with
  // --from-brief.
  const underlyingReporter = baseDeps.runReporter ?? defaultRunReporter;
  const underlyingFetchPage = baseDeps.fetchPage ?? defaultFetchPage;

  const wrappedReporter = async (
    input: Parameters<NonNullable<OrchestrateDeps['runReporter']>>[0],
  ) => {
    const out = await underlyingReporter(input);
    captured.reporterOutput = out;
    return out;
  };

  const wrappedFetchPage = async (url: string): Promise<FetchPageResult> => {
    const r = await underlyingFetchPage(url);
    if (r.ok) {
      captured.fetchedSources.push({ url: r.url, title: r.title, text: r.text });
    }
    return r;
  };

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
      runReporter: wrappedReporter,
      fetchPage: wrappedFetchPage,
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

  // Substantive-source filter (caption citation set)
  if (debug.substantiveSources) {
    lines.push('## Substantive-source filter (caption "Source:" line)');
    lines.push(`- Threshold: ≥ ${debug.substantiveSources.thresholdChars} chars of fetched text`);
    lines.push(`- Kept: ${debug.substantiveSources.keptCount} | Dropped: ${debug.substantiveSources.droppedCount}`);
    for (const url of debug.substantiveSources.keptUrls) lines.push(`  - ${url}`);
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

  // enforceStructure — deterministic pre-Editor merges / drops. Log every
  // mutation so the reviewer sees what code changed before the model.
  if (debug.enforceStructure) {
    lines.push('## enforceStructure (pre-Editor, deterministic)');
    if (debug.enforceStructure.log.length === 0) {
      lines.push('- No mutations — draft was structurally valid.');
    } else {
      for (const l of debug.enforceStructure.log) lines.push(`- ${l}`);
    }
    if (debug.enforceStructure.needsEditor) {
      const ne = debug.enforceStructure.needsEditor;
      if (ne.kind === 'rhythm') {
        lines.push(`- Left for the Editor: ${ne.violatingPairs.length} unresolved rhythm pair(s) — ${ne.violatingPairs.map(([a, b]) => `SLIDE ${a}+${b}`).join(', ')}`);
      } else {
        lines.push(`- Left for the Editor: variety gap (${ne.distinctKinds} distinct kind(s); needs ≥${ne.needed})`);
      }
    }
    lines.push('');
  }

  // Brief-integrity — unsourced quotes cut from THE STORY before Writer.
  if (debug.briefIntegrity && debug.briefIntegrity.droppedQuotes.length > 0) {
    lines.push('## Brief-integrity (unsourced quotes cut before Writer)');
    for (const d of debug.briefIntegrity.droppedQuotes) {
      lines.push(`- "${d.quote}" — ${d.reason}`);
    }
    lines.push('');
  }

  // Edited (initial editor pass) — kept so reviewers can see what the
  // first pass produced, but the FINAL post lives in the last round's
  // snapshot below, not here.
  if (debug.edited) {
    lines.push('## Editor — INITIAL EDITED POST');
    lines.push(`- Stop reasons: \`${debug.edited.stopReasons.join(', ')}\``);
    lines.push(`- ${formatUsage(debug.edited.usage)}`);
    if (debug.edited.editNotes && debug.edited.editNotes.length > 0) {
      lines.push('- Edit notes:');
      for (const n of debug.edited.editNotes) lines.push(`  - ${n}`);
    }
    lines.push('');
    lines.push('### Slides (initial editor pass — repairs may follow below)');
    lines.push(formatPostWithLengths(debug.edited.post));
    lines.push('');
  }

  // FINAL post — the settled post after every repair (in-round + post-PASS
  // soft-repair). This is what render sees and what the reviewer should
  // audit against the rules. Prefers debug.finalPost (single source of
  // truth added 2026-09-29); falls back to rounds[last] then edited.post
  // for older transcripts.
  {
    const lastRound = debug.rounds.length > 0 ? debug.rounds[debug.rounds.length - 1] : undefined;
    const finalPost = debug.finalPost ?? lastRound?.post ?? debug.edited?.post;
    const finalCaption = debug.finalCaption ?? lastRound?.caption ?? debug.caption?.caption ?? '';
    if (finalPost) {
      lines.push('## FINAL post (after all repairs — what render sees)');
      lines.push(formatPostWithLengths(finalPost));
      lines.push('');
      if (finalCaption) {
        lines.push('### FINAL caption');
        lines.push(`- Character count: **${finalCaption.length}**`);
        lines.push('');
        lines.push('```');
        lines.push(finalCaption.trim());
        lines.push('```');
        lines.push('');
      }
    }
  }

  // Caption (initial pass, kept for cost + repair transparency)
  if (debug.caption) {
    lines.push('## Caption — INITIAL PASS');
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

  // Image step — per-subject result (entity, QID, source, license, size,
  // verified or why removed). Runs on every outcome now (2026-09-29 rule),
  // including needs_human_review, so reviewers see photos + flags together.
  if (debug.imageStep) {
    lines.push('## Image step');
    if ('error' in debug.imageStep && debug.imageStep.error) {
      lines.push(`- Errored: ${debug.imageStep.error}`);
    } else {
      const selected = debug.imageStep.selected ?? [];
      const report = (debug.imageStep.report ?? []) as Array<{
        slide: 'cover' | number;
        requestedSubject: string;
        status: 'picked' | 'type-only';
        reason: string;
        picked?: {
          wikidataId: string;
          label: string;
          commonsFile: string;
          commonsUrl: string;
          license: string;
          author: string;
          storageUrl: string;
          isPortrait: boolean;
          cacheHit: boolean;
        };
      }>;
      lines.push(`- Vision calls: ${debug.imageStep.visionCalls ?? 0}`);
      lines.push(`- Photos placed: ${selected.length}`);
      lines.push('');
      if (report.length === 0) {
        lines.push('- (no photo requests — every slide was type-only from the start)');
      } else {
        for (const r of report) {
          const slideLabel = r.slide === 'cover' ? 'COVER' : `SLIDE ${r.slide}`;
          lines.push(`### ${slideLabel} — requested "${r.requestedSubject}"`);
          if (r.status === 'picked' && r.picked) {
            lines.push(`- Entity: ${r.picked.label} (Wikidata ${r.picked.wikidataId})`);
            lines.push(`- Commons file: ${r.picked.commonsFile}`);
            lines.push(`- Commons page: ${r.picked.commonsUrl}`);
            lines.push(`- License: ${r.picked.license}`);
            lines.push(`- Author: ${r.picked.author}`);
            lines.push(`- Storage URL: ${r.picked.storageUrl}`);
            lines.push(`- Cache hit: ${r.picked.cacheHit ? 'yes' : 'no'}`);
            lines.push(`- Verified: yes — resolved via ${r.picked.commonsFile.startsWith('File:') ? 'Wikidata P18 or Commons P180 (structured)' : 'Wikidata'} → license in allow-list → vision KIND check passed → ${r.picked.storageUrl.startsWith('no-upload:') ? 'test-run URL (no prod upload)' : 'Supabase Storage'}`);
          } else {
            lines.push(`- Status: type-only`);
            lines.push(`- Reason: ${r.reason}`);
          }
          lines.push('');
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
  const { LIMITS, classifySlideType } = require('./code-checks') as typeof import('./code-checks');
  const out: string[] = [];
  const coverText = post.cover.text ?? '';
  out.push(`- **COVER** (${coverText.length} chars, limit ${LIMITS.cover})`);
  out.push(`  - TEXT: ${coverText}`);
  out.push(`  - HIGHLIGHT: ${post.cover.highlight || '(none)'}`);
  out.push(`  - IMAGE: ${post.cover.image || '(none)'}`);
  for (const s of post.slides) {
    out.push(`- **SLIDE ${s.position}** [${classifySlideType(s)}]`);
    if (s.headline) out.push(`  - HEADLINE (${s.headline.length} chars, limit ${LIMITS.headline}): ${s.headline}`);
    if (s.body) out.push(`  - BODY (${s.body.length} chars, limit ${LIMITS.body}): ${s.body}`);
    if (s.bigNumber) out.push(`  - BIG NUMBER (${s.bigNumber.length} chars, limit ${LIMITS.bigNumber}): ${s.bigNumber}`);
    if (s.numberNote) out.push(`  - NUMBER NOTE (${s.numberNote.length} chars, limit ${LIMITS.numberNote}): ${s.numberNote}`);
    if (s.secondNumber) out.push(`  - SECOND NUMBER (${s.secondNumber.length} chars, limit ${LIMITS.secondNumber}): ${s.secondNumber}`);
    if (s.secondNote) out.push(`  - SECOND NOTE (${s.secondNote.length} chars, limit ${LIMITS.secondNote}): ${s.secondNote}`);
    if (s.quote) out.push(`  - QUOTE (${s.quote.length} chars, limit ${LIMITS.quote}): ${s.quote}`);
    if (s.quoteBy) out.push(`  - QUOTE BY (${s.quoteBy.length} chars, limit ${LIMITS.quoteBy}): ${s.quoteBy}`);
    if (s.note) out.push(`  - NOTE (${s.note.length} chars, limit ${LIMITS.note}): ${s.note}`);
    if (s.highlight) out.push(`  - HIGHLIGHT: ${s.highlight}`);
    if (s.image) out.push(`  - IMAGE: ${s.image}`);
  }
  out.push(`- **FOLLOW** (${post.follow.length} chars, limit ${LIMITS.follow}): ${post.follow}`);
  return out.join('\n');
}
