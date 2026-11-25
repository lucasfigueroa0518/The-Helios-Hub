#!/usr/bin/env node
/**
 * Interaction-latency harness (Sub-10ms playbook, Phase 1A + 7).
 *
 * Drives real pointer input (move, hover, down, up) through Playwright on a production
 * build against the local perf database, and records per interaction:
 *   M1  main-thread work: input delay + every input-event handler (capture-to-bubble on
 *       window, React's microtask flush included) + the rendering step of the next frame
 *       (rAF -> after-frame task). Long Animation Frames override it when larger.
 *   M2  visual acknowledgment: input timestamp -> end of the first frame with a DOM change.
 *   M3  content complete: input -> last DOM change before 300 ms of quiet (cap 4 s).
 *   M5  long animation frames (>50 ms) during the interaction.
 *   INP the Event Timing duration of the interaction (Chrome's own number, >= 16 ms only).
 * Safety: every non-GET request and every request off 127.0.0.1 is answered 503 by the
 * browser itself, so clicking cannot write data or spend money. Those blocked writes are
 * counted, which is how the double-click test finds duplicate mutations.
 *
 *   source perf/env.sh && node perf/interaction/harness.mjs --out sweep-low --tier low
 *   node perf/interaction/harness.mjs --out top --tier low --runs 15 --ids perf/interaction/top.txt
 * Flags: --routes /hub,/social  --max 20 (elements per page)  --runs 1  --tier low|mid
 *        --no-server (reuse a running server on --port)  --double (also run the double-click test)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintSessionCookie } from '../lib/session.mjs';

const PERF_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(PERF_DIR);
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) continue;
  const next = argv[i + 1];
  args[argv[i].slice(2)] = next && !next.startsWith('--') ? next : true;
}
const PORT = Number(args.port ?? 3100);
const RUNS = Number(args.runs ?? 1);
const MAX = Number(args.max ?? 20);
const TIER = args.tier ?? 'low';
const WRITE_MS = Number(args['write-ms'] ?? 800);
const CPU = { low: 4, mid: 2, high: 1 }[TIER] ?? 4;
const OUT = path.join(PERF_DIR, 'runs', 'interaction', String(args.out ?? `run-${TIER}`));
fs.mkdirSync(OUT, { recursive: true });
const ONLY_IDS = args.ids ? new Set(fs.readFileSync(args.ids, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) : null;

// Routes: measurable pages with no dynamic segment, unless --routes is given.
const allRoutes = JSON.parse(fs.readFileSync(path.join(PERF_DIR, 'routes.json'), 'utf8'));
const ROUTES = args.routes
  ? String(args.routes).split(',')
  : [...new Set(allRoutes.filter((r) => r.kind === 'page' && r.measure && !r.path.includes('[')).map((r) => r.sample?.path ?? r.path))];

// Labels that are never clicked even with writes blocked: leaving the app or the session.
const SKIP = /\b(sign ?out|log ?out|download|export|print|open in new|copy link)\b/i;

// ---------- server ----------
const procs = [];
const stop = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch { /* gone */ } } } };
process.on('exit', stop);
process.on('SIGINT', () => process.exit(130));
if (!args['no-server']) {
  const proxied = new URL(process.env.DATABASE_URL);
  const target = `${proxied.hostname}:${proxied.port || 5432}`;
  proxied.port = '6543';
  procs.push(spawn(process.execPath, [path.join(PERF_DIR, 'lib/latency-proxy.mjs'), '--listen', '6543', '--target', target, '--one-way-ms', '2.5'], { stdio: 'ignore', detached: true }));
  procs.push(spawn(path.join(ROOT, 'node_modules/.bin/next'), ['start', '-p', String(PORT), '-H', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore', detached: true,
    env: { ...process.env, NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: proxied.toString(), DIRECT_DATABASE_URL: proxied.toString() },
  }));
}
const ping = () => new Promise((resolve) => { http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0)); });
for (let i = 0; i < 300 && (await ping()) === 0; i += 1) await new Promise((r) => setTimeout(r, 200));

// ---------- in-page probe ----------
const PROBE = () => {
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* blocked */ }
  const ix = { events: [], loafs: [], cur: null, mutations: 0, lastMutation: 0 };
  window.__ix = ix;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) ix.events.push({ start: e.startTime, dur: e.duration, ps: e.processingStart, pe: e.processingEnd, name: e.name }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch { /* unsupported */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) ix.loafs.push({ start: e.startTime, end: e.startTime + e.duration, block: e.blockingDuration, scripts: e.scripts.map((s) => ({ inv: s.invoker, src: String(s.sourceURL || '').split('/').pop(), fn: s.sourceFunctionName, d: Math.round(s.duration) })).sort((a, b) => b.d - a.d).slice(0, 3) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch { /* unsupported */ }
  const afterFrame = (cb) => requestAnimationFrame((tRaf) => { const t = performance.now(); const ch = new MessageChannel(); ch.port1.onmessage = () => cb(t, performance.now()); ch.port2.postMessage(0); });
  const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  for (const type of types) {
    window.addEventListener(type, (e) => {
      const c = ix.cur; if (!c || !e.isTrusted) return;
      if (c.input == null) c.input = e.timeStamp;
      if (c.firstDispatch == null) c.firstDispatch = performance.now();
      c.ts[type] = e.timeStamp;
      if (type === 'pointerup') c.releaseDispatch = performance.now();
      c.open[type] = performance.now();
    }, true);
    window.addEventListener(type, (e) => {
      const c = ix.cur; if (!c || !e.isTrusted || c.open[type] == null) return;
      const d = performance.now() - c.open[type];
      if (type === 'pointerdown' || type === 'mousedown') c.pressHandlers += d; else c.handlers += d;
      c.byType[type] = +(performance.now() - c.open[type]).toFixed(2);
      if (type === 'click') afterFrame((tRaf, tAfter) => { c.render = tAfter - tRaf; c.frameEnd = tAfter; });
    }, false);
  }
  new MutationObserver((list) => {
    const c = ix.cur; if (!c || c.input == null) return;
    const t = performance.now();
    ix.lastMutation = t;
    if (c.firstMutation == null) { c.firstMutation = t; c.ackFrom = Math.max(...Object.values(c.ts).filter((x) => x <= t)); afterFrame((_r, tAfter) => { c.ackFrameEnd = tAfter; }); }
    c.mutations += list.length;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  window.__ixStart = () => { ix.cur = { open: {}, ts: {}, byType: {}, handlers: 0, pressHandlers: 0, mutations: 0 }; };
  window.__ixResult = () => {
    const c = ix.cur; if (!c || c.input == null) return null;
    // Press and release are separate frames: M1 is the heavier of the two (as INP picks one event).
    const release = c.ts.pointerup ?? c.ts.click ?? c.input;
    const inputDelay = Math.max(0, (c.releaseDispatch ?? c.firstDispatch) - release);
    const pressM1 = Math.max(0, c.firstDispatch - c.input) + c.pressHandlers;
    const end = (c.frameEnd ?? release) + 1;
    const loafs = ix.loafs.filter((f) => f.end > c.input && f.start < c.input + 1000);
    const loafBusy = loafs.filter((f) => f.start < end).reduce((s, f) => s + (Math.min(f.end, end) - Math.max(f.start, c.input)), 0);
    const loafRelease = loafs.filter((f) => f.start < end && f.end > release).reduce((s, f) => s + (Math.min(f.end, end) - Math.max(f.start, release)), 0);
    const m1 = Math.max(inputDelay + c.handlers + (c.render ?? 0), pressM1, loafRelease);
    const ev = ix.events.filter((e) => e.start >= c.input - 1 && e.start < c.input + 1000).sort((a, b) => b.dur - a.dur)[0];
    return {
      inputDelay: +inputDelay.toFixed(2),  handlers: +c.handlers.toFixed(2), render: +(c.render ?? 0).toFixed(2), m1: +m1.toFixed(2),
      m2: c.ackFrameEnd != null ? +(c.ackFrameEnd - c.ackFrom).toFixed(1) : null,
      m3: c.firstMutation != null ? +Math.max(0, ix.lastMutation - release).toFixed(1) : null,
      press: +pressM1.toFixed(2), loafBusy: +loafBusy.toFixed(1),
      longFrames: loafs.length, loafScripts: loafs.flatMap((f) => f.scripts).sort((a, b) => b.d - a.d).slice(0, 3),
      inp: ev ? Math.round(ev.dur) : null, mutations: c.mutations, byType: c.byType,
    };
  };
};

// ---------- browser ----------
const cookie = await mintSessionCookie();
const [ck, ...cv] = cookie.split('=');
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: ck, value: cv.join('='), domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(PROBE);
// --no-cv: A/B the QUEUE_CV flag without a rebuild by forcing the cards back to visible.
if (args['no-cv']) await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.send-queue-board-scroller--cv .send-queue-day-panel > div:last-child > button{content-visibility:visible!important;contain-intrinsic-size:none!important}'; document.head.appendChild(st); }); });
let writes = [];
await ctx.route('**/*', async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  if (u.hostname !== '127.0.0.1' && !u.protocol.startsWith('data')) return route.fulfill({ status: 503, body: '' });
  if (req.method() !== 'GET' && req.method() !== 'HEAD') {
    writes.push(`${req.method()} ${u.pathname}`);
    // Held in flight like a real write (default 800 ms), so a second click lands while the first is pending.
    await new Promise((r) => setTimeout(r, WRITE_MS));
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"perf harness: writes blocked"}' });
  }
  return route.continue();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

const goto = async (route) => {
  await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
};

// Discover candidates: visible, enabled, in-app controls; stable id = route + role + label + ordinal.
const discover = (route) => page.evaluate(({ route, max, skip }) => {
  const re = new RegExp(skip, 'i');
  const sel = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], summary, input[type="checkbox"], select, label[for]';
  const seen = new Map();
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (el.closest('[aria-hidden="true"], [inert]') || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    const href = el.getAttribute('href');
    if (href && (/^(https?:|mailto:|tel:|#$)/.test(href) && !href.startsWith(location.origin) || href.startsWith('/api/') || el.target === '_blank' || el.hasAttribute('download'))) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!label || re.test(label)) continue;
    const kind = href ? 'nav' : (el.getAttribute('role') || el.tagName.toLowerCase());
    const key = `${route}|${kind}|${label}`;
    const n = (seen.get(key) ?? 0) + 1; seen.set(key, n);
    const id = n > 1 ? `${key}#${n}` : key;
    el.setAttribute('data-ix-id', id);
    out.push({ id, route, kind, label, href: href ?? '', x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
  // Prefer variety: nav first (shared shell), then the rest, capped.
  return out.slice(0, max * 3);
}, { route, max: MAX, skip: SKIP.source });

const humanClick = async (x, y, double = false) => {
  await page.mouse.move(x - 40, y - 12);
  await page.mouse.move(x, y, { steps: 6 }); // pointer sweeping onto the target
  await page.waitForTimeout(120); // hover dwell before the press
  await page.evaluate(() => window.__ixStart());
  await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  if (double) { await page.waitForTimeout(80); await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up(); }
};
const waitQuiet = async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const quiet = await page.evaluate(() => performance.now() - (window.__ix?.lastMutation ?? 0) > 300).catch(() => false);
    if (quiet && Date.now() - t0 > 350) break;
    await page.waitForTimeout(100);
  }
};

const sel = (id) => `[data-ix-id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
const rows = [];
const write = () => fs.writeFileSync(path.join(OUT, 'samples.json'), JSON.stringify({ tier: TIER, cpu: CPU, rows }, null, 1));
for (const route of ROUTES) {
  try { await goto(route); } catch (e) { console.log(`skip ${route}: ${e.message.split('\n')[0]}`); continue; }
  const home = new URL(page.url()).pathname;
  let cands = await discover(route);
  if (ONLY_IDS) cands = cands.filter((c) => ONLY_IDS.has(c.id));
  else {
    const nav = cands.filter((c) => c.kind === 'nav'); const rest = cands.filter((c) => c.kind !== 'nav');
    cands = [...rest.slice(0, Math.ceil(MAX * 0.6)), ...nav].slice(0, MAX);
  }
  console.log(`${route}: ${cands.length} interactions`);
  for (const c of cands) {
    for (let run = 0; run < RUNS + (args.double ? 1 : 0); run += 1) {
      const double = args.double && run === RUNS;
      try {
        if (new URL(page.url()).pathname !== home || !(await page.$(sel(c.id)).catch(() => null))) { await goto(route); await discover(route); }
        const el = await page.$(sel(c.id));
        if (!el) { rows.push({ ...c, run, error: 'not found' }); break; }
        const box = await el.boundingBox();
        if (!box) { rows.push({ ...c, run, error: 'no box' }); break; }
        writes = []; errors.length = 0;
        const urlBefore = page.url();
        await humanClick(box.x + box.width / 2, box.y + box.height / 2, double);
        await waitQuiet();
        const r = await page.evaluate(() => window.__ixResult()).catch(() => null);
        const navigated = page.url() !== urlBefore;
        rows.push({ ...c, run, double, navigated, writes: [...writes], errors: [...errors], ...(r ?? { error: 'no result' }) });
        if (navigated) await goto(route);
        else { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
      } catch (e) {
        rows.push({ ...c, run, error: e.message.split('\n')[0].slice(0, 160) });
        await goto(route).catch(() => {});
      }
    }
    write();
  }
}
write();
await browser.close();
console.log(`samples -> ${path.relative(ROOT, OUT)}/samples.json (${rows.length})`);
stop();
process.exit(0);
