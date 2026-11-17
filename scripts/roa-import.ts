/**
 * Import dataset and viral AI images into the Real or AI? pool (CONTRACT.md §4, RA-5).
 *
 *   npx tsx scripts/roa-import.ts <folder> [--dry]
 *
 * The folder holds the images (PNG or JPEG) and provenance.json, an array of
 *   { "file": "<name in the folder>", "subject": "<content-map subject>", "trap": "mundane" | "amateur",
 *     "provenance": { "kind": "dataset", "dataset": "...", "id": "...", "model"?: "..." }
 *                 | { "kind": "viral", "url": "...", "firstSeen"?: "...", "model"?: "..." } }
 * AI images only: an entry without provenance, without a provenance kind, of another kind, or marked real is refused.
 *
 * Each image is screened (Jev vision) and gets a reveal line (Claude) like the daily run, so a real run is paid
 * (about $0.01–0.02 an image) and needs Lucas's go-ahead (CLAUDE.md Rule 1). --dry only checks the manifest.
 */
import './stories_env';

import fs from 'node:fs/promises';
import path from 'node:path';

import { liveStoriesDb } from '@/lib/stories/db';
import { poolDay } from '@/lib/stories/pool';
import { readRoaHistory } from '@/lib/stories/roa/history';
import { parseImportManifest, runRoaImport } from '@/lib/stories/roa/intake';
import { liveRoaVisionTransport } from '@/lib/stories/roa/screen';
import { loadSettings } from '@/lib/stories/settings';
import { createStoriesStorage } from '@/lib/stories/storage';
import { liveWriterCreate } from '@/lib/stories/writer';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const folder = args.find((a) => !a.startsWith('--'));
  const dry = args.includes('--dry');
  if (!folder) throw new Error('usage: npx tsx scripts/roa-import.ts <folder> [--dry]');
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'provenance.json'), 'utf8')) as unknown;

  if (dry) {
    const { entries, refused } = parseImportManifest(manifest);
    console.log(JSON.stringify({ ok: entries.map((e) => e.file), refused }, null, 2));
    return;
  }

  const db = liveStoriesDb;
  const now = new Date();
  const { usedKeys } = await readRoaHistory(db);
  const result = await runRoaImport(
    { db, write: liveWriterCreate(), settings: await loadSettings(db), vision: liveRoaVisionTransport, storage: createStoriesStorage(), now, day: poolDay(now), used: usedKeys },
    manifest,
    (file) => fs.readFile(path.join(folder, file)),
  );
  console.log(JSON.stringify(result, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
