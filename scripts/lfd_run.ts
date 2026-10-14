// scripts/lfd_run.ts
/**
 * Last Few Days, one live run by hand (spec §11 rollout step 2).
 *
 *   npx tsx scripts/lfd_run.ts          prints what a run would do; no calls
 *   npx tsx scripts/lfd_run.ts --live   Tommy only: a live run (Claude, Jev, photos), capped at lfd.settings.run_cap_usd
 *
 * CLAUDE.md Rule 1: agents never pass --live.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { HubQuery } from '@/lib/social-hub/db';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const live = process.argv.includes('--live');
  const { socialQuery } = await import('@/lib/social/store');
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { SLIDE_BUCKET } = await import('@/lib/social/overnight/config');
  const { closeDbPool } = await import('@/lib/db');
  const query = (await socialQuery()) as unknown as HubQuery;

  const raw = (await query<{ value: unknown }>(`SELECT value FROM lfd.settings WHERE key = 'run_cap_usd'`)).rows[0]?.value ?? 1;
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap <= 0) {
    console.error(`lfd.settings.run_cap_usd is not a positive number (got ${typeof raw === 'string' ? raw : JSON.stringify(raw)}); refusing to run`);
    await closeDbPool();
    process.exit(1);
  }
  if (!live) {
    console.log(`Dry: a live run would read the window's reels ideas, carousel shortlists and feeds, write and fact-check 5-6 stories, find photos, render 7-8 slides and save a review post. Cap $${cap}. Re-run with --live to do it.`);
    await closeDbPool();
    return;
  }

  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { createRunBudget } = await import('@/lib/social/pipeline/live-stages');
  const { createLivePhotoFinder } = await import('@/lib/stories/photos');
  const { fetchAllFeeds } = await import('@/lib/social/ingest/fetch-feeds');
  const { HELIOS_SOCIAL_FEEDS } = await import('@/lib/social/feeds');
  const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { readPage } = await import('@/lib/social/reporter/read-page');
  const { runLastFewDays } = await import('@/lib/lfd/run');

  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, cap);
  const budget = createRunBudget({ capUsd: cap, otherSpendUsd: () => tally.costUsd });
  const create = budget.guard(liveMessagesCreate(newAnthropic()));
  const bucket = mediaBucket(SLIDE_BUCKET);

  const res = await runLastFewDays({
    query,
    jev,
    create,
    photos: createLivePhotoFinder({ jev, create, runRef: `lfd:${new Date().toISOString()}` }),
    fetchFeeds: () => fetchAllFeeds(HELIOS_SOCIAL_FEEDS),
    fetchBody: fetchBodyLive,
    readPage: (url) => readPage(url),
    fitCheck: checkRenderFit,
    upload: (p, b) => bucket.upload(p, b, 'image/jpeg'),
    now: new Date(),
    trigger: 'manual',
    capUsd: cap,
    spend: () => ({ claudeUsd: budget.claudeUsd(), jevUsd: tally.costUsd }),
  });
  console.log(JSON.stringify({ ...res, spentUsd: budget.spent() }, null, 2));
  await closeDbPool();
  process.exit(res.ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  const { closeDbPool } = await import('@/lib/db');
  await closeDbPool().catch(() => undefined);
  process.exit(1);
});
