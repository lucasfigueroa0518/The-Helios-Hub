/**
 * Helios Social — one LIVE Reporter run on a selected story (Tommy's OK
 * required; --cap-usd required and enforced). Reads the story from a daily
 * run log, writes runs/reporter-<ts>/{brief.txt,result.json}.
 *
 *   npx tsx scripts/social_reporter_once.ts <run.json> <winner index> --cap-usd 0.50
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const [runPath, idxArg] = process.argv.slice(2);
  const capAt = process.argv.indexOf('--cap-usd');
  const cap = capAt > 0 ? Number(process.argv[capAt + 1]) : NaN;
  if (!runPath || !Number.isFinite(cap) || cap <= 0) throw new Error('usage: <run.json> <winner index> --cap-usd <amount>');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { runReporter, liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { readPage } = await import('@/lib/social/reporter/read-page');
  const { readableDate } = await import('@/lib/social/pipeline/reporter-stage');
  const { STAGE_MODELS } = await import('@/lib/social/pipeline/models');

  const run = JSON.parse(await fsp.readFile(runPath, 'utf8'));
  const winner = run.selection.winners[Number(idxArg ?? 0)];
  const startingSources = [...new Set<string>(winner.members.map((m: { url: string }) => m.url))];
  const reads: Array<{ url: string; ok: boolean; chars?: number; resolvedUrl?: string; error?: string }> = [];
  const result = await runReporter(
    { story: winner.representative.headline, startingSources, today: readableDate(new Date()) },
    {
      create: liveMessagesCreate(new Anthropic()),
      readPage: async (url) => {
        const page = await readPage(url);
        reads.push(page.ok ? { url, ok: true, chars: page.text.length, resolvedUrl: page.resolvedUrl } : { url, ok: false, error: page.error });
        return page;
      },
      costCapUsd: cap,
    },
  );
  const dir = path.join(process.cwd(), 'runs', `reporter-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(dir, { recursive: true });
  if (result.raw) await fsp.writeFile(path.join(dir, 'brief.txt'), result.raw);
  await fsp.writeFile(path.join(dir, 'result.json'), JSON.stringify({ model: STAGE_MODELS.reporter, story: winner.representative.headline, startingSources, reads, result: { ...result, pages: undefined } }, null, 2));
  console.log(JSON.stringify({
    dir: path.relative(process.cwd(), dir), ok: result.ok, reason: result.ok ? null : result.reason, detail: result.ok ? null : result.detail,
    costUsd: result.costUsd, turns: result.turns, webSearches: result.webSearches, pageReadCalls: result.pageReads,
    pagesRead: reads.filter((r) => r.ok).length, pagesFailed: reads.filter((r) => !r.ok).length,
  }, null, 2));
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
