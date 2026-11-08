// Snapshot the news kit gallery to PNGs: every component on all three scenes.
//   node explainers/real-case/kit/gallery.mjs [outDir]
// Default out: .explainers-local/real-case/kit-gallery/. Serves the repo on a local port (module scripts
// do not load over file://); the page itself makes no network requests beyond that local server.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.explainers-local/real-case/kit-gallery'));
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/explainers/real-case/kit/gallery.html`;

const SHOTS = [];
for (const scene of ['board', 'whiteboard', 'newspaper']) for (const sheet of ['paper', 'things', 'marks']) SHOTS.push({ scene, sheet });
SHOTS.push({ scene: 'whiteboard', sheet: 'marks', framing: 'close', name: 'whiteboard-marks-close' });
SHOTS.push({ scene: 'newspaper', sheet: 'marks', u: 0.5, name: 'newspaper-marks-half' });
SHOTS.push({ scene: 'board', sheet: 'things', u: 0.4, name: 'board-things-cord-unspooling' });

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const external = [];
tab.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:')) external.push(r.url()); });
tab.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });
for (const s of SHOTS) {
  const qs = new URLSearchParams({ scene: s.scene, sheet: s.sheet, ...(s.u != null ? { u: String(s.u) } : {}), ...(s.framing ? { framing: s.framing } : {}) });
  await tab.goto(`${base}?${qs}`);
  await tab.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  await tab.waitForTimeout(250);
  const name = s.name || `${s.scene}-${s.sheet}`;
  await tab.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('ok', path.relative(ROOT, path.join(OUT, `${name}.png`)));
}
await browser.close();
server.close();
if (external.length) { console.error('external requests (must be none):', external); process.exitCode = 1; }
