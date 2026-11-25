#!/usr/bin/env node
/**
 * Turns harness samples into the interaction ledger and the offender ranking.
 *   node perf/interaction/analyze.mjs <run-dir> [--ledger perf/INTERACTION_LEDGER.csv] [--top 10]
 * Class (playbook section 1) is inferred: nav -> B, a control that sent a write -> D
 * (F when the label reads as irreversible), select -> C, everything else -> A.
 * Budgets at p95: M1 <= 10 ms for every class; M2 <= 27 ms (one 60 Hz frame + 10 ms);
 * class A also needs M3 <= 27 ms (full result on the next frame).
 */
import fs from 'node:fs';
import path from 'node:path';

const [dir, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.reduce((a, c, i, all) => (c.startsWith('--') ? [...a, [c.slice(2), all[i + 1]]] : a), []));
const { rows, tier } = JSON.parse(fs.readFileSync(path.join(dir, 'samples.json'), 'utf8'));
const q = (xs, p) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const IRREVERSIBLE = /\b(send|publish|delete|remove|pay|approve|post now|launch|archive)\b/i;

const byId = new Map();
for (const r of rows) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
const ledger = [];
for (const [id, rs] of byId) {
  const ok = rs.filter((r) => !r.error && !r.double && r.m1 != null);
  const dbl = rs.find((r) => r.double && !r.error);
  const single = ok[0];
  const wroteOnce = ok.some((r) => r.writes?.length);
  const r0 = rs[0];
  const cls = r0.kind === 'nav' ? 'B' : wroteOnce ? (IRREVERSIBLE.test(r0.label) ? 'F' : 'D') : r0.kind === 'select' ? 'C' : 'A';
  const m1 = q(ok.map((r) => r.m1), 0.95); const m2 = q(ok.map((r) => r.m2), 0.95); const m3 = q(ok.map((r) => r.m3), 0.95);
  const dupWrites = dbl && single ? Math.max(0, dbl.writes.length - single.writes.length) : 0;
  const dead = ok.length > 0 && ok.every((r) => !r.mutations && !r.navigated);
  const over = [];
  if (m1 != null && m1 > 10) over.push(`M1 ${m1}`);
  if (m2 != null && m2 > 27) over.push(`M2 ${m2}`);
  if (cls === 'A' && m3 != null && m3 > 27) over.push(`M3 ${m3}`);
  if (dupWrites && single?.writes.length) over.push(`dup-writes ${dupWrites}`);
  const errs = [...new Set(rs.flatMap((r) => r.errors ?? []))];
  if (errs.length) over.push('page-error');
  // Pain score: how far over the M1 and M2 budgets at p95, plus correctness findings weighted heavily.
  const score = Math.max(0, (m1 ?? 0) - 10) + Math.max(0, (m2 ?? 0) - 27) * 0.5 + (cls === "A" ? Math.max(0, (m3 ?? 0) - 27) * 0.05 : 0) + (dupWrites ? 200 : 0) + (errs.length ? 100 : 0);
  ledger.push({
    id, route: r0.route, kind: r0.kind, label: r0.label, class: cls, n: ok.length,
    m1_p50: q(ok.map((r) => r.m1), 0.5), m1_p95: m1, m2_p95: m2, m3_p95: m3,
    inp_p95: q(ok.map((r) => r.inp), 0.95), long_frames: Math.max(0, ...ok.map((r) => r.longFrames ?? 0)),
    handlers_p95: q(ok.map((r) => r.handlers), 0.95), render_p95: q(ok.map((r) => r.render), 0.95),
    dup_writes: dupWrites, dead_click: dead, errors: errs.join(' / ').slice(0, 200),
    top_script: ok.flatMap((r) => r.loafScripts ?? []).sort((a, b) => b.d - a.d).map((s) => `${s.src}:${s.fn || s.inv} ${s.d}ms`)[0] ?? '',
    status: over.length ? `over: ${over.join(', ')}` : ok.length ? 'in budget' : `unmeasured: ${rs.find((r) => r.error)?.error ?? ''}`,
    score: +score.toFixed(1),
  });
}
ledger.sort((a, b) => b.score - a.score);
const cols = Object.keys(ledger[0] ?? {});
const csv = [cols.join(','), ...ledger.map((r) => cols.map((c) => { const v = r[c] ?? ''; return /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v; }).join(','))].join('\n');
fs.writeFileSync(path.join(dir, 'ledger.csv'), csv);
if (opt.ledger) fs.writeFileSync(opt.ledger, csv);
const measured = ledger.filter((r) => r.n);
const inBudget = measured.filter((r) => r.status === 'in budget').length;
const summary = {
  tier, interactions: ledger.length, measured: measured.length, inBudget,
  m1_p95_overall: q(rows.filter((r) => !r.error && !r.double).map((r) => r.m1), 0.95),
  m2_p95_overall: q(rows.filter((r) => !r.error && !r.double).map((r) => r.m2), 0.95),
  deadClicks: measured.filter((r) => r.dead_click).length,
  dupWriteControls: ledger.filter((r) => r.dup_writes).length,
  pageErrors: ledger.filter((r) => r.errors).length,
};
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
const top = Number(opt.top ?? 10);
for (const r of ledger.slice(0, top)) console.log(`${r.score.toString().padStart(6)}  ${r.class} ${r.id}  m1p95=${r.m1_p95} m2p95=${r.m2_p95} m3p95=${r.m3_p95} lf=${r.long_frames} ${r.top_script}  ${r.status}`);
