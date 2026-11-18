#!/usr/bin/env node
/**
 * Click-to-full timing for the Social Hub entry in the hub sidebar. Opens a hub page,
 * lets it settle, hovers "Social Hub" for --hover ms (a person's pointer reaching and
 * resting on the link), clicks, and times click -> the Content page fully on screen:
 * URL /social, today's strip rendered (#today-strip), no loading skeleton, nothing
 * pending in the hub nav, and every image in the page decoded.
 *   source perf/env.sh
 *   node perf/lib/social-click.mjs [--from /hub] [--runs 10] [--hover 250] [--port 3100] [--dir .]
 * Local database through the latency proxy (2.5 ms each way), production build.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintSessionCookie } from './session.mjs';

const PERF_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []));
const FROM = args.from ?? '/hub';
const RUNS = Number(args.runs ?? 10);
const HOVER = Number(args.hover ?? 250);
const PORT = Number(args.port ?? 3100);
const DIR = path.resolve(args.dir ?? '.');
const proxied = new URL(process.env.DATABASE_URL);
const target = `${proxied.hostname}:${proxied.port || 5432}`;
proxied.port = '6543';
const procs = [spawn(process.execPath, [path.join(PERF_DIR, 'lib/latency-proxy.mjs'), '--listen', '6543', '--target', target, '--one-way-ms', '2.5'], { stdio: 'ignore' })];
procs.push(spawn(path.join(DIR, 'node_modules/.bin/next'), ['start', '-p', String(PORT), '-H', '127.0.0.1'], {
  cwd: DIR, stdio: 'ignore', detached: true,
  env: { ...process.env, NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: proxied.toString(), DIRECT_DATABASE_URL: proxied.toString() },
}));
const stop = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch { /* gone */ } } } };
process.on('exit', stop);
const ping = () => new Promise((resolve) => { http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0)); });
for (let i = 0; i < 300 && (await ping()) === 0; i += 1) await new Promise((r) => setTimeout(r, 200));

const cookie = await mintSessionCookie();
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const [k, ...v] = cookie.split('=');
const results = [];
for (let run = 0; run < RUNS + 1; run += 1) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: k, value: v.join('='), domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}${FROM}`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(Number(args.settle ?? 1500)); // the page as a person sees it before reaching for the menu
  if (args.precss) await page.evaluate((hrefs) => Promise.all(hrefs.split(',').map((h) => new Promise((r) => { const l = document.createElement('link'); l.rel = args_mode(); l.as = 'style'; l.href = h; l.onload = l.onerror = r; document.head.appendChild(l); function args_mode() { return 'preload'; } }))), args.precss);
  const link = page.locator('a.hub-nav-item__row[href="/social"]').first();
  await link.hover();
  await page.waitForTimeout(HOVER);
  const ms = await page.evaluate(() => new Promise((resolve) => {
    const link = document.querySelector('a.hub-nav-item__row[href="/social"]');
    const t0 = performance.now();
    window.__t0 = t0;
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime - t0), Math.round(e.duration)]); }).observe({ type: 'longtask' });
    const done = () => {
      if (location.pathname !== '/social') return false;
      if (!document.querySelector('#today-strip')) return false;
      if (document.querySelector('.sh-loading, [data-hub-loading], [aria-busy="true"]')) return false;
      const imgs = [...document.querySelectorAll('.sh img')];
      return imgs.every((img) => img.complete);
    };
    const marks = {};
    const mark = (k, ok) => { if (ok && marks[k] == null) marks[k] = Math.round(performance.now() - t0); };
    const tick = () => {
      mark('url', location.pathname === '/social');
      mark('skeleton', Boolean(document.querySelector('.sh-page-loading')));
      mark('shRoot', Boolean(document.querySelector('.sh')));
      mark('strip', Boolean(document.querySelector('#today-strip')));
      mark('notBusy', location.pathname === '/social' && !document.querySelector('[aria-busy="true"]'));
      if (done()) { window.__marks = marks; resolve(performance.now() - t0); } else requestAnimationFrame(tick);
    };
    link.click();
    requestAnimationFrame(tick);
  }));
  if (run > 0) results.push(ms); // first run warms the server's caches and code
  const rsc = await page.evaluate((args_all) => performance.getEntriesByType('resource')
    .filter((e) => args_all || e.name.includes('_rsc=') || e.name.includes('/api/hub/warm'))
    .map((e) => `${new URL(e.name).pathname}${e.name.includes('_rsc') ? '?_rsc' : ''} start ${e.startTime.toFixed(0)} dur ${e.duration.toFixed(0)} ttfb ${(e.responseStart - e.requestStart).toFixed(0)} ${(e.transferSize / 1024).toFixed(0)}KB`), Boolean(args.all));
  if (args.verbose) console.log('   marks', JSON.stringify(await page.evaluate(() => window.__marks)), 'longtasks', JSON.stringify(await page.evaluate(() => window.__long)));
  if (args.verbose) console.log('   after click:', (await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.startTime > window.__t0 - 5).map((e) => `${Math.round(e.startTime - window.__t0)}+${Math.round(e.duration)} ${new URL(e.name).pathname}${new URL(e.name).search.slice(0, 30)}`))).join('\n      '));
  console.log(`run ${run}${run ? '' : ' (warm-up)'}: ${ms.toFixed(1)} ms${args.verbose ? `\n   ${rsc.join('\n   ')}` : ''}`);
  await ctx.close();
}
await browser.close();
const sorted = [...results].sort((a, b) => a - b);
const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const summary = { from: FROM, hoverMs: HOVER, runs: RUNS, p50: +pick(0.5).toFixed(1), p95: +pick(0.95).toFixed(1), max: +sorted.at(-1).toFixed(1), all: results.map((x) => +x.toFixed(1)) };
console.log(JSON.stringify(summary));
if (args.out) fs.writeFileSync(args.out, JSON.stringify(summary, null, 2));
stop();
process.exit(0);
