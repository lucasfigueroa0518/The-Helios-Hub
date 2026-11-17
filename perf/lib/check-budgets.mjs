#!/usr/bin/env node
/**
 * Compares a perf/measure.mjs result against perf/budgets.json and exits 1 on any
 * route over its warm p95 budget. Routes without their own entry use the defaults
 * (playbook budgets: page TTFB 150 ms / HTML 500 ms; API 500 ms).
 *   node perf/lib/check-budgets.mjs perf/ci.json perf/budgets.json
 */
import fs from 'node:fs';

const [resultFile, budgetFile] = process.argv.slice(2);
const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
const budgets = JSON.parse(fs.readFileSync(budgetFile, 'utf8')).latency;
let failed = 0;
for (const route of result.routes) {
  const warm = result.warm[route.id];
  if (!warm) continue;
  const scale = process.env.CI === 'true' ? Number(budgets.ciScale ?? 1) : 1;
  const raw = { ...budgets.defaults[route.kind], ...(budgets.routes[route.id] ?? {}) };
  const limit = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round(v * scale)]));
  const problems = [];
  if (warm.errors === warm.n) problems.push('every request failed');
  if (limit.ttfbP95 && warm.ttfb.p95 > limit.ttfbP95) problems.push(`TTFB p95 ${warm.ttfb.p95} > ${limit.ttfbP95}`);
  if (limit.totalP95 && warm.total.p95 > limit.totalP95) problems.push(`total p95 ${warm.total.p95} > ${limit.totalP95}`);
  if (warm.statuses.some((s) => s >= 500)) problems.push(`status ${warm.statuses.join(',')}`);
  if (problems.length) failed += 1;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${route.id.padEnd(56)} ttfb ${String(warm.ttfb.p95).padStart(6)}  total ${String(warm.total.p95).padStart(6)}${problems.length ? '  ' + problems.join('; ') : ''}`);
}
console.log(failed ? `\n${failed} route(s) over budget` : '\nall routes within budget');
process.exit(failed ? 1 : 0);
