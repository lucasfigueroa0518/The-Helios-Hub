/**
 * One live copy pass over the top N ideas on the latest slate. Does not ingest,
 * and does not turn on REELS_COPY_PROMPT_APPROVED for nightly runs.
 *
 *   npx tsx scripts/reels_copy_canary.ts
 *   npx tsx scripts/reels_copy_canary.ts --ranks 5
 */
import fs from 'node:fs';
import path from 'node:path';

function loadLocalEnvironment(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadLocalEnvironment();

const SPEND_CEILING_USD = 1.5;

function ranksArg(): number {
  const index = process.argv.indexOf('--ranks');
  const raw = index >= 0 ? Number(process.argv[index + 1]) : 5;
  if (!Number.isInteger(raw) || raw < 1 || raw > 20) {
    throw new Error('--ranks must be an integer from 1 to 20.');
  }
  return raw;
}

function log(message: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'reels-copy-canary', message, ...fields }));
}

async function main(): Promise<void> {
  const ranks = ranksArg();
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const { priceAnthropicMessages } = await import('@/lib/anthropic-pricing');
  const { closeDbPool, dbQuery } = await import('@/lib/db');
  const { COPY_MODEL, MONTHLY_WATCH_USD } = await import('@/lib/reels/config');
  const { loadCopyTargets, saveIdeaCopy } = await import('@/lib/reels/copy/store');
  const { writeCopy } = await import('@/lib/reels/copy/writer');
  const { finishRun, monthToDateUsd } = await import('@/lib/reels/repository');
  const { loadLatestSlate } = await import('@/lib/reels/scoring/store');

  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');

  const spent = await monthToDateUsd();
  if (spent >= MONTHLY_WATCH_USD) {
    throw new Error(`Month-to-date spend is $${spent.toFixed(2)}, at the $${MONTHLY_WATCH_USD} watch.`);
  }

  const slate = await loadLatestSlate();
  if (!slate) throw new Error('No score slate yet.');
  const targets = await loadCopyTargets(slate.id, { topRanks: ranks });
  log('targets', {
    slateId: slate.id,
    nyDate: slate.nyDate,
    ranks,
    ideas: targets.length,
    monthToDateUsd: spent,
    bodies: targets.map((target) => ({
      rank: target.rank,
      bucket: target.bucket,
      framework: target.framework,
      members: target.members.length,
      chars: target.members.reduce((sum, member) => sum + member.body.length, 0),
      headline: target.members[0]?.headline ?? '',
    })),
  });
  if (targets.length === 0) throw new Error(`No ranked ideas in the top ${ranks}.`);

  const { rows: runRows } = await dbQuery<{ id: string }>(
    `INSERT INTO reels.runs (trigger, status, started_at)
     VALUES ('manual', 'running', now())
     RETURNING id`,
  );
  const runId = runRows[0]?.id;
  if (!runId) throw new Error('Could not open a canary run.');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let usd = 0;
  let written = 0;
  const failures: string[] = [];

  try {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const result = await writeCopy(client, {
        bucket: target.bucket,
        framework: target.framework,
        members: target.members,
      });

      let inputTokens = 0;
      let outputTokens = 0;
      let cost = 0;
      if (result.message) {
        const priced = priceAnthropicMessages([result.message], {
          modelId: COPY_MODEL,
          fallbackCacheTtl: '5m',
        });
        inputTokens =
          priced.uncached_input_tokens +
          priced.cache_read_input_tokens +
          priced['cache_creation.ephemeral_5m_input_tokens'] +
          priced['cache_creation.ephemeral_1h_input_tokens'];
        outputTokens = priced.output_tokens;
        cost = Number(priced.costUsd);
        usd += cost;
        const { recordCost } = await import('@/lib/reels/repository');
        await recordCost({
          runId,
          vendor: 'anthropic',
          component: 'copy-caption-canary',
          inputTokens,
          outputTokens,
          usd: cost,
        });
      }

      await saveIdeaCopy({
        slateId: slate.id,
        postIdeaId: target.postIdeaId,
        runId,
        promptVersion: result.version,
        model: COPY_MODEL,
        bucket: target.bucket,
        framework: target.framework,
        report: result.report,
        checks: result.checks,
        error: result.error,
        inputTokens,
        outputTokens,
        usd: cost,
      });

      if (result.report) written += 1;
      else failures.push(`rank ${target.rank ?? '?'}: ${result.error ?? 'unknown error'}`);

      log('wrote', {
        rank: target.rank,
        bucket: target.bucket,
        framework: target.framework,
        headline: target.members[0]?.headline ?? '',
        usd: cost,
        error: result.error,
        checks: result.checks,
        onScreenCopy: result.report?.onScreenCopy ?? null,
        caption: result.report?.caption ?? null,
        callToAction: result.report?.callToAction ?? null,
        hashtags: result.report?.hashtags ?? null,
        sources: result.report?.sources ?? null,
      });

      const remaining = targets.length - index - 1;
      if (index === 0 && remaining > 0 && cost * (remaining + 1) > SPEND_CEILING_USD) {
        throw new Error(
          `First idea cost $${cost.toFixed(3)}. Projected $${(cost * targets.length).toFixed(2)} for ${targets.length} ideas, over the $${SPEND_CEILING_USD} ceiling. Stopped.`,
        );
      }
    }

    await finishRun(
      runId,
      failures.length === 0 ? 'ok' : 'partial',
      [],
      { copyWritten: written, usd },
      `Copy canary, top ${ranks}. Written ${written}, failed ${failures.length}, $${usd.toFixed(3)}.`,
    );
    log('done', { written, failed: failures.length, usd, failures });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(runId, 'failed', [], { copyWritten: written, usd }, `Copy canary stopped: ${message}`);
    throw error;
  } finally {
    await closeDbPool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
