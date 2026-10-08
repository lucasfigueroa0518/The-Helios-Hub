/**
 * Copy a content type's lifecycle history onto the social_hub spine (D36).
 * Idempotent; reads the type's old tables and writes only social_hub. A
 * human decision: it refuses to run without --apply.
 *
 *   npx tsx scripts/backfill_spine.ts carousels --apply
 *   npx tsx scripts/backfill_spine.ts explainers --apply
 *   npx tsx scripts/backfill_spine.ts reels --apply
 */
import path from 'node:path';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

async function main() {
  const vertical = process.argv[2];
  if (vertical !== 'carousels' && vertical !== 'explainers' && vertical !== 'reels' && vertical !== 'stories') {
    throw new Error('Usage: npx tsx scripts/backfill_spine.ts <carousels|explainers|reels|stories> --apply');
  }
  if (!process.argv.includes('--apply')) {
    console.error('Refusing to run without --apply (this writes to the shared database).');
    process.exit(2);
  }
  const { closeDbPool, dbQuery } = await import('@/lib/db');
  const { backfillCarousels, backfillExplainers, backfillReels } = await import('@/lib/social-hub/backfill');
  try {
    if (vertical === 'stories') {
      // Stories are projected, not copied (D44): re-project every set from stories.sets.
      const { liveStoriesDb } = await import('@/lib/stories/db');
      const { projectAllSets } = await import('@/lib/stories/spine');
      console.log(JSON.stringify({ vertical, projected: await projectAllSets(liveStoriesDb) }));
      return;
    }
    const run = { carousels: backfillCarousels, explainers: backfillExplainers, reels: backfillReels }[vertical];
    const counts = await run((text, params) => dbQuery(text, params));
    console.log(JSON.stringify({ vertical, copied: counts }));
  } finally {
    await closeDbPool();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
