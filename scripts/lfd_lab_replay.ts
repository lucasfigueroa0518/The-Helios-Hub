/**
 * Replay one Last Few Days day through the lab engine (local PGlite writes,
 * Hub reads only). Used to check meme-as-photo rescue and the unused-pool scan
 * without touching prod lfd.posts.
 *
 *   npx tsx scripts/lfd_lab_replay.ts --as-of 2026-10-27
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

function asOfArg(): Date {
  const i = process.argv.indexOf('--as-of');
  const day = i >= 0 ? process.argv[i + 1] : null;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error('Usage: npx tsx scripts/lfd_lab_replay.ts --as-of YYYY-MM-DD');
    process.exit(1);
  }
  // 3:00 AM New York on that date (EDT = UTC-4 through early November).
  return new Date(`${day}T07:00:00Z`);
}

async function main() {
  const asOf = asOfArg();
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgliteDb } = await import('@/lib/memes/db');
  const { ensureLfdSchema, readOnly } = await import('@/lib/memes/lfd-sim/router');
  const { inProcessEngine } = await import('@/lib/memes/lfd-sim/run');
  const { liveHubQuery } = await import('@/lib/social-hub/db');
  const { liveLfdDeps } = await import('@/lib/lfd/live');
  const local = pgliteDb(new PGlite());
  await ensureLfdSchema(local);
  const hub = readOnly(liveHubQuery);
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.memes-local', 'lfd-replay-'));
  const engine = inProcessEngine({
    local,
    hub,
    lfdDeps: (o) => liveLfdDeps(hub, { capUsd: o.capUsd, trigger: 'manual', now: o.now }),
  });
  console.log(`Replaying Last Few Days as of ${asOf.toISOString()} → ${dir}`);
  const result = await engine({ asOf, replay: true, dir, onProgress: (p) => console.log(JSON.stringify(p)) });
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  const { rows } = await local.query<{
    stories: Array<{ headline: string; url: string; photoSource?: string; meme?: { templateId: string } }>;
  }>(`SELECT stories FROM lfd.posts WHERE id = $1`, [result.postId]);
  const { rows: runs } = await local.query<{ record: Record<string, unknown> }>(`SELECT record FROM lfd.runs ORDER BY requested_at DESC LIMIT 1`);
  console.log(JSON.stringify({
    ok: true,
    postId: result.postId,
    stories: result.stories,
    spentUsd: result.spentUsd,
    headlines: (rows[0]?.stories ?? []).map((s) => ({ headline: s.headline, photoSource: s.photoSource ?? 'finder', meme: s.meme?.templateId ?? null, url: s.url })),
    memes: runs[0]?.record?.memes ?? null,
    drops: (runs[0]?.record?.drops as unknown[]) ?? [],
    dir,
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
