/**
 * The nightly Instagram photo read by hand (CI-32, lib/photos/ig-sync.ts). The worker runs it at 11:45 PM.
 *
 *   npx tsx scripts/photos/ig-sync.ts          dry: lists the account's posts and prints each match; writes nothing
 *   npx tsx scripts/photos/ig-sync.ts --go     writes the matches and their photos into the used-photo ledger
 *
 * Reads Instagram (META_USER_ACCESS_TOKEN / META_IG_BUSINESS_ACCOUNT_ID) and the photos' bytes for hashing.
 * No model call of any kind.
 */
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main(): Promise<void> {
  const go = process.argv.includes('--go');
  const { metaConfigured } = await import('@/lib/instagram/graph');
  if (!metaConfigured()) throw new Error('Meta is not configured: set META_USER_ACCESS_TOKEN and META_IG_BUSINESS_ACCOUNT_ID.');
  const { socialQuery } = await import('@/lib/social/store');
  const { liveIgSyncDeps, syncPublishedPhotos } = await import('@/lib/photos/ig-sync');
  const { closeDbPool } = await import('@/lib/db');
  try {
    const deps = await liveIgSyncDeps(await socialQuery(), (line) => console.log(`  note: ${line}`), { dryRun: !go });
    const report = await syncPublishedPhotos(deps);
    console.log(go ? 'Instagram photo read (written):' : 'Instagram photo read (dry run, nothing written):');
    for (const m of report.matches) {
      const what = m.how === 'none' ? 'no match' : `${m.vertical} ${m.postId} by ${m.how}${m.alreadyLogged ? ' (already logged)' : `, ${m.photos} photo(s)`}`;
      console.log(`  ${m.timestamp} ${m.surface} ${m.mediaId}: ${what}`);
    }
    const { matches: _matches, ...counts } = report;
    console.log(JSON.stringify(counts));
  } finally {
    await closeDbPool();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
