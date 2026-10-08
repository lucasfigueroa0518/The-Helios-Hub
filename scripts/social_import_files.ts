/**
 * Helios Social: one-time import of the local stores into the Postgres
 * `social` schema (storage spec 2026-10-08 §4). Idempotent: rows already
 * there are skipped by their natural key (feed health only when the table is
 * empty). Old runs/ folders are not imported.
 *
 *   npx tsx scripts/social_import_files.ts [--dry-run]
 *
 * No AI calls. Needs DIRECT_DATABASE_URL or DATABASE_URL in .env.local.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const dry = process.argv.includes('--dry-run');
  const { socialQuery } = await import('@/lib/social/store');
  const { insertFeedHealth, insertPosted, insertSetAside, insertUsedPhoto, upsertPost } = await import('@/lib/social/store/pg');
  const { GENERATED_DIR, listGeneratedSlugs, readGeneratedPost } = await import('@/lib/social/render/local-store');
  type UsedPhoto = import('@/lib/social/photos/used-photos').UsedPhoto;
  type PostedRecord = import('@/lib/social/ingest/select/posted').PostedRecord;
  type SetAsideEntry = import('@/lib/social/pipeline/set-aside-log').SetAsideEntry;
  type FeedHealthEntry = import('@/lib/social/ingest/select/feed-health').FeedHealthEntry;

  const out = (f: string) => path.join(process.cwd(), 'Claude outputs', f);
  const json = async <T>(f: string, empty: T): Promise<T> => {
    try { return JSON.parse(await fsp.readFile(f, 'utf8')) as T; } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty; throw err; }
  };
  const jsonl = async <T>(f: string): Promise<T[]> => {
    try { return (await fsp.readFile(f, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as T); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
  };

  const used = await json<UsedPhoto[]>(out('social-used-photos.json'), []);
  const posted = await json<PostedRecord[]>(out('social-posted.json'), []);
  const setAsides = await jsonl<SetAsideEntry>(out('social-set-aside.jsonl'));
  const feedHealth = await jsonl<FeedHealthEntry>(out('social-feed-health.jsonl'));
  const slugs = await listGeneratedSlugs();
  console.log(`Found: ${used.length} used photos, ${posted.length} posted stories, ${setAsides.length} set-asides, ${feedHealth.length} feed-health rows, ${slugs.length} rendered posts`);
  if (dry) return;

  const query = await socialQuery();
  const count = async (t: string) => Number((await query(`SELECT count(*)::int AS n FROM social.${t}`)).rows[0].n);
  const before = Object.fromEntries(await Promise.all(['used_photos', 'posted_stories', 'set_asides', 'feed_health', 'posts'].map(async (t) => [t, await count(t)] as const)));

  for (const e of used) await insertUsedPhoto(query, e);
  for (const r of posted) await insertPosted(query, r);
  for (const e of setAsides) await insertSetAside(query, e);
  if (before.feed_health === 0) for (const e of feedHealth) await insertFeedHealth(query, e);
  else console.log('feed_health already has rows: skipped');
  for (const slug of slugs) {
    if ((await query(`SELECT 1 FROM social.posts WHERE slug = $1`, [slug])).rows.length) continue;
    const render = await readGeneratedPost(slug);
    if (!render) continue;
    const cover = render.slides[0];
    const title = (cover?.headline ?? cover?.title ?? []).map((r) => r.text).join('').trim() || slug;
    const stat = await fsp.stat(path.join(GENERATED_DIR, `${slug}.json`));
    await upsertPost(query, { runId: null, slug, storyId: render.sourceUrl || null, title, status: 'preview', brief: null, draft: null, render, createdAt: stat.mtime.toISOString() });
  }

  for (const t of Object.keys(before)) console.log(`social.${t}: ${before[t]} → ${await count(t)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
