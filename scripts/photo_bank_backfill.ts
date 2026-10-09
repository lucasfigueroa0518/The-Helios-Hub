/**
 * Photo bank backfill (DECISIONS_LOG D49): photos already published, from
 * social.used_photos (and optionally the old file log), into the bank, then
 * the ingest of what resolves (dead links → gone; their sightings and tags
 * are kept). Same import as the bank's passive drain(), without its batch
 * limit. Needs the media_library schema (scripts/apply_media_library_schema.js).
 *
 * A human runs this, after capture is on (rollout in D49). It refuses to run
 * without --dry-run or --apply:
 *
 *   npx tsx scripts/photo_bank_backfill.ts --dry-run                 plan only: counts, nothing written or fetched
 *   npx tsx scripts/photo_bank_backfill.ts --apply --limit 200       the next 200 rows past the watermark
 *   npx tsx scripts/photo_bank_backfill.ts --apply --since 2026-10-01   rows used since then (the watermark stays)
 *   npx tsx scripts/photo_bank_backfill.ts --apply --file            also 'Claude outputs/social-used-photos.json'
 *   npx tsx scripts/photo_bank_backfill.ts --apply --file path/to/log.json
 *
 * Downloads go to the original hosts (Wikimedia, Openverse providers,
 * article sites) with the bank's User-Agent; copies go to the private
 * `photo-bank` bucket. No Claude, Jev or web_search calls.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (dryRun === apply) {
    console.error('Pass exactly one of --dry-run (plan only) or --apply (writes the bank and downloads photos).');
    process.exit(2);
  }
  const limitArg = flag('--limit');
  const limit = limitArg ? Number(limitArg) : 5000;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('--limit must be a positive whole number');
  const sinceArg = flag('--since');
  const since = sinceArg ? new Date(sinceArg) : undefined;
  if (since && Number.isNaN(since.getTime())) throw new Error('--since must be a date (YYYY-MM-DD)');
  const fileArg = flag('--file');
  const file = fileArg === undefined ? null : fileArg || path.join(process.cwd(), 'Claude outputs', 'social-used-photos.json');

  const { dbQuery, closeDbPool } = await import('@/lib/db');
  const { fromFileEntries, importUsedPhotos } = await import('@/lib/media-library/backfill');
  const { runIngest } = await import('@/lib/media-library/ingest');
  const { loadBankSettings } = await import('@/lib/media-library/settings');
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { PHOTO_BANK_BUCKET } = await import('@/lib/media-library/types');
  const query = (text: string, params?: unknown[]) => dbQuery(text, params);

  const settings = await loadBankSettings(query);
  if (!settings.present) throw new Error('media_library is not applied (node scripts/apply_media_library_schema.js --apply)');
  if (!settings.capture) console.log('Note: capture is off; the backfill runs anyway (it is an explicit run).');

  const fileRows = file ? fromFileEntries(JSON.parse(await fsp.readFile(file, 'utf8'))) : [];
  const r = await importUsedPhotos(query, { limit, since, dryRun, fileRows });
  const reasons = new Map<string, number>();
  for (const s of r.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  console.log(JSON.stringify({
    dryRun,
    rowsRead: r.read,
    sightings: r.sightings,
    sourcesQueued: r.sources,
    notStored: r.skipped.length,
    notStoredWhy: Object.fromEntries(reasons),
    watermark: r.watermark ?? (since ? 'unchanged (--since)' : 'unchanged'),
  }, null, 2));

  if (!dryRun) {
    const bucket = mediaBucket(PHOTO_BANK_BUCKET);
    const stats = await runIngest({ query, bucket, http: fetch, log: (l) => console.log(l) }, { concurrency: 2 });
    console.log(JSON.stringify({ ingest: stats }, null, 2));
  }
  await closeDbPool();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  },
);
