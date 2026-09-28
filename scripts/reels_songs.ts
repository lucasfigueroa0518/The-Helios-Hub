/**
 * Run the song ingest by hand (D-166): the day-one fill without waiting for
 * 12:30 AM, or a re-tag after the endpoint comes up.
 *
 *   npm run reels:songs            # fetch trending, cache, evict, tag
 *   npm run reels:songs -- --tag   # only tag what is untagged
 */
import fs from 'node:fs';
import path from 'node:path';

for (const file of ['.env.local', 'scripts/gcp/worker.env']) {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

async function main(): Promise<void> {
  const { closeDbPool } = await import('@/lib/db');
  try {
    if (process.argv.includes('--tag')) {
      const { clapConfigured, createLiveClapClient } = await import('@/lib/reels/music/clap');
      const { tagUntagged } = await import('@/lib/reels/music/tag');
      const { downloadFrameObject } = await import('@/lib/reels/visual/storage');
      if (!clapConfigured()) throw new Error('HF_TOKEN and HF_CLAP_ENDPOINT_URL must be set.');
      console.log(JSON.stringify(await tagUntagged({ clap: createLiveClapClient(), downloadPreview: downloadFrameObject }), null, 2));
      return;
    }
    const { runSongIngest } = await import('@/lib/reels/music/ingest');
    console.log(JSON.stringify(await runSongIngest('manual'), null, 2));
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
