/**
 * Offline replay: reload each run's FINAL post + FULL cached sources, run
 * every current code check + render the cover. No model calls, no DB
 * writes. Emits a per-run report so the user can eyeball REAL vs FALSE
 * flags before the live run.
 *
 * Usage:
 *   npx tsx scripts/replay_offline.ts <runDir> [--brief=<path>] [--out=<dir>]
 *
 * If --brief is omitted, tries `<runDir>/brief.json`; if that doesn't
 * exist, reads `transcript.meta.fromBriefPath` and resolves it.
 */

import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { adaptToPost } from '@/lib/social/editorial/v2/adapter';
import { classifySlideType, checkPost, checkNumberTrace, checkQuotes, checkOutlineMatch } from '@/lib/social/editorial/v2/code-checks';
import { checkBriefIntegrity } from '@/lib/social/editorial/v2/brief-integrity';
import type { Brief, ParsedPost } from '@/lib/social/editorial/v2/parse';
import { renderPreview } from '@/lib/social/editorial/v2/render-preview';
import type { SelectedImage, SlideKey } from '@/lib/social/editorial/v2/image-step';

type FetchedSource = { url: string; title: string | null; text: string };

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      brief: { type: 'string' },
      out: { type: 'string' },
      'skip-render': { type: 'boolean' },
      server: { type: 'string' },
    },
    allowPositionals: true,
  });
  const runDir = positionals[0];
  if (!runDir) {
    console.error('Usage: npx tsx scripts/replay_offline.ts <runDir> [--brief=<path>] [--out=<dir>] [--skip-render] [--server=<url>]');
    process.exit(2);
  }
  const runAbs = path.isAbsolute(runDir) ? runDir : path.resolve(runDir);

  const transcript = JSON.parse(await fsp.readFile(path.join(runAbs, 'transcript.json'), 'utf-8')) as {
    meta: { articleId: string; articleHeadline: string; articlePublishedAt?: string; usedFromBrief: boolean; fromBriefPath?: string };
    debug: {
      reporter?: { brief: Brief; briefRaw: string };
      briefIntegrity?: { droppedQuotes: Array<{ quote: string; reason: string }> };
      approvedOutline?: Array<{ position: number; kind: string }>;
      imageStep?: { selected?: Array<{ slide: SlideKey; wikidataId: string; subject?: string; label: string; commonsFile: string; storageUrl?: string; license: string; licenseUrl?: string | null; author: string; credit?: string; isPortrait?: boolean; source: 'cache' | 'wikimedia' }> };
      finalPost?: ParsedPost;
      finalCaption?: string;
      rounds?: Array<{ post?: ParsedPost; caption?: string }>;
      edited?: { post: ParsedPost };
      caption?: { caption: string };
    };
  };
  const dbg = transcript.debug;
  const brief = dbg.reporter?.brief;
  if (!brief) throw new Error(`transcript ${runAbs} has no debug.reporter.brief`);
  const briefRaw = dbg.reporter?.briefRaw ?? '';

  // Resolve brief.json for FULL sources — the transcript itself only
  // stores 500-char previews.
  let briefPath = values.brief;
  if (!briefPath) {
    const local = path.join(runAbs, 'brief.json');
    if (fs.existsSync(local)) briefPath = local;
    else if (transcript.meta.fromBriefPath) briefPath = path.resolve(process.cwd(), transcript.meta.fromBriefPath);
  }
  if (!briefPath || !fs.existsSync(briefPath)) {
    throw new Error(`No brief.json found. Tried ${path.join(runAbs, 'brief.json')} and meta.fromBriefPath="${transcript.meta.fromBriefPath}". Pass --brief=<path>.`);
  }
  const briefFile = JSON.parse(await fsp.readFile(briefPath, 'utf-8')) as { sourceTexts?: FetchedSource[] };
  const sourceTexts: FetchedSource[] = briefFile.sourceTexts ?? [];
  if (sourceTexts.length === 0) throw new Error(`brief.json at ${briefPath} has no sourceTexts`);

  // Final post: prefer debug.finalPost, then rounds[last].post, then edited.post.
  const finalPost: ParsedPost = dbg.finalPost
    ?? (dbg.rounds && dbg.rounds.length > 0 ? dbg.rounds[dbg.rounds.length - 1]!.post! : undefined)
    ?? dbg.edited?.post!;
  if (!finalPost) throw new Error(`transcript has no final post (checked finalPost, rounds[-1].post, edited.post)`);
  const finalCaption: string = dbg.finalCaption ?? (dbg.rounds && dbg.rounds.length > 0 ? dbg.rounds[dbg.rounds.length - 1]!.caption ?? '' : dbg.caption?.caption ?? '');

  console.log(`\n=== REPLAY: ${runAbs} ===`);
  console.log(`Article: ${transcript.meta.articleId.slice(0, 8)} — ${transcript.meta.articleHeadline}`);
  console.log(`Brief:   ${briefPath}`);
  console.log(`Sources: ${sourceTexts.length} (${sourceTexts.map((s) => s.text.length).join(', ')} chars)`);
  console.log(`Slides:  ${finalPost.slides.length} (${finalPost.slides.map(classifySlideType).join(', ')})`);
  console.log(`Cover:   ${(finalPost.cover.text ?? '').slice(0, 90)}...`);
  if (dbg.imageStep?.selected?.length) {
    for (const s of dbg.imageStep.selected) {
      console.log(`Photo:   slide=${s.slide} ${s.wikidataId} "${s.label}" ${s.storageUrl ? 'HAS storageUrl' : 'NO storageUrl (pre-2026-09-29-late transcript)'}`);
    }
  }

  // ── Checks ─────────────────────────────────────────────────────────
  const bi = checkBriefIntegrity(brief, briefRaw, sourceTexts);
  const post = checkPost(finalPost, brief);
  const nt = checkNumberTrace(finalPost, finalCaption, sourceTexts.map((s) => s.text));
  const qv = checkQuotes(finalPost, sourceTexts.map((s) => s.text));
  const om = checkOutlineMatch(finalPost, dbg.approvedOutline);

  console.log(`\n--- brief-integrity dropped ${bi.droppedQuotes.length} quote(s) ---`);
  for (const d of bi.droppedQuotes) console.log(`  - "${d.quote.slice(0, 80)}${d.quote.length > 80 ? '...' : ''}"`);

  const groups: Array<[string, typeof post.errors]> = [
    ['checkPost', post.errors],
    ['checkNumberTrace', nt.errors],
    ['checkQuotes', qv.errors],
    ['checkOutlineMatch', om.errors],
  ];
  console.log('');
  for (const [name, errs] of groups) {
    console.log(`--- ${name}: ${errs.length} error(s) ---`);
    for (const e of errs) console.log(`  [${e.kind}] ${e.message.slice(0, 240)}`);
  }

  // ── Render cover PNG via preview server (if reachable) ─────────────
  if (values['skip-render']) {
    console.log('\n(--skip-render: skipping cover PNG.)');
    return;
  }
  const outDir = values.out ?? path.join(runAbs, 'replay');
  await fsp.mkdir(outDir, { recursive: true });

  const selectedImages: Map<SlideKey, SelectedImage> = new Map();
  for (const s of dbg.imageStep?.selected ?? []) {
    if (!s.storageUrl || s.credit === undefined) continue;
    selectedImages.set(s.slide, {
      wikidataId: s.wikidataId,
      subject: s.subject ?? s.label,
      label: s.label,
      commonsFile: s.commonsFile,
      storageUrl: s.storageUrl,
      license: s.license,
      licenseUrl: s.licenseUrl ?? null,
      author: s.author,
      credit: s.credit,
      isPortrait: s.isPortrait ?? true,
      source: s.source,
    });
  }
  const renderPost = adaptToPost({
    brief,
    post: finalPost,
    caption: finalCaption,
    articlePublishedAt: transcript.meta.articlePublishedAt ?? new Date().toISOString(),
    issueNumber: Math.floor(Date.now() / 86_400_000) - 20_000,
    selectedImages: selectedImages.size > 0 ? selectedImages : undefined,
  });

  const r = await renderPreview({
    post: renderPost,
    captured: null,
    runId: `replay-${path.basename(runAbs)}`,
    articlePublishedAt: transcript.meta.articlePublishedAt,
    outDir,
    server: values.server ?? 'http://127.0.0.1:3000',
  });
  if (r.ok) {
    console.log(`\nRendered ${r.slideCount} slide PNG(s) → ${outDir}`);
    if (r.overflowSlides.length > 0) console.log(`⚠ overflow: ${r.overflowSlides.join(', ')}`);
  } else {
    console.log(`\nRender skipped: ${r.reason}`);
  }
}

main().catch((err) => {
  console.error('replay_offline failed:', err);
  process.exit(1);
});
