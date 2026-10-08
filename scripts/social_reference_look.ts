/**
 * Helios Social — render the target look (photo spec §5a: the Oct 4
 * hand-made walkthrough) to the image the render review keeps in its cached
 * prefix (photo spec §5b). Offline: headless Chromium on a local file.
 *
 *   npx tsx scripts/social_reference_look.ts [--preview <png>]
 *
 * Writes lib/social/render/assets/reference-look.png (long side ≤ 1568 px).
 */
import path from 'node:path';

const SOURCE = 'docs/superpowers/m8-drafts/reference-carousel-daily-run-2026-10-04.html';
const OUT = 'lib/social/render/assets/reference-look.png';
const LONG_SIDE = 1568;

async function main() {
  const at = process.argv.indexOf('--preview');
  const preview = at > 0 ? process.argv[at + 1] : undefined;
  const { chromium } = await import('playwright');
  const sharp = (await import('sharp')).default;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 2600, height: 1400 } });
    await page.goto(`file://${path.resolve(SOURCE)}`, { waitUntil: 'networkidle' });
    if (preview) await page.screenshot({ path: preview, fullPage: true });
    // The slides only (the walkthrough's .slide elements), as one grid: the look, not the walkthrough text.
    const shots: Buffer[] = [];
    for (const el of await page.$$('.slide')) shots.push(await el.screenshot());
    if (!shots.length) throw new Error('no .slide elements in the reference');
    const tw = 300;
    const tiles = await Promise.all(shots.map((b) => sharp(b).resize({ width: tw }).toBuffer()));
    const th = Math.max(...(await Promise.all(tiles.map(async (t) => (await sharp(t).metadata()).height ?? 0))));
    const cols = 5;
    const gap = 12;
    const rows = Math.ceil(tiles.length / cols);
    const W = cols * tw + (cols + 1) * gap;
    const H = rows * th + (rows + 1) * gap;
    const grid = await sharp({ create: { width: W, height: H, channels: 3, background: '#1a1a1a' } })
      .composite(tiles.map((input, i) => ({ input, left: gap + (i % cols) * (tw + gap), top: gap + Math.floor(i / cols) * (th + gap) })))
      .png()
      .toBuffer();
    const scale = Math.min(1, LONG_SIDE / Math.max(W, H));
    await sharp(grid).resize(Math.round(W * scale), Math.round(H * scale)).png().toFile(OUT);
    console.log(`${OUT}: ${tiles.length} slides, ${Math.round(W * scale)}×${Math.round(H * scale)}`);
  } finally {
    await browser.close();
  }
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
