// scripts/create_public_feeds_bucket.ts
/**
 * Creates the PUBLIC Supabase Storage bucket `public-feeds` (AI Events plan M3, AE-19) that
 * heliosgroup.ai reads the events calendar snapshot from. Idempotent: an existing bucket is left
 * as it is when already public, or switched to public with the same settings.
 *
 *   npx tsx scripts/create_public_feeds_bucket.ts
 *
 * Uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local, which point at
 * production: Lucas runs it (or approves it), agents do not. It touches Storage only, never a
 * table. Objects in this bucket are world-readable, so only the public snapshot is uploaded to it.
 */
import path from 'node:path';

async function main(): Promise<number> {
  try {
    process.loadEnvFile(path.join(process.cwd(), '.env.local'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const { ensurePublicFeedsBucket, livePublicFeedStorageConfig, publicFeedUrl, PUBLIC_FEEDS_BUCKET } = await import(
    '@/lib/networking/public-feed-storage'
  );
  const cfg = livePublicFeedStorageConfig();
  const outcome = await ensurePublicFeedsBucket(cfg);
  const label = { created: 'created', made_public: 'existed, now public', already_public: 'already exists and is public' }[outcome];
  console.log(`Bucket ${PUBLIC_FEEDS_BUCKET}: ${label}.`);
  console.log(`Events feed URL: ${publicFeedUrl(cfg.baseUrl)}`);
  return 0;
}

// Only when run directly: importing this file never touches Storage.
if (process.argv[1]?.endsWith('create_public_feeds_bucket.ts')) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
