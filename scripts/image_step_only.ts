/**
 * Image-step-only run: load a saved run's FINAL post + brief, call the
 * image step (Wikidata lookup + vision KIND check), then render the
 * preview so we can see whether a photo actually lands on the cover.
 *
 * Cost: ~$0.01 (one Haiku vision call per requested subject).
 *
 * Usage:
 *   npx tsx scripts/image_step_only.ts <runDir> [--brief=<path>] [--server=<url>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { parseArgs } from 'node:util';

// Load .env.local before any imports that need it.
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

import { adaptToPost } from '@/lib/social/editorial/v2/adapter';
import { runImageStep, buildAttributionBlock, type SelectedImage, type SlideKey } from '@/lib/social/editorial/v2/image-step';
import type { Brief, ParsedPost } from '@/lib/social/editorial/v2/parse';
import { renderPreview } from '@/lib/social/editorial/v2/render-preview';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { brief: { type: 'string' }, server: { type: 'string' }, out: { type: 'string' } },
    allowPositionals: true,
  });
  const runDir = positionals[0];
  if (!runDir) { console.error('Usage: npx tsx scripts/image_step_only.ts <runDir> [--brief=<path>] [--server=<url>]'); process.exit(2); }
  const runAbs = path.isAbsolute(runDir) ? runDir : path.resolve(runDir);

  const transcript = JSON.parse(await fsp.readFile(path.join(runAbs, 'transcript.json'), 'utf-8')) as {
    meta: { articleId: string; articleHeadline: string; articlePublishedAt?: string; fromBriefPath?: string };
    debug: {
      reporter?: { brief: Brief; briefRaw: string };
      finalPost?: ParsedPost;
      rounds?: Array<{ post?: ParsedPost }>;
      edited?: { post: ParsedPost };
    };
  };
  const dbg = transcript.debug;
  const brief = dbg.reporter?.brief;
  if (!brief) throw new Error('transcript has no debug.reporter.brief');
  const finalPost = dbg.finalPost
    ?? (dbg.rounds && dbg.rounds.length > 0 ? dbg.rounds[dbg.rounds.length - 1]!.post : undefined)
    ?? dbg.edited?.post;
  if (!finalPost) throw new Error('transcript has no final post');

  let briefPath = values.brief;
  if (!briefPath) {
    const local = path.join(runAbs, 'brief.json');
    if (fs.existsSync(local)) briefPath = local;
    else if (transcript.meta.fromBriefPath) briefPath = path.resolve(process.cwd(), transcript.meta.fromBriefPath);
  }
  if (!briefPath || !fs.existsSync(briefPath)) throw new Error(`brief.json not found. Tried ${path.join(runAbs, 'brief.json')} and meta.fromBriefPath="${transcript.meta.fromBriefPath}". Pass --brief=<path>.`);

  console.log(`\n=== IMAGE-STEP-ONLY: ${runAbs} ===`);
  console.log(`Article: ${transcript.meta.articleId.slice(0, 8)} — ${transcript.meta.articleHeadline}`);
  console.log(`Brief:   ${briefPath}`);
  console.log(`Cover text: ${(finalPost.cover.text ?? '').slice(0, 90)}...`);

  // Run image step live (Wikidata + Haiku vision).
  const startedAt = Date.now();
  const result = await runImageStep(finalPost, brief);
  const ms = Date.now() - startedAt;
  console.log(`\nImage step: ${ms}ms, ${result.visionCalls} vision call(s)`);
  const approxCost = result.visionUsage.reduce((n, u) => n + (u as { approxCostUsd?: number }).approxCostUsd!, 0);
  if (Number.isFinite(approxCost) && approxCost > 0) console.log(`Approx cost: $${approxCost.toFixed(4)}`);
  console.log('\nReport:');
  for (const r of result.report) {
    console.log(`  slide=${r.slide} subject=${r.requestedSubject} status=${r.status} reason=${r.reason ?? '-'}`);
  }
  console.log('\nSelected:');
  for (const [slide, img] of result.selected) {
    console.log(`  slide=${slide} wikidata=${img.wikidataId} label="${img.label}" license=${img.license} credit="${img.credit}"`);
    console.log(`    storageUrl: ${img.storageUrl}`);
  }
  if (result.selected.size === 0) {
    console.log('\n(No photo placed — cover will render type-only.)');
  }

  // Render preview via adaptToPost, forwarding the selectedImages Map.
  const outDir = values.out ?? path.join(runAbs, 'image-step-only');
  await fsp.mkdir(outDir, { recursive: true });
  const photoLine = buildAttributionBlock(result.selected);
  const renderPost = adaptToPost({
    brief,
    // Show the caption + credit together so we can see the CC BY line
    // in the rendered preview + summary. Empty caption body is fine —
    // this script's job is to prove the credit renders.
    post: finalPost,
    caption: '',
    articlePublishedAt: transcript.meta.articlePublishedAt ?? new Date().toISOString(),
    issueNumber: Math.floor(Date.now() / 86_400_000) - 20_000,
    selectedImages: result.selected.size > 0 ? result.selected : undefined,
    attributionBlockOverride: photoLine || undefined,
  });
  const r = await renderPreview({
    post: renderPost,
    captured: null,
    runId: `image-step-only-${path.basename(runAbs)}`,
    articlePublishedAt: transcript.meta.articlePublishedAt,
    outDir,
    server: values.server ?? 'http://127.0.0.1:3000',
  });
  if (r.ok) {
    console.log(`\nRendered ${r.slideCount} slide PNG(s) → ${outDir}`);
    if (photoLine) console.log(`Credit line (would appear after Source: in caption): ${photoLine}`);
  } else {
    console.log(`\nRender skipped: ${r.reason}`);
  }
}

main().catch((err) => { console.error('image_step_only failed:', err); process.exit(1); });
