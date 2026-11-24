/**
 * First-try lessons and cost telemetry across renders (Lucas 2026-11-17: every reel logs its
 * first-try lessons, production included; pull them here to experiment).
 *
 *   npx tsx scripts/explainers-lessons.ts                     report from the local DB
 *   npx tsx scripts/explainers-lessons.ts --prod              report from production (read-only)
 *   npx tsx scripts/explainers-lessons.ts --prod --import     also merge production's renders into
 *                                                             the local ledger file, so local renders
 *                                                             learn from them
 *   npx tsx scripts/explainers-lessons.ts --seed              copy the local ledger file's renders into
 *                                                             the local DB (renders from before the DB log)
 *   --out <file.md>   write the report there (default: print it)
 *   --limit <n>       renders to read (default 50)
 *
 * Production is read in one READ ONLY transaction (DATABASE_URL, Supabase's pooler: never a session
 * SET). No model is called.
 */
import fs from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';

import { foldRender, lessonEffects, readLedger, writeLedger, type Ledger, type RenderLog } from '@/lib/explainers/injection/ledger';
import { lessonIdOf, loadLessonRules, ruleOf } from '@/lib/explainers/injection/lessons';

const LOCAL_URL = process.env.EXPLAINERS_DATABASE_URL || 'postgres://helios:helios-local@127.0.0.1:54329/explainers';
const LEDGER_FILE = path.join(process.cwd(), '.explainers-local', 'jobs', 'injection-ledger.json');

type Row = { job_id: string; render_at: Date; label: string; role: string; look: string; frame: string | null; injected: string[]; scores: Record<string, number>; misses: string[]; lessons: string[]; first_try: string[] | null };
type Cost = { job_id: string; title: string | null; spend: number | null; summary: { totals?: Record<string, number> } | null };

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const flag = (name: string) => process.argv.includes(name);

async function read(url: string, limit: number): Promise<{ renders: RenderLog[]; costs: Map<string, Cost> }> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const rows = (
      await client.query<Row>(
        `SELECT job_id, render_at, label, role, look, frame, injected, scores, misses, lessons, first_try
           FROM explainers.first_try_log
          WHERE job_id IN (SELECT job_id FROM explainers.first_try_log GROUP BY job_id ORDER BY max(render_at) DESC LIMIT $1)
          ORDER BY render_at, created_at`,
        [limit],
      )
    ).rows;
    const ids = [...new Set(rows.map((r) => r.job_id))];
    const costs = (
      await client.query<Cost>(
        `SELECT j.id AS job_id, t.title, j.spend_usd::float AS spend,
                (SELECT detail FROM explainers.cost_breakdown b WHERE b.job_id = j.id AND b.component = 'session_b:summary' ORDER BY created_at DESC LIMIT 1) AS summary
           FROM explainers.jobs j LEFT JOIN explainers.topics t ON t.id = j.topic_id
          WHERE j.id = ANY($1::uuid[])`,
        [ids],
      )
    ).rows;
    await client.query('ROLLBACK');
    const renders = new Map<string, RenderLog>();
    for (const r of rows) {
      if (!renders.has(r.job_id)) renders.set(r.job_id, { jobId: r.job_id, at: new Date(r.render_at).toISOString(), contexts: [] });
      renders.get(r.job_id)!.contexts.push({ label: r.label, role: r.role, look: r.look, frame: r.frame, injected: r.injected ?? [], scores: r.scores ?? {}, misses: r.misses ?? [], lessons: r.lessons ?? [], firstTry: r.first_try });
    }
    return { renders: [...renders.values()], costs: new Map(costs.map((c) => [c.job_id, c])) };
  } finally {
    await client.end();
  }
}

async function seed(url: string): Promise<void> {
  const ledger = readLedger(LEDGER_FILE);
  const client = new Client({ connectionString: url });
  await client.connect();
  let n = 0;
  try {
    for (const r of ledger.renders) {
      const exists = await client.query('SELECT 1 FROM explainers.jobs WHERE id = $1', [r.jobId]);
      if (!exists.rowCount) continue;
      await client.query('BEGIN');
      await client.query('DELETE FROM explainers.first_try_log WHERE job_id = $1', [r.jobId]);
      for (const c of r.contexts) {
        await client.query(
          `INSERT INTO explainers.first_try_log (job_id, render_at, label, role, look, frame, injected, scores, misses, lessons, first_try)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [r.jobId, r.at, c.label, c.role, c.look, c.frame, c.injected, JSON.stringify(c.scores ?? {}), c.misses, c.lessons ?? [], c.firstTry === null ? null : JSON.stringify(c.firstTry)],
        );
      }
      await client.query('COMMIT');
      n++;
    }
  } finally {
    await client.end();
  }
  console.log(`seeded ${n} of ${ledger.renders.length} ledger renders into the local DB`);
}

function report(renders: RenderLog[], costs: Map<string, Cost>, source: string): string {
  const rules = loadLessonRules();
  const ledger: Ledger = { renders, overrides: { always: {}, never: {} } };
  const out: string[] = [`# First-try lessons and cost (${source}, ${renders.length} renders)`, '', '## Renders', '', '| when | job | topic | total $ | session B $ | turns | cache hit | first try clean | first-try errors | lessons given |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of renders) {
    const c = costs.get(r.jobId);
    const t = c?.summary?.totals ?? {};
    const tried = r.contexts.filter((x) => x.firstTry !== null && x.role !== 'planner');
    const clean = tried.filter((x) => x.firstTry!.length === 0).length;
    const errors = tried.reduce((n, x) => n + x.firstTry!.length, 0);
    const given = r.contexts.reduce((n, x) => n + (x.lessons?.length ?? 0), 0);
    const money = (v: unknown) => (typeof v === 'number' ? `$${v.toFixed(2)}` : '–');
    out.push(`| ${r.at.slice(0, 16).replace('T', ' ')} | ${r.jobId.slice(0, 8)} | ${c?.title ?? ''} | ${money(c?.spend)} | ${money(t.sdkUsd)} | ${t.turns ?? '–'} | ${typeof t.cacheHitRatio === 'number' ? `${(t.cacheHitRatio * 100).toFixed(1)}%` : '–'} | ${clean}/${tried.length} | ${errors} | ${given} |`);
  }
  const effects = lessonEffects(ledger);
  const byLesson = new Map<string, { given: number; recurred: number; without: number; withoutErrors: number }>();
  for (const e of effects) {
    const x = byLesson.get(e.lesson) ?? { given: 0, recurred: 0, without: 0, withoutErrors: 0 };
    x.given += e.injected;
    x.recurred += e.recurred;
    x.without += e.without;
    x.withoutErrors += e.withoutErrors;
    byLesson.set(e.lesson, x);
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
  out.push('', '## Lessons (all builder types)', '', 'A lesson works when "made it anyway" is well under "made it without the lesson". A retired lesson that is still made means its code fix leaks.', '', '| lesson | status | given | made it anyway | without the lesson | made it without |', '|---|---|---|---|---|---|');
  for (const [id, x] of [...byLesson].sort((a, b) => b[1].recurred + b[1].withoutErrors - (a[1].recurred + a[1].withoutErrors))) {
    if (!x.recurred && !x.withoutErrors && !x.given) continue;
    const rule = ruleOf(id, rules);
    const status = !rule ? 'no rule yet' : rule.retired ? (x.withoutErrors + x.recurred ? 'RETIRED, LEAKING' : 'retired (code fix)') : 'rule';
    out.push(`| ${id.slice(0, 90)} | ${status} | ${x.given} | ${x.recurred} (${pct(x.recurred, x.given)}) | ${x.without} | ${x.withoutErrors} (${pct(x.withoutErrors, x.without)}) |`);
  }
  const counts = new Map<string, number>();
  for (const r of renders) for (const c of r.contexts) for (const e of c.firstTry ?? []) {
    const id = lessonIdOf(e, rules);
    if (id.startsWith('kind:')) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size) {
    out.push('', '## Error kinds with no rule yet (candidates for a rule or a code fix)', '');
    for (const [id, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25)) out.push(`- ${n}× ${id.slice(5)}`);
  }
  return `${out.join('\n')}\n`;
}

async function main() {
  const limit = Number(arg('--limit') ?? 50);
  if (flag('--seed')) return seed(LOCAL_URL);
  const prod = flag('--prod');
  const url = prod ? process.env.DATABASE_URL : LOCAL_URL;
  if (!url) throw new Error('DATABASE_URL is not set (source .env.local first)');
  const { renders, costs } = await read(url, limit);
  if (prod && flag('--import')) {
    let ledger = readLedger(LEDGER_FILE);
    for (const r of renders) ledger = foldRender(ledger, r);
    writeLedger(LEDGER_FILE, ledger);
    console.error(`merged ${renders.length} production renders into ${path.relative(process.cwd(), LEDGER_FILE)}`);
  }
  const text = report(renders, costs, prod ? 'production' : 'local');
  const out = arg('--out');
  if (out) {
    fs.writeFileSync(out, text);
    console.error(`wrote ${out}`);
  } else process.stdout.write(text);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
