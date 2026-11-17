#!/usr/bin/env node
/**
 * Route latency + page-weight harness (perf/README.md).
 *
 *   source perf/env.sh
 *   node perf/measure.mjs --out baseline            # full run: cold + warm + trace + lighthouse
 *   node perf/measure.mjs --out quick --runs 10 --cold-cycles 0 --no-lighthouse --only page:hub
 *
 * Starts `next start` itself (a production build must exist), so it can
 * restart the server between cold cycles. Cold = fresh server process with an
 * empty Next data cache, one request per route, route order shuffled each
 * cycle. Warm = the same process after warm-up, N sequential requests.
 * Trace = one warm request per route with perf/lib/pg-trace.cjs preloaded
 * (query count, query time, repeated statements = N+1 signal).
 *
 * Writes perf/<out>.json and perf/<out>.md.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { mintSessionCookie } from './lib/session.mjs';
import { markdown } from './lib/table.mjs';

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(PERF_DIR);

// ---------- args ----------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    if (key.startsWith('no-')) { out[key.slice(3)] = false; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = next;
    i += 1;
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const OUT = String(args.out ?? 'run');
const RUNS = Number(args.runs ?? 30);
const COLD_CYCLES = Number(args['cold-cycles'] ?? 30);
const WARMUP = Number(args.warmup ?? 3);
const PORT = Number(args.port ?? process.env.PERF_APP_PORT ?? 3100);
const LIGHTHOUSE = args.lighthouse !== false;
const LH_RUNS = Number(args['lh-runs'] ?? 1);
const TRACE = args.trace !== false;
const ONLY = args.only ? String(args.only).split(',') : null;
const KIND = args.kind ? String(args.kind) : null; // page | api
const BASE = `http://127.0.0.1:${PORT}`;
const RUN_DIR = path.join(PERF_DIR, 'runs', OUT);
fs.mkdirSync(RUN_DIR, { recursive: true });

// ---------- routes ----------
const ids = JSON.parse(fs.readFileSync(path.join(PERF_DIR, 'db', 'seed-ids.json'), 'utf8'));
const allRoutes = JSON.parse(fs.readFileSync(path.join(PERF_DIR, 'routes.json'), 'utf8'));

function fill(template) {
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    if (!(key in ids)) throw new Error(`seed-ids.json has no value for {${key}} (route ${template})`);
    return encodeURIComponent(String(ids[key]));
  });
}

function buildUrl(route) {
  const sample = route.sample ?? {};
  let url = fill(sample.path ?? route.path);
  if (sample.query && Object.keys(sample.query).length) {
    const qs = new URLSearchParams(Object.entries(sample.query).map(([k, v]) => [k, fill(String(v))]));
    url += (url.includes('?') ? '&' : '?') + qs.toString();
  }
  return url;
}

const routes = allRoutes
  .filter((r) => r.measure === true)
  .filter((r) => !ONLY || ONLY.includes(r.id))
  .filter((r) => !KIND || r.kind === KIND)
  .map((r) => ({ ...r, url: buildUrl(r) }));

if (routes.length === 0) {
  console.error('No routes selected.');
  process.exit(1);
}

// ---------- DB latency proxy ----------
const DB_ONE_WAY_MS = Number(args['db-one-way-ms'] ?? process.env.PERF_DB_ONE_WAY_MS ?? 2.5);
process.env.PERF_DB_ONE_WAY_MS = String(DB_ONE_WAY_MS);
let proxy = null;
let proxiedDbUrl = process.env.DATABASE_URL;

async function startProxy() {
  if (DB_ONE_WAY_MS <= 0) return;
  const target = new URL(process.env.DATABASE_URL);
  const listen = Number(process.env.PERF_DB_PROXY_PORT ?? 6543);
  proxy = spawn(process.execPath, [path.join(PERF_DIR, 'lib', 'latency-proxy.mjs'), '--listen', String(listen), '--target', `${target.hostname}:${target.port || 5432}`, '--one-way-ms', String(DB_ONE_WAY_MS)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => proxy.stdout.once('data', resolve));
  const proxied = new URL(process.env.DATABASE_URL);
  proxied.port = String(listen);
  proxiedDbUrl = proxied.toString();
}

// ---------- server control ----------
let server = null;
let serverLog = null;

function clearDataCache() {
  for (const dir of ['fetch-cache', 'images']) {
    fs.rmSync(path.join(ROOT, '.next', 'cache', dir), { recursive: true, force: true });
  }
}

async function waitForServer(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await request('/api/health', {});
      if (r.status > 0) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}

async function startServer({ trace = null } = {}) {
  await stopServer();
  if (await request('/api/health', {}).then(() => true, () => false)) {
    throw new Error(`port ${PORT} is already serving; stop the stray server first (pkill -f next-server)`);
  }
  // Port 6543 + VERCEL=1 reproduce production's pool: transaction mode, max 3 per isolate (lib/db.ts).
  const env = { ...process.env, PORT: String(PORT), NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: proxiedDbUrl, DIRECT_DATABASE_URL: proxiedDbUrl };
  if (trace) {
    env.PERF_PG_TRACE = trace;
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --require ${path.join(PERF_DIR, 'lib', 'pg-trace.cjs')}`.trim();
  }
  serverLog = fs.createWriteStream(path.join(RUN_DIR, 'server.log'), { flags: 'a' });
  // Own process group: `next start` forks a `next-server` child, and both must go on stop.
  server = spawn(path.join(ROOT, 'node_modules', '.bin', 'next'), ['start', '-p', String(PORT), '-H', '127.0.0.1'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  server.once('exit', (code) => { if (code && code !== 0 && code !== 143) console.error(`next start exited with ${code} (see ${path.relative(ROOT, RUN_DIR)}/server.log)`); });
  server.stdout.pipe(serverLog);
  server.stderr.pipe(serverLog);
  await waitForServer();
}

async function stopServer() {
  if (!server) return;
  const proc = server;
  server = null;
  await new Promise((resolve) => {
    proc.once('exit', resolve);
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
    setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } }, 5000);
  });
  // The forked next-server can outlive the parent briefly; wait until the port is free.
  for (let i = 0; i < 100; i += 1) {
    const busy = await request('/api/health', {}).then(() => true, () => false);
    if (!busy) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Lighthouse can throw protocol errors from inside its own event handlers ("Session
// closed"); those must not kill a run that holds an hour of measurements.
process.on('uncaughtException', (error) => console.warn(`uncaught (continuing): ${String(error?.message ?? error).slice(0, 200)}`));
process.on('unhandledRejection', (error) => console.warn(`unhandled rejection (continuing): ${String(error?.message ?? error).slice(0, 200)}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await stopServer(); proxy?.kill(); process.exit(130); });

// ---------- timing ----------
const agent = new http.Agent({ keepAlive: false });

function request(url, { cookie, method = 'GET', body, headers: extra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let ttfb = null;
    let firstByte = null;
    let bytes = 0;
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(`${BASE}${url}`, {
      method,
      agent,
      headers: {
        'accept-encoding': 'identity',
        accept: url.startsWith('/api/') ? 'application/json' : 'text/html',
        ...(cookie ? { cookie } : {}),
        ...(payload ? { 'content-type': 'application/json' } : {}),
        ...extra,
      },
    }, (res) => {
      ttfb = performance.now() - started;
      res.on('data', (chunk) => {
        if (firstByte === null) firstByte = performance.now() - started;
        bytes += chunk.length;
      });
      res.on('end', () => resolve({
        status: res.statusCode,
        ttfb,
        firstByte: firstByte ?? ttfb,
        total: performance.now() - started,
        bytes,
        serverTiming: res.headers['server-timing'] ?? null,
        location: res.headers.location ?? null,
      }));
    });
    req.setTimeout(60_000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pct(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 10) / 10;
}

function summarize(samples) {
  const ok = samples.filter((s) => !s.error);
  const ttfb = ok.map((s) => s.ttfb);
  const total = ok.map((s) => s.total);
  return {
    n: samples.length,
    errors: samples.length - ok.length,
    statuses: [...new Set(ok.map((s) => s.status))],
    bytes: ok.length ? ok[ok.length - 1].bytes : null,
    ttfb: { p50: pct(ttfb, 50), p95: pct(ttfb, 95), p99: pct(ttfb, 99) },
    total: { p50: pct(total, 50), p95: pct(total, 95), p99: pct(total, 99) },
  };
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function timeOne(route, cookie) {
  try {
    return await request(route.url, { cookie: route.auth === 'public' ? undefined : cookie, method: route.method, body: route.sample?.body, headers: route.sample?.headers });
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

// ---------- phases ----------
async function warmPhase(cookie) {
  console.log(`\n[warm] ${routes.length} routes × ${RUNS} runs`);
  await startServer();
  const results = {};
  for (const route of routes) {
    for (let i = 0; i < WARMUP; i += 1) await timeOne(route, cookie);
    const samples = [];
    for (let i = 0; i < RUNS; i += 1) samples.push(await timeOne(route, cookie));
    results[route.id] = summarize(samples);
    const s = results[route.id];
    console.log(`  ${route.id.padEnd(58)} ttfb p95 ${String(s.ttfb.p95).padStart(7)}  total p95 ${String(s.total.p95).padStart(7)}  ${s.statuses.join(',')}${s.errors ? ` err ${s.errors}` : ''}`);
  }
  await stopServer();
  return results;
}

async function coldPhase(cookie) {
  if (COLD_CYCLES <= 0) return {};
  console.log(`\n[cold] ${COLD_CYCLES} cycles × ${routes.length} routes (fresh process + empty data cache each cycle)`);
  const samples = Object.fromEntries(routes.map((r) => [r.id, []]));
  for (let cycle = 0; cycle < COLD_CYCLES; cycle += 1) {
    clearDataCache();
    await startServer();
    for (const route of shuffle(routes)) samples[route.id].push(await timeOne(route, cookie));
    await stopServer();
    process.stdout.write(`  cycle ${cycle + 1}/${COLD_CYCLES}\r`);
  }
  process.stdout.write('\n');
  return Object.fromEntries(Object.entries(samples).map(([id, s]) => [id, summarize(s)]));
}

async function tracePhase(cookie) {
  if (!TRACE) return {};
  console.log('\n[trace] one cold + one warm traced request per route');
  const file = path.join(RUN_DIR, 'trace.jsonl');
  fs.rmSync(file, { force: true });
  clearDataCache();
  await startServer({ trace: file });
  const marks = [];
  for (const route of routes) {
    marks.push({ id: route.id, phase: 'cold', url: route.url });
    await timeOne(route, cookie);
  }
  for (const route of routes) {
    await timeOne(route, cookie);
    marks.push({ id: route.id, phase: 'warm', url: route.url });
    await timeOne(route, cookie);
  }
  await new Promise((r) => setTimeout(r, 500));
  await stopServer();
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // Match trace lines to requests in order (requests are strictly sequential).
  const byUrl = new Map();
  for (const line of lines) {
    if (line.url === '/api/health') continue;
    if (!byUrl.has(line.url)) byUrl.set(line.url, []);
    byUrl.get(line.url).push(line);
  }
  const out = {};
  for (const route of routes) {
    const seen = byUrl.get(route.url) ?? [];
    // Order per url: cold, warm-up, warm(measured).
    const cold = seen[0];
    const warm = seen[2] ?? seen[seen.length - 1];
    const describe = (line) => {
      if (!line) return null;
      const counts = new Map();
      for (const q of line.queries) counts.set(q.sql, (counts.get(q.sql) ?? 0) + 1);
      const repeated = [...counts.entries()].filter(([, n]) => n > 5).map(([sql, n]) => ({ sql, n }));
      const slowest = [...line.queries].sort((a, b) => b.ms - a.ms).slice(0, 5);
      return { ms: line.ms, queryCount: line.queryCount, queryMs: line.queryMs, repeated, slowest };
    };
    out[route.id] = { cold: describe(cold), warm: describe(warm) };
  }
  fs.writeFileSync(path.join(RUN_DIR, 'trace-summary.json'), JSON.stringify(out, null, 2));
  return out;
}

async function lighthousePhase(cookie) {
  const pages = routes.filter((r) => r.kind === 'page');
  if (!LIGHTHOUSE || pages.length === 0) return {};
  console.log(`\n[lighthouse] ${pages.length} pages × ${LH_RUNS} (4x CPU, Fast 4G)`);
  const { default: lighthouse } = await import('lighthouse');
  const chromeLauncher = await import('chrome-launcher');
  await startServer();
  const launch = () => chromeLauncher.launch({
    chromePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  let chrome = await launch();
  const out = {};
  try {
    for (const route of pages) {
      // Warm the route so the measurement is render cost, not first compile.
      for (let i = 0; i < 2; i += 1) await timeOne(route, cookie);
      const runs = [];
      for (let i = 0; i < LH_RUNS; i += 1) {
        let result;
        // A Chrome protocol error on one page must not lose the run: relaunch and retry once.
        for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
          try {
            result = await lighthouseOnce(route);
          } catch (error) {
            console.warn(`  lighthouse ${route.id} attempt ${attempt + 1} failed: ${String(error?.message ?? error).slice(0, 160)}`);
            try { await chrome.kill(); } catch { /* gone */ }
            chrome = await launch();
          }
        }
        if (!result) continue;
        runs.push(result);
      }
      if (runs.length === 0) { out[route.id] = { runs: 0, error: 'lighthouse failed' }; continue; }
      const med = (key) => pct(runs.map((r) => r[key]).filter((v) => v !== null), 50);
      out[route.id] = {
        runs: runs.length,
        finalUrl: runs[0]?.finalUrl,
        score: med('score'),
        fcp: med('fcp'), lcp: med('lcp'), tbt: med('tbt'), cls: med('cls'), si: med('si'),
        ttfbServer: med('ttfbServer'), jsTransferKB: med('jsTransferKB'), jsRequests: med('jsRequests'),
        totalTransferKB: med('totalTransferKB'),
      };
      const s = out[route.id];
      console.log(`  ${route.id.padEnd(58)} LCP ${String(Math.round(s.lcp)).padStart(6)}  TBT ${String(Math.round(s.tbt)).padStart(5)}  JS ${s.jsTransferKB} KB`);
    }
  } finally {
    await chrome.kill();
    await stopServer();
  }
  return out;

  async function lighthouseOnce(route) {
    {
      {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('lighthouse timed out after 120 s')), 120_000));
        const result = await Promise.race([timeout, lighthouse(`${BASE}${route.url}`, {
          port: chrome.port,
          output: 'json',
          logLevel: 'error',
          onlyCategories: ['performance'],
          formFactor: 'mobile',
          screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
          throttlingMethod: 'devtools',
          // Chrome DevTools "Fast 4G" preset + 4x CPU slowdown (perf/PROFILE.md).
          throttling: {
            requestLatencyMs: 165,
            downloadThroughputKbps: 8100,
            uploadThroughputKbps: 1350,
            cpuSlowdownMultiplier: 4,
            rttMs: 165,
            throughputKbps: 8100,
          },
          extraHeaders: route.auth === 'public' ? {} : { Cookie: cookie },
          // Pages that poll never go network-idle; cap the wait so one page can't take minutes.
          maxWaitForLoad: Number(args['lh-max-wait'] ?? 45_000),
          disableStorageReset: false,
        })]);
        const lhr = result.lhr;
        if (lhr.runtimeError) throw new Error(lhr.runtimeError.message);
        const scripts = (lhr.audits['network-requests']?.details?.items ?? [])
          .filter((it) => it.resourceType === 'Script');
        return ({
          finalUrl: lhr.finalDisplayedUrl,
          score: lhr.categories.performance.score,
          fcp: lhr.audits['first-contentful-paint']?.numericValue ?? null,
          lcp: lhr.audits['largest-contentful-paint']?.numericValue ?? null,
          tbt: lhr.audits['total-blocking-time']?.numericValue ?? null,
          cls: lhr.audits['cumulative-layout-shift']?.numericValue ?? null,
          si: lhr.audits['speed-index']?.numericValue ?? null,
          ttfbServer: lhr.audits['server-response-time']?.numericValue ?? null,
          jsTransferKB: Math.round(scripts.reduce((s, it) => s + (it.transferSize ?? 0), 0) / 102.4) / 10,
          jsRequests: scripts.length,
          totalTransferKB: Math.round((lhr.audits['total-byte-weight']?.numericValue ?? 0) / 102.4) / 10,
        });
      }
    }
  }
}

// ---------- pg_stat_statements ----------
async function pgss(action) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    if (action === 'reset') { await client.query('SELECT pg_stat_statements_reset()'); return null; }
    const { rows } = await client.query(`
      SELECT left(regexp_replace(query, '\\s+', ' ', 'g'), 600) AS query, calls::int,
             round(total_exec_time::numeric, 1)::float AS total_ms, round(mean_exec_time::numeric, 2)::float AS mean_ms,
             round(max_exec_time::numeric, 1)::float AS max_ms, rows::bigint AS rows,
             shared_blks_hit + shared_blks_read AS blocks,
             round(((jit_generation_time + jit_inlining_time + jit_optimization_time + jit_emission_time) / nullif(calls, 0))::numeric, 1)::float AS jit_ms
        FROM pg_stat_statements
       WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
         AND query !~* '^(BEGIN|COMMIT|ROLLBACK|SET|SHOW|SELECT pg_stat_statements|SELECT 1)'
       ORDER BY mean_exec_time DESC LIMIT 60`);
    return rows;
  } catch (error) {
    console.warn('pg_stat_statements unavailable:', error.message);
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------- budgets ----------
const BUDGET = { ttfbMs: 150, totalMs: 500, apiServerMs: 150, jsKB: 150 };

function verdict(route, warm, lh) {
  if (!warm || warm.errors === warm.n) return 'error';
  if (route.kind === 'api') return warm.total.p95 <= BUDGET.totalMs ? 'pass' : 'fail';
  const serverOk = warm.ttfb.p95 <= BUDGET.ttfbMs && warm.total.p95 <= BUDGET.totalMs;
  return serverOk ? 'pass' : 'fail';
}

// ---------- main ----------
async function main() {
  const startedAt = new Date().toISOString();
  const commit = await new Promise((resolve) => {
    const p = spawn('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT });
    let s = '';
    p.stdout.on('data', (d) => { s += d; });
    p.on('exit', () => resolve(s.trim()));
  });
  const cookie = await mintSessionCookie();
  await startProxy();
  await pgss('reset');
  const phases = String(args.phases ?? 'warm,cold,trace,lighthouse').split(',');
  // Each phase is saved as it finishes, so a stopped run keeps what it measured.
  const partial = (name, value) => { fs.writeFileSync(path.join(RUN_DIR, `${name}.json`), JSON.stringify(value, null, 2)); return value; };
  const warm = phases.includes('warm') ? partial('warm', await warmPhase(cookie)) : {};
  const traceFile = path.join(RUN_DIR, 'trace-summary.json');
  const trace = phases.includes('trace') ? await tracePhase(cookie) : (fs.existsSync(traceFile) ? JSON.parse(fs.readFileSync(traceFile, 'utf8')) : {});
  const cold = phases.includes('cold') ? partial('cold', await coldPhase(cookie)) : {};
  const lh = phases.includes('lighthouse') ? partial('lighthouse', await lighthousePhase(cookie)) : {};
  const statements = await pgss('dump');
  if (statements) fs.writeFileSync(path.join(RUN_DIR, 'pg_stat_statements.json'), JSON.stringify(statements, null, 2));
  const verdicts = Object.fromEntries(routes.map((r) => [r.id, verdict(r, warm[r.id], lh[r.id])]));
  const result = {
    out: OUT,
    startedAt,
    commit,
    settings: { runs: RUNS, coldCycles: COLD_CYCLES, warmup: WARMUP, dbOneWayMs: Number(process.env.PERF_DB_ONE_WAY_MS ?? 0), budget: BUDGET },
    routes: routes.map(({ id, kind, method, path: p, url, auth }) => ({ id, kind, method, path: p, url, auth })),
    warm, cold, trace, lighthouse: lh, verdicts,
  };
  fs.writeFileSync(path.join(PERF_DIR, `${OUT}.json`), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(PERF_DIR, `${OUT}.md`), markdown(result));
  console.log(`\nWrote perf/${OUT}.json and perf/${OUT}.md`);
  proxy?.kill();
}

main().catch(async (error) => {
  console.error(error);
  await stopServer();
  proxy?.kill();
  process.exit(1);
});
