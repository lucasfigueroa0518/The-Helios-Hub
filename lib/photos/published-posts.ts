/**
 * The posts we built, as the used-photo ledger needs them (CI-32): for each content type that carries photos, its
 * caption, the image Instagram shows first, and the photos it published, brand assets removed. The nightly Instagram
 * read (./ig-sync.ts) matches a published post back to one of these; LFD's own publish writes through it too.
 *
 * Reads only, and always bounded: one post by its id or its Instagram media id, or the posts built in a short window.
 * Reels, Text-on-Screen and Explainers carry no web or bank photos, so they have no adapter.
 *
 * `recordPublishedPost` is the publish-time write every app publish path uses (LFD, Carousels, Field Notes, AI
 * Events): the post's photos, hashed best effort, into the ledger. The nightly read stays the backstop.
 */
import { PHOTO_BANK_BUCKET } from '@/lib/media-library/types';
import { isPhash } from '@/lib/reel-ai-drama/harvest/filters';
import { SLIDE_BUCKET } from '@/lib/social/overnight/config';
import { carouselCaption } from '@/lib/social/overnight/publish';
import type { Query } from '@/lib/social/store/pg';
import { STORIES_BUCKET } from '@/lib/stories/storage';

import { hashesOf, isBrandAsset, mediaLibraryKey, recordUsedPhotos, type UsedPhotoEntry, type UsedVertical } from './used';

/** A file in our own Storage, written `storage:<bucket>/<path>` (the convention LFD's meme slides already use). */
export const storageRef = (bucket: string, path: string) => `storage:${bucket}/${path}`;

export function parseStorageRef(ref: string): { bucket: string; path: string } | null {
  const m = /^storage:([^/]+)\/(.+)$/.exec(ref);
  return m ? { bucket: m[1], path: m[2] } : null;
}

export type PostPhoto = {
  /** The ledger key: the photo's URL, or mediaLibraryKey(id) for a bank photo. */
  url: string;
  slide: number;
  kind?: string | null;
  credit?: string | null;
  source?: string | null;
  qid?: string | null;
  subject?: string | null;
  scene?: string | null;
  phash?: string | null;
  dhash?: string | null;
  /** Where to read the bytes when `url` can't be fetched (a bank photo's master in Storage). */
  fetchFrom?: string | null;
};

export type CandidatePost = {
  vertical: UsedVertical;
  postId: string;
  caption: string | null;
  builtAt: Date;
  /** URL or storage ref of the image Instagram would show first; null when we keep none (AI Drama reels). */
  coverRender: string | null;
  /** Stories only: every frame's render (each frame is its own Instagram story). */
  frameRenders?: string[];
  photos: PostPhoto[];
};

export type PublishedPostAdapter = {
  vertical: UsedVertical;
  byMediaId(mediaId: string): Promise<CandidatePost | null>;
  /** One post by its own id (the publish-time write). */
  byPostId?(postId: string): Promise<CandidatePost | null>;
  /** Posts built in [from, to], newest first, at most CANDIDATE_LIMIT. */
  candidates(from: Date, to: Date): Promise<CandidatePost[]>;
};

/** social_hub.content_items.vertical for each ledger vertical (db/social_hub_schema.sql, lib/social-hub/spine.ts). */
export const SPINE_VERTICAL: Record<UsedVertical, string> = {
  lfd: 'last_few_days',
  stories: 'stories',
  carousels: 'carousels',
  reel_ai_drama: 'reel_ai_drama',
  field_notes: 'field_notes',
  ai_events: 'ai_events',
};

export const CANDIDATE_LIMIT = 200;

/** Ledger entries for a matched post (brand assets are already gone). */
export function entriesFor(post: CandidatePost, usedAt: Date, mediaId: string | null): UsedPhotoEntry[] {
  return post.photos.map((p) => ({
    url: p.url,
    usedAt,
    vertical: post.vertical,
    postId: post.postId,
    slide: p.slide,
    mediaId,
    phash: p.phash ?? null,
    dhash: p.dhash ?? null,
    source: p.source ?? null,
    credit: p.credit ?? null,
    qid: p.qid ?? null,
    subject: p.subject ?? null,
    scene: p.scene ?? null,
  }));
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const firstObject = (v: unknown): string | null => {
  const first = str(arr(v)[0]);
  return first ? storageRef(SLIDE_BUCKET, first) : null;
};
const at = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

/** The content item a published attempt (or a Story frame) belongs to. */
async function spineRefFor(query: Query, vertical: UsedVertical, mediaId: string): Promise<string | null> {
  const { rows } = await query(
    `SELECT ci.native_ref FROM social_hub.publish_attempts a JOIN social_hub.content_items ci ON ci.id = a.content_item_id
      WHERE a.media_id = $1 AND ci.vertical = $2 LIMIT 1`,
    [mediaId, SPINE_VERTICAL[vertical]],
  );
  return (rows[0]?.native_ref as string | undefined) ?? null;
}

// ── Last Few Days ────────────────────────────────────────────────────────────

/** lfd.posts: story i is slide i + 2 (the cover is slide 1 and reuses them). Logo and meme slides are exempt. */
export function lfdCandidate(row: { id: string; caption: unknown; created_at: unknown; stories: unknown; render: unknown; slide_objects: unknown }): CandidatePost {
  const slides = arr(obj(row.render).slides).map(obj);
  const photos: PostPhoto[] = [];
  for (const [i, raw] of arr(row.stories).entries()) {
    const photo = obj(obj(raw).photo);
    const src = str(photo.src);
    if (!src) continue;
    const slide = slides.find((s) => s.position === i + 1) ?? slides[i + 1] ?? {};
    if (isBrandAsset(str(photo.kind)) || isBrandAsset(str(slide.photoKind))) continue;
    photos.push({ url: src, slide: i + 2, kind: str(photo.kind), credit: str(photo.credit), source: 'lfd' });
  }
  return { vertical: 'lfd', postId: String(row.id), caption: str(row.caption), builtAt: at(row.created_at), coverRender: firstObject(row.slide_objects), photos };
}

function lfdAdapter(query: Query): PublishedPostAdapter {
  const cols = `id::text AS id, caption, created_at, stories, render, slide_objects`;
  const byPostId = async (id: string) => {
    const { rows } = await query(`SELECT ${cols} FROM lfd.posts WHERE id::text = $1`, [id]);
    return rows[0] ? lfdCandidate(rows[0]) : null;
  };
  return {
    vertical: 'lfd',
    byPostId,
    async byMediaId(mediaId) {
      const ref = await spineRefFor(query, 'lfd', mediaId);
      return ref ? byPostId(ref) : null;
    },
    async candidates(from, to) {
      const { rows } = await query(
        `SELECT ${cols} FROM lfd.posts WHERE created_at BETWEEN $1 AND $2 AND status <> 'preview' ORDER BY created_at DESC LIMIT ${CANDIDATE_LIMIT}`,
        [from.toISOString(), to.toISOString()],
      );
      return rows.map(lfdCandidate);
    },
  };
}

/** The post's ledger entries at publish time (lib/lfd/publish.ts). */
export async function lfdPostPhotos(query: Query, postId: string): Promise<CandidatePost | null> {
  const { rows } = await query(`SELECT id::text AS id, caption, created_at, stories, render, slide_objects FROM lfd.posts WHERE id = $1`, [postId]);
  return rows[0] ? lfdCandidate(rows[0]) : null;
}

// ── IG Stories (Morning Download, Guess the Number, Free vs. Paid) ───────────

type FrameRow = { set_id: string; seq: number; role: string | null; photo: unknown; storage_path: string | null };

/** One set: every frame's photo (slide = frame seq). Free vs. Paid frames show logos only, so it logs none. */
export function storiesCandidate(set: { id: string; series: string; built_at: unknown }, frames: readonly FrameRow[]): CandidatePost {
  const ordered = [...frames].sort((a, b) => a.seq - b.seq);
  const photos: PostPhoto[] = [];
  if (set.series !== 'free_vs_paid') {
    for (const f of ordered) {
      const photo = obj(f.photo);
      const src = str(photo.src);
      if (!src || isBrandAsset(str(photo.kind))) continue;
      photos.push({ url: src, slide: f.seq, kind: str(photo.kind), credit: str(photo.credit), source: str(photo.source) ?? 'stories', qid: str(photo.qid), scene: f.role });
    }
  }
  const renders = ordered.flatMap((f) => (f.storage_path ? [storageRef(STORIES_BUCKET, f.storage_path)] : []));
  return { vertical: 'stories', postId: String(set.id), caption: null, builtAt: at(set.built_at), coverRender: renders[0] ?? null, frameRenders: renders, photos };
}

function storiesAdapter(query: Query): PublishedPostAdapter {
  async function load(setIds: string[]): Promise<CandidatePost[]> {
    if (!setIds.length) return [];
    const sets = (await query(
      `SELECT id::text AS id, series, coalesce(built_at, created_at) AS built_at FROM stories.sets WHERE id::text = ANY($1::text[]) ORDER BY coalesce(built_at, created_at) DESC`,
      [setIds],
    )).rows as Array<{ id: string; series: string; built_at: unknown }>;
    const frames = (await query(
      `SELECT set_id::text AS set_id, seq, role, photo, storage_path FROM stories.frames WHERE set_id::text = ANY($1::text[])`,
      [setIds],
    )).rows as FrameRow[];
    return sets.map((s) => storiesCandidate(s, frames.filter((f) => f.set_id === s.id)));
  }
  return {
    vertical: 'stories',
    byPostId: async (id) => (await load([id]))[0] ?? null,
    async byMediaId(mediaId) {
      const frame = (await query(`SELECT set_id::text AS set_id FROM stories.frames WHERE ig_media_id = $1 LIMIT 1`, [mediaId])).rows[0];
      const setId = (frame?.set_id as string | undefined) ?? (await spineRefFor(query, 'stories', mediaId));
      return setId ? (await load([setId]))[0] ?? null : null;
    },
    async candidates(from, to) {
      const { rows } = await query(
        `SELECT id::text AS id FROM stories.sets WHERE built_at BETWEEN $1 AND $2 ORDER BY built_at DESC LIMIT ${CANDIDATE_LIMIT}`,
        [from.toISOString(), to.toISOString()],
      );
      return load(rows.map((r) => r.id as string));
    },
  };
}

// ── Carousels (social.posts) ─────────────────────────────────────────────────

/** render.slides[].photoUrl; logo and meme slides are exempt. The caption is what the publish sends. */
export function carouselCandidate(row: { id: string; caption: unknown; created_at: unknown; render: unknown; slide_objects: unknown }): CandidatePost {
  const render = obj(row.render);
  const photos: PostPhoto[] = [];
  for (const [i, raw] of arr(render.slides).entries()) {
    const s = obj(raw);
    const url = str(s.photoUrl);
    if (!url || isBrandAsset(str(s.photoKind))) continue;
    photos.push({ url, slide: (typeof s.position === 'number' ? s.position : i) + 1, kind: str(s.photoKind), credit: str(s.photoCredit), source: 'carousels' });
  }
  const caption = carouselCaption({ caption: str(render.caption) ?? '', attributionBlock: str(render.attributionBlock) ?? '' }) || str(row.caption);
  return { vertical: 'carousels', postId: String(row.id), caption, builtAt: at(row.created_at), coverRender: firstObject(row.slide_objects), photos };
}

function carouselsAdapter(query: Query): PublishedPostAdapter {
  const cols = `id::text AS id, caption, created_at, render, slide_objects`;
  const byPostId = async (id: string) => {
    const { rows } = await query(`SELECT ${cols} FROM social.posts WHERE id::text = $1`, [id]);
    return rows[0] ? carouselCandidate(rows[0]) : null;
  };
  return {
    vertical: 'carousels',
    byPostId,
    async byMediaId(mediaId) {
      const ref = await spineRefFor(query, 'carousels', mediaId);
      return ref ? byPostId(ref) : null;
    },
    async candidates(from, to) {
      const { rows } = await query(
        `SELECT ${cols} FROM social.posts WHERE created_at BETWEEN $1 AND $2 AND status <> 'preview' AND origin = 'pipeline' ORDER BY created_at DESC LIMIT ${CANDIDATE_LIMIT}`,
        [from.toISOString(), to.toISOString()],
      );
      return rows.map(carouselCandidate);
    },
  };
}

// ── AI Drama Reels ───────────────────────────────────────────────────────────

type UseRow = { job_id: string; asset_key: string; character_image: boolean; data: unknown };

/**
 * The job's asset uses. Character cutouts, logos and code-made pictures (screenshots, maps, drawings) are not
 * logged. An asset key that is a pHash goes into the entry's phash.
 */
export function dramaCandidate(job: { id: string; finished_at: unknown; caption: unknown }, uses: readonly UseRow[]): CandidatePost {
  const photos: PostPhoto[] = [];
  const seen = new Set<string>();
  for (const u of uses) {
    const d = obj(u.data);
    // Logos are brand assets whether the kind or a flag says so (as the harvest's reuse rule reads them).
    if (u.character_image || d.character_image === true || d.made === true || isBrandAsset(str(d.kind)) || arr(d.flags).includes('logo')) continue;
    const phash = isPhash(u.asset_key) ? u.asset_key : str(d.phash);
    const url = str(d.url) ?? (isPhash(u.asset_key) ? `phash:${u.asset_key}` : /^https?:/.test(u.asset_key) ? u.asset_key : null);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    photos.push({ url, slide: photos.length + 1, kind: str(d.kind), credit: str(d.credit), source: str(d.source) ?? 'reel_ai_drama', qid: str(arr(d.qids)[0]), phash });
  }
  return { vertical: 'reel_ai_drama', postId: String(job.id), caption: str(job.caption), builtAt: at(job.finished_at), coverRender: null, photos };
}

function dramaAdapter(query: Query): PublishedPostAdapter {
  async function load(jobIds: string[]): Promise<CandidatePost[]> {
    if (!jobIds.length) return [];
    const jobs = (await query(
      `SELECT j.id::text AS id, coalesce(j.finished_at, j.requested_at) AS finished_at,
              (SELECT a.content FROM reel_ai_drama.artifacts a WHERE a.job_id = j.id AND a.kind = 'post_caption' ORDER BY a.seq DESC LIMIT 1) AS caption
         FROM reel_ai_drama.jobs j WHERE j.id::text = ANY($1::text[]) ORDER BY coalesce(j.finished_at, j.requested_at) DESC`,
      [jobIds],
    )).rows as Array<{ id: string; finished_at: unknown; caption: unknown }>;
    // The asset row of the same job when there is one, else the newest with that key.
    const uses = (await query(
      `SELECT u.job_id::text AS job_id, u.asset_key, u.character_image,
              (SELECT s.data FROM reel_ai_drama.assets s WHERE s.asset_key = u.asset_key ORDER BY (s.job_id = u.job_id) DESC, s.created_at DESC LIMIT 1) AS data
         FROM reel_ai_drama.asset_uses u WHERE u.job_id::text = ANY($1::text[]) ORDER BY u.used_at, u.id`,
      [jobIds],
    )).rows as UseRow[];
    return jobs.map((j) => dramaCandidate(j, uses.filter((u) => u.job_id === j.id)));
  }
  return {
    vertical: 'reel_ai_drama',
    byPostId: async (id) => (await load([id]))[0] ?? null,
    async byMediaId(mediaId) {
      const ref = await spineRefFor(query, 'reel_ai_drama', mediaId);
      return ref ? (await load([ref]))[0] ?? null : null;
    },
    async candidates(from, to) {
      const { rows } = await query(
        `SELECT id::text AS id FROM reel_ai_drama.jobs WHERE status = 'ok' AND finished_at BETWEEN $1 AND $2 ORDER BY finished_at DESC LIMIT ${CANDIDATE_LIMIT}`,
        [from.toISOString(), to.toISOString()],
      );
      return load(rows.map((r) => r.id as string));
    },
  };
}

// ── Field Notes (team photos from the photo bank) ────────────────────────────

type BankRow = { id: string; dhash: string | null; credit: string | null; qids: unknown; subjects: unknown; scenes: unknown; master_path: string | null };

/** photo_ids → media_library.photos; the ledger key is mediaLibraryKey(id) with the bank's dHash. */
export function fieldNotesCandidate(row: { id: string; caption: unknown; created_at: unknown; photo_ids: unknown; slide_objects: unknown }, bank: readonly BankRow[]): CandidatePost {
  const photos: PostPhoto[] = [];
  for (const [i, raw] of arr(row.photo_ids).entries()) {
    const id = String(raw);
    const p = bank.find((b) => b.id === id);
    photos.push({
      url: mediaLibraryKey(id),
      slide: i + 1,
      dhash: p?.dhash ?? null,
      credit: p?.credit ?? null,
      qid: str(arr(p?.qids)[0]),
      subject: str(arr(p?.subjects)[0]),
      scene: str(arr(p?.scenes)[0]),
      source: 'photo_bank',
      fetchFrom: p?.master_path ? storageRef(PHOTO_BANK_BUCKET, p.master_path) : null,
    });
  }
  return { vertical: 'field_notes', postId: String(row.id), caption: str(row.caption), builtAt: at(row.created_at), coverRender: firstObject(row.slide_objects), photos };
}

function fieldNotesAdapter(query: Query): PublishedPostAdapter {
  const cols = `id::text AS id, caption, created_at, photo_ids::text[] AS photo_ids, slide_objects`;
  async function withBank(rows: Array<{ id: string; caption: unknown; created_at: unknown; photo_ids: unknown; slide_objects: unknown }>): Promise<CandidatePost[]> {
    const ids = [...new Set(rows.flatMap((r) => arr(r.photo_ids).map(String)))];
    const bank = ids.length
      ? ((await query(
          `SELECT id::text AS id, dhash, credit, qids, subjects, scenes, master_path FROM media_library.photos WHERE id::text = ANY($1::text[])`,
          [ids],
        )).rows as BankRow[])
      : [];
    return rows.map((r) => fieldNotesCandidate(r, bank));
  }
  const byPostId = async (id: string) => {
    const { rows } = await query(`SELECT ${cols} FROM field_notes.posts WHERE id::text = $1`, [id]);
    return (await withBank(rows))[0] ?? null;
  };
  return {
    vertical: 'field_notes',
    byPostId,
    async byMediaId(mediaId) {
      const ref = await spineRefFor(query, 'field_notes', mediaId);
      return ref ? byPostId(ref) : null;
    },
    async candidates(from, to) {
      const { rows } = await query(
        `SELECT ${cols} FROM field_notes.posts WHERE created_at BETWEEN $1 AND $2 AND status <> 'preview' ORDER BY created_at DESC LIMIT ${CANDIDATE_LIMIT}`,
        [from.toISOString(), to.toISOString()],
      );
      return withBank(rows);
    },
  };
}

// ── AI Events This Week ──────────────────────────────────────────────────────

/** Every web `image` inside a slide (the organizer posters: aiEvents.pick.image, rows[].image). */
function imagesIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) imagesIn(x, out);
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'image' && typeof x === 'string' && /^https?:\/\//.test(x)) out.push(x);
      else imagesIn(x, out);
    }
  }
  return out;
}

export function aiEventsCandidate(row: { id: string; caption: unknown; created_at: unknown; render: unknown; slide_objects: unknown }): CandidatePost {
  const photos: PostPhoto[] = [];
  for (const [i, raw] of arr(obj(row.render).slides).entries()) {
    const s = obj(raw);
    if (isBrandAsset(str(s.photoKind))) continue;
    const slide = (typeof s.position === 'number' ? s.position : i) + 1;
    for (const url of new Set(imagesIn(s))) photos.push({ url, slide, source: 'ai_events' });
  }
  return { vertical: 'ai_events', postId: String(row.id), caption: str(row.caption), builtAt: at(row.created_at), coverRender: firstObject(row.slide_objects), photos };
}

function aiEventsAdapter(query: Query): PublishedPostAdapter {
  const cols = `id::text AS id, caption, created_at, render, slide_objects`;
  const byPostId = async (id: string) => {
    const { rows } = await query(`SELECT ${cols} FROM ai_events.posts WHERE id::text = $1`, [id]);
    return rows[0] ? aiEventsCandidate(rows[0]) : null;
  };
  return {
    vertical: 'ai_events',
    byPostId,
    async byMediaId(mediaId) {
      const ref = await spineRefFor(query, 'ai_events', mediaId);
      return ref ? byPostId(ref) : null;
    },
    async candidates(from, to) {
      const { rows } = await query(
        `SELECT ${cols} FROM ai_events.posts WHERE created_at BETWEEN $1 AND $2 AND status <> 'preview' ORDER BY created_at DESC LIMIT ${CANDIDATE_LIMIT}`,
        [from.toISOString(), to.toISOString()],
      );
      return rows.map(aiEventsCandidate);
    },
  };
}

/** One adapter per content type that publishes photos. */
export function publishedPostAdapters(query: Query): PublishedPostAdapter[] {
  return [lfdAdapter(query), storiesAdapter(query), carouselsAdapter(query), dramaAdapter(query), fieldNotesAdapter(query), aiEventsAdapter(query)];
}

// ── Hashes and the publish-time write ────────────────────────────────────────

/** Reads a photo's bytes: a web URL, or a `storage:<bucket>/<path>` ref. Throws when it can't. */
export type ReadBytes = (ref: string) => Promise<Buffer>;

export type PhotoHashDeps = {
  /** Default liveReadBytes(). */
  read?: ReadBytes;
  /** Default hashesOf (pHash + dHash). */
  hash?: (bytes: Buffer) => Promise<{ phash: string; dhash: string }>;
  log?: (line: string) => void;
};

const READ_TIMEOUT_MS = 20_000;

/** The live reader: a bounded web fetch (the harvest's user agent and size cap), or a Storage download. */
export function liveReadBytes(http: typeof fetch = fetch): ReadBytes {
  return async (ref) => {
    const s = parseStorageRef(ref);
    if (s) {
      const { mediaBucket } = await import('@/lib/media-bucket');
      return mediaBucket(s.bucket).download(s.path);
    }
    const { USER_AGENT, MAX_IMAGE_BYTES } = await import('@/lib/reel-ai-drama/harvest/fetch');
    const res = await http(ref, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new Error('empty image');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('image too large');
    return bytes;
  };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Both hashes for each photo that lacks one, best effort: a photo that can't be read keeps what it has (a URL-only row). */
export async function withHashes(photos: readonly PostPhoto[], deps: PhotoHashDeps = {}): Promise<PostPhoto[]> {
  const read = deps.read ?? liveReadBytes();
  const hash = deps.hash ?? hashesOf;
  const out: PostPhoto[] = [];
  for (const p of photos) {
    const from = p.fetchFrom ?? (/^https?:\/\//.test(p.url) || parseStorageRef(p.url) ? p.url : null);
    if ((p.phash && p.dhash) || !from) {
      out.push(p);
      continue;
    }
    try {
      const h = await hash(await read(from));
      out.push({ ...p, phash: p.phash ?? h.phash, dhash: p.dhash ?? h.dhash });
    } catch (e) {
      deps.log?.(`photo not read, logged by URL only: ${p.url} (${errorText(e)})`);
      out.push(p);
    }
  }
  return out;
}

/**
 * The publish-time write (CI-32): a post the app just published, its photos hashed best effort, into the ledger at
 * `at`. Returns the rows offered; 0 when the post is gone or carries no photos. Callers catch: a failure here must
 * never fail a publish (the nightly Instagram read is the backstop).
 */
export async function recordPublishedPost(
  query: Query,
  vertical: UsedVertical,
  postId: string,
  at: Date,
  o: PhotoHashDeps & { mediaId?: string | null; adapters?: PublishedPostAdapter[] } = {},
): Promise<number> {
  const adapter = (o.adapters ?? publishedPostAdapters(query)).find((a) => a.vertical === vertical);
  const post = adapter?.byPostId ? await adapter.byPostId(postId) : null;
  if (!post || !post.photos.length) return 0;
  return recordUsedPhotos(query, entriesFor({ ...post, photos: await withHashes(post.photos, o) }, at, o.mediaId ?? null));
}
