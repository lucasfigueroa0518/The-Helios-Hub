/**
 * Render every template with its layout sample (lib/memes/samples.ts) in
 * Chromium, run the renderer's checks (fit, faces), and write the PNGs plus a
 * contact sheet for review (BUILD_PLAN M2). No model call.
 *
 *   npx tsx scripts/memes_render_samples.ts [out dir, default .memes-local/samples]
 */
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { resolveMeme } from '@/lib/memes/fill';
import { CANVAS_H, CANVAS_W, openMemeRenderer } from '@/lib/memes/render';
import { SAMPLE_FILLS } from '@/lib/memes/samples';

async function main() {
  const out = path.resolve(process.argv[2] ?? '.memes-local/samples');
  fs.mkdirSync(out, { recursive: true });
  const renderer = await openMemeRenderer();
  const specs = SAMPLE_FILLS.map(resolveMeme);
  let failed = 0;
  try {
    const results = await renderer.render(specs);
    const tiles: Array<{ input: Buffer; left: number; top: number }> = [];
    const TW = 360;
    const TH = Math.round((TW * CANVAS_H) / CANVAS_W);
    for (const [i, r] of results.entries()) {
      const id = specs[i]!.templateId;
      fs.writeFileSync(path.join(out, `${id}.png`), r.png);
      if (r.problems.length) failed++;
      console.log(r.problems.length ? `  ✗ ${id}: ${r.problems.join('; ')}` : `  ✓ ${id}`);
      tiles.push({ input: await sharp(r.png).resize(TW, TH).png().toBuffer(), left: (i % 5) * (TW + 8), top: Math.floor(i / 5) * (TH + 8) });
    }
    const cols = 5;
    const rows = Math.ceil(specs.length / cols);
    await sharp({ create: { width: cols * (TW + 8), height: rows * (TH + 8), channels: 3, background: '#888888' } }).composite(tiles).png().toFile(path.join(out, 'sheet.png'));
  } finally {
    await renderer.close();
  }
  console.log(`${specs.length - failed} of ${specs.length} pass. Sheet: ${path.join(out, 'sheet.png')}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
