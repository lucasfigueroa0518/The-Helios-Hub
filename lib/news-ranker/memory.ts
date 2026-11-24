/**
 * News Ranker memory (CONTRACT.md, D1/D2/D11): ONE shared read of what Morning
 * Download and Last Few Days already said, and the repeat rule. A story the
 * asking format already ran comes back only for a massive development
 * (news-massive-development@1 ≥ MASSIVE_BAR). LFD may recap MD's stories (D2):
 * readSaid returns only the asking format's records.
 *
 * Pure reads; bounded by window or by the given story ids (never a sweep,
 * CLAUDE.md rule 2).
 */
import type { JevAsk } from '@/lib/social/jev/client';
import { newArticlesSince, readWhatWeSaid, articlesText, SAID_DAYS, type NewArticle } from '@/lib/stories/md-development';

import { NEWS_MASSIVE_DEVELOPMENT } from './questions';
import { MASSIVE_BAR } from './scores';
import type { NewsFormat, RankerStory, RepeatVerdict, SaidRecord } from './types';

export type MemoryQuery = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }> };

const nyDate = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** LFD's non-rejected posts: one record per story slide, inside `days` or about the given intake stories. */
async function readLfdSaid(q: MemoryQuery, now: Date, days: number, storyIds: readonly string[]): Promise<SaidRecord[]> {
  const { rows } = await q.query<{ key: string | null; story_id: string | null; headline: string | null; posted_at: Date | string }>(
    `SELECT st.v->>'key' AS key, COALESCE(st.v->>'storyId', st.v->>'intakeStoryId') AS story_id, st.v->>'headline' AS headline,
            COALESCE(p.published_at, p.created_at) AS posted_at
       FROM lfd.posts p
       CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.stories) = 'array' THEN p.stories ELSE '[]'::jsonb END) AS st(v)
      WHERE p.status <> 'rejected'
        AND (COALESCE(p.published_at, p.created_at) > $1::timestamptz - make_interval(days => $2)
             OR COALESCE(st.v->>'storyId', st.v->>'intakeStoryId') = ANY($3::text[]))`,
    [now.toISOString(), days, [...new Set(storyIds)]],
  );
  return rows
    .filter((r) => r.key)
    .map((r) => ({ format: 'lfd' as const, storyId: r.story_id, key: r.key!, headline: r.headline?.trim() ?? '', postedAt: r.posted_at instanceof Date ? r.posted_at : new Date(r.posted_at) }));
}

/**
 * What the asking format already said (D2: only its own records). MD: stories.history + approved/scheduled sets,
 * exactly as lib/stories/md-development.ts readWhatWeSaid reads them. LFD: lfd.posts that are not rejected.
 * A missing headline is '' (repeatVerdict then blocks, as md-development does).
 */
export async function readSaid(q: MemoryQuery, format: NewsFormat, now: Date, opts: { days?: number; storyIds?: readonly string[] } = {}): Promise<SaidRecord[]> {
  const days = opts.days ?? SAID_DAYS;
  if (format === 'lfd') return readLfdSaid(q, now, days, opts.storyIds ?? []);
  const said = await readWhatWeSaid(q, now, nyDate(now), { days, storyIds: opts.storyIds });
  return said.map((s) => ({ format: 'md' as const, storyId: s.storyId, key: s.key, headline: s.headline ?? '', postedAt: s.postedAt }));
}

/** The latest record about this story: same intake story id, or its key / a member key. */
export function priorSaid(story: Pick<RankerStory, 'storyId' | 'key' | 'memberKeys'>, said: readonly SaidRecord[]): SaidRecord | null {
  const keys = new Set([story.key, ...story.memberKeys]);
  const hits = said.filter((s) => (s.storyId && s.storyId === story.storyId) || keys.has(s.key));
  return hits.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())[0] ?? null;
}

export type RepeatDeps = {
  jev: JevAsk;
  /** Articles of these intake stories first seen after `since` (default: md-development's newArticlesSince). */
  readArticles: (storyIds: readonly string[], since: Date) => Promise<NewArticle[]>;
};

/** Default article reader over the intake (pure read). */
export const intakeArticles = (q: MemoryQuery): RepeatDeps['readArticles'] => (ids, since) => newArticlesSince(q, ids, since);

/**
 * D2/D11: never run → allowed (no call). Run before → blocked with no stored headline or no articles since posted_at
 * (no call); otherwise allowed only with news-massive-development@1 `massive` ≥ MASSIVE_BAR.
 * `said` must already be the asking format's records (readSaid).
 */
export async function repeatVerdict(story: RankerStory, said: readonly SaidRecord[], deps: RepeatDeps, bar: number = MASSIVE_BAR): Promise<RepeatVerdict> {
  const prior = priorSaid(story, said);
  if (!prior) return { allowed: true, massive: null, reason: 'not run before' };
  if (!prior.headline) return { allowed: false, massive: null, reason: 'ran before; no stored headline to compare' };
  const articles = await deps.readArticles([story.storyId], prior.postedAt).catch(() => [] as NewArticle[]);
  if (!articles.length) return { allowed: false, massive: null, reason: 'ran before; no new articles since' };
  const res = await deps.jev(
    { state: { we_said: prior.headline, posted_at: prior.postedAt.toISOString(), new_articles: { untrusted_content: articlesText(articles) } }, questions: NEWS_MASSIVE_DEVELOPMENT.questions },
    { version: NEWS_MASSIVE_DEVELOPMENT.version, subjectId: story.storyId },
  );
  const massive = (res.answers.massive as { noul: number } | undefined)?.noul ?? 0;
  return massive >= bar
    ? { allowed: true, massive, reason: `ran before; massive development (${massive.toFixed(2)})` }
    : { allowed: false, massive, reason: `ran before; no massive development (${massive.toFixed(2)})` };
}
