/**
 * Top-level driver for the v2 creator pipeline.
 *
 *   Reporter → source fetch → Writer → Editor → Caption
 *     → code checks → Fact-checker
 *     → fix loop (BIG → Writer; small slide → Editor; small caption → Caption)
 *   Round limit: 3 total (initial check + 2 fix rounds).
 *
 * Runs on Sonnet 4.6 for every stage (env override `HELIOS_EDITORIAL_MODEL`).
 * Every stage's raw output goes into `pipeline_v2_debug` so a bad post's
 * root cause is visible without a re-run. If the per-run cost cap (default
 * $1.50, env `HELIOS_V2_MAX_COST_USD`) trips before completion, the run
 * stops and the post goes to `needs_human_review` with the partial
 * transcript intact.
 */

import { adaptToPost } from './adapter';
import { checkCaption, checkNumberTrace, checkPost, partitionErrors, renderLengthsBlock, type CheckError } from './code-checks';
import { runCaption as defaultRunCaption, type CaptionInput, type CaptionOutput } from './caption';
import { runEditor as defaultRunEditor, type EditorInput, type EditorOutput } from './editor';
import { runFactChecker as defaultRunFactChecker, type FactCheckerInput, type FactCheckerOutput } from './fact-checker';
import { runReporter as defaultRunReporter, type ReporterInput, type ReporterOutput } from './reporter';
import { runWriter as defaultRunWriter, type WriterInput, type WriterOutput, type FetchedSource } from './writer';
import { fetchPage as defaultFetchPage, type FetchPageResult } from './tools/fetch-page';
import type {
  Brief,
  FactCheckFlag,
  FactCheckResult,
  ParsedPost,
} from './parse';
import { persistDebugAndCompose as defaultPersistDebugAndCompose } from './log';
import type { PipelineV2Debug, StageUsage } from './log';
import {
  rewriteBriefSources,
  rewriteBriefWithValidatedImages,
  validateBriefImages as defaultValidateBriefImages,
  type ValidationResult,
} from './validate-images';

/**
 * Dependency-injection surface. Real usage takes the defaults; unit tests
 * pass canned stage outputs so they run without any live API or DB access.
 */
export type OrchestrateDeps = {
  runReporter: (input: ReporterInput) => Promise<ReporterOutput>;
  runWriter: (input: WriterInput) => Promise<WriterOutput>;
  runEditor: (input: EditorInput) => Promise<EditorOutput>;
  runCaption: (input: CaptionInput) => Promise<CaptionOutput>;
  runFactChecker: (input: FactCheckerInput) => Promise<FactCheckerOutput>;
  fetchPage: (url: string) => Promise<FetchPageResult>;
  validateBriefImages: (brief: Brief) => Promise<ValidationResult>;
  persistDebugAndCompose: typeof defaultPersistDebugAndCompose;
};

const defaultDeps: OrchestrateDeps = {
  runReporter: defaultRunReporter,
  runWriter: defaultRunWriter,
  runEditor: defaultRunEditor,
  runCaption: defaultRunCaption,
  runFactChecker: defaultRunFactChecker,
  fetchPage: defaultFetchPage,
  validateBriefImages: defaultValidateBriefImages,
  persistDebugAndCompose: defaultPersistDebugAndCompose,
};

export type OrchestrateRow = {
  id: string;
  source: string;
  source_url: string;
  headline: string;
  body: string;
  published_at: Date | string | null;
};

export type OrchestrateOptions = {
  /** Regenerate from an existing EDITED POST with human editor's critique. */
  reviewerNotes?: string;
  /** Previous EDITED POST when reviewerNotes is set (from pipeline_v2_debug). */
  previousEditedPostRaw?: string;
  /** Previous CAPTION when reviewerNotes is set (from pipeline_v2_debug). */
  previousCaptionRaw?: string;
  /** Force a fresh Reporter run even if a brief was already stored. Not used yet. */
  force?: boolean;
};

export type OrchestrateResult = {
  ok: boolean;
  status: 'shipped' | 'needs_human_review' | 'failed';
  reason?: string;
  slug?: string;
  costUsd: number;
  stagesRun: string[];
  previewUrl?: string;
};

/**
 * Read at call time (not module load) so `HELIOS_V2_MAX_COST_USD` set by the
 * test-runner script AFTER this module is imported still takes effect.
 */
function getMaxCostUsd(): number {
  return Number(process.env.HELIOS_V2_MAX_COST_USD ?? '1.5');
}
const MAX_FACT_CHECK_ROUNDS = 3;
/**
 * Per-stage repair budget inside one round. Handoff §Orchestration rules
 * — code-check failures give the Editor (for slides) and the Caption stage
 * up to this many tries per round; still-failing = bail to human review.
 * Doubled from the original 1 after the second live Bloomberg run showed
 * Sonnet often needed a second pass to actually hit the character targets.
 */
const MAX_REPAIRS_PER_STAGE_PER_ROUND = 2;

/**
 * Minimum fetched-text length (chars) for a source to count as
 * "substantive" — full article, not a paywall preview. Only substantive
 * sources appear in the caption's "Source:" line so readers aren't sent
 * to an outlet whose text we couldn't actually verify against.
 * 1500 chars is roughly 250 words = 4-5 real paragraphs; paywall
 * previews on Bloomberg / Forbes / WSJ typically ship 300-800 chars.
 * Env-tunable.
 */
function getSubstantiveSourceMinChars(): number {
  return Number(process.env.HELIOS_V2_MIN_SOURCE_CHARS ?? '1500');
}

export async function runCreatorPipeline(
  row: OrchestrateRow,
  opts: OrchestrateOptions = {},
  depsOverride: Partial<OrchestrateDeps> = {},
): Promise<OrchestrateResult> {
  const deps: OrchestrateDeps = { ...defaultDeps, ...depsOverride };
  const startedAt = new Date().toISOString();
  const stagesRun: string[] = [];
  let costUsd = 0;

  const debug: PipelineV2Debug = {
    version: 2,
    articleId: row.id,
    startedAt,
    rounds: [],
    repairs: [],
    outcome: { status: 'failed', totalCostUsd: 0 },
  };

  const addCost = (u: StageUsage) => {
    costUsd += u.approxCostUsd;
  };
  const overCap = () => costUsd >= getMaxCostUsd();

  const bailToHumanReview = async (reason: string): Promise<OrchestrateResult> => {
    debug.finishedAt = new Date().toISOString();
    debug.outcome = { status: 'needs_human_review', reason, totalCostUsd: round4(costUsd) };
    await deps.persistDebugAndCompose(row.id, debug, { composeStatus: 'needs_human_review', composeError: reason });
    return { ok: false, status: 'needs_human_review', reason, costUsd: round4(costUsd), stagesRun };
  };
  const bailFailed = async (reason: string): Promise<OrchestrateResult> => {
    debug.finishedAt = new Date().toISOString();
    debug.outcome = { status: 'failed', reason, totalCostUsd: round4(costUsd) };
    await deps.persistDebugAndCompose(row.id, debug, { composeStatus: 'compose_failed', composeError: reason });
    return { ok: false, status: 'failed', reason, costUsd: round4(costUsd), stagesRun };
  };

  // ── 1. Reporter ────────────────────────────────────────────────────
  const reporterResult = await deps.runReporter({
    url: row.source_url,
    articleText: row.body,
    headline: row.headline,
    source: row.source,
  });
  addCost(reporterResult.usage);
  stagesRun.push('reporter');
  debug.reporter = {
    brief: reporterResult.brief,
    briefRaw: reporterResult.briefRaw,
    stopReasons: reporterResult.stopReasons,
    usage: reporterResult.usage,
  };

  if (!reporterResult.briefRaw || reporterResult.brief.sources.length === 0) {
    return bailToHumanReview('reporter produced no SOURCES');
  }
  if (overCap()) return bailToHumanReview('cost cap reached after Reporter');

  // ── 2. Fetch every SOURCES URL for downstream stages ───────────────
  const sourceTexts: FetchedSource[] = [];
  debug.sources = [];
  for (const s of reporterResult.brief.sources) {
    if (!s.url) continue;
    const r = await deps.fetchPage(s.url);
    debug.sources.push({
      url: s.url,
      resolvedUrl: r.ok ? r.resolvedUrl : undefined,
      ok: r.ok,
      error: r.ok ? undefined : r.error,
      textPreview: r.ok ? r.text.slice(0, 500) : undefined,
      length: r.ok ? r.text.length : undefined,
    });
    if (r.ok) {
      sourceTexts.push({ url: s.url, title: r.title, text: r.text });
    }
  }
  if (sourceTexts.length === 0) {
    return bailToHumanReview('no SOURCES could be fetched');
  }

  // ── 2b. Validate brief images before Writer sees them ────────────────
  // HEAD each Link to confirm it returns an image/*; drop entries whose
  // Credit reads as an instruction ("check the source", "TBD"). Downstream
  // stages get a brief where dropped images are gone and, if none survive,
  // the IMAGES section reads "None found".
  const imageValidation = await deps.validateBriefImages(reporterResult.brief);
  debug.imageValidation = {
    kept: imageValidation.valid.map((img) => ({
      number: img.number,
      link: img.link,
      credit: img.credit,
    })),
    dropped: imageValidation.dropped.map((d) => ({
      number: d.image.number,
      link: d.image.link,
      credit: d.image.credit,
      reason: d.reason,
    })),
  };

  // finalBrief / finalBriefRaw — the ONLY brief that reaches Writer, Editor,
  // Caption, Fact-checker. sanitizedBriefRaw has SINGLE STORY collapsed to
  // yes/no (no sibling-story leak), and rewriteBriefWithValidatedImages
  // renders IMAGES from the validated set (or "None found").
  const finalBrief: Brief = { ...reporterResult.brief, images: imageValidation.valid };
  const finalBriefRaw = rewriteBriefWithValidatedImages(
    reporterResult.sanitizedBriefRaw,
    imageValidation.valid,
  );

  // Estimate the characters of image credits the publish pipeline appends to
  // the caption. Used by both the LENGTHS block for the Editor and the
  // caption code-check.
  const creditsEstimate = estimateCreditsChars(imageValidation.valid);

  // ── 2c. Filter substantive sources for the Caption's "Source:" line ──
  // Every fetched source is fine for Writer/Editor/Fact-checker — they use
  // the full text bodies for factual verification. But the caption's
  // "Source:" line credits outlets to readers, and it shouldn't cite an
  // outlet whose fetched text was just a paywall preview we couldn't
  // actually verify against. Filter to sources whose fetched text passed
  // getSubstantiveSourceMinChars() (default 1500 chars).
  const substantiveMinChars = getSubstantiveSourceMinChars();
  const substantiveUrls = new Set(
    sourceTexts.filter((s) => s.text.length >= substantiveMinChars).map((s) => s.url),
  );
  const substantiveSources = finalBrief.sources.filter((s) => s.url && substantiveUrls.has(s.url));
  const captionBriefRaw = rewriteBriefSources(finalBriefRaw, substantiveSources);
  debug.substantiveSources = {
    thresholdChars: substantiveMinChars,
    keptCount: substantiveSources.length,
    droppedCount: finalBrief.sources.length - substantiveSources.length,
    keptUrls: substantiveSources.map((s) => s.url),
  };

  // ── 3. Writer — first pass, OR reviewer-notes rerun ────────────────
  let writerRaw: string;
  let writerPost: ParsedPost;
  if (opts.reviewerNotes && opts.previousEditedPostRaw) {
    const w = await deps.runWriter({
      brief: finalBrief,
      briefRaw: finalBriefRaw,
      sourceTexts,
      previousPost: opts.previousEditedPostRaw,
      reviewerNotes: opts.reviewerNotes,
    });
    writerRaw = w.raw;
    writerPost = w.post;
    addCost(w.usage);
    stagesRun.push('writer(reviewer-notes)');
    debug.draft = { post: w.post, raw: w.raw, stopReasons: w.stopReasons, usage: w.usage };
  } else {
    const w = await deps.runWriter({
      brief: finalBrief,
      briefRaw: finalBriefRaw,
      sourceTexts,
    });
    writerRaw = w.raw;
    writerPost = w.post;
    addCost(w.usage);
    stagesRun.push('writer');
    debug.draft = { post: w.post, raw: w.raw, stopReasons: w.stopReasons, usage: w.usage };
  }
  if (overCap()) return bailToHumanReview('cost cap reached after Writer');

  // ── 4. Editor — first pass on the draft ────────────────────────────
  let editorRaw: string;
  let editorPost: ParsedPost;
  {
    const e = await deps.runEditor({
      brief: finalBrief,
      briefRaw: finalBriefRaw,
      sourceTexts,
      post: writerRaw,
      // Lengths from the writer's draft — no caption yet.
      lengthsBlock: renderLengthsBlock(writerPost, null, 0),
    });
    editorRaw = e.raw;
    editorPost = e.post;
    addCost(e.usage);
    stagesRun.push('editor');
    debug.edited = { post: e.post, raw: e.raw, editNotes: e.editNotes, stopReasons: e.stopReasons, usage: e.usage };
  }
  if (overCap()) return bailToHumanReview('cost cap reached after Editor');

  // ── 5. Caption — first pass ────────────────────────────────────────
  let captionRaw: string;
  let captionText: string;
  {
    const c = await deps.runCaption({
      brief: finalBrief,
      briefRaw: captionBriefRaw,
      slides: editorRaw,
    });
    captionRaw = c.raw;
    captionText = c.caption;
    addCost(c.usage);
    stagesRun.push('caption');
    debug.caption = { caption: c.caption, raw: c.raw, stopReasons: c.stopReasons, usage: c.usage };
  }
  if (overCap()) return bailToHumanReview('cost cap reached after Caption');

  // ── 6. Loop: code checks → Fact-checker → fix routing (max 3 rounds) ─
  //
  // Errors are partitioned into HARD (banned voice, number trace, image ref,
  // caption hashtag, slide count) and SOFT (char_limit, highlight_substring).
  // Hard errors that survive the round's repair budget bail immediately.
  // Soft errors that survive don't stop the round — the pipeline continues
  // to the Fact-checker and, at the end, blocks shipping via a
  // needs_human_review terminal state that lists them. Handoff §Orchestration
  // rules.
  let round = 0;
  let lastVerdict: FactCheckResult | null = null;

  // (creditsEstimate was computed earlier, right after image validation, so
  // the initial Editor call can use it too. See §2b.)

  while (round < MAX_FACT_CHECK_ROUNDS) {
    round++;
    if (overCap()) return bailToHumanReview(`cost cap reached during round ${round}`);

    // 6a. Compute code-check errors, split into slide vs caption.
    const computeErrors = () => {
      const slideCheck = checkPost(editorPost, finalBrief);
      const captionCheck = checkCaption(captionText, creditsEstimate);
      const numberCheck = checkNumberTrace(editorPost, captionText, sourceTexts.map((s) => s.text));
      return {
        slideErrors: [...slideCheck.errors, ...numberCheck.errors.filter((e) => e.target !== 'caption')],
        captionErrors: [...captionCheck.errors, ...numberCheck.errors.filter((e) => e.target === 'caption')],
      };
    };
    let { slideErrors, captionErrors } = computeErrors();

    // 6a.i Slide-level repair — up to MAX_REPAIRS_PER_STAGE_PER_ROUND tries.
    for (
      let slideAttempt = 1;
      slideErrors.length > 0 && slideAttempt <= MAX_REPAIRS_PER_STAGE_PER_ROUND;
      slideAttempt++
    ) {
      const eRetry = await deps.runEditor({
        brief: finalBrief,
        briefRaw: finalBriefRaw,
        sourceTexts,
        post: editorRaw,
        lengthsBlock: renderLengthsBlock(editorPost, captionText, creditsEstimate),
        checkErrors: slideErrors,
      });
      addCost(eRetry.usage);
      stagesRun.push(`editor(check-errors r${round}.${slideAttempt})`);
      debug.repairs.push({
        round,
        stage: 'editor',
        reason: `${slideErrors.length} slide error(s), try ${slideAttempt}/${MAX_REPAIRS_PER_STAGE_PER_ROUND}`,
        usage: eRetry.usage,
      });
      editorRaw = eRetry.raw;
      editorPost = eRetry.post;
      if (overCap()) return bailToHumanReview(`cost cap reached during round ${round} slide repair`);
      ({ slideErrors, captionErrors } = computeErrors());
    }

    // 6a.ii Caption-level repair — up to MAX_REPAIRS_PER_STAGE_PER_ROUND tries.
    for (
      let captionAttempt = 1;
      captionErrors.length > 0 && captionAttempt <= MAX_REPAIRS_PER_STAGE_PER_ROUND;
      captionAttempt++
    ) {
      const cRetry = await deps.runCaption({
        brief: finalBrief,
        briefRaw: captionBriefRaw,
        slides: editorRaw,
        previousCaption: captionRaw,
        checkErrors: captionErrors,
      });
      addCost(cRetry.usage);
      stagesRun.push(`caption(fix-notes r${round}.${captionAttempt})`);
      debug.repairs.push({
        round,
        stage: 'caption',
        reason: `${captionErrors.length} caption error(s), try ${captionAttempt}/${MAX_REPAIRS_PER_STAGE_PER_ROUND}`,
        usage: cRetry.usage,
      });
      captionRaw = cRetry.raw;
      captionText = cRetry.caption;
      if (overCap()) return bailToHumanReview(`cost cap reached during round ${round} caption repair`);
      ({ slideErrors, captionErrors } = computeErrors());
    }

    // 6a.iii Final code check after the repair budget is spent.
    // HARD errors (banned, numbers, images, hashtags, slide count) still
    // stop the run — the post can't safely reach fact-check with those.
    // SOFT errors (char_limit, highlight_substring) don't block — record
    // them and continue to the Fact-checker; the final gate at the end
    // of the pipeline will bail to needs_human_review if any survive.
    {
      const slidePartition = partitionErrors(slideErrors);
      const captionPartition = partitionErrors(captionErrors);
      const hardStill = [...slidePartition.hard, ...captionPartition.hard];
      if (hardStill.length > 0) {
        debug.rounds.push({
          round,
          post: editorPost,
          caption: captionText,
          codeCheckErrorsBeforeFactCheck: hardStill.filter((e) => e.kind !== 'number_trace'),
          captionCheckErrorsBeforeFactCheck: [], // now merged into codeCheckErrorsBeforeFactCheck
          numberTraceErrorsBeforeFactCheck: hardStill.filter((e) => e.kind === 'number_trace'),
          factCheck: { verdict: 'FLAGGED', flags: [] },
          factCheckRaw: '(skipped — persistent hard code-check failures)',
          stopReasons: [],
          usage: emptyUsage(),
        });
        return bailToHumanReview(
          `hard code checks failed after ${MAX_REPAIRS_PER_STAGE_PER_ROUND} tries per stage in round ${round}: ${hardStill.map((e) => e.message).join(' | ')}`,
        );
      }
      // Soft errors don't block the round. They'll be re-checked at the
      // final gate after the fact-check loop ends.
    }

    // 6b. Fact-checker.
    const fc = await deps.runFactChecker({
      brief: finalBrief,
      briefRaw: finalBriefRaw,
      sourceTexts,
      post: editorRaw,
      caption: captionText,
    });
    addCost(fc.usage);
    stagesRun.push(`fact-checker(r${round})`);
    lastVerdict = fc.result;
    debug.rounds.push({
      round,
      post: editorPost,
      caption: captionText,
      factCheck: fc.result,
      factCheckRaw: fc.raw,
      stopReasons: fc.stopReasons,
      usage: fc.usage,
    });

    if (fc.result.verdict === 'PASS') {
      break;
    }

    // FLAGGED. Route the flags per §The fact-check loop.
    const hasBig = fc.result.flags.some((f) => f.size === 'BIG');
    if (round >= MAX_FACT_CHECK_ROUNDS) {
      return bailToHumanReview(`fact-check FLAGGED after ${MAX_FACT_CHECK_ROUNDS} rounds`);
    }
    if (overCap()) return bailToHumanReview(`cost cap reached during round ${round} routing`);

    if (hasBig) {
      // Any BIG → Writer with PREVIOUS POST + every flag.
      const w = await deps.runWriter({
        brief: finalBrief,
        briefRaw: finalBriefRaw,
        sourceTexts,
        previousPost: editorRaw,
        factCheckFlags: fc.result.flags,
      });
      addCost(w.usage);
      stagesRun.push(`writer(fact-check r${round})`);
      debug.repairs.push({ round, stage: 'writer', reason: 'BIG fact-check flag', usage: w.usage });
      writerRaw = w.raw;
      writerPost = w.post;
      if (overCap()) return bailToHumanReview(`cost cap reached during round ${round} Writer rerun`);
      // Rerun Editor + Caption on the new draft.
      const e = await deps.runEditor({
        brief: finalBrief,
        briefRaw: finalBriefRaw,
        sourceTexts,
        post: writerRaw,
        lengthsBlock: renderLengthsBlock(writerPost, captionText, creditsEstimate),
      });
      addCost(e.usage);
      stagesRun.push(`editor(post-writer r${round})`);
      editorRaw = e.raw;
      editorPost = e.post;
      if (overCap()) return bailToHumanReview(`cost cap reached during round ${round} Editor rerun`);
      const c = await deps.runCaption({
        brief: finalBrief,
        briefRaw: captionBriefRaw,
        slides: editorRaw,
      });
      addCost(c.usage);
      stagesRun.push(`caption(post-writer r${round})`);
      captionRaw = c.raw;
      captionText = c.caption;
    } else {
      // Only SMALL. Split slide vs caption.
      const slideFlags = fc.result.flags.filter((f) => !isCaptionFlag(f));
      const captionFlags = fc.result.flags.filter(isCaptionFlag);
      if (slideFlags.length > 0) {
        const e = await deps.runEditor({
          brief: finalBrief,
          briefRaw: finalBriefRaw,
          sourceTexts,
          post: editorRaw,
          lengthsBlock: renderLengthsBlock(editorPost, captionText, creditsEstimate),
          factCheckFlags: slideFlags,
        });
        addCost(e.usage);
        stagesRun.push(`editor(fact-check r${round})`);
        debug.repairs.push({ round, stage: 'editor', reason: `${slideFlags.length} small slide flag(s)`, usage: e.usage });
        editorRaw = e.raw;
        editorPost = e.post;
        if (overCap()) return bailToHumanReview(`cost cap reached during round ${round} Editor small-flag rerun`);
      }
      if (captionFlags.length > 0) {
        const c = await deps.runCaption({
          brief: finalBrief,
          briefRaw: captionBriefRaw,
          slides: editorRaw,
          previousCaption: captionRaw,
          factCheckFlags: captionFlags,
        });
        addCost(c.usage);
        stagesRun.push(`caption(fact-check r${round})`);
        debug.repairs.push({ round, stage: 'caption', reason: `${captionFlags.length} small caption flag(s)`, usage: c.usage });
        captionRaw = c.raw;
        captionText = c.caption;
      }
    }
  }

  if (!lastVerdict || lastVerdict.verdict !== 'PASS') {
    return bailToHumanReview('fact-check did not converge on PASS');
  }

  // ── 6c. Final soft-error gate. char_limit / highlight_substring errors
  // were allowed to survive the round-level bailout (§Orchestration rules
  // — soft errors don't stop the fact-check loop). If any survive to
  // here, the post must not ship: bail to needs_human_review with the
  // outstanding errors listed. Hard errors shouldn't be possible here
  // because we bail on them mid-loop, but check defensively.
  {
    const finalSlideCheck = checkPost(editorPost, finalBrief);
    const finalCaptionCheck = checkCaption(captionText, creditsEstimate);
    const finalNumberCheck = checkNumberTrace(editorPost, captionText, sourceTexts.map((s) => s.text));
    const allErrors = [
      ...finalSlideCheck.errors,
      ...finalCaptionCheck.errors,
      ...finalNumberCheck.errors,
    ];
    const { hard: finalHard, soft: finalSoft } = partitionErrors(allErrors);
    if (finalHard.length > 0) {
      return bailToHumanReview(
        `hard code checks unexpectedly survived to final gate: ${finalHard.map((e) => e.message).join(' | ')}`,
      );
    }
    if (finalSoft.length > 0) {
      const roundsRan = round;
      const roundNoun = roundsRan === 1 ? 'round' : 'rounds';
      return bailToHumanReview(
        `char_limit / highlight_substring errors survived every repair try across ${roundsRan} ${roundNoun}:\n${finalSoft.map((e) => e.message).join('\n')}`,
      );
    }
  }

  // ── 7. Adapt to Post + persist ──────────────────────────────────────
  const publishedIso = toIso(row.published_at);
  const dayStamp = Math.floor(Date.now() / 86_400_000) - 20_000;
  const post = adaptToPost({
    brief: finalBrief,
    post: editorPost,
    caption: captionText,
    articlePublishedAt: publishedIso,
    issueNumber: dayStamp,
  });

  // Guard: any slide with photoUrl but no photoCredit → don't ship.
  for (const slide of post.slides) {
    if (slide.photoUrl && !slide.photoCredit) {
      return bailToHumanReview(`slide ${slide.position} has photoUrl without photoCredit`);
    }
  }

  const slug = `${slugify(row.source)}-${slugify(row.headline).slice(0, 40)}-${row.id.slice(0, 8)}`;

  debug.finishedAt = new Date().toISOString();
  debug.outcome = { status: 'shipped', totalCostUsd: round4(costUsd) };
  await deps.persistDebugAndCompose(row.id, debug, {
    renderPostJson: post,
    renderSlug: slug,
    composeStatus: 'composed',
  });

  return {
    ok: true,
    status: 'shipped',
    slug,
    costUsd: round4(costUsd),
    stagesRun,
    previewUrl: `/social/render/preview?generated=${slug}&all=1`,
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function isCaptionFlag(f: FactCheckFlag): boolean {
  return /^\s*CAPTION\b/i.test(f.where);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function toIso(v: Date | string | null | undefined): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  return v;
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function emptyUsage(): StageUsage {
  return { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, approxCostUsd: 0 };
}

/**
 * Estimate the character count of the image-credit block the publish
 * pipeline will append to the caption. Over-counts (assumes every
 * validated brief image ends up used); safe direction to err in for
 * a length cap. Empty list → 0.
 */
function estimateCreditsChars(images: Array<{ credit: string }>): number {
  if (images.length === 0) return 0;
  const header = '\n\nPhotos:\n'.length;
  const body = images.reduce((sum, img) => sum + img.credit.length + 1, 0); // +1 = "\n"
  return header + body;
}
