// The kit gallery, rendered (iteration 4): every case in gallery.html at its moment, in headless Chrome,
// saved as a still for review. The caption over each is set the way the reel sets it: the band is sampled
// with the caption hidden (measure.mjs) and the sampled tone is applied. Local only: the repo is served
// on 127.0.0.1, no model and no network.
//
//   node explainers/reel-ai-drama/kit/gallery.mjs [outDir] [shot …]
//
// Default outDir: planning/AI Mini Docs/test-runs/iter8-gallery. Prints one JSON line per still.

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { driver, findChrome, serve } from './browser.mjs';
import { sampleBand, toneFor } from './measure.mjs';

const KIT = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(KIT, '../../..');

/** [shot, t]: the review cases, a shot at each moment worth seeing (a lift before and after its peel). */
export const CASES = [
  ['iter4-face-ring', 2.5],
  ['iter4-text-ring', 3],
  ['iter4-centred', 2],
  ['iter4-cutout', 2],
  ['iter4-caption-article', 1],
  ['iter4-stat-counter', 2.5],
  ['iter4-stat-bar', 2.5],
  ['iter4-stat-scale', 2.5],
  ['iter4-lift', 0.4],
  ['iter4-lift', 2.5],
  ['iter4-drawn', 2],
  ['iter4-collage-style', 2.5],
  ['iter7-date-label', 2],
  ['iter7-object-tableau', 2],
  ['iter7-object-collage', 2],
  // Iteration 8: each move at its moments; before (`newspaper`, `board`) and after (`newspaper-moment`, `board-players`).
  ['move-flash', 0.52],
  ['move-flash', 2],
  ['move-phone', 3],
  ['move-click', 0.4],
  ['move-click', 1.3],
  ['move-click', 3.5],
  ['move-burst', 0.6],
  ['move-burst', 1.5],
  ['move-speech', 2],
  ['move-speech-tableau', 2],
  ['move-cuts', 1],
  ['move-cuts', 3],
  ['move-cuts', 5],
  ['move-drawn-logo', 1.2],
  ['move-drawn-logo', 3],
  ['stat-camera', 1],
  ['stat-camera', 3],
  ['stat-world', 0.5],
  ['board', 2.5],
  ['board-players', 2.8],
  ['board-players-five', 3],
  ['newspaper', 2.5],
  ['newspaper-moment', 0.22],
  ['newspaper-moment', 0.7],
  ['newspaper-moment', 1],
  ['newspaper-moment', 3],
  ['newspaper-words', 3],
  ['close-fade', 0.2],
  ['close', 0.5],
  ['close', 1.2],
  ['close', 2.4],
];

export async function renderGallery(outDir = join(REPO, 'planning', 'AI Mini Docs', 'test-runs', 'iter8-gallery'), only = []) {
  const launch = driver();
  const chrome = findChrome();
  if (!launch || !chrome) return { ok: false, skipped: !launch ? 'no browser driver' : 'no headless Chrome' };
  mkdirSync(outDir, { recursive: true });
  const server = await serve(REPO);
  const browser = await launch(chrome);
  const page = await browser.page();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
  const out = [];
  try {
    for (const [shot, t] of CASES.filter(([s]) => !only.length || only.includes(s))) {
      const before = errors.length;
      await page.goto(`http://127.0.0.1:${server.address().port}/explainers/reel-ai-drama/kit/gallery.html?shot=${shot}&t=${t}`);
      await page.waitForFunction('window.__ready === true', { timeout: 30000 });
      await page.evaluate(() => window.__cap(false));
      const sample = await sampleBand(page, t);
      const tone = toneFor(sample);
      await page.evaluate((x) => { window.__render(x.t); window.__tone(x.tone); window.__cap(true); }, { t, tone });
      const file = join(outDir, `${shot}-t${t}.png`);
      await page.screenshot({ path: file, type: 'png' });
      out.push({ shot, t, tone, p10: round(sample?.p10), p90: round(sample?.p90), file, errors: errors.slice(before) });
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { ok: errors.length === 0, stills: out };
}

const round = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, ...only] = process.argv.slice(2);
  renderGallery(dir ? resolve(dir) : undefined, only)
    .then((r) => {
      for (const s of r.stills ?? []) console.log(JSON.stringify({ ...s, file: s.file.replace(`${REPO}/`, '') }));
      if (r.skipped) console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
