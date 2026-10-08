/**
 * Helios Social — LIVE Writer run on saved Reporter briefs (Tommy's OK
 * required). A total cap is required: no Claude call starts unless
 * CALL_RESERVE_USD (one call's worst case) still fits under it.
 *
 *   npx tsx scripts/social_writer_run.ts --cap-usd 0.50 <name>=<brief.json> …
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

/** One Writer call at most: ~10k input (incl. cache write) + 16k output on Sonnet 5.5. */
const CALL_RESERVE_USD = 0.2;

async function main() {
  const at = process.argv.indexOf('--cap-usd');
  const cap = at > 0 ? Number(process.argv[at + 1]) : NaN;
  const inputs = process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=') as [string, string]);
  if (!Number.isFinite(cap) || cap <= 0 || inputs.length === 0) throw new Error('usage: --cap-usd <amount> <name>=<brief.json> …');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { validateBrief } = await import('@/lib/social/reporter/brief');
  const { runWriter, briefForWriter } = await import('@/lib/social/writer/writer');
  const { isWellKnownLive } = await import('@/lib/social/writer/well-known');
  const { priceAnthropicMessages } = await import('@/lib/anthropic-pricing');
  const { STAGE_MODELS } = await import('@/lib/social/pipeline/models');

  const live = liveMessagesCreate(new Anthropic());
  let spent = 0;
  const create: typeof live = async (params) => {
    if (spent + CALL_RESERVE_USD > cap) throw new Error(`total cap: $${spent.toFixed(4)} spent, a call could pass $${cap}`);
    const res = await live(params);
    spent += Number(priceAnthropicMessages([res as any], { modelId: STAGE_MODELS.writer.model }).costUsd);
    return res;
  };

  const dir = path.join(process.cwd(), 'runs', `writer-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(dir, { recursive: true });
  const summary = [];
  for (const [name, file] of inputs) {
    const brief = validateBrief(JSON.parse(await fsp.readFile(file, 'utf8')));
    const wellKnown = (await briefForWriter(brief, isWellKnownLive)).subjects.map((s) => `${s.name}: ${s.well_known}`);
    const r = await runWriter(brief, { create, isWellKnown: isWellKnownLive });
    await fsp.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ brief: file, wellKnown, result: r }, null, 2));
    summary.push({ name, ok: r.ok, reason: r.ok ? null : r.reason, detail: r.ok ? null : r.detail, costUsd: r.costUsd, turns: r.turns, draftRetries: r.draftRetries, retryErrors: r.retryErrors, wellKnown });
  }
  console.log(JSON.stringify({ dir: path.relative(process.cwd(), dir), totalUsd: Number(spent.toFixed(4)), summary }, null, 2));
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
