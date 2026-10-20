/**
 * Filling the gate's short cells (Lucas, 2026-10-19): a cell needs MIN_CELL_N graded stories before a story in
 * it can pass, and LFD simulations only make memes for stories that already pass, so a short cell is filled by
 * hand. Given Hub story URLs Lucas approved, this reads each story (read only), tags it with Jev, puts it in the
 * lab with a body brief, and queues one single-story meme run, through the unchanged v5 pipeline. Lucas then
 * grades the slates in the meme lab and the cells fill.
 */
import type { HubQuery } from '@/lib/social-hub/db';
import type { JevAsk } from '@/lib/social/jev/client';
import { storyKey } from '@/lib/stories/sources/reels';

import type { Queryable } from '../db';
import { loadStoryTags, saveStoryTags } from '../odds-store';
import { tagStories, type StoryTags } from '../story-tags';

export const FILL_MAX = 20;
const BRIEF_CHUNK = 5;

export type FillResult = { id: string; headline: string; tags: StoryTags; requestId: string | null; error?: string };

const cellOf = (t: StoryTags) => `${t.irony || t.launch ? 'irony or launch' : 'neither'}, ${t.numberStory ? 'number story' : 'not a number story'}, ${t.shortHeadline ? 'short' : 'long'} headline`;

export async function fillStories(
  d: { db: Queryable; hub: HubQuery; jev: JevAsk; briefs: (ids: string[]) => Promise<number>; kickMemes: () => void; by: string },
  urls: string[],
): Promise<{ stories: Array<FillResult & { cell: string }>; briefUsd: number }> {
  if (!urls.length || urls.length > FILL_MAX) throw new Error(`Send 1 to ${FILL_MAX} story URLs.`);
  const { rows } = await d.hub<{ url: string; headline: string; body: string; source: string | null }>(
    `SELECT DISTINCT ON (canonical_url) canonical_url AS url, headline, body, source_name AS source FROM reels.sources
      WHERE canonical_url = ANY($1::text[]) ORDER BY canonical_url, publish_time DESC NULLS LAST`,
    [urls],
  );
  // A carousel-only story has no reels source: read it from the daily runs' shortlists.
  const notReels = urls.filter((u) => !rows.some((r) => r.url === u));
  if (notReels.length) {
    const { rows: shortlisted } = await d.hub<{ url: string; headline: string; body: string; source: string | null }>(
      `SELECT DISTINCT ON (url) url, headline, body, source FROM (
         SELECT COALESCE(e->'representative'->>'sourceUrl', e->>'id') AS url, e->'representative'->>'headline' AS headline,
                COALESCE(e->'representative'->>'body', e->>'body', '') AS body, e->'representative'->>'source' AS source, r.finished_at
           FROM social.runs r, jsonb_array_elements(r.record->'selection'->'shortlist') e
          WHERE r.kind = 'daily' AND jsonb_typeof(r.record->'selection'->'shortlist') = 'array') x
        WHERE url = ANY($1::text[]) AND headline IS NOT NULL ORDER BY url, finished_at DESC`,
      [notReels],
    );
    rows.push(...shortlisted);
  }
  const missing = urls.filter((u) => !rows.some((r) => r.url === u));
  if (missing.length) throw new Error(`Not in the Hub: ${missing.join(', ')}`);
  const known = await loadStoryTags(d.db, rows.map((r) => storyKey(r.url)));
  const fresh = await tagStories(d.jev, rows.filter((r) => !known.has(storyKey(r.url))).map((r) => ({ id: r.url, headline: r.headline, text: r.body ?? '' })));
  const tags = new Map(rows.map((r) => [r.url, known.get(storyKey(r.url)) ?? fresh.get(r.url)!]));
  const out: Array<FillResult & { cell: string }> = [];
  const day = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    const id = storyKey(r.url);
    const t = tags.get(r.url)!;
    await saveStoryTags(d.db, id, t);
    await d.db.query(
      `INSERT INTO memes.lfd_stories (id, group_kind, post_ref, ny_date, headline, url, body, origin, outlet)
       VALUES ($1, 'sim', $2, $3, $4, $5, $6, 'reels', $7)
       ON CONFLICT (id) DO UPDATE SET headline = EXCLUDED.headline, body = EXCLUDED.body`,
      [id, `fill:${day}`, day, r.headline, r.url, r.body ?? '', r.source],
    );
    out.push({ id, headline: r.headline, tags: t, requestId: null, cell: cellOf(t) });
  }
  let briefUsd = 0;
  for (let i = 0; i < out.length; i += BRIEF_CHUNK) briefUsd += await d.briefs(out.slice(i, i + BRIEF_CHUNK).map((s) => s.id));
  for (const s of out) {
    const { rows: ok } = await d.db.query<{ ok: boolean }>(`SELECT brief IS NOT NULL AS ok FROM memes.lfd_stories WHERE id = $1`, [s.id]);
    if (!ok[0]?.ok) {
      s.error = 'no brief';
      continue;
    }
    const { rows: req } = await d.db.query<{ id: string }>(
      `INSERT INTO memes.requests (kind, post_id, requested_by, detail) VALUES ('single', $1, $2, '{"fill":true}'::jsonb) RETURNING id::text`,
      [s.id, d.by],
    );
    s.requestId = req[0]!.id;
  }
  d.kickMemes();
  return { stories: out, briefUsd };
}
