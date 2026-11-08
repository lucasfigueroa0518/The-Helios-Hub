// The headless browser try.mjs and bounds.mjs share: the Chrome HyperFrames already downloads, driven
// by the project's puppeteer-core (HyperFrames' runtime) or the repo's playwright-core, with the
// project served on a local port (module scripts do not load over file://). Without a driver or a
// Chrome, open() returns null and the checks report themselves skipped.
//
// A frame is loaded the way its composition loads it (mount.mjs): the kit installed, fonts loaded,
// build(root, ctx) run once; then window.__render(t) draws any moment.

import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FONT_LOADS } from './mount.mjs';

export const W = 1080;
export const H = 1920;

/** The headless Chrome HyperFrames downloaded (or HELIOS_CHROME). */
export function findChrome() {
  if (process.env.HELIOS_CHROME && existsSync(process.env.HELIOS_CHROME)) return process.env.HELIOS_CHROME;
  const names = new Set(['chrome-headless-shell', 'chrome', 'Google Chrome for Testing']);
  const roots = [join(process.env.HOME ?? homedir(), '.cache', 'hyperframes', 'chrome'), join(homedir(), '.cache', 'hyperframes', 'chrome')];
  const walk = (dir, depth) => {
    if (depth > 5 || !existsSync(dir)) return null;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isFile() && names.has(name) && st.mode & 0o111) return p;
      if (st.isDirectory()) {
        const hit = walk(p, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const r of roots) {
    const hit = walk(r, 0);
    if (hit) return hit;
  }
  return null;
}

function driver() {
  const bases = [process.env.HELIOS_NODE_MODULES, join(process.cwd(), 'node_modules'), dirname(fileURLToPath(import.meta.url))].filter(Boolean);
  const load = (name) => {
    for (const base of bases) {
      try {
        return createRequire(join(base, 'noop.js'))(name);
      } catch {
        // try the next
      }
    }
    return null;
  };
  const pptr = load('puppeteer-core');
  if (pptr) {
    return async (executablePath) => {
      const b = await pptr.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
      return {
        async page() {
          const pg = await b.newPage();
          await pg.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
          return pg;
        },
        close: () => b.close(),
      };
    };
  }
  const pw = load('playwright-core') ?? load('playwright');
  if (pw) {
    return async (executablePath) => {
      const b = await pw.chromium.launch({ executablePath, headless: true });
      return { page: () => b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }), close: () => b.close() };
    };
  }
  return null;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

/** Serve `root` on 127.0.0.1 (symlinks followed: assets/sfx-library is one). */
function serve(root) {
  const base = resolve(root);
  const server = http.createServer((req, res) => {
    const file = resolve(join(base, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if ((file !== base && !file.startsWith(base + sep)) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}#w{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden}</style></head>
<body><div id="w"></div><script type="module">
import * as nk from '../assets/kit/components/index.js';
nk.installKit(document, { fonts: '../assets/fonts/', textures: '../assets/kit/textures/' });
window.__load = async (id, ctx) => {
  const host = document.getElementById('w');
  host.innerHTML = '';
  const mod = (await import('../assets/frames/' + id + '.js?v=' + Math.random().toString(36).slice(2))).default;
  if (!mod || typeof mod.build !== 'function' || typeof mod.render !== 'function') throw new Error('the default export must be { ground, build(root, ctx), render(t) }');
  await Promise.all(${JSON.stringify(FONT_LOADS)}.map((f) => document.fonts.load(f).catch(() => null)));
  mod.build(host, Object.assign(ctx, { nk, assets: '../assets/' }));
  await Promise.all([...host.querySelectorAll('img')].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
  if (ctx.sting) { const { buildSting } = await import('../assets/kit/sting.js'); window.__sting = buildSting(host, nk, { at: ctx.sting.at }); } else window.__sting = null;
  window.__render = (t) => { mod.render(t); if (window.__sting) window.__sting.render(t); };
  return { ground: mod.ground ?? null };
};
window.__ready = true;
</script></body></html>`;

/**
 * Open the browser on the project at `root`. Returns null when no driver/Chrome is available, else
 * { page, errors, close() }: page has the harness loaded (window.__load / window.__render).
 */
export async function open(root) {
  const launch = driver();
  const chrome = findChrome();
  if (!launch) return { skipped: 'no browser driver (puppeteer-core or playwright-core) is installed' };
  if (!chrome) return { skipped: 'no headless Chrome found (HyperFrames downloads one on first render)' };
  const dir = join(root, '.hyperframes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'news-harness.html'), HARNESS);
  const server = await serve(root);
  const browser = await launch(chrome);
  const page = await browser.page();
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith('http://127.0.0.1') && !u.startsWith('data:')) external.push(u); });
  await page.goto(`http://127.0.0.1:${server.address().port}/.hyperframes/news-harness.html`);
  await page.waitForFunction('window.__ready === true');
  return { page, errors, external, close: async () => { await browser.close(); server.close(); } };
}
