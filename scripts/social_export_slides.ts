// scripts/social_export_slides.ts — Headless Chromium exports pixel-exact
// PNGs of each slide in a Helios Social fixture. Reuses the /social/render/
// preview route at scale=1 so the same component that renders in the Hub
// produces the file we upload to Instagram.
//
// Prereqs: dev server running (npx next dev -p 3001).
//
// Usage:
//   npx tsx scripts/social_export_slides.ts
//   npx tsx scripts/social_export_slides.ts --fixture example-post --humanized
//   npx tsx scripts/social_export_slides.ts --out exports/social/ig-drop --server http://localhost:3001
//
// No live Claude API calls unless --humanized is passed (opt-in, ~$0.005 per run).

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

import { FIXTURES } from '../fixtures/social/example-post';
import type { Post } from '../lib/social/render/types';

type Args = {
  fixture: string;
  /** When set, the preview loads a generated Post JSON from exports/social/generated/<slug>.json instead of a fixture. */
  generated: string | null;
  out: string;
  server: string;
  humanized: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    fixture: 'example-post',
    generated: null,
    out: '',
    server: 'http://localhost:3001',
    humanized: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fixture') out.fixture = argv[++i];
    else if (a === '--generated') out.generated = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--server') out.server = argv[++i];
    else if (a === '--humanized') out.humanized = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: npx tsx scripts/social_export_slides.ts [--fixture ID | --generated SLUG] [--out DIR] [--server URL] [--humanized]');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  if (!out.out) {
    out.out = path.join('exports', 'social', out.generated ? `gen-${out.generated}` : out.fixture);
  }
  return out;
}

function pngDimensions(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  // PNG signature is 8 bytes, IHDR chunk starts at byte 8 with 4-byte length +
  // 4-byte type ("IHDR"), then width (uint32 BE) at byte 16 and height at 20.
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${file}: not a valid PNG`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function checkServer(server: string): Promise<void> {
  try {
    const res = await fetch(`${server}/social/render/preview?fixture=example-post&slide=0&scale=1`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`preview route returned ${res.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ dev server not reachable at ${server}: ${msg}`);
    console.error('  start it with: npx next dev -p 3001');
    process.exit(1);
  }
}

async function captureSlide(
  page: Page,
  server: string,
  source: { fixture?: string; generated?: string },
  slideIndex: number,
  humanized: boolean,
  expected: { width: number; height: number },
  outFile: string,
): Promise<void> {
  const params = new URLSearchParams({
    slide: String(slideIndex),
    scale: '1',
  });
  if (source.generated) params.set('generated', source.generated);
  else params.set('fixture', source.fixture ?? 'example-post');
  if (humanized) params.set('humanized', '1');
  const url = `${server}/social/render/preview?${params}`;

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const slide = page.locator('.helios-slide[data-slide-ready="true"]').first();
  await slide.waitFor({ state: 'visible', timeout: 15_000 });

  // Fonts must be laid out before capture — a swap after screenshot ruins the file.
  await page.evaluate(() => document.fonts.ready);

  // All <img> tags must be decoded. broken images resolve too — we want *settled*, not *loaded*.
  await page.evaluate(async () => {
    const imgs = Array.from(document.images);
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
      ),
    );
  });

  if (humanized) {
    // Wait for the meta bar to flip from "humanizing…" to "humanized" (or "humanize failed").
    await page
      .locator('.preview-shell__meta', { hasText: /humanized|humanize failed/ })
      .waitFor({ state: 'visible', timeout: 30_000 });
  }

  await slide.screenshot({ path: outFile, type: 'png', omitBackground: false });

  const dims = pngDimensions(outFile);
  if (dims.width !== expected.width || dims.height !== expected.height) {
    throw new Error(
      `slide ${slideIndex}: expected ${expected.width}x${expected.height}, got ${dims.width}x${dims.height}`,
    );
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Post source: either a fixture from FIXTURES or a generated JSON on disk.
  let post: Post;
  if (args.generated) {
    const filePath = path.join('exports', 'social', 'generated', `${args.generated}.json`);
    if (!fs.existsSync(filePath)) {
      console.error(`✗ generated post not found at ${filePath}. Run "npm run helios-social:render-dry-run" first.`);
      process.exit(1);
    }
    try {
      post = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Post;
    } catch (err) {
      console.error(`✗ ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  } else {
    const fromFixture: Post | undefined = FIXTURES[args.fixture];
    if (!fromFixture) {
      console.error(`✗ fixture "${args.fixture}" not found. Available: ${Object.keys(FIXTURES).join(', ')}`);
      process.exit(1);
    }
    post = fromFixture;
  }

  await checkServer(args.server);

  const expected = post.format === 'story'
    ? { width: 1080, height: 1920 }
    : { width: 1080, height: 1350 };

  fs.mkdirSync(args.out, { recursive: true });

  const started = Date.now();
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1200, height: expected.height + 200 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    const written: string[] = [];
    for (let i = 0; i < post.slides.length; i++) {
      const outFile = path.join(args.out, `slide-${String(i).padStart(2, '0')}.png`);
      process.stdout.write(`  slide ${i} → ${outFile} ... `);
      await captureSlide(
        page,
        args.server,
        args.generated ? { generated: args.generated } : { fixture: args.fixture },
        i,
        args.humanized,
        expected,
        outFile,
      );
      process.stdout.write('ok\n');
      written.push(outFile);
    }

    const metaFile = path.join(args.out, 'metadata.json');
    fs.writeFileSync(
      metaFile,
      JSON.stringify(
        {
          fixture: args.fixture,
          humanized: args.humanized,
          exportedAt: new Date().toISOString(),
          format: post.format,
          storyType: post.storyType,
          source: post.source,
          sourceUrl: post.sourceUrl,
          slideCount: post.slides.length,
          files: written.map((f) => path.basename(f)),
        },
        null,
        2,
      ),
    );

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\n✓ ${written.length} slide${written.length === 1 ? '' : 's'} exported to ${args.out} (${elapsed}s)`);
    console.log(`  metadata: ${metaFile}`);
  } finally {
    if (browser) await browser.close();
  }
}

run().catch((err) => {
  console.error('\n✗ export failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
