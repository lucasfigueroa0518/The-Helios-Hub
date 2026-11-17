/**
 * The comparison plan (PHASE3-CONTRACT.md, Owner D): recent posts of each type, rebuilt from what prod stores, as
 * the shared finder's needs plus the photo each frame actually shipped with ("old").
 *
 * Where each type's inputs live (read from the code, 2026-11-10):
 * - LFD: `lfd.posts.stories[]` (lib/lfd/run.ts insertPost). Each entry is the pick's fields (lane, origin, url,
 *   outlet, major, builder, net), the writer's copy spread in (key, setup, headline, highlight, names, body), the
 *   writer's photo request as `photoAsk`, and the shipped photo as `photo` (+ `photoSource`).
 * - Morning Download: `stories.sets.payload.stories[]` (key, headline, url, source) in story-frame order, and
 *   `payload.photo_log[]` whose first step per frame is the writer's request (`<kind>: "<query>"`; design stage).
 *   Subjects are not stored. The shipped photos are `stories.frames.photo` (opener, then story frames).
 * - Guess the Number and Free vs Paid retired with their profiles (SS-20); AI Trivia and Real or AI? have no replay yet.
 * - Carousels: `social.posts.brief` (the Reporter's brief) and `social.posts.draft` (the final draft submission,
 *   the same pair scripts/social_daily.ts copies out of the run record), filled with `fillDraft`. Shipped photos:
 *   `social.posts.render.slides[]` (cover first, then the draft's slides, in the design stage's slot order).
 */
import type { Pick as LfdPick, StoryCopy } from '@/lib/lfd/types';
import type { Brief } from '@/lib/social/reporter/brief';
import { fillDraft, type DraftSubmission, type FilledDraft } from '@/lib/social/writer/draft';
import type { PhotoRequest } from '@/lib/stories/photos';

import { draftSlotIndex, needForLfd, needFromRequest, needsForDraft } from '../needs';
import type { PhotoNeed, PhotoProfileId } from '../types';

import type { ReadQuery } from './db';

/** The photo a frame shipped with. `src` may be a storage path (not hotlinkable). */
export type OldPhoto = { src: string; credit: string | null; kind: string | null; source: string | null };

export type CompareFrame = {
  /** The need's id (stable within the post). */
  id: string;
  /** Human label: "story 2", "cover", "question". */
  label: string;
  /** The frame's own words, for the review page. */
  copy: string;
  need: PhotoNeed;
  old: OldPhoto | null;
};

export type ComparePost = {
  type: PhotoProfileId;
  postId: string;
  /** YYYY-MM-DD the post is for. */
  date: string;
  /** When the post was built (ISO); the 7-day used-photo window ends here. */
  builtAt: string;
  status: string;
  title: string;
  frames: CompareFrame[];
  /** What could not be rebuilt exactly (e.g. subjects not stored). */
  notes: string[];
};

export type SkippedPost = { type: PhotoProfileId; postId: string; reason: string };

export type PlanPart = { posts: ComparePost[]; skipped: SkippedPost[] };

/** Trivia and Real or AI? have no replay yet (SS-20): 0 posts unless asked; loadType reports them as skipped. */
export const DEFAULT_POSTS: Record<PhotoProfileId, number> = { lfd: 2, md: 2, carousel: 2, trivia: 0, roa: 0 };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const day = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
};
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : str(v));

/** A stored frame photo (Stories `Photo`, LFD `photo`) as an OldPhoto; null when absent. */
export function oldFrom(v: unknown, source: string | null = null): OldPhoto | null {
  const p = obj(v);
  const src = p ? str(p.src) || str(p.url) : '';
  if (!src) return null;
  return { src, credit: strOrNull(p!.credit), kind: strOrNull(p!.kind), source };
}

const VISUAL_KINDS = new Set(['person', 'company', 'logo', 'product', 'event', 'thematic', 'setting']);

/** The writer's request from a design-stage trace's first step (`company: "Goldman Sachs"`), or null. */
export function requestFromStep(step: unknown): { kind: string; query: string } | null {
  const m = /^([a-z_]+): "(.+)"$/.exec(str(step).trim());
  if (!m || !VISUAL_KINDS.has(m[1]!)) return null;
  return { kind: m[1]!, query: m[2]! };
}

/**
 * Subjects are not stored for Morning Download. A person/company/logo ask's query is usually the subject's name
 * ("Jensen Huang", "Goldman Sachs"); a short one becomes the subject. Products get theirs from needFromRequest.
 */
export function subjectsFromQuery(kind: string, query: string): PhotoRequest['subjects'] {
  const q = query.trim().replace(/\s+logo$/i, '');
  const words = q.split(/\s+/).filter(Boolean);
  // A name only: at most 4 words, each capitalised ("Jensen Huang", "Goldman Sachs"; not "Meta headquarters Menlo Park").
  if (!words.length || words.length > 4 || !words.every((w) => /^[A-Z0-9]/.test(w))) return [];
  if (kind === 'person') return [{ name: q, type: 'person' }];
  if (kind === 'company' || kind === 'logo') return [{ name: q, type: 'organization' }];
  return [];
}

const request = (r: Omit<PhotoRequest, 'exclude'>): PhotoRequest => ({ ...r, exclude: new Set() });

// ── LFD ───────────────────────────────────────────────────────────────────

export type LfdPostRow = { id: string; ny_date: unknown; created_at: unknown; status: string; stories: unknown };

export function lfdPlan(row: LfdPostRow): ComparePost | SkippedPost {
  const stories = arr(row.stories).map(obj).filter((s): s is Json => !!s);
  const frames: CompareFrame[] = [];
  const notes: string[] = [];
  let missing = 0;
  stories.forEach((s, i) => {
    const ask = obj(s.photoAsk);
    if (!ask || !str(ask.query)) {
      missing++;
      return;
    }
    const pick: LfdPick = {
      key: str(s.key), refs: [], origin: (str(s.origin) || 'feed') as LfdPick['origin'], headline: str(s.headline), sourceName: str(s.outlet), url: str(s.url),
      body: str(s.body), publishedAt: null, net: typeof s.net === 'number' ? s.net : null, blockbuster: 0, firstSeen: null, alsoFrom: [],
      major: typeof s.major === 'number' ? s.major : null, builder: typeof s.builder === 'number' ? s.builder : null, eventDate: null, lane: (str(s.lane) || 'major') as LfdPick['lane'],
    };
    const copy: StoryCopy = {
      key: str(s.key), setup: str(s.setup), headline: str(s.headline), highlight: str(s.highlight), names: arr(s.names).map(str), body: str(s.body),
      photo: { kind: str(ask.kind), query: str(ask.query), subjects: arr(ask.subjects).map(obj).filter((x): x is Json => !!x).map((x) => ({ name: str(x.name), type: x.type === 'person' ? 'person' : 'organization' })), alts: [] },
    };
    const id = `story ${i + 1}`;
    frames.push({ id, label: `${id} (${pick.lane})`, copy: [copy.setup, copy.headline, copy.body].filter(Boolean).join(' '), need: needForLfd(pick, copy, id), old: oldFrom(s.photo, strOrNull(s.photoSource)) });
  });
  if (!frames.length) return { type: 'lfd', postId: row.id, reason: stories.length ? 'no story stores its photo request (photoAsk)' : 'no stories stored' };
  if (missing) notes.push(`${missing} story(ies) without a stored photo request were left out`);
  notes.push('publish and event dates are not stored on the post: storyDate is empty');
  return { type: 'lfd', postId: row.id, date: day(row.ny_date), builtAt: iso(row.created_at), status: row.status, title: `Last Few Days ${day(row.ny_date)}`, frames, notes };
}

// ── Stories ───────────────────────────────────────────────────────────────

export type StoryFrameRow = { seq: number; role: string; copy: unknown; photo: unknown };
export type StorySetRow = { id: string; series: string; ny_date: unknown; created_at: unknown; status: string; payload: unknown; frames: unknown; chosen?: unknown };

/** Series the replay rebuilds. Guess the Number and Free vs. Paid retired with their profiles (SS-20). */
const SERIES: Record<string, PhotoProfileId> = { morning_download: 'md' };

export function storySetPlan(row: StorySetRow): ComparePost | SkippedPost {
  const type = SERIES[row.series];
  if (!type) throw new Error(`unknown series ${row.series}`);
  const frames = arr(row.frames).map((f) => f as StoryFrameRow).sort((a, b) => a.seq - b.seq);
  const payload = obj(row.payload) ?? {};
  const head = { type, postId: row.id, date: day(row.ny_date), builtAt: iso(row.created_at), status: row.status };
  const out = mdFrames(payload, frames);
  if ('reason' in out) return { type, postId: row.id, reason: out.reason };
  return { ...head, title: out.title, frames: out.frames, notes: out.notes };
}

type Built = { title: string; frames: CompareFrame[]; notes: string[] } | { reason: string };

function mdFrames(payload: Json, frames: StoryFrameRow[]): Built {
  const stories = arr(payload.stories).map(obj).filter((s): s is Json => !!s);
  const log = arr(payload.photo_log).map(obj).filter((s): s is Json => !!s);
  const storyRows = frames.filter((f) => f.role === 'story');
  const opener = frames.find((f) => f.role === 'opener');
  if (!stories.length) return { reason: 'payload.stories is empty' };
  if (storyRows.length !== stories.length) return { reason: `${storyRows.length} story frame(s) but ${stories.length} stored story(ies)` };
  const stepOf = (frame: string) => log.find((l) => str(l.frame) === frame);
  const notes = ['subjects are not stored: a person/company/logo query that is just a name becomes the subject', 'story text is not stored: the brief is the headline'];
  const out: CompareFrame[] = [];
  const first = stories[0]!;
  const openerAsk = requestFromStep(arr(stepOf('opener')?.steps)[0]);
  if (openerAsk) {
    const req = request({ kind: openerAsk.kind, query: openerAsk.query, subjects: subjectsFromQuery(openerAsk.kind, openerAsk.query), storyDate: null, sourceUrls: [str(first.url)], cover: true });
    out.push({ id: 'opener', label: 'opener (cover)', copy: '', need: needFromRequest(req, 'opener', { headline: str(first.headline), brief: str(first.headline), sourceName: strOrNull(first.source) }), old: oldFrom(opener?.photo) });
  } else notes.push('the opener has no stored request: left out');
  let guessed = 0;
  stories.forEach((s, i) => {
    const id = `story ${i + 1}`;
    const headline = str(s.headline);
    const ask = requestFromStep(arr(stepOf(id)?.steps)[0]);
    if (!ask) guessed++;
    const kind = ask?.kind ?? 'event';
    const query = ask?.query ?? headline;
    const req = request({ kind, query, subjects: subjectsFromQuery(kind, query), storyDate: null, sourceUrls: [str(s.url)], copy: headline });
    out.push({ id, label: id, copy: headline, need: needFromRequest(req, id, { headline, brief: headline, sourceName: strOrNull(s.source) }), old: oldFrom(storyRows[i]!.photo) });
  });
  if (guessed) notes.push(`${guessed} frame(s) kept a carousel photo, so no request was stored: kind 'event', query = the headline`);
  return { title: `Morning Download: ${str(first.headline).slice(0, 80)}`, frames: out, notes };
}

// ── Carousels ─────────────────────────────────────────────────────────────

export type CarouselPostRow = { id: string; title: string; status: string; created_at: unknown; brief: unknown; draft: unknown; render: unknown };

/** The stored draft as a FilledDraft: already filled, or filled here from the brief. */
function filled(draft: Json, brief: Brief): FilledDraft {
  const slides = arr(draft.slides);
  if (typeof draft.cover === 'string' && slides.every((s) => obj(s) && 'quote' in obj(s)!)) return draft as unknown as FilledDraft;
  return fillDraft(draft as unknown as DraftSubmission, brief);
}

export function carouselPlan(row: CarouselPostRow): ComparePost | SkippedPost {
  const brief = obj(row.brief) as unknown as Brief | null;
  const draft = obj(row.draft);
  if (!brief || !draft) return { type: 'carousel', postId: row.id, reason: 'no brief or draft stored' };
  if (!Array.isArray(brief.sources) || !Array.isArray(brief.subjects) || !Array.isArray(brief.quotes) || !Array.isArray(brief.numbers)) return { type: 'carousel', postId: row.id, reason: 'the stored brief is not a Reporter brief' };
  if (!Array.isArray(draft.cover_options) || !Array.isArray(draft.slides)) return { type: 'carousel', postId: row.id, reason: 'the stored draft has no cover_options/slides' };
  let fd: FilledDraft;
  let needs: Array<{ slot: string; need: PhotoNeed }>;
  // Older briefs may lack the optional-in-practice lists the mapper reads.
  const b = { ...brief, events: brief.events ?? [], why_it_matters: brief.why_it_matters ?? [] } as Brief;
  try {
    fd = filled(draft, b);
    needs = needsForDraft(fd, b);
  } catch (err) {
    return { type: 'carousel', postId: row.id, reason: `the draft could not be filled: ${err instanceof Error ? err.message : String(err)}` };
  }
  const slides = arr(obj(row.render)?.slides).map(obj);
  const notes: string[] = [];
  if (slides.length !== fd.slides.length + 2) notes.push(`render has ${slides.length} slides for ${fd.slides.length} draft slides (+ cover, follow): old photos matched by position`);
  const frames: CompareFrame[] = needs.map(({ slot, need }) => {
    const i = draftSlotIndex(slot);
    const s = i == null ? null : slides[i] ?? null;
    const url = s ? str(s.photoUrl) : '';
    return { id: slot, label: slot, copy: need.copy, need, old: url ? { src: url, credit: strOrNull(s!.photoCredit), kind: strOrNull(s!.photoKind) ?? strOrNull(s!.layoutVariant), source: null } : null };
  });
  return { type: 'carousel', postId: row.id, date: day(row.created_at), builtAt: iso(row.created_at), status: row.status, title: `Carousel: ${row.title}`, frames, notes };
}

// ── Loading from prod (read only) ─────────────────────────────────────────

const STORY_LIVE = `('ready', 'approved', 'scheduled', 'publishing', 'published')`;

export const SQL = {
  lfd: `SELECT id, ny_date::text AS ny_date, created_at, status, stories FROM lfd.posts WHERE status <> 'rejected' ORDER BY created_at DESC LIMIT $1`,
  stories: `SELECT s.id, s.series, s.ny_date::text AS ny_date, s.created_at, s.status, s.payload,
       (SELECT json_agg(json_build_object('seq', f.seq, 'role', f.role, 'copy', f.copy, 'photo', f.photo) ORDER BY f.seq) FROM stories.frames f WHERE f.set_id = s.id) AS frames,
       (SELECT c.payload FROM stories.candidates c WHERE c.set_id = s.id AND c.chosen ORDER BY c.created_at LIMIT 1) AS chosen
     FROM stories.sets s WHERE s.series = $1 AND s.status IN ${STORY_LIVE} ORDER BY s.created_at DESC LIMIT $2`,
  carousel: `SELECT id, title, status, created_at, brief, draft, render FROM social.posts WHERE status <> 'rejected' ORDER BY created_at DESC LIMIT $1`,
  usedBefore: `SELECT DISTINCT url FROM social.used_photos WHERE used_at > $1::timestamptz - interval '7 days' AND used_at < $1::timestamptz`,
} as const;

const SERIES_OF: Partial<Record<PhotoProfileId, string>> = { md: 'morning_download' };

/**
 * The newest `n` posts of a type that can be rebuilt. Reads up to 3n rows so a skipped post doesn't shrink the
 * sample; every skip is reported.
 */
export async function loadType(q: ReadQuery, type: PhotoProfileId, n: number): Promise<PlanPart> {
  const limit = Math.max(n * 3, n);
  if (type !== 'lfd' && type !== 'carousel' && !SERIES_OF[type]) return { posts: [], skipped: n > 0 ? [{ type, postId: '-', reason: `no replay for ${type} yet` }] : [] };
  const rows =
    type === 'lfd' ? (await q<LfdPostRow>(SQL.lfd, [limit])).rows.map(lfdPlan)
    : type === 'carousel' ? (await q<CarouselPostRow>(SQL.carousel, [limit])).rows.map(carouselPlan)
    : (await q<StorySetRow>(SQL.stories, [SERIES_OF[type], limit])).rows.map(storySetPlan);
  const posts: ComparePost[] = [];
  const skipped: SkippedPost[] = [];
  for (const r of rows) {
    if ('reason' in r) skipped.push(r);
    else if (posts.length < n) posts.push(r);
  }
  return { posts, skipped };
}

/** The 7-day used-photo URLs as of the post's build time (the post's own exclude), or an empty set with a note. */
export async function excludeFor(q: ReadQuery, post: ComparePost): Promise<{ urls: Set<string>; note: string | null }> {
  if (!post.builtAt) return { urls: new Set(), note: 'no build time: exclude is empty' };
  try {
    const { rows } = await q<{ url: string }>(SQL.usedBefore, [post.builtAt]);
    return { urls: new Set(rows.map((r) => r.url)), note: null };
  } catch (err) {
    return { urls: new Set(), note: `used photos unreadable (${err instanceof Error ? err.message : String(err)}): exclude is empty` };
  }
}
