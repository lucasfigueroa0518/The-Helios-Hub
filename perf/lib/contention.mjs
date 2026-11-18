#!/usr/bin/env node
/**
 * Pool-contention experiment: does a Social Hub cache rebuild stall unrelated
 * requests on the same server process?
 *
 *   source perf/env.sh && node perf/lib/serve.mjs &     # production build behind the DB proxy
 *   node perf/lib/contention.mjs --seconds 300 --out perf/runs/contention-before.json
 *
 * Loop A requests /social once a second (keeps the 60 s hub cache expiring and
 * rebuilding in the background, as hub traffic does in production). Loop B
 * requests a cheap one-query API every 250 ms and records its latency. Report:
 * B's p50/p95/p99/max, and A's p50/p95.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintSessionCookie } from './session.mjs';

const PERF_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []));
const SECONDS = Number(args.seconds ?? 300);
const PORT = Number(process.env.PERF_APP_PORT ?? 3100);
const ids = JSON.parse(fs.readFileSync(path.join(PERF_DIR, 'db', 'seed-ids.json'), 'utf8'));
const PROBE = args.probe ?? `/api/inboxes/${ids.inboxId}`;
const HUB = args.hub ?? '/social';
const cookie = await mintSessionCookie();
const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });

function get(url) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    http.get(`http://127.0.0.1:${PORT}${url}`, { agent, headers: { cookie } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ms: performance.now() - t0, status: res.statusCode }));
    }).on('error', () => resolve({ ms: performance.now() - t0, status: 0 }));
  });
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10) / 10; };
const until = Date.now() + SECONDS * 1000;
const probe = [];
const hub = [];
async function loop(url, every, sink) {
  while (Date.now() < until) {
    const started = Date.now();
    sink.push(await get(url));
    const wait = every - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}
await Promise.all([loop(HUB, Number(args['hub-every'] ?? 1000), hub), loop(PROBE, 250, probe)]);
const summary = (xs) => ({ n: xs.length, errors: xs.filter((x) => x.status === 0 || x.status >= 500).length, p50: pct(xs.map((x) => x.ms), 50), p95: pct(xs.map((x) => x.ms), 95), p99: pct(xs.map((x) => x.ms), 99), max: Math.round(Math.max(...xs.map((x) => x.ms))) });
const out = { seconds: SECONDS, probe: PROBE, hub: HUB, hubEveryMs: Number(args['hub-every'] ?? 1000), probeLatency: summary(probe), hubLatency: summary(hub), over1s: probe.filter((x) => x.ms > 1000).length };
console.log(JSON.stringify(out, null, 2));
if (args.out) fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
process.exit(0);
