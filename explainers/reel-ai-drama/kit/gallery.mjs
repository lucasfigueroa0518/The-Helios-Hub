// Snapshot the Reel AI Drama kit gallery: every treatment on real banked images (and the smoke fixture's
// page and map) to PNGs, then one contact sheet of them all for Lucas.
//   node explainers/reel-ai-drama/kit/gallery.mjs [outDir]
// Default out: .explainers-local/reel-ai-drama/kit-gallery/. Serves the repo on a local port (module
// scripts do not load over file://); the page makes no network requests beyond that local server.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.explainers-local/reel-ai-drama/kit-gallery'));
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/explainers/reel-ai-drama/kit/gallery.html`;

/** [shot, t]: each treatment at a moment where its move, marks and words are under way or done. */
export const SHOTS = [
  ['photo', 3], ['photo-pan', 3], ['cutout_lift', 2.5], ['collision', 2], ['page', 3], ['page-underline', 3], ['document', 3], ['post', 2],
  ['map', 2.5], ['headline', 2.5], ['lower_third', 2.5], ['number', 2.5], ['board', 1], ['whiteboard', 1], ['newspaper', 1], ['close', 1.6],
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const external = [];
tab.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:')) external.push(r.url()); });
tab.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });
const files = [];
for (const [shot, t] of SHOTS) {
  await tab.goto(`${base}?${new URLSearchParams({ shot, t: String(t) })}`);
  await tab.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  await tab.waitForTimeout(200);
  const file = path.join(OUT, `${shot}.png`);
  await tab.screenshot({ path: file });
  files.push([shot, t, file]);
  console.log('ok', path.relative(ROOT, file));
}
// The contact sheet: every shot at a third of its size, labelled.
const sheet = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1a1a1a;font:600 22px system-ui;color:#ddd}
.g{display:grid;grid-template-columns:repeat(4,360px);gap:24px;padding:32px}.t img{width:360px;height:640px;display:block;border-radius:6px}.t div{margin-top:8px}</style>
<div class="g">${files.map(([s, t, f]) => `<div class="t"><img src="${path.basename(f)}"><div>${s} · ${t}s</div></div>`).join('')}</div>`;
fs.writeFileSync(path.join(OUT, 'sheet.html'), sheet);
const sp = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await sp.goto(`http://127.0.0.1:${server.address().port}/${path.relative(ROOT, path.join(OUT, 'sheet.html'))}`);
await sp.waitForTimeout(500);
await sp.screenshot({ path: path.join(OUT, 'kit-gallery-sheet.png'), fullPage: true });
console.log('sheet', path.relative(ROOT, path.join(OUT, 'kit-gallery-sheet.png')));
await browser.close();
server.close();
if (external.length) { console.error('external requests (must be none):', [...new Set(external)]); process.exitCode = 1; }
