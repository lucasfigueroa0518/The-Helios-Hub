#!/usr/bin/env node
// Markdown table for a perf/measure.mjs result. CLI: node perf/lib/table.mjs perf/baseline.json  (rewrites perf/baseline.md)
import fs from 'node:fs';

function fmt(v) { return v === null || v === undefined ? '–' : String(Math.round(v)); }

export function markdown(result) {
  const RUNS = result.settings?.runs; const COLD_CYCLES = result.settings?.coldCycles; const BUDGET = result.settings?.budget ?? { ttfbMs: 150, totalMs: 500, apiServerMs: 150 };
  const rows = [
    `# Perf run: ${result.out}`,
    '',
    `${result.startedAt} · commit ${result.commit} · ${result.routes.length} routes · warm ${RUNS} runs · cold ${COLD_CYCLES} cycles · DB one-way delay ${result.settings?.dbOneWayMs ?? 0} ms`,
    '',
    `Budget: page warm p95 TTFB ≤ ${BUDGET.ttfbMs} ms and full HTML ≤ ${BUDGET.totalMs} ms; API warm p95 ≤ ${BUDGET.totalMs} ms (server target ${BUDGET.apiServerMs} ms).`,
    '',
    '| Route | Warm TTFB p50/p95 | Warm total p50/p95/p99 | Cold TTFB p95 | Cold total p95 | Queries (warm/cold) | LCP | TBT | JS KB | Verdict |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const route of result.routes) {
    const w = result.warm[route.id];
    const c = result.cold[route.id];
    const t = result.trace[route.id];
    const l = result.lighthouse[route.id];
    rows.push(`| \`${route.method} ${route.url}\` | ${fmt(w?.ttfb.p50)}/${fmt(w?.ttfb.p95)} | ${fmt(w?.total.p50)}/${fmt(w?.total.p95)}/${fmt(w?.total.p99)} | ${fmt(c?.ttfb.p95)} | ${fmt(c?.total.p95)} | ${t?.warm?.queryCount ?? '–'}/${t?.cold?.queryCount ?? '–'} | ${fmt(l?.lcp)} | ${fmt(l?.tbt)} | ${l?.jsTransferKB ?? '–'} | ${result.verdicts[route.id]} |`);
  }
  const pass = Object.values(result.verdicts).filter((v) => v === 'pass').length;
  rows.push('', `**${pass}/${result.routes.length} routes meet the warm budget.**`);
  return rows.join('\n') + '\n';
}


if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file.replace(/\.json$/, '.md'), markdown(result));
  console.log(`wrote ${file.replace(/\.json$/, '.md')}`);
}
