/**
 * Last Few Days stories for the meme lab. Read-only against Tommy's tables
 * and the same candidate lanes LFD uses. Missing `lfd.*` is not an error:
 * the lab then shows candidates only. Never writes lfd.posts.
 */
import { nyDate } from '@/lib/explainers/repository';
import { carouselLane, reelsLane } from '@/lib/lfd/sources';
import type { LfdCandidate } from '@/lib/lfd/types';
import { windowFor } from '@/lib/lfd/window';
import type { HubQuery } from '@/lib/social-hub/db';
import { storyKey } from '@/lib/stories/sources/reels';

import type { Brief } from '@/lib/social/reporter/brief';

import type { Queryable } from './db';
import type { MemeStory } from './story';

export const THIN_BODY_CHARS = 500;

const fact = (id: string, text: string, outlet: string | null) => ({
  id,
  text,
  sources: outlet ? [outlet] : ['Last Few Days'],
  claim_by: null,
  notes: [] as string[],
});

export function sentencesOf(text: string, max = 8): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20)
    .slice(0, max);
}

/** A Reporter-shaped brief from LFD writer copy. No model call. */
export function briefFromCopy(input: { headline: string; body: string; outlet?: string | null; url?: string | null; names?: string[] }): Brief {
  const outlet = input.outlet ?? 'Last Few Days';
  const lines = sentencesOf([input.headline, input.body].filter(Boolean).join('. '));
  const facts = lines.map((text, i) => fact(`F${i + 1}`, text, outlet));
  if (!facts.length) facts.push(fact('F1', input.headline, outlet));
  const subjects = (input.names ?? []).map((name, i) => ({ id: `S${i + 1}`, name, role: null, type: 'organization' as const }));
  return {
    single_story: { yes: true, note: 'from Last Few Days copy' },
    the_news: { text: input.headline, ids: facts[0] ? [facts[0].id] : [] },
    why_it_matters: [],
    plot: [{ beat: 'TRIGGER', text: input.headline, ids: facts[0] ? [facts[0].id] : [] }],
    tensions: [],
    facts,
    background: [],
    quotes: [],
    numbers: [],
    terms: [],
    subjects,
    events: [],
    article_photos: [],
    not_answered: [],
    sources: [{ outlet, date: null, url: input.url ?? '', kind: 'original' }],
    fetch_failures: [],
  };
}

export type OriginalPhoto = { url: string; credit: string | null; kind: string | null };

export type LabStoryItem = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  group: 'post' | 'candidate';
  postRef: string | null;
  nyDate: string | null;
  origin: string | null;
  outlet: string | null;
  url: string | null;
  body: string;
  hasBrief: boolean;
  briefSource: 'copy' | 'from-body' | 'reporter' | null;
  thin: boolean;
  originalPhoto: OriginalPhoto | null;
  /** A candidate's upstream score: the reels best net and blockbuster flag; null for carousel shortlists (already their run's top 10). */
  net?: number | null;
  blockbuster?: number;
};

type PostStory = {
  key?: string;
  headline?: string;
  setup?: string;
  body?: string;
  names?: string[];
  highlight?: string;
  url?: string;
  outlet?: string;
  origin?: string;
  photo?: { src?: string; credit?: string; kind?: string };
};

type PostRow = { id: string; ny_date: string; status: string; created_at: string; stories: PostStory[] };

export function isMissingLfd(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e.code === '42P01' || /relation ["']?lfd\./i.test(e.message ?? '') || /schema ["']?lfd/i.test(e.message ?? '');
}

async function tryQuery<T>(q: HubQuery, text: string, params: unknown[] = []): Promise<T[] | null> {
  try {
    return (await q<T>(text, params)).rows;
  } catch (err) {
    if (isMissingLfd(err)) return null;
    throw err;
  }
}

export function photoOf(story: PostStory): OriginalPhoto | null {
  const src = story.photo?.src?.trim();
  if (!src) return null;
  return { url: src, credit: story.photo?.credit ?? null, kind: story.photo?.kind ?? null };
}

/** A Reporter-shaped brief from LFD writer copy, no model call. */
export function storyFromPost(postId: string, ny: string, createdAt: string, status: string, s: PostStory): LabStoryItem {
  const url = s.url ?? '';
  const id = s.key || (url ? storyKey(url) : `${postId}:${(s.headline ?? '').slice(0, 40)}`);
  const body = [s.setup, s.headline, s.body].filter(Boolean).join('\n');
  return {
    id,
    title: s.headline ?? 'Untitled story',
    status,
    createdAt,
    group: 'post',
    postRef: postId,
    nyDate: ny,
    origin: s.origin ?? null,
    outlet: s.outlet ?? null,
    url: url || null,
    body,
    hasBrief: true,
    briefSource: 'copy',
    thin: body.length < THIN_BODY_CHARS,
    originalPhoto: photoOf(s),
  };
}

export function candidateItem(c: LfdCandidate): LabStoryItem {
  return {
    id: c.key,
    title: c.headline,
    status: 'candidate',
    createdAt: c.publishedAt ?? c.firstSeen ?? '',
    group: 'candidate',
    postRef: null,
    nyDate: null,
    origin: c.origin,
    outlet: c.sourceName || null,
    url: c.url,
    body: c.body ?? '',
    hasBrief: false,
    briefSource: null,
    thin: (c.body ?? '').length < THIN_BODY_CHARS,
    originalPhoto: null,
    net: c.net,
    blockbuster: c.blockbuster,
  };
}

export async function listFinishedPosts(q: HubQuery, limit = 12): Promise<LabStoryItem[]> {
  const rows = await tryQuery<PostRow>(
    q,
    `SELECT id::text, ny_date::text, status, created_at::text, stories
       FROM lfd.posts WHERE status <> 'rejected' ORDER BY ny_date DESC, created_at DESC LIMIT $1`,
    [limit],
  );
  if (!rows) return [];
  return rows.flatMap((r) => (Array.isArray(r.stories) ? r.stories : []).map((s) => storyFromPost(r.id, r.ny_date, r.created_at, r.status, s)));
}

export async function previousNyDate(q: HubQuery): Promise<string | null> {
  const rows = await tryQuery<{ ny_date: string }>(q, `SELECT ny_date::text FROM lfd.posts WHERE status <> 'rejected' ORDER BY ny_date DESC LIMIT 1`);
  return rows?.[0]?.ny_date ?? null;
}

/** Reels + carousel lanes for today's LFD window. No Jev, no feed fetch (feeds are slow on a page load). */
export async function listCandidates(q: HubQuery, now: Date = new Date()): Promise<LabStoryItem[]> {
  const today = nyDate(now);
  const window = windowFor(today, await previousNyDate(q));
  const sinceIso = `${window.after}T04:00:00Z`;
  const [reels, carousel] = await Promise.all([
    reelsLane(q, window).catch(() => [] as LfdCandidate[]),
    carouselLane(q, sinceIso).catch(() => [] as LfdCandidate[]),
  ]);
  const seen = new Set<string>();
  const out: LabStoryItem[] = [];
  for (const c of [...reels, ...carousel]) {
    if (!c.headline || seen.has(c.key)) continue;
    seen.add(c.key);
    out.push(candidateItem(c));
  }
  return out;
}

/** Posts first, then candidates whose key is not already in a post. */
export async function listLfdStories(q: HubQuery, now: Date = new Date()): Promise<LabStoryItem[]> {
  const posts = await listFinishedPosts(q);
  const inPost = new Set(posts.map((s) => s.id));
  const candidates = (await listCandidates(q, now)).filter((s) => !inPost.has(s.id));
  return [...posts, ...candidates];
}

export type StoryRow = {
  id: string;
  headline: string;
  status: string;
  created_at: string;
  group_kind: string;
  post_ref: string | null;
  ny_date: string | null;
  origin: string | null;
  outlet: string | null;
  url: string | null;
  body: string;
  brief: MemeStory['brief'] | null;
  brief_source: string | null;
  original_photo: OriginalPhoto | null;
};

export async function upsertLabStories(db: Queryable, stories: LabStoryItem[]): Promise<void> {
  for (const s of stories) {
    const brief = s.group === 'post' ? briefFromCopy({ headline: s.title, body: s.body, outlet: s.outlet, url: s.url }) : null;
    await db.query(
      `INSERT INTO memes.lfd_stories
         (id, group_kind, post_ref, ny_date, headline, url, body, origin, outlet, published_at, original_photo, brief, brief_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)
       ON CONFLICT (id) DO UPDATE SET
         group_kind = EXCLUDED.group_kind,
         post_ref = COALESCE(EXCLUDED.post_ref, memes.lfd_stories.post_ref),
         ny_date = COALESCE(EXCLUDED.ny_date, memes.lfd_stories.ny_date),
         headline = EXCLUDED.headline,
         url = EXCLUDED.url,
         body = EXCLUDED.body,
         origin = EXCLUDED.origin,
         outlet = EXCLUDED.outlet,
         original_photo = COALESCE(EXCLUDED.original_photo, memes.lfd_stories.original_photo),
         brief = COALESCE(memes.lfd_stories.brief, EXCLUDED.brief),
         brief_source = COALESCE(memes.lfd_stories.brief_source, EXCLUDED.brief_source)`,
      [
        s.id, s.group, s.postRef, s.nyDate, s.title, s.url, s.body, s.origin, s.outlet,
        s.createdAt || null, s.originalPhoto ? JSON.stringify(s.originalPhoto) : null,
        brief ? JSON.stringify(brief) : null, brief ? 'copy' : null,
      ],
    );
  }
}

/**
 * A brief made from a finished post's copy has no tensions and no claim
 * marks. When the body is long enough to read (500+ characters), meme runs
 * wait for the body brief instead (ME-107); a thin body keeps its copy brief.
 */
export const needsBodyBrief = (r: Pick<StoryRow, 'brief_source' | 'body'>): boolean =>
  r.brief_source === 'copy' && (r.body ?? '').length >= THIN_BODY_CHARS;

function itemFromRow(r: StoryRow): LabStoryItem {
  return {
    id: r.id,
    title: r.headline,
    status: r.status || r.group_kind,
    createdAt: r.created_at,
    group: r.group_kind === 'post' ? 'post' : 'candidate',
    postRef: r.post_ref,
    nyDate: r.ny_date,
    origin: r.origin,
    outlet: r.outlet,
    url: r.url,
    body: r.body,
    hasBrief: Boolean(r.brief) && !needsBodyBrief(r),
    briefSource: (r.brief_source as LabStoryItem['briefSource']) ?? null,
    thin: (r.body ?? '').length < THIN_BODY_CHARS,
    originalPhoto: r.original_photo,
  };
}

export async function listedFromDb(db: Queryable): Promise<LabStoryItem[]> {
  const { rows } = await db.query<StoryRow>(
    `SELECT id, headline, group_kind AS status, COALESCE(published_at::text, '') AS created_at, group_kind, post_ref, ny_date, origin, outlet, url, body, brief, brief_source, original_photo
       FROM memes.lfd_stories ORDER BY (group_kind = 'post') DESC, ny_date DESC NULLS LAST, published_at DESC NULLS LAST`,
  );
  return rows.map(itemFromRow);
}

export function memeStoryFromRow(r: StoryRow): MemeStory | null {
  if (!r.brief || needsBodyBrief(r)) return null;
  return {
    postId: r.id,
    title: r.headline,
    status: r.status || r.group_kind,
    createdAt: r.created_at,
    brief: r.brief,
    originalPhoto: r.original_photo,
    postRef: r.post_ref,
  };
}

export async function loadLabStory(db: Queryable, id: string): Promise<MemeStory | null> {
  const { rows } = await db.query<StoryRow>(
    `SELECT id, headline, group_kind AS status, COALESCE(published_at::text, '') AS created_at, group_kind, post_ref, ny_date, origin, outlet, url, body, brief, brief_source, original_photo
       FROM memes.lfd_stories WHERE id = $1`,
    [id],
  );
  return rows[0] ? memeStoryFromRow(rows[0]) : null;
}

export async function loadLabStories(db: Queryable, ids: string[]): Promise<MemeStory[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<StoryRow>(
    `SELECT id, headline, group_kind AS status, COALESCE(published_at::text, '') AS created_at, group_kind, post_ref, ny_date, origin, outlet, url, body, brief, brief_source, original_photo
       FROM memes.lfd_stories WHERE id = ANY($1::text[])`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const s = byId.get(id);
    const story = s ? memeStoryFromRow(s) : null;
    return story ? [story] : [];
  });
}

export async function saveBrief(db: Queryable, id: string, brief: MemeStory['brief'], source: 'from-body' | 'reporter'): Promise<void> {
  await db.query(`UPDATE memes.lfd_stories SET brief = $2::jsonb, brief_source = $3 WHERE id = $1`, [id, JSON.stringify(brief), source]);
}

export async function refreshAndList(db: Queryable, q: HubQuery, now: Date = new Date()): Promise<LabStoryItem[]> {
  const live = await listLfdStories(q, now);
  await upsertLabStories(db, live);
  return listedFromDb(db);
}
