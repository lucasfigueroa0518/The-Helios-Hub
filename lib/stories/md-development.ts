/**
 * Morning Download: remember what we said, and let a story we already ran back
 * in only for a new event (Bald-Eagle 2026-11-12, D2 / D5, PLAN "New 3").
 *
 * Replaces "any member's key shown in the last 3 days → the whole story is
 * dropped": every new article joins the same intake story, so that rule hid a
 * developing story for as long as it kept developing.
 *
 *   what we said   per story of an earlier MD set that went out or was approved
 *                  (by intake story id at any age; by key the last SAID_DAYS
 *                  days): its key, intake story id, the headline
 *                  we ran and when it posted. Published sets: stories.history
 *                  (the `headline` / `intake_story_id` columns recordHistory
 *                  fills at publish; db/bald_eagle_2026_11_12_md.sql). Older
 *                  rows have no stored headline: the story frame's headline is
 *                  read at run time, per story (no backfill, CLAUDE.md rule 2),
 *                  else the story stays blocked as before. Approved and
 *                  scheduled sets not yet published are read from the set.
 *   development    articles of the story first seen after posted_at, plus Jev
 *                  md-development@1 `new_event` ≥ DEVELOPMENT_BAR. No new
 *                  articles: blocked, no Jev call.
 *   spin-offs      an intake story the SAME_EVENT check ties to a story we ran
 *                  goes through the same test with that story's headline.
 *
 * TODO(News Ranker, CONTRACT.md D2/D11): production still uses md-development@1 ≥ DEVELOPMENT_BAR. The shared
 * replacement is lib/news-ranker/memory.ts (readSaid + repeatVerdict, news-massive-development@1 ≥ MASSIVE_BAR);
 * rewire here once the lab (/news-ranker/lab) has calibrated MASSIVE_BAR on Lucas-tagged repeats.
 */
import { MD_DEVELOPMENT } from '@/lib/stories/questions';
import type { Queryable } from '@/lib/stories/db';
import type { StoriesJev } from '@/lib/stories/jev';
import { DEVELOPMENT_BAR } from '@/lib/stories/scores';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

/**
 * How far back "what we said" reaches for a story known only by its key (no intake story id: a legacy or seed
 * candidate). A candidate with an intake story id is looked up by that id with no day limit (integration review S5:
 * a long-running story we ran 8+ days ago must still take the development test). First value, to calibrate.
 */
export const SAID_DAYS = 7;
/** New articles shown to the development test, newest first, and the text budget. */
export const NEW_ARTICLES_MAX = 12;
export const NEW_ARTICLES_CHARS = 6000;

export type Said = {
  /** The story key we ran (the set's historyKeys entry). */
  key: string;
  storyId: string | null;
  /** The headline we ran; null when neither the stored column nor a story frame has it (the story stays blocked). */
  headline: string | null;
  postedAt: Date;
  setId: string | null;
};

type SaidRow = { key: string; set_id: string | null; posted_at: Date | string; stored_headline: string | null; stored_story_id: string | null; payload_story_id: string | null; frame_headline: string | null };

/**
 * The stories of earlier Morning Download sets: published (stories.history) and approved/scheduled/publishing sets
 * that have not posted yet. Same-day sets are not here: the same-date rule (R13) blocks those outright.
 * Two reaches in one read: everything of the last `days` days (key matches), and, at any age, what we said about
 * the given intake stories (today's candidates' ids: bounded by them, never a sweep, CLAUDE.md rule 2).
 * `to_jsonb(h)` reads the new columns when the SQL file is applied and null before, so this never fails on them.
 */
export async function readWhatWeSaid(db: Queryable, now: Date, nyDate: string, opts: { days?: number; storyIds?: readonly string[] } = {}): Promise<Said[]> {
  const days = opts.days ?? SAID_DAYS;
  const ids = [...new Set(opts.storyIds ?? [])];
  const storyOf = `LEFT JOIN LATERAL (
         SELECT t.v, t.ord FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload->'stories') = 'array' THEN s.payload->'stories' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(v, ord)
          WHERE t.v->>'key' = %KEY% LIMIT 1) st ON true`;
  const frameOf = `(SELECT f.copy->>'headline' FROM stories.frames f WHERE f.set_id = s.id AND f.role = 'story' ORDER BY f.seq OFFSET GREATEST(st.ord - 1, 0) LIMIT 1)`;
  const { rows } = await db.query<SaidRow>(
    `SELECT h.key, h.set_id::text AS set_id, h.shown_at AS posted_at,
            to_jsonb(h)->>'headline' AS stored_headline, to_jsonb(h)->>'intake_story_id' AS stored_story_id,
            st.v->>'storyId' AS payload_story_id, CASE WHEN st.ord IS NULL THEN NULL ELSE ${frameOf} END AS frame_headline
       FROM stories.history h
       LEFT JOIN stories.sets s ON s.id = h.set_id
       ${storyOf.replace('%KEY%', 'h.key')}
      WHERE h.series = 'morning_download'
        AND (h.shown_at > $1::timestamptz - make_interval(days => $2)
             OR to_jsonb(h)->>'intake_story_id' = ANY($4::text[]) OR st.v->>'storyId' = ANY($4::text[]))
     UNION ALL
     SELECT k.key, s.id::text, COALESCE(s.publish_at, s.approved_at, s.updated_at), NULL, NULL,
            st.v->>'storyId', CASE WHEN st.ord IS NULL THEN NULL ELSE ${frameOf} END
       FROM stories.sets s
       CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(s.payload->'historyKeys') = 'array' THEN s.payload->'historyKeys' ELSE '[]'::jsonb END) AS k(key)
       ${storyOf.replace('%KEY%', 'k.key')}
      WHERE s.series = 'morning_download' AND s.status IN ('approved', 'scheduled', 'publishing')
        AND s.ny_date < $3::date AND (s.ny_date >= $3::date - $2::int OR st.v->>'storyId' = ANY($4::text[]))`,
    [now.toISOString(), days, nyDate, ids],
  );
  return rows.map((r) => ({
    key: r.key,
    storyId: r.stored_story_id ?? r.payload_story_id ?? null,
    headline: (r.stored_headline ?? r.frame_headline)?.trim() || null,
    postedAt: r.posted_at instanceof Date ? r.posted_at : new Date(r.posted_at),
    setId: r.set_id,
  }));
}

/** The latest thing we said about this candidate: same intake story, or its key / any member key is one we ran. */
export function saidAbout(c: StoryCandidate, said: readonly Said[]): Said | null {
  const keys = new Set([c.key, ...(c.intake?.memberKeys ?? [])]);
  const hits = said.filter((s) => (c.intake?.storyId && s.storyId === c.intake.storyId) || keys.has(s.key));
  return hits.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())[0] ?? null;
}

export type NewArticle = { headline: string; source: string; body: string; firstSeenAt: Date };

/** Articles of these intake stories (or stories merged into them) first seen after `since`, newest first. Pure read. */
export async function newArticlesSince(q: Queryable, storyIds: readonly string[], since: Date, limit: number = NEW_ARTICLES_MAX): Promise<NewArticle[]> {
  if (!storyIds.length) return [];
  const { rows } = await q.query<{ headline: string; source_name: string; body: string; first_seen_at: Date | string }>(
    `SELECT i.headline, i.source_name, i.body, i.first_seen_at
       FROM intake.items i JOIN intake.stories s ON s.id = i.story_id
      WHERE (s.id::text = ANY($1::text[]) OR s.merged_into::text = ANY($1::text[])) AND i.first_seen_at > $2::timestamptz
      ORDER BY i.first_seen_at DESC LIMIT $3`,
    [[...storyIds], since.toISOString(), limit],
  );
  return rows.map((r) => ({ headline: r.headline, source: r.source_name, body: r.body ?? '', firstSeenAt: r.first_seen_at instanceof Date ? r.first_seen_at : new Date(r.first_seen_at) }));
}

/** The new articles as one text block, newest first, within the budget. */
export function articlesText(articles: readonly NewArticle[], chars: number = NEW_ARTICLES_CHARS): string {
  let out = '';
  for (const a of articles) {
    const piece = `${a.source}: ${a.headline}\n${a.body.slice(0, 1200)}\n\n`;
    if (out.length + piece.length > chars) {
      out += piece.slice(0, Math.max(0, chars - out.length));
      break;
    }
    out += piece;
  }
  return out.trim();
}

export type DevelopmentVerdict =
  | { back: true; newEvent: number; articles: NewArticle[]; text: string }
  | { back: false; reason: string; newEvent?: number };

/**
 * The development test for one story we ran: blocked with no stored headline or no articles first seen after
 * posted_at (no Jev call); otherwise back only with `new_event` ≥ DEVELOPMENT_BAR.
 */
export async function developmentTest(
  o: { jev: StoriesJev; setId: string | null; said: Said; storyIds: readonly string[]; readArticles: (ids: readonly string[], since: Date) => Promise<NewArticle[]> },
): Promise<DevelopmentVerdict> {
  if (!o.said.headline) return { back: false, reason: 'ran before; no stored headline to compare' };
  const articles = await o.readArticles(o.storyIds, o.said.postedAt).catch(() => [] as NewArticle[]);
  if (!articles.length) return { back: false, reason: 'ran before; no new articles since' };
  const text = articlesText(articles);
  const res = await o.jev.ask({
    component: 'md-development',
    set: MD_DEVELOPMENT,
    setId: o.setId,
    state: { we_said: o.said.headline, posted_at: o.said.postedAt.toISOString(), new_articles: { untrusted_content: text } },
  });
  const newEvent = res.answers.new_event.noul;
  return newEvent >= DEVELOPMENT_BAR ? { back: true, newEvent, articles, text } : { back: false, reason: `ran before; new articles but no new event (${newEvent.toFixed(2)})`, newEvent };
}
