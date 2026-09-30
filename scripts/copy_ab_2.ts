/**
 * Copy A/B second pass — runs 4 saved briefs through the REAL production
 * pipeline (orchestrate.runCreatorPipeline) with the new field-scoped
 * repair, outline validation, fact-first prompts, and fact-checker.
 *
 * Skips the image step and render (HELIOS_V2_SKIP_IMAGE_STEP=1). Saves
 * per-post output to "Claude outputs/copy-ab-2/<slug>/".
 *
 * Missing brief.json files are built on the fly by re-fetching the
 * source URLs listed in the run transcript (fetchPage, no LLM cost).
 *
 * Usage: npx tsx scripts/copy_ab_2.ts
 */
import fs from 'node:fs';
import path from 'node:path';

// Load env before importing anything that uses ANTHROPIC_API_KEY, and
// before setting the skip-image-step / no-storage-upload flags.
{
  const root = '/Users/tommypozo/Desktop/HELIOS/The-Helios-Hub';
  const envPath = path.join(root, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/\r$/, '');
    }
  }
  process.env.HELIOS_V2_NO_STORAGE_UPLOAD = '1';
  process.env.HELIOS_V2_SKIP_IMAGE_STEP = '1';
  process.env.HELIOS_V2_MAX_COST_USD = process.env.HELIOS_V2_MAX_COST_USD ?? '1.5';
}

import { promises as fsp } from 'node:fs';

const ROOT = '/Users/tommypozo/Desktop/HELIOS/The-Helios-Hub';
const OUT_ROOT = path.join(ROOT, 'Claude outputs', 'copy-ab-2');

type RunSpec = { slug: string; transcriptDir: string; headline: string; source: string; articleId: string };

const RUNS: RunSpec[] = [
  { slug: 'google-cc', transcriptDir: 'runs/2026-09-29T03-38-05-457Z', headline: 'Google CC — household AI agent', source: 'blog.google', articleId: 'copy-ab-2-google-cc' },
  { slug: 'gottheimer', transcriptDir: 'runs/2026-09-29T19-50-15-796Z', headline: 'Gottheimer — two bipartisan AI security bills', source: 'gottheimer.house.gov', articleId: 'copy-ab-2-gottheimer' },
  { slug: 'suleyman', transcriptDir: 'runs/2026-09-29T16-40-07-763Z', headline: 'Suleyman — MAI Code of Conduct + Anthropic essay', source: 'microsoft.ai', articleId: 'copy-ab-2-suleyman' },
  { slug: 'newsom', transcriptDir: 'runs/2026-09-29T02-28-32-764Z', headline: 'Newsom — AI kill switch executive order', source: 'gov.ca.gov', articleId: 'copy-ab-2-newsom' },
];

async function buildCachedBrief(spec: RunSpec) {
  // 1. Load reporter output straight from the transcript.
  const t = JSON.parse(await fsp.readFile(path.join(ROOT, spec.transcriptDir, 'transcript.json'), 'utf-8'));
  const debug = t.debug ?? t;
  const rep = debug.reporter;
  if (!rep?.brief) throw new Error(`${spec.slug}: no debug.reporter.brief`);

  // 2. If there's already a brief.json with full source texts, use it.
  const briefPath = path.join(ROOT, spec.transcriptDir, 'brief.json');
  if (fs.existsSync(briefPath)) {
    const cached = JSON.parse(await fsp.readFile(briefPath, 'utf-8'));
    if (Array.isArray(cached.sourceTexts) && cached.sourceTexts.every((s: { text?: string }) => (s.text?.length ?? 0) > 0)) {
      console.log(`  using existing brief.json (${cached.sourceTexts.length} full sources)`);
      return cached;
    }
  }

  // 3. Otherwise re-fetch source URLs listed in the transcript.
  const { fetchPage } = await import('@/lib/social/editorial/v2/tools/fetch-page');
  const sourceMeta = (debug.sources ?? []) as Array<{ url: string; ok: boolean; resolvedUrl?: string }>;
  const sourceTexts: Array<{ url: string; title: string | null; text: string }> = [];
  for (const s of sourceMeta) {
    if (!s.ok) continue;
    console.log(`  re-fetching ${s.url}`);
    const r = await fetchPage(s.url);
    if (r.ok) sourceTexts.push({ url: s.url, title: r.title ?? null, text: r.text });
  }

  const cached = {
    reporterOutput: {
      brief: rep.brief,
      briefRaw: rep.briefRaw,
      sanitizedBriefRaw: rep.sanitizedBriefRaw ?? rep.briefRaw,
      fetchedUrls: sourceTexts.map((s) => s.url),
      stopReasons: rep.stopReasons ?? [],
      usage: rep.usage ?? { inputTokens: 0, outputTokens: 0, approxCostUsd: 0 },
    },
    sourceTexts,
  };
  await fsp.writeFile(briefPath, JSON.stringify(cached, null, 2), 'utf-8');
  return cached;
}

async function main() {
  const {
    runCreatorPipeline,
  } = await import('@/lib/social/editorial/v2/orchestrate');
  const {
    buildFromBriefDeps, wrapDepsForCapture,
  } = await import('@/lib/social/editorial/v2/test-runner-support');

  await fsp.mkdir(OUT_ROOT, { recursive: true });
  let grandCost = 0;
  const summaryRows: Array<Record<string, unknown>> = [];

  for (const spec of RUNS) {
    console.log(`\n=== ${spec.slug} ===`);
    const outDir = path.join(OUT_ROOT, spec.slug);
    await fsp.mkdir(outDir, { recursive: true });

    const cached = await buildCachedBrief(spec);
    const baseDeps = buildFromBriefDeps(cached);
    const { deps, captured } = wrapDepsForCapture(baseDeps);

    const row = {
      id: spec.articleId,
      source: spec.source,
      source_url: cached.sourceTexts[0]?.url ?? '',
      headline: spec.headline,
      body: cached.sourceTexts[0]?.text ?? '',
      published_at: null,
    };

    console.log(`  running pipeline (image-step skipped)...`);
    const started = Date.now();
    let result: unknown;
    try {
      result = await runCreatorPipeline(row, {}, deps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    pipeline crashed: ${msg}`);
      await fsp.writeFile(path.join(outDir, 'error.txt'), msg, 'utf-8');
      continue;
    }
    const elapsedS = ((Date.now() - started) / 1000).toFixed(1);

    // Save the captured artifacts.
    await fsp.writeFile(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2), 'utf-8');
    if (captured.debug) {
      await fsp.writeFile(path.join(outDir, 'debug.json'), JSON.stringify(captured.debug, null, 2), 'utf-8');
    }
    if (captured.renderPostJson) {
      await fsp.writeFile(path.join(outDir, 'render-post.json'), JSON.stringify(captured.renderPostJson, null, 2), 'utf-8');
    }
    const cost = (result as { costUsd: number }).costUsd;
    grandCost += cost;
    console.log(`  cost $${cost.toFixed(4)}, elapsed ${elapsedS}s, status: ${(result as { status: string }).status}`);

    // Build the summary the reviewer will read.
    await fsp.writeFile(
      path.join(outDir, 'summary.txt'),
      buildSummary(spec, result, captured),
      'utf-8',
    );

    summaryRows.push({
      slug: spec.slug,
      cost,
      elapsedS,
      status: (result as { status: string }).status,
      reason: (result as { reason?: string }).reason,
      stagesRun: (result as { stagesRun: string[] }).stagesRun,
    });
  }

  await fsp.writeFile(path.join(OUT_ROOT, 'summary.json'), JSON.stringify({ grandTotalCost: Number(grandCost.toFixed(4)), perPost: summaryRows }, null, 2), 'utf-8');
  console.log(`\n=== GRAND TOTAL: $${grandCost.toFixed(4)} ===`);
  for (const r of summaryRows) {
    console.log(`  ${r.slug}: $${(r.cost as number).toFixed(4)} (${r.status}) — ${(r.stagesRun as string[]).length} stages`);
  }
}

function buildSummary(spec: RunSpec, result: unknown, captured: { debug: Record<string, unknown> | null }): string {
  const r = result as { status: string; reason?: string; costUsd: number; stagesRun: string[] };
  const debug = captured.debug as {
    approvedOutline?: Array<{ position: number; kind: string }>;
    edited?: { post?: Record<string, unknown>; raw?: string };
    finalPost?: Record<string, unknown>;
    finalCaption?: string;
    caption?: { caption?: string };
    rounds?: Array<{ round: number; factCheck?: { verdict: string; flags: unknown[] }; factCheckRaw?: string }>;
    repairs?: Array<{ round: number; stage: string; reason?: string; usage: { approxCostUsd: number } }>;
    reporter?: { brief?: { news?: string; terms?: unknown[] } };
  } | null;

  const out: string[] = [];
  out.push(`# ${spec.slug}`);
  out.push('');
  out.push(`STATUS: ${r.status}`);
  if (r.reason) out.push(`REASON: ${r.reason}`);
  out.push(`COST: $${r.costUsd.toFixed(4)}`);
  out.push(`STAGES: ${r.stagesRun.join(' → ')}`);
  out.push('');

  const brief = debug?.reporter?.brief;
  if (brief?.news) out.push(`THE NEWS: ${brief.news}`);
  if (Array.isArray(brief?.terms)) out.push(`TERMS: ${brief.terms.length}`);
  out.push('');

  const outline = debug?.approvedOutline;
  if (outline) {
    out.push('## APPROVED OUTLINE');
    for (const s of outline) out.push(`- SLIDE ${s.position}: ${s.kind}`);
    out.push('');
  }

  const finalPost = (debug?.finalPost ?? debug?.edited?.post) as {
    cover?: { text?: string; image?: string };
    slides?: Array<{ position: number; headline?: string; body?: string; note?: string; quote?: string; quoteBy?: string; bigNumber?: string; numberNote?: string; secondNumber?: string; secondNote?: string; highlight?: string; image?: string }>;
    follow?: string;
  } | undefined;

  if (finalPost?.cover) {
    out.push('## FINAL SLIDES');
    out.push('');
    out.push(`COVER: ${finalPost.cover.text ?? '(missing)'}`);
    if (finalPost.cover.image) out.push(`COVER IMAGE: ${finalPost.cover.image}`);
    out.push('');
    for (const s of finalPost.slides ?? []) {
      out.push(`SLIDE ${s.position}`);
      if (s.headline) out.push(`  HEADLINE: ${s.headline}`);
      if (s.body) out.push(`  BODY: ${s.body}`);
      if (s.note) out.push(`  NOTE: ${s.note}`);
      if (s.bigNumber) out.push(`  BIG NUMBER: ${s.bigNumber}`);
      if (s.numberNote) out.push(`  NUMBER NOTE: ${s.numberNote}`);
      if (s.secondNumber) out.push(`  SECOND NUMBER: ${s.secondNumber}`);
      if (s.secondNote) out.push(`  SECOND NOTE: ${s.secondNote}`);
      if (s.quote) out.push(`  QUOTE: ${s.quote}`);
      if (s.quoteBy) out.push(`  QUOTE BY: ${s.quoteBy}`);
      if (s.highlight) out.push(`  HIGHLIGHT: ${s.highlight}`);
      if (s.image) out.push(`  IMAGE: ${s.image}`);
      out.push('');
    }
    if (finalPost.follow) {
      out.push(`FOLLOW: ${finalPost.follow}`);
      out.push('');
    }
  }

  const caption = debug?.finalCaption ?? debug?.caption?.caption;
  if (caption) {
    out.push('## CAPTION');
    out.push(caption);
    out.push('');
  }

  const rounds = debug?.rounds ?? [];
  if (rounds.length > 0) {
    out.push('## FACT-CHECK ROUNDS');
    for (const rn of rounds) {
      const fc = rn.factCheck;
      out.push(`Round ${rn.round}: verdict ${fc?.verdict ?? '?'} — ${fc?.flags?.length ?? 0} flag(s)`);
      for (const f of (fc?.flags ?? []) as Array<{ size: string; where: string; text: string; problem: string; sourcesSay: string }>) {
        out.push(`  - [${f.size}] ${f.where}`);
        out.push(`      TEXT: ${(f.text ?? '').slice(0, 180)}`);
        out.push(`      PROBLEM: ${(f.problem ?? '').slice(0, 220)}`);
        out.push(`      SOURCES SAY: ${(f.sourcesSay ?? '').slice(0, 220)}`);
      }
    }
    out.push('');
  }

  const repairs = debug?.repairs ?? [];
  if (repairs.length > 0) {
    out.push('## REPAIRS');
    for (const rep of repairs) {
      out.push(`- r${rep.round} ${rep.stage}: ${rep.reason ?? ''}  ($${rep.usage.approxCostUsd.toFixed(4)})`);
    }
    out.push('');
  }

  return out.join('\n');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
