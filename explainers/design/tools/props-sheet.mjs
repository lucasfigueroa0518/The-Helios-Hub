// Renders a kit contact sheet to a PNG (Explainers 3.2, EX3-78): the prop library by default, or
// another sheet page in this folder (critter-sheet.html).
//   node explainers/design/tools/props-sheet.mjs <out.png> [query, e.g. "only=chair,jar&focal=1"] [page.html]
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [out = 'props-sheet.png', query = '', sheet = 'props-sheet.html'] = process.argv.slice(2);
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' };
const srv = createServer((req, res) => {
  try {
    const p = join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(root)) throw new Error('outside');
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
await new Promise((ok) => srv.on('listening', ok));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://127.0.0.1:${srv.address().port}/design/tools/${sheet}?${query}`);
await page.waitForSelector('body[data-done="1"]', { timeout: 30000 }).catch(() => errors.push('sheet never finished'));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
srv.close();
if (errors.length) console.error(errors.join('\n'));
console.log(out);
