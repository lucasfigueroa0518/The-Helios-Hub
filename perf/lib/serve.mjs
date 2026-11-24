#!/usr/bin/env node
/**
 * Serves the production build exactly as perf/measure.mjs measures it (DB behind the
 * latency proxy on :6543, VERCEL=1 pool settings) and stays up, for Lighthouse CI.
 *   source perf/env.sh && node perf/lib/serve.mjs &
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PORT = Number(process.env.PERF_APP_PORT ?? 3100);
const oneWay = String(process.env.PERF_DB_ONE_WAY_MS ?? 2.5);
const target = new URL(process.env.DATABASE_URL);
const proxied = new URL(process.env.DATABASE_URL);
proxied.port = '6543';

const proxy = spawn(process.execPath, [path.join(ROOT, 'perf/lib/latency-proxy.mjs'), '--listen', '6543', '--target', `${target.hostname}:${target.port || 5432}`, '--one-way-ms', oneWay], { stdio: 'inherit' });
const server = spawn(path.join(ROOT, 'node_modules/.bin/next'), ['start', '-p', String(PORT), '-H', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: proxied.toString(), DIRECT_DATABASE_URL: proxied.toString() },
});
const stop = () => { server.kill('SIGTERM'); proxy.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const ping = () => new Promise((resolve) => {
  http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => { res.resume(); resolve(true); }).on('error', () => resolve(false));
});
for (let i = 0; i < 300 && !(await ping()); i += 1) await new Promise((r) => setTimeout(r, 200));
console.log(`perf server ready on :${PORT}`);
