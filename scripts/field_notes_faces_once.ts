/**
 * npm run field-notes:faces — the worker's Field Notes face check, once, from this machine (local testing without
 * the helios-social VM). Claims up to one batch of photos uploaded since the face check exists and still pending
 * (field_notes.pool faces_result 'pending', faces_checked_at NULL), downloads each master from the photo bucket,
 * runs the local detector (headless Chromium; `npx playwright install chromium` once) and tags a clear face
 * Faces (auto). Nothing else in the pool is read or written (Rule 2). No model call, no spend.
 *
 *   npm run field-notes:faces            one batch (10)
 *   npm run field-notes:faces -- --all   batches until nothing pending is left
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

const log = (message: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'field-notes-faces', message, ...fields }));

async function main(): Promise<void> {
  const all = process.argv.slice(2).includes('--all');
  const { socialQuery } = await import('@/lib/social/store');
  const { closeDbPool } = await import('@/lib/db');
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { PHOTO_BANK_BUCKET } = await import('@/lib/media-library/types');
  const { openLiveFaceDetector, runFacesStep } = await import('@/lib/field-notes/photos/faces-worker');
  const db = (await socialQuery()) as unknown as import('@/lib/media-library/types').Query;
  const bucket = mediaBucket(PHOTO_BANK_BUCKET);
  try {
    for (;;) {
      const out = await runFacesStep({ db, download: (p) => bucket.download(p), openDetector: openLiveFaceDetector });
      log('field_notes_faces_batch', { ...out });
      // A batch with nothing settled (all retrying or released) would loop on the same failure: stop.
      if (!all || out.claimed === 0 || out.faces + out.none + out.unavailable === 0) break;
    }
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  },
);
