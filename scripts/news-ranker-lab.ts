/**
 * News Ranker lab CLI (CONTRACT.md §Lab, D6): the same actions as the UI, for
 * the agent to run when Lucas asks. Stop the dev server first (one process
 * owns the local PGlite store).
 *
 *   npx tsx scripts/news-ranker-lab.ts freeze-set          read-only intake read → new frozen set
 *   npx tsx scripts/news-ranker-lab.ts plan <variant>      estimate only
 *   npx tsx scripts/news-ranker-lab.ts run <variant> --yes LIVE calls (refused past the $1 cap)
 *   npx tsx scripts/news-ranker-lab.ts metrics             per-variant metrics + mix sweep
 *
 * Live runs need the project's own keys: unset ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN /
 * ANTHROPIC_BASE_URL from the Claude Code env first, so .env.local's key is used.
 */
import fs from 'node:fs';
import path from 'node:path';

const envFile = path.join(process.cwd(), '.env.local');
for (const line of fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const { labDb, liveDeps } = await import('@/lib/news-ranker/lab/live');
  const { latestSet } = await import('@/lib/news-ranker/lab/db');
  const { planRun, runVariant } = await import('@/lib/news-ranker/lab/runner');
  const { labState } = await import('@/lib/news-ranker/lab/results');
  const { VARIANT_IDS, isVariantId } = await import('@/lib/news-ranker/lab/variants');
  const db = await labDb();

  if (cmd === 'freeze-set') {
    const { freezeSet, intakeUrl, readOnly } = await import('@/lib/news-ranker/lab/freeze');
    const set = await readOnly(intakeUrl(), (q) => freezeSet(db, q));
    console.log(`froze ${set.id}: ${set.stories.length} stories, ${set.windowFrom.toISOString()} → ${set.windowTo.toISOString()} (no model calls)`);
    return;
  }

  if (cmd === 'plan' || cmd === 'run') {
    if (!arg || !isVariantId(arg)) throw new Error(`variant one of: ${VARIANT_IDS.join(', ')}`);
    const set = await latestSet(db);
    if (!set) throw new Error('no frozen set: run freeze-set first');
    const plan = await planRun(db, set.id, arg);
    console.log(`${arg} on ${set.id}: ${plan.jevCalls} Jev + ${plan.sonnetCalls} Sonnet calls, estimate $${plan.estimateUsd.toFixed(4)}; spent $${plan.spentUsd.toFixed(4)} of $1.00${plan.note ? ` — ${plan.note}` : ''}`);
    if (!plan.capOk) throw new Error('refused: would pass the $1 lab cap (or a prerequisite run is missing)');
    if (cmd === 'plan') return;
    if (!process.argv.includes('--yes')) throw new Error('live run: re-run with --yes once Lucas has asked for it');
    const res = await runVariant(db, liveDeps(), set.id, arg);
    console.log(`${res.runId}: ${res.status}, cost $${res.costUsd.toFixed(4)}${res.error ? `, error: ${res.error}` : ''}`);
    return;
  }

  if (cmd === 'metrics') {
    const s = await labState(db);
    console.log(`set ${s.set?.id ?? 'none'} · tagged ${s.tags.length} · spent $${s.spentUsd.toFixed(4)} of $${s.capUsd.toFixed(2)}`);
    const f = (p: { at5: number; at10: number }) => `${p.at5.toFixed(2)}/${p.at10.toFixed(2)}`;
    for (const v of s.variants) {
      if (!v.metrics) {
        console.log(`${v.variantId.padEnd(22)} not run`);
        continue;
      }
      for (const m of [v.metrics, ...v.sweep]) {
        console.log(`${(m === v.metrics ? v.variantId : '  sweep').padEnd(22)} w=${m.mixCool.toFixed(2)} cool ${f(m.meanCool)} need ${f(m.meanNeed)} blend ${f(m.meanBlend)} corr ${m.rankCorr.cool.toFixed(2)}/${m.rankCorr.need.toFixed(2)}/${m.rankCorr.blend.toFixed(2)} low@5 ${m.noShareTop5.toFixed(2)}`);
      }
    }
    return;
  }

  console.log('usage: news-ranker-lab.ts freeze-set | plan <variant> | run <variant> --yes | metrics');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
