/**
 * Helios Social rebuild — M0 dry run. Stubbed stages only: no model, no
 * Jev, no network, no DB. Prints the post objects, set-aside entries and
 * cost breakdown for two runs:
 *   1. clean: both slots filled by the top two stories;
 *   2. writer fails on story-a: it's set aside and story-c fills the slot.
 *
 *   npx tsx scripts/social_dry_run.ts
 */
import { createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { runDay } from '@/lib/social/pipeline/orchestrator';
import { createInMemorySetAsideLog } from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages, type StubOptions } from '@/lib/social/pipeline/stubs';

async function dryRun(label: string, stubOpts: StubOptions) {
  const result = await runDay({
    articles: STUB_ARTICLES,
    stages: createStubStages(stubOpts),
    meter: createCostMeter(),
    log: createInMemorySetAsideLog(),
    now: new Date(),
  });
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  await dryRun('clean run', {});
  await dryRun('writer fails on story-a', {
    failures: [{ stage: 'writer', reasonCode: 'malformed-output', storyId: 'story-a' }],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
