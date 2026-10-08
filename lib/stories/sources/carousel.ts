/**
 * Tommy's carousel as a source (S-02, plan §2): `social.runs.record` (the full
 * run.json: selection.scored / shortlist) and `social.posts` (brief, render).
 * Built against his schema on feature/helios-social-rebuild
 * (db/social_schema.sql); his rows arrive when his daily runner writes them.
 * Read-only, except the one write his storage spec allows: a
 * `social.used_photos` row for a photo Stories actually published (S-24).
 *
 * The JSON is read defensively: a missing field drops that candidate, never
 * the build.
 */
import type { Queryable } from '@/lib/stories/db';

import { storyKey, type StoryCandidate } from './reels';

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A story group from selection.scored, as a candidate. */
export function groupToCandidate(g: Json, rank: number): StoryCandidate | null {
  const rep = (g.representative ?? {}) as Json;
  const members = arr(g.members) as Json[];
  const url = str(g.id) ?? str(rep.url);
  const headline = str(rep.title) ?? str(members[0]?.title);
  if (!url || !headline) return null;
  const outlets = arr(g.outlets).map(str).filter(Boolean) as string[];
  return {
    key: storyKey(url),
    origin: 'carousel',
    ref: url,
    headline,
    sourceName: outlets[0] ?? str(members[0]?.outlet) ?? 'unknown',
    url,
    body: str(g.body) ?? '',
    publishedAt: str(g.publishedAt),
    nativeScore: typeof g.passes === 'number' ? g.passes : null,
    alsoFrom: outlets.slice(1),
    ...(rank >= 0 ? {} : {}),
  };
}

type PostRow = { slug: string; story_id: string | null; status: string; brief: Json | null; render: Json; created_at: string };

/** The first photo the carousel placed for a post (its cover), with its credit (S-29). */
export function postPhoto(render: Json | null): { url: string; credit: string } | null {
  for (const s of arr(render?.slides) as Json[]) {
    const url = str(s.photoUrl);
    if (url && !url.startsWith('data:') && str(s.photoKind) !== 'logo') return { url, credit: str(s.photoCredit) ?? '' };
  }
  return null;
}

/** Morning Download pool, carousel side (plan §5.1): qualified stories from runs finished in the last 30 hours, shortlist first. */
export async function morningDownloadCarousel(db: Queryable, now: Date): Promise<StoryCandidate[]> {
  const runs = await db.query<{ record: Json }>(
    `SELECT record FROM social.runs WHERE finished_at > $1::timestamptz - interval '30 hours' ORDER BY finished_at DESC`,
    [now.toISOString()],
  );
  const posts = await db.query<PostRow>(`SELECT slug, story_id, status, brief, render, created_at::text FROM social.posts WHERE created_at > $1::timestamptz - interval '30 hours'`, [now.toISOString()]);
  const photoByStory = new Map(posts.rows.filter((p) => p.story_id).map((p) => [p.story_id!, postPhoto(p.render)]));
  const out: StoryCandidate[] = [];
  for (const { record } of runs.rows) {
    const sel = (record?.selection ?? {}) as Json;
    const shortlist = new Set((arr(sel.shortlist) as Json[]).map((g) => str(g.id)));
    const scored = (arr(sel.scored) as Json[]).filter((g) => g.status === 'qualified');
    scored.sort((a, b) => Number(shortlist.has(str(b.id))) - Number(shortlist.has(str(a.id))));
    scored.forEach((g, i) => {
      const c = groupToCandidate(g, i);
      if (c) out.push({ ...c, photo: photoByStory.get(c.ref) ?? null });
    });
  }
  return out;
}

export type NumberCandidate = {
  key: string;
  origin: 'carousel' | 'reels' | 'generated';
  ref: string;
  value: string;
  fact: string;
  counts: string;
  storyHeadline: string;
  sourceName: string;
  url: string;
  storyKey: string;
  photo?: { url: string; credit: string } | null;
};

/** Guess the Number, carousel side (S-10, S-12, S-26): every brief number from posts of the last 7 days. */
export async function carouselNumbers(db: Queryable, now: Date): Promise<NumberCandidate[]> {
  const { rows } = await db.query<PostRow>(
    `SELECT slug, story_id, status, brief, render, created_at::text FROM social.posts
      WHERE status IN ('review', 'published') AND created_at > $1::timestamptz - interval '7 days' ORDER BY created_at DESC`,
    [now.toISOString()],
  );
  const out: NumberCandidate[] = [];
  for (const p of rows) {
    const brief = p.brief ?? {};
    const news = str((brief.the_news as Json | undefined)?.text) ?? '';
    const src = (arr(brief.sources) as Json[])[0] ?? {};
    const facts = arr(brief.facts) as Json[];
    for (const n of arr(brief.numbers) as Json[]) {
      const value = str(n.value);
      const id = str(n.id);
      if (!value || !id) continue;
      // The fact sentence the number appears in, else the news line.
      const fact = str(facts.find((f) => arr(f.ids).includes(id) || (str(f.text) ?? '').includes(value))?.text) ?? news;
      out.push({
        key: `${p.slug}#${id}`,
        origin: 'carousel',
        ref: p.slug,
        value,
        fact,
        counts: str(n.counts) ?? '',
        storyHeadline: news,
        sourceName: str(src.outlet) ?? 'unknown',
        url: str(src.url) ?? '',
        storyKey: storyKey(str(src.url) ?? p.slug),
        photo: postPhoto(p.render),
      });
    }
  }
  return out;
}

/** Shortlisted stories from the last 7 days that never became a post: Stories extracts their numbers (S-26). */
export async function shortlistWithoutBrief(db: Queryable, now: Date): Promise<StoryCandidate[]> {
  const runs = await db.query<{ record: Json }>(`SELECT record FROM social.runs WHERE finished_at > $1::timestamptz - interval '7 days'`, [now.toISOString()]);
  const posted = new Set((await db.query<{ story_id: string }>(`SELECT story_id FROM social.posts WHERE story_id IS NOT NULL`)).rows.map((r) => r.story_id));
  const out: StoryCandidate[] = [];
  for (const { record } of runs.rows) {
    for (const g of arr(((record?.selection ?? {}) as Json).shortlist) as Json[]) {
      const c = groupToCandidate(g, 0);
      if (c && !posted.has(c.ref)) out.push(c);
    }
  }
  return out;
}

/** Photos used in the last `days` (Tommy's 7-day no-repeat rule, S-24). */
export async function recentUsedPhotoUrls(db: Queryable, now: Date, days = 7): Promise<Set<string>> {
  const { rows } = await db.query<{ url: string }>(`SELECT DISTINCT url FROM social.used_photos WHERE used_at > $1::timestamptz - make_interval(days => $2)`, [now.toISOString(), days]);
  return new Set(rows.map((r) => r.url));
}

/** The one write into Tommy's tables (plan rule 6): a photo Stories actually published. */
export async function recordPublishedPhoto(
  db: Queryable,
  p: { url: string; usedAt: Date; storyId: string; slide: number; source?: string | null; qid?: string | null; subject?: string | null; credit?: string | null; scene?: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO social.used_photos (url, used_at, story_id, slide, source, qid, subject, credit, scene)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
    [p.url, p.usedAt.toISOString(), p.storyId, p.slide, p.source ?? 'stories', p.qid ?? null, p.subject ?? null, p.credit ?? null, p.scene ?? null],
  );
}
