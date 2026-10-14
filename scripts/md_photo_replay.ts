/**
 * Replay one Morning Download set's photo stage with its trace (diagnosis only).
 * Re-writes the set's chosen stories (md-headlines@2, for their photo requests,
 * which the set never saved) and runs the live photo set on them, printing each
 * frame's design-stage steps. Saves nothing but the cost rows, against the set.
 *
 *   npx tsx scripts/md_photo_replay.ts <set-id>
 *
 * Live Claude + Jev calls (~$0.10): run only with Tommy's go-ahead.
 */
import './stories_env';
import { newAnthropic } from '@/lib/anthropic-client';
import { liveStoriesDb } from '@/lib/stories/db';
import { findSetOrEach, createLivePhotoFinder, type PhotoRequest } from '@/lib/stories/photos';
import { MD_HEADLINES, material, type MdHeadlinesOut } from '@/lib/stories/prompts';
import { loadSettings } from '@/lib/stories/settings';
import { recentPhotoUses } from '@/lib/stories/sources/carousel';
import type { StoryCandidate } from '@/lib/stories/sources/reels';
import { liveWriterCreate, writeStructured } from '@/lib/stories/writer';

async function main() {
  const setId = process.argv[2];
  if (!setId) throw new Error('usage: md_photo_replay.ts <set-id>');
  const db = liveStoriesDb;
  const { rows: sets } = await db.query<{ payload: { historyKeys?: string[] } }>(`SELECT payload FROM stories.sets WHERE id = $1`, [setId]);
  const keys = sets[0]?.payload.historyKeys ?? [];
  if (!keys.length) throw new Error(`set ${setId} has no stories`);
  const { rows } = await db.query<{ payload: { story: StoryCandidate } }>(`SELECT payload FROM stories.pool WHERE series = 'morning_download' AND key = ANY($1::text[])`, [keys]);
  const stories = keys.map((k) => rows.find((r) => r.payload.story.key === k)?.payload.story).filter((s): s is StoryCandidate => Boolean(s));
  console.log(`${stories.length} of ${keys.length} stories found in the pool`);

  const settings = await loadSettings(db);
  const written = (
    await writeStructured<MdHeadlinesOut>({
      create: liveWriterCreate(), db, setId, component: MD_HEADLINES.id, model: settings.models.copy, system: MD_HEADLINES.system, tool: MD_HEADLINES.tool,
      user: material(stories.map((c) => ({ key: c.key, headline: c.headline, outlet: c.sourceName, also_reported_by: c.alsoFrom ?? [], published: c.publishedAt, url: c.url, text: c.body.slice(0, 9000) }))),
    })
  ).value;

  const exclude = new Set((await recentPhotoUses(db, new Date())).keys());
  const byKey = new Map(stories.map((s) => [s.key, s]));
  const frames = written.stories.filter((s) => byKey.has(s.key));
  const requests: PhotoRequest[] = [
    ...frames.map((s) => ({ kind: s.visual.kind, query: s.visual.query, subjects: s.subjects, storyDate: byKey.get(s.key)!.publishedAt?.slice(0, 10) ?? null, sourceUrls: [byKey.get(s.key)!.url], exclude, alts: s.alt_visuals ?? [], copy: s.headline })),
    { kind: written.opener_visual.kind, query: written.opener_visual.query, subjects: frames[0]!.subjects, storyDate: byKey.get(frames[0]!.key)!.publishedAt?.slice(0, 10) ?? null, sourceUrls: [byKey.get(frames[0]!.key)!.url], exclude },
  ];
  const client = newAnthropic();
  const finder = createLivePhotoFinder({ create: (p) => client.messages.create(p) });
  const trace: string[][] = [];
  const photos = await findSetOrEach(finder, requests, trace);
  requests.forEach((r, i) => {
    console.log(`\n=== ${i < frames.length ? `story ${i + 1}: ${frames[i]!.headline.slice(0, 80)}` : 'opener'}`);
    console.log(`request ${r.kind}: "${r.query}"; alts ${JSON.stringify(r.alts ?? [])}; subjects ${r.subjects.map((s) => s.name).join(', ')}`);
    for (const step of trace[i] ?? []) console.log(`  · ${step}`);
    console.log(`  → ${photos[i]?.src ?? 'NO PHOTO'}`);
  });
  console.log(`\nphoto stage spend $${finder.usd.toFixed(4)}; ${exclude.size} URLs excluded as used in the last 7 days`);
}

void main().then(() => process.exit(0), (err) => (console.error(err), process.exit(1)));
