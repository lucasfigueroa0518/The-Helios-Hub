#!/usr/bin/env node
/**
 * Before/after table for REPORT.md.
 *   node perf/lib/compare.mjs perf/baseline.json perf/final.json \
 *     --bundles-before perf/bundle-baseline/first-load.json --bundles-after perf/bundle-final/first-load.json > table.md
 */
import fs from 'node:fs';

const [beforeFile, afterFile, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : null; };
const read = (f) => (f && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const before = read(beforeFile);
const after = read(afterFile);
const bundlesBefore = read(opt('bundles-before')) ?? [];
const bundlesAfter = read(opt('bundles-after')) ?? [];
const kb = (list, route) => list.find((b) => b.route === route)?.kb ?? null;
const routeOf = (p) => p.replace(/\[([^\]]+)\]/g, '[$1]');

const r = (v) => (v === null || v === undefined ? '–' : String(Math.round(v)));
const pair = (a, b) => `${r(a)} → ${r(b)}`;
const verdict = (v) => (v === 'pass' ? '✅' : v === 'fail' ? '❌' : v ?? '–');

const rows = [
  '| Route | Warm p50 (ms) | Warm p95 (ms) | Warm TTFB p95 (ms) | Cold p95 (ms) | SQL/request (warm) | First-load JS (KB gz) | LCP (ms) | TBT (ms) | Budget |',
  '|---|---|---|---|---|---|---|---|---|---|',
];
const ids = after.routes.map((x) => x.id);
for (const id of ids) {
  const route = after.routes.find((x) => x.id === id);
  const wb = before.warm[id];
  const wa = after.warm[id];
  const cb = before.cold[id];
  const ca = after.cold[id];
  const tb = before.trace[id]?.warm;
  const ta = after.trace[id]?.warm;
  const lb = before.lighthouse[id];
  const la = after.lighthouse[id];
  const js = route.kind === 'page' ? pair(kb(bundlesBefore, routeOf(route.path)), kb(bundlesAfter, routeOf(route.path))) : '–';
  rows.push(`| \`${route.method} ${route.path}\` | ${pair(wb?.total.p50, wa?.total.p50)} | ${pair(wb?.total.p95, wa?.total.p95)} | ${pair(wb?.ttfb.p95, wa?.ttfb.p95)} | ${pair(cb?.total.p95, ca?.total.p95)} | ${tb?.queryCount ?? '–'} → ${ta?.queryCount ?? '–'} | ${js} | ${route.kind === 'page' ? pair(lb?.lcp, la?.lcp) : '–'} | ${route.kind === 'page' ? pair(lb?.tbt, la?.tbt) : '–'} | ${verdict(before.verdicts[id])} → ${verdict(after.verdicts[id])} |`);
}
const passB = Object.values(before.verdicts).filter((v) => v === 'pass').length;
const passA = Object.values(after.verdicts).filter((v) => v === 'pass').length;
rows.push('', `Routes within the warm budget: **${passB}/${ids.length} → ${passA}/${ids.length}**.`);
console.log(rows.join('\n'));
