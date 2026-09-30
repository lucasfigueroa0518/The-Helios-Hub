/**
 * Run the Jev grader on the 13 calibration drafts (docs/JEV-GRADING-PASS.md
 * §6). Text only, cost ~$0.13 total. Does not open
 * docs/jev-calibration-key.json — the hand grades stay blind until the
 * grader has produced its own scores.
 *
 * Usage: npx tsx scripts/jev_calibrate.ts
 * Writes: Claude outputs/jev-calibration/results.json + per-post table.
 */
import fs from 'node:fs';
import path from 'node:path';

{
  const root = '/Users/tommypozo/Desktop/HELIOS/The-Helios-Hub';
  const envPath = path.join(root, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/\r$/, '');
    }
  }
}

import { promises as fsp } from 'node:fs';

const ROOT = '/Users/tommypozo/Desktop/HELIOS/The-Helios-Hub';
const OUT_DIR = path.join(ROOT, 'Claude outputs', 'jev-calibration');

type CorpusEntry = {
  id: string;
  label: string;
  loader: () => Promise<unknown>;
};

const CORPUS: CorpusEntry[] = [
  // Old pipeline runs (transcripts)
  { id: 'old-google-cc', label: 'Google CC (old pipeline, Lucas: good)', loader: () => loadTranscriptPost('runs/2026-09-29T03-38-05-457Z', 'round0') },
  { id: 'old-gottheimer', label: 'Gottheimer (old pipeline, Lucas: dragged out)', loader: () => loadTranscriptPost('runs/2026-09-29T19-50-15-796Z', 'finalPost') },
  { id: 'old-suleyman', label: 'Suleyman (old pipeline)', loader: () => loadTranscriptPost('runs/2026-09-29T16-40-07-763Z', 'finalPost') },
  { id: 'old-newsom', label: 'Newsom (old pipeline)', loader: () => loadTranscriptPost('runs/2026-09-29T02-28-32-764Z', 'finalPost') },
  // Hand-finalized posts
  { id: 'final-gottheimer', label: 'Gottheimer (hand-finalized)', loader: () => loadRenderPost('Claude outputs/final/gottheimer/post.json') },
  { id: 'final-suleyman', label: 'Suleyman (hand-finalized)', loader: () => loadRenderPost('Claude outputs/final/suleyman/post.json') },
  { id: 'final-newsom', label: 'Newsom (hand-finalized)', loader: () => loadRenderPost('Claude outputs/final/newsom/post.json') },
  // copy-ab (first fact-first A/B, harness-driven)
  { id: 'copy-ab-google-cc', label: 'Google CC (copy-ab first pass)', loader: () => loadRenderPost('Claude outputs/copy-ab/google-cc/post.json') },
  { id: 'copy-ab-gottheimer', label: 'Gottheimer (copy-ab first pass)', loader: () => loadRenderPost('Claude outputs/copy-ab/gottheimer/post.json') },
  { id: 'copy-ab-suleyman', label: 'Suleyman (copy-ab first pass)', loader: () => loadRenderPost('Claude outputs/copy-ab/suleyman/post.json') },
  { id: 'copy-ab-newsom', label: 'Newsom (copy-ab first pass)', loader: () => loadRenderPost('Claude outputs/copy-ab/newsom/post.json') },
  // copy-ab-2 (real orchestrate, field-scoped repairs). Only two of four
  // shipped slides; the other two bailed at OUTLINE validation.
  { id: 'copy-ab-2-google-cc', label: 'Google CC (copy-ab-2 real pipeline)', loader: () => loadDebugFinalPost('Claude outputs/copy-ab-2/google-cc/debug.json') },
  { id: 'copy-ab-2-gottheimer', label: 'Gottheimer (copy-ab-2 real pipeline)', loader: () => loadDebugFinalPost('Claude outputs/copy-ab-2/gottheimer/debug.json') },
];

async function loadTranscriptPost(runDir: string, source: 'finalPost' | 'round0') {
  const t = JSON.parse(await fsp.readFile(path.join(ROOT, runDir, 'transcript.json'), 'utf-8'));
  const d = t.debug ?? t;
  if (source === 'finalPost') {
    return d.finalPost ?? d.edited?.post ?? d.draft?.post;
  }
  return d.rounds?.[0]?.post ?? d.edited?.post ?? d.draft?.post;
}

async function loadRenderPost(rel: string) {
  return JSON.parse(await fsp.readFile(path.join(ROOT, rel), 'utf-8'));
}

async function loadDebugFinalPost(rel: string) {
  const d = JSON.parse(await fsp.readFile(path.join(ROOT, rel), 'utf-8'));
  return d.finalPost ?? d.edited?.post ?? d.draft?.post;
}

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const { buildJevStateFromRenderPost, buildJevStateFromParsed } = await import('@/lib/social/jev-grader/state');
  const { jevGrade } = await import('@/lib/social/jev-grader/grader');

  const rows: Array<Record<string, unknown>> = [];
  let totalCost = 0;

  for (const entry of CORPUS) {
    console.log(`\n=== ${entry.id} ===`);
    const post = await entry.loader() as { cover?: { text?: string }; slides?: unknown[] };
    if (!post || !Array.isArray(post.slides) || post.slides.length === 0) {
      console.log(`  skipping — no slides available`);
      rows.push({ id: entry.id, label: entry.label, skipped: 'no slides' });
      continue;
    }
    // Prefer the RenderPost adapter (both shapes have cover.text +
    // slides[].{headline,body,note,...}).
    const state = buildJevStateFromRenderPost(post as never);
    console.log(`  ${state.storySlides.length} story slides, state ${state.serialized.length} chars`);

    const result = await jevGrade({ state });
    totalCost += result.usage.approxCostUsd;
    console.log(`  cost $${result.usage.approxCostUsd.toFixed(4)}, verdict ${result.verdict.passed ? 'PASS' : 'FAIL'}, ${result.verdict.postFailures.length} post-Q failures, ${result.verdict.slideFailures.length} slide failures`);
    rows.push({
      id: entry.id,
      label: entry.label,
      slideCount: state.storySlides.length,
      passed: result.verdict.passed,
      postFailures: result.verdict.postFailures,
      slideFailures: result.verdict.slideFailures,
      probabilities: result.probabilities,
      costUsd: result.usage.approxCostUsd,
    });
  }

  await fsp.writeFile(
    path.join(OUT_DIR, 'results.json'),
    JSON.stringify({ graderVersion: 'jev-grader-2026-09-29', totalCostUsd: totalCost, rows }, null, 2),
    'utf-8',
  );

  console.log(`\n=== GRAND TOTAL: $${totalCost.toFixed(4)} across ${rows.filter((r) => !r.skipped).length} posts ===`);
  console.log('\n| Post | Slides | Pass? | Cover | Pulls | Clear | Why | Share | Slide failures |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    if (r.skipped) {
      console.log(`| ${r.id} | — | — | (${r.skipped}) | | | | | |`);
      continue;
    }
    const p = r.probabilities as Record<string, number>;
    const pct = (n?: number) => n === undefined ? '—' : `${(n * 100).toFixed(0)}%`;
    const sf = (r.slideFailures as number[]).length === 0 ? '(none)' : (r.slideFailures as number[]).join(', ');
    console.log(`| ${r.id} | ${r.slideCount} | ${r.passed ? '✓' : '✗'} | ${pct(p.cover_says_what)} | ${pct(p.pulls_through)} | ${pct(p.clear_to_outsider)} | ${pct(p.why_it_matters)} | ${pct(p.worth_sharing)} | ${sf} |`);
  }
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
