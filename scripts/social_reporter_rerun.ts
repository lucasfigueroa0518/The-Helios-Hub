/**
 * Helios Social — rerun the LIVE Reporter on stories already selected in a
 * saved daily run (same groups, same starting sources), through runDay.
 * Tommy's OK required; --cap-usd is required and enforced per story.
 *
 *   npx tsx scripts/social_reporter_rerun.ts <run.json> --cap-usd 0.50 [--picks w0,w1,b0]
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const runPath = process.argv[2];
  const at = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const cap = Number(at('--cap-usd'));
  if (!runPath || !Number.isFinite(cap) || cap <= 0) throw new Error('usage: <run.json> --cap-usd <amount> [--picks w0,w1,b0]');
  const picks = (at('--picks') ?? 'w0,w1,b0').split(',');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { liveMessagesCreate, runReporter } = await import('@/lib/social/reporter/reporter');
  const { readPage } = await import('@/lib/social/reporter/read-page');
  const { readableDate } = await import('@/lib/social/pipeline/reporter-stage');
  const { toCandidate } = await import('@/lib/social/pipeline/selection-stage');
  const { runDay } = await import('@/lib/social/pipeline/orchestrator');
  const { createCostMeter } = await import('@/lib/social/pipeline/cost-meter');
  const { createFileSetAsideLog } = await import('@/lib/social/pipeline/set-aside-log');
  const { createStubStages, STUB_COST_USD } = await import('@/lib/social/pipeline/stubs');

  const saved = JSON.parse(await fsp.readFile(runPath, 'utf8')).selection;
  const groups = picks.map((p) => (p[0] === 'w' ? saved.winners : saved.backups)[Number(p.slice(1))]);
  const candidates = groups.map((g: any, i: number) => toCandidate(g, groups.length - i));

  const now = new Date();
  const runDir = path.join(process.cwd(), 'runs', `reporter-rerun-${now.toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(runDir, { recursive: true });
  const create = liveMessagesCreate(new Anthropic());
  const log: any[] = [];
  const zero = Object.fromEntries(Object.keys(STUB_COST_USD).map((k) => [k, 0]));

  const result = await runDay({
    articles: [],
    now,
    meter: createCostMeter(),
    log: createFileSetAsideLog(),
    targetPosts: candidates.length,
    stages: {
      ...createStubStages({ costUsd: zero }),
      score: async () => ({ ok: true, value: candidates, costUsd: 0 }),
      report: async (story) => {
        const reads: any[] = [];
        const r = await runReporter(
          { story: story.title, startingSources: story.sources, today: readableDate(now) },
          {
            create,
            costCapUsd: cap,
            readPage: async (url) => {
              const page = await readPage(url);
              reads.push(page.ok ? { url, ok: true, chars: page.text.length } : { url, ok: false, error: page.error });
              return page;
            },
          },
        );
        const n = log.length + 1;
        if (r.raw) await fsp.writeFile(path.join(runDir, `brief-${n}.json`), r.raw);
        log.push({ n, title: story.title, startingSources: story.sources, ok: r.ok, reason: r.ok ? null : r.reason, detail: r.ok ? null : r.detail, costUsd: r.costUsd, turns: r.turns, webSearches: r.webSearches, pageReadCalls: r.pageReads, submitRetries: r.submitRetries, retryErrors: r.retryErrors, turnUsage: r.turnUsage, reads });
        if (!r.ok) return { ok: false, reasonCode: r.reason, detail: r.detail, costUsd: r.costUsd };
        return { ok: true, value: { storyId: story.id, parsed: r.brief, raw: r.raw, pages: r.pages }, costUsd: r.costUsd };
      },
    },
  });
  await fsp.writeFile(path.join(runDir, 'run.json'), JSON.stringify({ log, result }, null, 2));
  console.log(JSON.stringify({ runDir: path.relative(process.cwd(), runDir), stopReason: result.stopReason, totalUsd: result.costUsd, stories: log.map(({ reads, startingSources, ...x }) => ({ ...x, startingSources: startingSources.length, readsOk: reads.filter((r: any) => r.ok).length, readsFailed: reads.filter((r: any) => !r.ok).length })) }, null, 2));
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
