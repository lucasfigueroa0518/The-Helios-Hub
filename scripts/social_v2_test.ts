/**
 * Local test runner for the v2 pipeline.
 *
 *   npm run social:v2:test -- --article <id>
 *   npm run social:v2:test -- --article <id> --from-brief runs/<ts>/brief.json
 *   npm run social:v2:test -- --article <id> --max-cost 0.75
 *
 * Reads the article from prod DB (SELECT only). Writes NOTHING to DB — the
 * pipeline's persistDebugAndCompose is intercepted and its would-be write is
 * captured to disk instead. Outputs land in runs/<ISO-timestamp>/ :
 *
 *   transcript.json  — captured debug + result + would-be render_post_json
 *   summary.md       — readable review: brief, slides w/ char counts, caption,
 *                      every code-check error, every fact-check round, costs
 *   brief.json       — reporterOutput + fetched source texts (for --from-brief)
 *
 * Cost cap defaults to $1.50 per run (override with --max-cost). If the cap
 * trips mid-run, the orchestrator bails to needs_human_review as it would
 * in production — the runner still writes whatever was captured.
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

// Load .env.local BEFORE any lib import that reads process.env (Anthropic
// client, pg pool). Same pattern as scripts/social_ingest.ts and the
// apply_*_migration.js scripts. Runs at import time so process.env is
// populated before the dynamic imports inside main() evaluate.
{
  const root = path.resolve(__dirname, '..');
  const envPath = path.join(root, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/\r$/, '');
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      article: { type: 'string' },
      // Comma-separated list of article ids. When set, the runner loops
      // over each id, runs the full pipeline, and writes a batch
      // scorecard.md under runs/batch-<ts>/.
      articles: { type: 'string' },
      'from-brief': { type: 'string' },
      'max-cost': { type: 'string' },
      inject: { type: 'string' },
      'render-preview': { type: 'boolean' },
      'preview-only': { type: 'string' },
      'preview-server': { type: 'string' },
      // Safety guard (2026-09-29): explicit acknowledgement that the run
      // must not write to any DB. The test runner already suppresses
      // persistDebugAndCompose via wrapDepsForCapture, but the flag makes
      // it visible in every invocation. Required for --article / --articles
      // runs; if omitted, the runner exits with a warning listing the
      // suppressed columns.
      'no-persist': { type: 'boolean' },
    },
    strict: true,
    allowPositionals: false,
  });

  const articleId = values.article;
  const articlesCsv = values.articles;
  const fromBriefPath = values['from-brief'];
  const maxCostArg = values['max-cost'];
  const injectSentence = values.inject;
  const renderPreview = values['render-preview'] === true;
  const previewOnlyDir = values['preview-only'];
  const previewServer = values['preview-server'];
  const noPersist = values['no-persist'] === true;

  // --preview-only mode: skip DB + pipeline entirely, just render an
  // existing run's captured post to PNGs. Zero LLM cost, zero DB access.
  if (previewOnlyDir) {
    const { renderPreviewFromRunDir } = await import('@/lib/social/editorial/v2/render-preview');
    console.log(`Preview-only mode — rendering ${previewOnlyDir}`);
    const r = await renderPreviewFromRunDir(previewOnlyDir, previewServer);
    if (!r.ok) {
      console.error(`Preview render failed: ${r.reason}`);
      process.exit(1);
    }
    console.log(`Wrote ${r.slideCount} slide PNG(s) to ${path.relative(process.cwd(), r.outDir)}/`);
    if (r.overflowSlides.length > 0) {
      console.log(`  ⚠ Body overflowed on ${r.overflowSlides.length} slide(s): ${r.overflowSlides.map((n) => n + 1).join(', ')} — those PNGs carry a red OVERFLOW badge and need human review.`);
    }
    process.exit(0);
  }

  if (!articleId && !articlesCsv) {
    console.error('Usage: npm run social:v2:test -- --article <uuid> [--from-brief runs/<ts>/brief.json] [--max-cost 1.5] [--inject "<sentence>"] [--render-preview] --no-persist');
    console.error('   or: npm run social:v2:test -- --articles <uuid>,<uuid>,... [--max-cost 1.5] [--render-preview] --no-persist');
    console.error('   or: npm run social:v2:test -- --preview-only runs/<ts>');
    process.exit(2);
  }

  // Safety: refuse to start a pipeline run without an explicit --no-persist
  // acknowledgement. Test runs must not touch any DB (the current dev
  // .env.local points at production Supabase, so an accidental write would
  // land on prod). The runner still suppresses writes via
  // wrapDepsForCapture — this guard forces the operator to say so.
  //
  // --no-persist also blocks the image step's Supabase Storage upload and
  // helios_social.image_cache DB write (via HELIOS_V2_NO_STORAGE_UPLOAD=1)
  // — storage.ts and cache.ts check this env var. Set it BEFORE the
  // dynamic imports so downstream modules see it.
  if (noPersist) {
    process.env.HELIOS_V2_NO_STORAGE_UPLOAD = '1';
  }
  if (!noPersist) {
    console.error('ABORT: pipeline runs must be invoked with --no-persist.');
    console.error('Test runs never write to any database. Every column the pipeline');
    console.error("would set on helios_social.article_queue (pipeline_v2_debug,");
    console.error('render_post_json, render_slug, compose_status, compose_error,');
    console.error('review_status, review_note, reviewed_at, reviewed_by) stays local:');
    console.error('the persistDebugAndCompose call is intercepted and its inputs are');
    console.error('written to runs/<ts>/transcript.json instead.');
    console.error('');
    console.error('If you want writes to land in a DB, set up a dev Supabase project,');
    console.error('point DATABASE_URL / DIRECT_DATABASE_URL at it, and run the');
    console.error('production ingest / review UI flow directly — not this test runner.');
    process.exit(3);
  }

  // Set cost cap BEFORE importing orchestrate — its getMaxCostUsd() reads
  // process.env at call time so this order isn't strictly required, but
  // it's more obvious what's going on.
  if (maxCostArg !== undefined) {
    process.env.HELIOS_V2_MAX_COST_USD = maxCostArg;
  }

  // Dynamic imports so the cost-cap env is set before the orchestrator's
  // deps snapshot might latch anything.
  const { runCreatorPipeline } = await import('@/lib/social/editorial/v2/orchestrate');
  const { dbQuery } = await import('@/lib/db');
  const {
    buildFromBriefDeps,
    buildSummaryMarkdown,
    wrapDepsForCapture,
  } = await import('@/lib/social/editorial/v2/test-runner-support');
  const { partitionErrors, checkPost, checkQuotes, checkNumberTrace, classifySlideType } = await import('@/lib/social/editorial/v2/code-checks');

  // ── Batch mode: --articles <id>,<id>,... ─────────────────────────────
  if (articlesCsv) {
    const ids = articlesCsv.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      console.error('No article ids parsed from --articles');
      process.exit(2);
    }
    const batchId = `batch-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const batchDir = path.join(process.cwd(), 'runs', batchId);
    await fsp.mkdir(batchDir, { recursive: true });
    console.log(`Batch mode — ${ids.length} article${ids.length === 1 ? '' : 's'} → ${path.relative(process.cwd(), batchDir)}/`);
    console.log(`Cost cap per article: $${maxCostArg ?? '1.5'}`);
    console.log('');

    type Score = Awaited<ReturnType<typeof runOne>> | { error: string; articleId: string };
    const scores: Score[] = [];
    for (const id of ids) {
      console.log(`── ${id} ─────────────────────────────`);
      try {
        const s = await runOne(id, {
          batchDir, previewServer, renderPreview,
          fromBriefPath: undefined, injectSentence: undefined,
          runCreatorPipeline, dbQuery,
          buildFromBriefDeps, buildSummaryMarkdown, wrapDepsForCapture,
          partitionErrors, checkPost, checkQuotes, checkNumberTrace, classifySlideType,
        });
        scores.push(s);
      } catch (err) {
        console.error(`  ✖ ${err instanceof Error ? err.message : String(err)}`);
        scores.push({ error: err instanceof Error ? err.message : String(err), articleId: id });
      }
      console.log('');
    }

    const scorecard = buildBatchScorecard(scores, batchId);
    await fsp.writeFile(path.join(batchDir, 'scorecard.md'), scorecard, 'utf-8');
    console.log(`Scorecard → ${path.relative(process.cwd(), path.join(batchDir, 'scorecard.md'))}`);
    process.exit(0);
  }

  // ── Single-article mode ──────────────────────────────────────────────
  await runOne(articleId!, {
    batchDir: undefined,
    previewServer, renderPreview,
    fromBriefPath, injectSentence,
    runCreatorPipeline, dbQuery,
    buildFromBriefDeps, buildSummaryMarkdown, wrapDepsForCapture,
    partitionErrors, checkPost, checkQuotes, checkNumberTrace, classifySlideType,
  });
  process.exit(0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Deps = any;

type RunOneOptions = {
  batchDir?: string | undefined;
  previewServer: string | undefined;
  renderPreview: boolean;
  fromBriefPath: string | undefined;
  injectSentence: string | undefined;
  runCreatorPipeline: Deps;
  dbQuery: Deps;
  buildFromBriefDeps: Deps;
  buildSummaryMarkdown: Deps;
  wrapDepsForCapture: Deps;
  partitionErrors: Deps;
  checkPost: Deps;
  checkQuotes: Deps;
  checkNumberTrace: Deps;
  classifySlideType: Deps;
};

type BatchScore = {
  articleId: string;
  source: string;
  headline: string;
  status: string;
  reason?: string;
  costUsd: number;
  storySlideCount: number;
  slideKinds: string[];
  photos: Array<{ slide: string; subject: string; wikidataId: string; commonsFile: string; license: string }>;
  otherStoryFlags: Array<{ where: string; text: string; sourcesSay: string }>;
  lengthErrors: string[];
  quoteCheck: 'ok' | 'failed' | 'no-quotes';
  factCheckVerdict: string | null;
};

async function runOne(articleId: string, o: RunOneOptions): Promise<BatchScore> {
  // Load article (SELECT only — no writes).
  type Row = {
    id: string;
    source: string;
    source_url: string;
    headline: string;
    body: string;
    published_at: Date | string | null;
  };
  const { rows } = await o.dbQuery(
    `SELECT id, source, source_url, headline, body, published_at
       FROM helios_social.article_queue
      WHERE id = $1`,
    [articleId],
  );
  const row = rows[0] as Row | undefined;
  if (!row) throw new Error(`Article ${articleId} not found`);
  if (!row.body || row.body.length < 200) {
    throw new Error(`Article ${articleId} body too thin (${row.body?.length ?? 0} chars, need ≥ 200)`);
  }

  // Runs dir with ISO timestamp — safe for filesystem across OSes. In
  // batch mode each per-article run lives inside runs/batch-<ts>/<runId>/.
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = o.batchDir
    ? path.join(o.batchDir, runId)
    : path.join(process.cwd(), 'runs', runId);
  await fsp.mkdir(runDir, { recursive: true });

  const fromBriefPath = o.fromBriefPath;
  const injectSentence = o.injectSentence;
  const previewServer = o.previewServer;
  const renderPreview = o.renderPreview;
  const {
    runCreatorPipeline, buildFromBriefDeps, buildSummaryMarkdown,
    wrapDepsForCapture, partitionErrors, checkPost, checkQuotes,
    checkNumberTrace, classifySlideType,
  } = o;

  console.log(`Article: ${row.id} — ${row.headline}`);
  console.log(`Run dir: ${runDir}`);
  console.log(`Cost cap: $${process.env.HELIOS_V2_MAX_COST_USD ?? '1.5'}`);
  console.log(`--no-persist: ON (DB writes suppressed)`);

  // If --from-brief, load the cached brief and stub Reporter+fetchPage.
  let baseDeps: Awaited<ReturnType<typeof buildFromBriefDeps>> | Record<string, never> = {};
  let usedFromBrief = false;
  if (fromBriefPath) {
    const cached = JSON.parse(await fsp.readFile(fromBriefPath, 'utf-8'));
    baseDeps = buildFromBriefDeps(cached);
    usedFromBrief = true;
    console.log(`Loaded cached brief: ${fromBriefPath}`);
    console.log(`  Reporter + fetchPage stubbed; Writer onwards runs live.`);
  }

  // Wrap deps so we capture reporterOutput, fetchedSources, and the
  // persist callback's inputs — without ever touching the DB.
  const { deps, captured } = wrapDepsForCapture({
    // If --from-brief: pass through the stubs. Otherwise runCreatorPipeline
    // will fall back to its own real defaults.
    ...(usedFromBrief ? baseDeps : {}),
  });

  if (injectSentence) {
    console.log(`Inject enabled — will append to SLIDE 3 BODY before first fact-check:`);
    console.log(`  "${injectSentence}"`);
  }

  console.log('Running pipeline...');
  const result = await runCreatorPipeline(
    {
      id: row.id,
      source: row.source,
      source_url: row.source_url,
      headline: row.headline,
      body: row.body,
      published_at: row.published_at,
    },
    injectSentence ? { injectSentence } : {},
    deps,
  );
  captured.result = result;

  // Write transcript.json — everything captured, plus the row we ran against.
  await fsp.writeFile(
    path.join(runDir, 'transcript.json'),
    JSON.stringify(
      {
        meta: {
          runId,
          articleId: row.id,
          articleHeadline: row.headline,
          articleSource: row.source,
          // ISO string for the article's published date. Needed by
          // --render-preview / --preview-only so adaptToPost can build
          // the Post's publishedAt field without re-hitting the DB.
          articlePublishedAt: row.published_at instanceof Date
            ? row.published_at.toISOString()
            : (row.published_at ?? null),
          usedFromBrief,
          fromBriefPath: fromBriefPath ?? null,
          costCap: Number(process.env.HELIOS_V2_MAX_COST_USD ?? '1.5'),
        },
        result: captured.result,
        columns: {
          composeStatus: captured.composeStatus,
          composeError: captured.composeError,
          renderPostJson: captured.renderPostJson,
          renderSlug: captured.renderSlug,
        },
        debug: captured.debug,
      },
      null,
      2,
    ),
    'utf-8',
  );

  // Write brief.json — only if we ran the Reporter live and captured a real
  // ReporterOutput. In --from-brief mode we already have the source.
  if (!usedFromBrief && captured.reporterOutput) {
    await fsp.writeFile(
      path.join(runDir, 'brief.json'),
      JSON.stringify(
        {
          reporterOutput: captured.reporterOutput,
          sourceTexts: captured.fetchedSources,
        },
        null,
        2,
      ),
      'utf-8',
    );
  }

  // Write summary.md — human-readable.
  const summary = buildSummaryMarkdown(captured, {
    articleId: row.id,
    articleHeadline: row.headline,
    runId,
    usedFromBrief,
  });
  await fsp.writeFile(path.join(runDir, 'summary.md'), summary, 'utf-8');

  console.log('');
  console.log(`Status: ${result.status}`);
  if (result.reason) console.log(`Reason: ${result.reason}`);
  console.log(`Stages: ${result.stagesRun.join(' → ') || '(none)'}`);
  // Show stubbed Reporter cost separately in --from-brief mode so the
  // reviewer isn't misled by the cached Reporter's usage rolled into this
  // run's total.
  if (usedFromBrief && captured.debug?.reporter) {
    const stubbed = captured.debug.reporter.usage.approxCostUsd;
    const live = result.costUsd - stubbed;
    console.log(`Total cost: $${live.toFixed(4)} live + $${stubbed.toFixed(4)} stubbed (from cached brief.json) = $${result.costUsd.toFixed(4)}`);
  } else {
    console.log(`Total cost: $${result.costUsd.toFixed(4)}`);
  }
  console.log('');
  console.log(`Wrote: ${path.relative(process.cwd(), path.join(runDir, 'summary.md'))}`);
  console.log(`       ${path.relative(process.cwd(), path.join(runDir, 'transcript.json'))}`);
  if (!usedFromBrief && captured.reporterOutput) {
    console.log(`       ${path.relative(process.cwd(), path.join(runDir, 'brief.json'))}`);
  }

  // --render-preview: after the pipeline finishes, screenshot every slide
  // into runs/<ts>/preview/. Zero LLM cost, zero DB writes. Uses the
  // adapter to reconstruct a Post when the run bailed on soft errors
  // (renderPostJson is null in that case).
  if (renderPreview) {
    console.log('');
    console.log('Rendering slide previews...');
    const { renderPreview: doRender } = await import('@/lib/social/editorial/v2/render-preview');
    const publishedIso = row.published_at instanceof Date
      ? row.published_at.toISOString()
      : (typeof row.published_at === 'string' ? row.published_at : undefined);
    const r = await doRender({
      post: captured.renderPostJson,
      captured,
      runId,
      articlePublishedAt: publishedIso,
      outDir: path.join(runDir, 'preview'),
      server: previewServer,
    });
    if (r.ok) {
      console.log(`       ${path.relative(process.cwd(), r.outDir)}/ (${r.slideCount} slide PNG${r.slideCount === 1 ? '' : 's'})`);
      if (r.overflowSlides.length > 0) {
        console.log(`       ⚠ Body overflowed on ${r.overflowSlides.length} slide(s): ${r.overflowSlides.map((n) => n + 1).join(', ')} — those PNGs carry a red OVERFLOW badge and need human review.`);
      }
    } else {
      console.warn(`Preview render skipped: ${r.reason}`);
    }
  }

  return summarizeRun(row, captured, {
    partitionErrors, checkPost, checkQuotes, checkNumberTrace, classifySlideType,
  });
}

/**
 * Build a per-post BatchScore from a captured run. Reads everything the
 * scorecard needs off `captured.debug` — the final Editor post for slide
 * kinds + length errors, the image step's chosen photos, the last
 * fact-check round's flags, and the run result for status + cost.
 */
function summarizeRun(
  row: { id: string; source: string; headline: string },
  captured: Deps,
  helpers: {
    partitionErrors: Deps; checkPost: Deps; checkQuotes: Deps;
    checkNumberTrace: Deps; classifySlideType: Deps;
  },
): BatchScore {
  const result = captured.result ?? { status: 'unknown', costUsd: 0 };
  const debug = captured.debug ?? {};
  const editedPost = debug.edited?.post;
  const brief = debug.reporter?.brief;

  let storySlideCount = 0;
  let slideKinds: string[] = [];
  let lengthErrors: string[] = [];
  let quoteCheck: BatchScore['quoteCheck'] = 'no-quotes';

  if (editedPost && brief) {
    storySlideCount = editedPost.slides?.length ?? 0;
    slideKinds = [...new Set((editedPost.slides ?? []).map((s: Deps) => helpers.classifySlideType(s)))] as string[];
    const finalCheck = helpers.checkPost(editedPost, brief);
    const { soft } = helpers.partitionErrors(finalCheck.errors);
    lengthErrors = soft
      .filter((e: Deps) => e.kind === 'char_limit')
      .map((e: Deps) => e.message);
    const anyQuote = (editedPost.slides ?? []).some((s: Deps) => s.quote);
    if (anyQuote) {
      const sourceTexts = (debug.sources ?? []).map((s: Deps) => s.textPreview ?? '');
      const qc = helpers.checkQuotes(editedPost, sourceTexts);
      quoteCheck = qc.ok ? 'ok' : 'failed';
    }
  }

  const photos = ((debug.imageStep?.selected ?? []) as Deps[]).map((s: Deps) => ({
    slide: s.slide === 'cover' ? 'cover' : `slide ${s.slide}`,
    subject: s.label ?? s.subject ?? '(unknown)',
    wikidataId: s.wikidataId ?? '',
    commonsFile: s.commonsFile ?? '',
    license: s.license ?? '',
  }));

  const lastRound = (debug.rounds ?? []).slice(-1)[0];
  const lastFlags = (lastRound?.factCheck?.flags ?? []) as Deps[];
  const otherStoryFlags = lastFlags
    .filter((f: Deps) => /different (story|event|company)|not (in|from) (the )?main|separate story|cross-story/i.test(String(f.problem ?? '')))
    .map((f: Deps) => ({
      where: String(f.where ?? ''),
      text: String(f.text ?? ''),
      sourcesSay: String(f.sourcesSay ?? ''),
    }));

  return {
    articleId: row.id,
    source: row.source,
    headline: row.headline,
    status: String(result.status ?? 'unknown'),
    reason: result.reason,
    costUsd: Number(result.costUsd ?? 0),
    storySlideCount,
    slideKinds,
    photos,
    otherStoryFlags,
    lengthErrors,
    quoteCheck,
    factCheckVerdict: lastRound?.factCheck?.verdict ?? null,
  };
}

/**
 * Compose the batch scorecard.md. One row per post + a totals row that
 * shows which problems repeat across the batch.
 */
function buildBatchScorecard(scores: Array<BatchScore | { error: string; articleId: string }>, batchId: string): string {
  const parts: string[] = [];
  parts.push(`# Batch scorecard — ${batchId}`);
  parts.push('');
  parts.push(`${scores.length} article${scores.length === 1 ? '' : 's'} run through the full v2 pipeline.`);
  parts.push('');

  let totalCost = 0;
  const problems: Record<string, number> = {};

  for (const s of scores) {
    if ('error' in s) {
      parts.push(`## ${s.articleId} — FAILED TO RUN`);
      parts.push('');
      parts.push(`\`${s.error}\``);
      parts.push('');
      problems.pipeline_failure = (problems.pipeline_failure ?? 0) + 1;
      continue;
    }
    totalCost += s.costUsd;
    parts.push(`## ${s.articleId} — ${s.source}: ${s.headline}`);
    parts.push('');
    parts.push(`- **Status:** ${s.status}${s.reason ? ` — ${s.reason}` : ''}`);
    parts.push(`- **Cost:** $${s.costUsd.toFixed(4)}`);
    parts.push(`- **Story slides:** ${s.storySlideCount}`);
    parts.push(`- **Slide kinds:** ${s.slideKinds.length > 0 ? s.slideKinds.join(', ') : '(none)'}`);
    if (s.photos.length > 0) {
      parts.push(`- **Photos placed (${s.photos.length}):**`);
      for (const p of s.photos) {
        parts.push(`    - ${p.slide}: ${p.subject} (Wikidata ${p.wikidataId}) — ${p.commonsFile} — ${p.license}`);
      }
    } else {
      parts.push(`- **Photos placed:** none`);
    }
    if (s.otherStoryFlags.length > 0) {
      parts.push(`- **Fact-checker other-story flags (${s.otherStoryFlags.length}):**`);
      for (const f of s.otherStoryFlags) {
        parts.push(`    - ${f.where}: "${f.text.slice(0, 80)}${f.text.length > 80 ? '…' : ''}" — sources say: ${f.sourcesSay.slice(0, 80)}${f.sourcesSay.length > 80 ? '…' : ''}`);
      }
      problems.other_story = (problems.other_story ?? 0) + 1;
    } else {
      parts.push(`- **Fact-checker other-story flags:** none`);
    }
    if (s.lengthErrors.length > 0) {
      parts.push(`- **Length errors remaining (${s.lengthErrors.length}):**`);
      for (const e of s.lengthErrors) parts.push(`    - ${e}`);
      problems.length_errors = (problems.length_errors ?? 0) + 1;
    } else {
      parts.push(`- **Length errors remaining:** none`);
    }
    parts.push(`- **Quote check:** ${s.quoteCheck}`);
    if (s.quoteCheck === 'failed') problems.quote_verbatim = (problems.quote_verbatim ?? 0) + 1;
    parts.push(`- **Fact-check verdict:** ${s.factCheckVerdict ?? '(not run)'}`);
    if (s.factCheckVerdict === 'FLAGGED') problems.flagged_at_fact_check = (problems.flagged_at_fact_check ?? 0) + 1;
    if (s.status === 'needs_human_review') problems.needs_human_review = (problems.needs_human_review ?? 0) + 1;
    if (s.status === 'shipped') problems.shipped = (problems.shipped ?? 0) + 1;
    parts.push('');
  }

  parts.push('---');
  parts.push('');
  parts.push('## Totals');
  parts.push('');
  parts.push(`- **Total cost:** $${totalCost.toFixed(4)}`);
  const problemKeys = Object.keys(problems).sort();
  if (problemKeys.length === 0) {
    parts.push(`- **No repeat problems recorded.**`);
  } else {
    parts.push(`- **Repeat problems across posts:**`);
    for (const k of problemKeys) parts.push(`    - ${k}: ${problems[k]}`);
  }

  return parts.join('\n');
}

main().catch((err) => {
  console.error('social:v2:test failed:', err);
  process.exit(1);
});
