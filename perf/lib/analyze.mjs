#!/usr/bin/env node
/**
 * Turns a measure.mjs run into ranked tables.
 *   node perf/lib/analyze.mjs baseline   ->  perf/runs/baseline/ranking.md, perf/runs/baseline/slow-queries.md
 * BOTTLENECKS.md and slow-queries.md in perf/ are written by hand from these.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PERF_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const name = process.argv[2] ?? 'baseline';
const run = JSON.parse(fs.readFileSync(path.join(PERF_DIR, `${name}.json`), 'utf8'));
const runDir = path.join(PERF_DIR, 'runs', name);
const r = (v) => (v === null || v === undefined ? '–' : String(Math.round(v)));

const rows = run.routes.map((route) => {
  const w = run.warm[route.id];
  const c = run.cold[route.id];
  const t = run.trace[route.id];
  const l = run.lighthouse[route.id];
  return { route, w, c, t, l, p95: w?.total?.p95 ?? -1 };
}).sort((a, b) => b.p95 - a.p95);

const out = [
  `# Ranking: ${name} (${run.commit})`,
  '',
  '| # | Route | Status | Warm TTFB p95 | Warm total p50/p95 | Cold total p95 | Server ms (trace) | SQL n / ms (warm) | SQL n (cold) | Bytes | LCP | TBT | JS KB |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
];
rows.forEach(({ route, w, c, t, l }, i) => {
  out.push(`| ${i + 1} | \`${route.method} ${route.url}\` | ${w?.statuses?.join(',') ?? '–'} | ${r(w?.ttfb?.p95)} | ${r(w?.total?.p50)}/${r(w?.total?.p95)} | ${r(c?.total?.p95)} | ${r(t?.warm?.ms)} | ${t?.warm?.queryCount ?? '–'} / ${r(t?.warm?.queryMs)} | ${t?.cold?.queryCount ?? '–'} | ${w?.bytes ?? '–'} | ${r(l?.lcp)} | ${r(l?.tbt)} | ${l?.jsTransferKB ?? '–'} |`);
});
fs.writeFileSync(path.join(runDir, 'ranking.md'), out.join('\n') + '\n');

// N+1 signals from the trace.
const nplus = [];
for (const { route, t } of rows) {
  for (const phase of ['cold', 'warm']) {
    for (const rep of t?.[phase]?.repeated ?? []) nplus.push({ id: route.id, phase, ...rep });
  }
}
const pgssFile = path.join(runDir, 'pg_stat_statements.json');
const statements = fs.existsSync(pgssFile) ? JSON.parse(fs.readFileSync(pgssFile, 'utf8')) : [];
const sq = [
  `# Slow queries: ${name}`,
  '',
  '## Slowest 25 statements by mean execution time (pg_stat_statements, whole run)',
  '',
  '| Mean ms | Max ms | Calls | Rows | Query |',
  '|---|---|---|---|---|',
  ...statements.slice(0, 25).map((s) => `| ${s.mean_ms} | ${s.max_ms} | ${s.calls} | ${s.rows} | \`${s.query.replace(/\|/g, '\\|').slice(0, 300)}\` |`),
  '',
  '## Statements repeated more than 5 times in one request (N+1 signal)',
  '',
  nplus.length ? '| Route | Phase | Times | Statement |\n|---|---|---|---|' : '_None found._',
  ...nplus.map((n) => `| ${n.id} | ${n.phase} | ${n.n} | \`${n.sql.replace(/\|/g, '\\|').slice(0, 220)}\` |`),
];
fs.writeFileSync(path.join(runDir, 'slow-queries.md'), sq.join('\n') + '\n');
console.log(`wrote ${path.relative(PERF_DIR, path.join(runDir, 'ranking.md'))} and slow-queries.md`);
