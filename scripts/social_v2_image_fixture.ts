/**
 * Acceptance step 2 per docs/IMAGES-V1-HANDOFF.md:
 *   Free: run the image step alone (no writing stages) on a fixture post
 *   with hand-written IMAGE lines: "photo of Gavin Newsom" on the cover
 *   and "photo of the California State Capitol" on one Text slide.
 *   Render it with --render-preview and show which images it picked,
 *   their licenses, and the credit line.
 *
 * No LLM writing stages. Real Wikidata + Commons API calls. Real Haiku
 * vision check on each candidate. Real Supabase Storage upload. Real DB
 * cache read/write.
 */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

// Load .env.local BEFORE any lib import that reads process.env
// (Anthropic client, pg pool, supabase client). Same pattern as
// scripts/social_v2_test.ts.
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
import { buildAttributionBlock, runImageStep } from '@/lib/social/editorial/v2/image-step';
import type { Brief, ParsedPost } from '@/lib/social/editorial/v2/parse';
import { renderPreview } from '@/lib/social/editorial/v2/render-preview';

const SERVER = process.argv.find((a) => a.startsWith('--server='))?.slice('--server='.length)
  ?? 'http://localhost:3001';

const RUN_ID = `image-step-fixture-${new Date().toISOString().replace(/[:.]/g, '-')}`;

const BRIEF: Brief = {
  singleStory: { yes: true, sourceNote: '' },
  news: 'California Governor Gavin Newsom signed an executive order on AI at the State Capitol.',
  story:
    'On 2026-09-28, Gavin Newsom, the Governor of California, signed an executive order at the California State Capitol in Sacramento requiring state agencies to test generative AI systems before deploying them.',
  terms: [
    { name: 'Gavin Newsom', description: 'Governor of California and state executive' },
    { name: 'California State Capitol', description: 'The neoclassical government building in Sacramento housing California state legislature and governor' },
  ],
  images: [],
  sources: [
    { outlet: 'CalMatters', publishedAt: '2026-09-28', url: 'https://calmatters.example/newsom-ai-order' },
  ],
};

const POST: ParsedPost = {
  cover: {
    kind: 'edited',
    text: 'Gavin Newsom signed an AI executive order at the California State Capitol.',
    highlight: 'AI executive order',
    image: 'photo of Gavin Newsom',
  },
  slides: [
    {
      position: 2,
      headline: 'State agencies must test generative AI before deploying it.',
      body: 'The order requires California state agencies to run generative AI systems through impact assessments before putting them into production, and to publish the results.',
      image: 'type only',
      highlight: 'impact assessments',
    },
    {
      position: 3,
      headline: 'The signing took place at the State Capitol in Sacramento.',
      body: 'Newsom signed the order in a ceremony at the neoclassical State Capitol in Sacramento, flanked by state legislators and staff.',
      image: 'photo of the California State Capitol',
      highlight: 'Sacramento',
    },
  ],
  follow: 'Follow Helios to track how U.S. states are regulating AI.',
  editNotes: null,
};

const CAPTION = `California Governor Gavin Newsom signed an executive order requiring state agencies to test generative AI systems before deploying them. The order was signed at the State Capitol in Sacramento on 2026-09-28.

Source: CalMatters, 2026-09-28.`;

async function main() {
  const runDir = path.join(process.cwd(), 'runs', RUN_ID);
  await fsp.mkdir(runDir, { recursive: true });

  console.log(`\nRunning image step on fixture (real Wikidata + Commons + Haiku + Supabase)...\n`);
  const t0 = Date.now();
  const imageResult = await runImageStep(POST, BRIEF);
  const elapsedMs = Date.now() - t0;

  // Print the acceptance proof block.
  console.log('─'.repeat(72));
  console.log(`IMAGE STEP RESULT — ${imageResult.selected.size} picked, ${imageResult.report.length - imageResult.selected.size} type-only`);
  console.log(`elapsed: ${(elapsedMs / 1000).toFixed(1)}s | vision calls: ${imageResult.visionCalls}`);
  console.log('─'.repeat(72));
  for (const entry of imageResult.report) {
    const where = entry.slide === 'cover' ? 'COVER' : `SLIDE ${entry.slide}`;
    console.log(`\n${where}  requested: "photo of ${entry.requestedSubject}"`);
    console.log(`  status: ${entry.status}`);
    console.log(`  reason: ${entry.reason}`);
    if (entry.picked) {
      console.log(`  wikidata:    https://www.wikidata.org/wiki/${entry.picked.wikidataId}  (${entry.picked.label})`);
      console.log(`  commons:     ${entry.picked.commonsUrl}`);
      console.log(`  license:     ${entry.picked.license}`);
      console.log(`  author:      ${entry.picked.author}`);
      console.log(`  storage:     ${entry.picked.storageUrl}`);
      console.log(`  is portrait: ${entry.picked.isPortrait}   cache hit: ${entry.picked.cacheHit}`);
    }
  }
  console.log('\n' + '─'.repeat(72));

  // Build the Post + render the preview PNGs.
  const post = adaptToPost({
    brief: BRIEF,
    post: POST,
    caption: CAPTION,
    articlePublishedAt: '2026-09-28T00:00:00Z',
    issueNumber: 200,
    selectedImages: imageResult.selected,
  });
  // Same override the orchestrator applies: use the image-step's
  // "Photos: <credit>; <credit>." format instead of the adapter's
  // newline-separated fallback.
  const photoLine = buildAttributionBlock(imageResult.selected);
  if (photoLine) post.attributionBlock = photoLine;
  await fsp.writeFile(path.join(runDir, 'post.json'), JSON.stringify(post, null, 2), 'utf-8');
  await fsp.writeFile(path.join(runDir, 'image-report.json'), JSON.stringify(imageResult.report, null, 2), 'utf-8');

  const render = await renderPreview({
    post,
    captured: null,
    runId: RUN_ID,
    articlePublishedAt: '2026-09-28T00:00:00Z',
    outDir: path.join(runDir, 'preview'),
    server: SERVER,
  });
  if (render.ok) {
    console.log(`\n✓ Rendered ${render.slideCount} PNG(s) → ${path.relative(process.cwd(), render.outDir)}/`);
    if (render.overflowSlides.length > 0) {
      console.log(`  ⚠ overflow on slide(s) ${render.overflowSlides.map((n) => n + 1).join(', ')}`);
    }
  } else {
    console.warn(`\n⚠ Preview render skipped: ${render.reason}`);
  }

  console.log(`\nCredit line for caption:`);
  console.log(`  ${post.attributionBlock ?? '(none — every slide was type-only)'}\n`);
}

main().catch((err) => {
  console.error('Fixture failed:', err);
  process.exit(1);
});
