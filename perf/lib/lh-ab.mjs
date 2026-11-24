#!/usr/bin/env node
/**
 * Lighthouse A/B: two production builds served side by side on the same data and DB
 * proxy, Lighthouse alternating between them (A, B, A, B, ...) so drift hits both.
 *   source perf/env.sh
 *   node perf/lib/lh-ab.mjs --a /path/to/baseline-checkout --b . --runs 5 --pages /,/hub,/dashboards --out perf/experiments/lh-ab.json
 * Same throttling as perf/measure.mjs (mobile, Fast 4G, 4x CPU). Reports medians.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintSessionCookie } from './session.mjs';

const PERF_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []));
const RUNS = Number(args.runs ?? 5);
const ids = JSON.parse(fs.readFileSync(path.join(PERF_DIR, 'db', 'seed-ids.json'), 'utf8'));
const pages = String(args.pages).split(',').map((p) => p.replace(/\{(\w+)\}/g, (_, k) => ids[k]));
const sides = { A: { dir: path.resolve(args.a), port: 3101 }, B: { dir: path.resolve(args.b), port: 3102 } };
const target = new URL(process.env.DATABASE_URL);
const proxied = new URL(process.env.DATABASE_URL);
proxied.port = '6543';
const procs = [];
procs.push(spawn(process.execPath, [path.join(PERF_DIR, 'lib/latency-proxy.mjs'), '--listen', '6543', '--target', `${target.hostname}:${target.port || 5432}`, '--one-way-ms', '2.5'], { stdio: 'ignore' }));
for (const s of Object.values(sides)) {
  procs.push(spawn(path.join(s.dir, 'node_modules/.bin/next'), ['start', '-p', String(s.port), '-H', '127.0.0.1'], {
    cwd: s.dir, stdio: 'ignore', detached: true,
    env: { ...process.env, NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: proxied.toString(), DIRECT_DATABASE_URL: proxied.toString() },
  }));
}
const stop = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch { /* gone */ } } } };
process.on('exit', stop);
const get = (port, url, cookie) => new Promise((resolve) => {
  http.get(`http://127.0.0.1:${port}${url}`, { headers: { cookie } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', () => resolve(0));
});
const cookie = await mintSessionCookie();
for (const s of Object.values(sides)) for (let i = 0; i < 300 && (await get(s.port, '/api/health', cookie)) === 0; i += 1) await new Promise((r) => setTimeout(r, 200));

const { default: lighthouse } = await import('lighthouse');
const chromeLauncher = await import('chrome-launcher');
let chrome = await chromeLauncher.launch({ chromePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
process.on('uncaughtException', (e) => console.warn('uncaught (continuing):', String(e?.message ?? e).slice(0, 120)));
const settings = {
  output: 'json', logLevel: 'error', onlyCategories: ['performance'], formFactor: 'mobile',
  screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
  throttlingMethod: 'devtools',
  throttling: { requestLatencyMs: 165, downloadThroughputKbps: 8100, uploadThroughputKbps: 1350, cpuSlowdownMultiplier: 4, rttMs: 165, throughputKbps: 8100 },
  extraHeaders: { Cookie: cookie }, maxWaitForLoad: 20000,
};
async function once(port, page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { lhr } = await lighthouse(`http://127.0.0.1:${port}${page}`, { ...settings, port: chrome.port });
      if (lhr.runtimeError) throw new Error(lhr.runtimeError.message);
      const scripts = (lhr.audits['network-requests']?.details?.items ?? []).filter((it) => it.resourceType === 'Script');
      return { lcp: lhr.audits['largest-contentful-paint'].numericValue, fcp: lhr.audits['first-contentful-paint'].numericValue, tbt: lhr.audits['total-blocking-time'].numericValue, cls: lhr.audits['cumulative-layout-shift'].numericValue, jsKB: scripts.reduce((s, it) => s + (it.transferSize ?? 0), 0) / 1024, totalKB: lhr.audits['total-byte-weight'].numericValue / 1024 };
    } catch (error) {
      console.warn(`  retry ${page} on :${port}: ${String(error?.message ?? error).slice(0, 100)}`);
      try { await chrome.kill(); } catch { /* gone */ }
      chrome = await chromeLauncher.launch({ chromePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
    }
  }
  return null;
}
const median = (xs) => { const s = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(s.length / 2)] * 10) / 10 : null; };
const out = { runs: RUNS, a: sides.A.dir, b: sides.B.dir, pages: {} };
for (const page of pages) {
  for (const s of Object.values(sides)) for (let i = 0; i < 2; i += 1) await get(s.port, page, cookie); // warm both
  const res = { A: [], B: [] };
  for (let i = 0; i < RUNS; i += 1) for (const side of i % 2 ? ['B', 'A'] : ['A', 'B']) { const r = await once(sides[side].port, page); if (r) res[side].push(r); }
  const sum = (list) => Object.fromEntries(['lcp', 'fcp', 'tbt', 'cls', 'jsKB', 'totalKB'].map((k) => [k, median(list.map((r) => r[k]))]));
  out.pages[page] = { A: sum(res.A), B: sum(res.B), n: { A: res.A.length, B: res.B.length } };
  const a = out.pages[page].A, b = out.pages[page].B;
  console.log(`${page.padEnd(44)} LCP ${a.lcp}->${b.lcp}  FCP ${a.fcp}->${b.fcp}  TBT ${a.tbt}->${b.tbt}  JS ${a.jsKB?.toFixed(0)}->${b.jsKB?.toFixed(0)}KB  total ${a.totalKB?.toFixed(0)}->${b.totalKB?.toFixed(0)}KB`);
}
await chrome.kill();
if (args.out) fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
stop();
process.exit(0);
