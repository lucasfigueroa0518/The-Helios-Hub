/**
 * The meme lab's handlers (BUILD_PLAN M5), one per /api/memes route. Pure
 * over a database and a story source, so tests run them on PGlite; the
 * routes add the session check (lib/memes/route.ts).
 */
import fs from 'node:fs';
import path from 'node:path';

import type { MessagesCreate } from '@/lib/social/reporter/reporter';

import { generateBriefs as runBriefs, liveReporter, type BriefJob } from './brief-from-body';
import { templateCard } from './catalog';
import type { Queryable } from './db';
import { listedFromDb, type LabStoryItem, type OriginalPhoto } from './lfd-source';
import { situation } from './situations';
import type { MemeStory } from './story';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Reject reasons (ME-64). */
export const REJECT_TAGS = {
  'not-funny': 'Not funny',
  'wrong-template': 'Wrong template',
  inaccurate: 'Inaccurate',
  unclear: 'Unclear',
  'off-brand': 'Off-brand',
  'too-political': 'Too political',
} as const;
export type RejectTag = keyof typeof REJECT_TAGS;

/** Why a meme rated 1 or 2 failed, one click each (UPGRADE_PLAN U0): the failure kinds the graded batch showed. */
export const REASON_TAGS = {
  'no-turn': 'No turn',
  'obscure-name': 'Obscure name',
  'template-misused': 'Template misused',
  'too-long': 'Too long',
  flat: 'Hedged or flat',
  'wrong-tone': 'Wrong tone',
  inaccurate: 'Inaccurate',
  'off-limits': 'Off-limits',
} as const;

/** What made a meme rated 3 or 4 work. */
export const WORKED_TAGS = {
  'sharp-turn': 'Sharp turn',
  'template-fits': 'Template fits',
  short: 'Short',
  'company-on-image': 'Company on the image',
  relatable: 'Relatable',
} as const;

/** Tags a pick may carry for its rating; the old reject tags stay valid for old rows. */
function allowedTags(rating: 1 | 2 | 3 | 4 | null): ReadonlySet<string> {
  if (rating == null) return new Set(Object.keys(REJECT_TAGS));
  return new Set(rating >= 3 ? Object.keys(WORKED_TAGS) : [...Object.keys(REASON_TAGS), ...Object.keys(REJECT_TAGS)]);
}

export type StoryListItem = LabStoryItem | { postId: string; title: string; status: string; createdAt: string };

/** Where LFD stories come from. Tests can pass a fixture source. */
export type StorySource = {
  list(limit: number): Promise<StoryListItem[]>;
  load(postId: string): Promise<MemeStory | null>;
  loadMany?: (ids: string[]) => Promise<MemeStory[]>;
};

export function asLabStory(s: StoryListItem): LabStoryItem {
  if ('group' in s) return s;
  return {
    id: s.postId, title: s.title, status: s.status, createdAt: s.createdAt, group: 'candidate',
    postRef: null, nyDate: null, origin: null, outlet: null, url: null, body: '',
    hasBrief: true, briefSource: null, thin: false, originalPhoto: null,
  };
}

export type StoryWithRuns = LabStoryItem & { generated: number; generating: number };

async function storyRunCounts(db: Queryable): Promise<Map<string, { generated: number; generating: number }>> {
  const { rows } = await db.query<{ id: string; status: string }>(`
    SELECT post_id AS id, status FROM memes.requests WHERE post_id IS NOT NULL
    UNION ALL
    SELECT jsonb_array_elements_text(COALESCE(detail->'storyIds', '[]'::jsonb)) AS id, status
      FROM memes.requests
     WHERE jsonb_typeof(detail->'storyIds') = 'array'
  `);
  const out = new Map<string, { generated: number; generating: number }>();
  for (const r of rows) {
    if (!r.id) continue;
    const cur = out.get(r.id) ?? { generated: 0, generating: 0 };
    if (r.status === 'ok') cur.generated += 1;
    else if (r.status === 'requested' || r.status === 'running') cur.generating += 1;
    out.set(r.id, cur);
  }
  return out;
}

export async function listStories(db: Queryable, source: StorySource): Promise<StoryWithRuns[]> {
  const items = (await source.list(80)).map(asLabStory);
  const local = await listedFromDb(db).catch(() => [] as LabStoryItem[]);
  const extra = new Map(local.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: LabStoryItem[] = [];
  for (const s of items) {
    const overlay = extra.get(s.id);
    out.push(overlay ? { ...s, hasBrief: overlay.hasBrief, briefSource: overlay.briefSource, originalPhoto: overlay.originalPhoto ?? s.originalPhoto } : s);
    seen.add(s.id);
  }
  for (const s of local) if (!seen.has(s.id)) out.push(s);
  const counts = await storyRunCounts(db);
  return out.map((s) => {
    const n = counts.get(s.id);
    return { ...s, generated: n?.generated ?? 0, generating: n?.generating ?? 0 };
  });
}

function storyIdsOf(body: { storyIds?: unknown; postId?: unknown }): string[] {
  if (Array.isArray(body.storyIds)) return body.storyIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
  if (typeof body.postId === 'string' && body.postId.trim()) return [body.postId.trim()];
  return [];
}

/** Queue a Generate click. The click is the approval for that run's live calls (CLAUDE.md Rule 1). One-story mode shards: one request per selected story. */
export async function generate(db: Queryable, body: { kind?: unknown; postId?: unknown; storyIds?: unknown }, by: string, source: StorySource): Promise<{ requestId: string; requestIds: string[] }> {
  const kind = body.kind === 'landscape' ? 'landscape' : body.kind === 'spread' ? 'spread' : 'single';
  const ids = [...new Set(storyIdsOf(body))];
  if (kind === 'single') {
    if (!ids.length) throw new ApiError(400, 'Pick a story first.');
    const loaded = source.loadMany ? await source.loadMany(ids) : (await Promise.all(ids.map((id) => source.load(id)))).flatMap((s) => (s ? [s] : []));
    if (loaded.length !== ids.length) throw new ApiError(404, ids.length === 1 ? 'That story has no brief yet. Generate a brief first.' : 'Every selected story needs a brief first.');
  }
  if (kind === 'spread' || kind === 'landscape') {
    if (ids.length < 2) throw new ApiError(400, 'Pick at least two stories that already have a brief.');
    const loaded = source.loadMany ? await source.loadMany(ids) : (await Promise.all(ids.map((id) => source.load(id)))).flatMap((s) => (s ? [s] : []));
    if (loaded.length !== ids.length) throw new ApiError(404, 'Every selected story needs a brief first.');
  }
  const busy = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM memes.requests WHERE status IN ('requested', 'running')`);
  if ((busy.rows[0]?.n ?? 0) >= 3) throw new ApiError(429, 'Three runs are already waiting; let them finish first.');
  if (kind === 'single') {
    const requestIds: string[] = [];
    for (const postId of ids) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO memes.requests (kind, post_id, requested_by, detail) VALUES ('single', $1, $2, '{}'::jsonb) RETURNING id`,
        [postId, by],
      );
      requestIds.push(rows[0]!.id);
    }
    return { requestId: requestIds[0]!, requestIds };
  }
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO memes.requests (kind, post_id, requested_by, detail) VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [kind, null, by, JSON.stringify({ storyIds: ids })],
  );
  return { requestId: rows[0]!.id, requestIds: [rows[0]!.id] };
}

export async function requestBriefs(
  db: Queryable,
  body: { storyIds?: unknown; mode?: unknown },
  create: MessagesCreate,
): Promise<{ jobs: BriefJob[]; spent: number }> {
  const ids = storyIdsOf(body);
  if (!ids.length) throw new ApiError(400, 'Pick at least one story.');
  const mode = body.mode === 'reporter' ? 'reporter' : 'from-body';
  if (mode === 'reporter' && ids.length !== 1) throw new ApiError(400, 'The full Reporter runs one story at a time.');
  return runBriefs(db, ids, mode, create, { reporter: liveReporter(create) });
}

export type RunSummary = {
  id: string; kind: string; postId: string | null; status: string; stage: string | null; costUsd: number;
  error: string | null; requestedAt: string; finishedAt: string | null; title: string | null;
  slate: number; graded: number;
};

const SUMMARY_SQL = `
  SELECT r.id::text, r.kind, r.post_id, r.status, r.stage, r.cost_usd::float8 AS cost, r.error,
         r.requested_at::text, r.finished_at::text, s.stories,
         (SELECT count(*)::int FROM memes.memes m WHERE m.slate_id = s.id AND m.in_slate) AS slate,
         (SELECT count(*)::int FROM memes.memes m JOIN memes.picks p ON p.meme_id = m.id WHERE m.slate_id = s.id AND m.in_slate) AS graded
    FROM memes.requests r LEFT JOIN memes.slates s ON s.request_id = r.id`;

type SummaryRow = {
  id: string; kind: string; post_id: string | null; status: string; stage: string | null; cost: number; error: string | null;
  requested_at: string; finished_at: string | null; stories: Array<{ title?: string }> | null; slate: number | null; graded: number | null;
};

const summary = (r: SummaryRow): RunSummary => ({
  id: r.id, kind: r.kind, postId: r.post_id, status: r.status, stage: r.stage, costUsd: Number(r.cost), error: r.error,
  requestedAt: r.requested_at, finishedAt: r.finished_at, title: r.stories?.map((x) => x.title).filter(Boolean).join(' · ') || null,
  slate: Number(r.slate ?? 0), graded: Number(r.graded ?? 0),
});

/** How many runs the lab lists, newest first: enough for a whole graded batch (v4 lost 3 slates past an older cap of 30). */
export const RUN_LIST_LIMIT = 300;

export async function listRuns(db: Queryable): Promise<RunSummary[]> {
  const { rows } = await db.query<SummaryRow>(`${SUMMARY_SQL} ORDER BY r.requested_at DESC LIMIT ${RUN_LIST_LIMIT}`);
  return rows.map(summary);
}

export type LabMeme = {
  id: string; templateId: string; templateName: string; inSlate: boolean; rank: number | null;
  situation: { id: string; name: string } | null; point: string; lines: Array<{ slot: string; says: string; why: string | null }>;
  judges: Record<string, number | string | null>; dropped: string | null; belowBar: string | null; hasImage: boolean;
  /** The turn this meme carries (pipeline v3), or null. */
  turnId: string | null; turnType: string | null;
  pick: { verdict: string; tags: string[]; note: string | null; rating: number | null } | null;
};

export type RunDetail = RunSummary & { slateId: string | null; pipeline: string; shape: Record<string, unknown> | null; memes: LabMeme[]; detail: Record<string, unknown> };

export async function getRun(db: Queryable, id: string): Promise<RunDetail> {
  const { rows } = await db.query<SummaryRow & { detail: Record<string, unknown> }>(`${SUMMARY_SQL.replace('s.stories', 's.stories, r.detail')} WHERE r.id = $1`, [id]);
  const r = rows[0];
  if (!r) throw new ApiError(404, 'No such run.');
  const slate = await db.query<{ id: string; shape: Record<string, unknown> | null }>(`SELECT id::text, shape FROM memes.slates WHERE request_id = $1`, [id]);
  const slateId = slate.rows[0]?.id ?? null;
  const memes: LabMeme[] = [];
  if (slateId) {
    const m = await db.query<{
      id: string; template_id: string; in_slate: boolean; rank: number | null; situation_id: string | null;
      mapping: { relation: string; turnId?: string; turnType?: string; why?: Record<string, string>; fill: { fills: Array<{ slot: string; kind: string; text?: string; playerId?: string }> } };
      judges: Record<string, number | string | null>; image_path: string | null; verdict: string | null; tags: string[] | null; note: string | null; rating: number | null;
    }>(
      `SELECT m.id::text, m.template_id, m.in_slate, m.rank, m.situation_id, m.mapping, m.judges, m.image_path, p.verdict, p.tags, p.note, p.rating
         FROM memes.memes m LEFT JOIN memes.picks p ON p.meme_id = m.id
        WHERE m.slate_id = $1 ORDER BY m.in_slate DESC, m.rank NULLS LAST, m.created_at`,
      [slateId],
    );
    for (const x of m.rows) {
      const sit = x.situation_id ? situation(x.situation_id) : undefined;
      memes.push({
        id: x.id, templateId: x.template_id, templateName: templateCard(x.template_id)?.name ?? x.template_id, inSlate: x.in_slate, rank: x.rank,
        situation: sit ? { id: sit.id, name: sit.name } : null, point: x.mapping.relation,
        lines: x.mapping.fill.fills.map((f) => ({ slot: f.slot, says: f.kind === 'entity' ? `[label: ${f.playerId}]` : f.text ?? '', why: x.mapping.why?.[f.slot] ?? null })),
        judges: x.judges, dropped: (x.judges.dropped as string | null) ?? null, belowBar: (x.judges.belowBar as string | null) ?? null, hasImage: Boolean(x.image_path),
        turnId: x.mapping.turnId ?? null, turnType: x.mapping.turnType ?? null,
        pick: x.verdict ? { verdict: x.verdict, tags: x.tags ?? [], note: x.note, rating: x.rating } : null,
      });
    }
  }
  const shape = slate.rows[0]?.shape ?? null;
  return { ...summary(r), slateId, pipeline: String(shape?.pipeline ?? 'v2'), shape, memes, detail: r.detail ?? {} };
}

const asRating = (v: unknown): 1 | 2 | 3 | 4 | null => (v === 1 || v === 2 || v === 3 || v === 4 ? v : null);

/**
 * Rate a meme 1–4, or pick/reject it with tags (ME-06, ME-64). Each meme
 * keeps its own rating. With a rating, tags are the optional reason chips
 * (REASON_TAGS for 1–2, WORKED_TAGS for 3–4); tags or a note left out of the
 * body keep what was saved, so changing a rating never wipes them, and tags
 * that no longer fit the new rating are dropped.
 */
export async function pick(db: Queryable, body: { memeId?: unknown; verdict?: unknown; tags?: unknown; note?: unknown; rating?: unknown }, by: string): Promise<{ ok: true }> {
  if (typeof body.memeId !== 'string') throw new ApiError(400, 'Which meme?');
  const rating = asRating(body.rating);
  const verdict = rating != null ? (rating >= 3 ? 'picked' : 'rejected') : body.verdict;
  if (verdict !== 'picked' && verdict !== 'rejected') throw new ApiError(400, 'Pick, reject, or rate 1 to 4.');
  const m = await db.query<{ slate_id: string; tags: string[] | null; note: string | null }>(
    `SELECT m.slate_id::text, p.tags, p.note FROM memes.memes m LEFT JOIN memes.picks p ON p.meme_id = m.id WHERE m.id = $1`,
    [body.memeId],
  );
  const row = m.rows[0];
  if (!row) throw new ApiError(404, 'No such meme.');
  const allowed = allowedTags(rating);
  const sent = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : null;
  const tags = [...new Set((sent ?? (rating != null ? row.tags ?? [] : [])).filter((t) => allowed.has(t)))];
  if (rating == null && verdict === 'rejected' && !tags.length) throw new ApiError(400, 'Say why with at least one tag.');
  const note = body.note === undefined && rating != null
    ? row.note
    : typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
  await db.query(
    `INSERT INTO memes.picks (slate_id, meme_id, verdict, tags, note, rating, decided_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (meme_id) DO UPDATE SET verdict = EXCLUDED.verdict, tags = EXCLUDED.tags, note = EXCLUDED.note, rating = EXCLUDED.rating, decided_by = EXCLUDED.decided_by, decided_at = now()`,
    [row.slate_id, body.memeId, verdict, rating == null && verdict === 'picked' ? [] : tags, note, rating, by],
  );
  return { ok: true };
}

export async function attach(db: Queryable, body: { postRef?: unknown; storyKey?: unknown; memeId?: unknown; role?: unknown }): Promise<{ ok: true }> {
  const postRef = typeof body.postRef === 'string' ? body.postRef.trim() : '';
  const memeId = typeof body.memeId === 'string' ? body.memeId : '';
  const role = body.role === 'cover' ? 'cover' : body.role === 'slide' ? 'slide' : null;
  const storyKey = typeof body.storyKey === 'string' && body.storyKey.trim() ? body.storyKey.trim() : null;
  if (!postRef) throw new ApiError(400, 'Which Last Few Days post?');
  if (!memeId) throw new ApiError(400, 'Which meme?');
  if (!role) throw new ApiError(400, 'Cover or slide?');
  if (role === 'slide' && !storyKey) throw new ApiError(400, 'Which story slide?');
  if (role === 'cover') {
    const spread = await db.query<{ kind: string }>(
      `SELECT s.kind FROM memes.memes m JOIN memes.slates s ON s.id = m.slate_id WHERE m.id = $1`,
      [memeId],
    );
    if (spread.rows[0]?.kind !== 'spread') throw new ApiError(400, 'Only a spread meme can be the cover.');
  }
  const meme = await db.query<{ id: string }>(`SELECT id::text FROM memes.memes WHERE id = $1`, [memeId]);
  if (!meme.rows[0]) throw new ApiError(404, 'No such meme.');
  if (role === 'cover') {
    await db.query(`DELETE FROM memes.lfd_attachments WHERE post_ref = $1 AND role = 'cover'`, [postRef]);
    await db.query(
      `INSERT INTO memes.lfd_attachments (post_ref, story_key, meme_id, role) VALUES ($1, NULL, $2, 'cover')`,
      [postRef, memeId],
    );
  } else {
    await db.query(
      `INSERT INTO memes.lfd_attachments (post_ref, story_key, meme_id, role) VALUES ($1, $2, $3, 'slide')
       ON CONFLICT (post_ref, story_key, role) DO UPDATE SET meme_id = EXCLUDED.meme_id, attached_at = now()`,
      [postRef, storyKey, memeId],
    );
  }
  return { ok: true };
}

export async function detach(db: Queryable, body: { postRef?: unknown; storyKey?: unknown; role?: unknown }): Promise<{ ok: true }> {
  const postRef = typeof body.postRef === 'string' ? body.postRef.trim() : '';
  const role = body.role === 'cover' ? 'cover' : 'slide';
  const storyKey = typeof body.storyKey === 'string' ? body.storyKey.trim() : null;
  if (!postRef) throw new ApiError(400, 'Which Last Few Days post?');
  if (role === 'cover') await db.query(`DELETE FROM memes.lfd_attachments WHERE post_ref = $1 AND role = 'cover'`, [postRef]);
  else await db.query(`DELETE FROM memes.lfd_attachments WHERE post_ref = $1 AND story_key = $2 AND role = 'slide'`, [postRef, storyKey]);
  return { ok: true };
}

export type PreviewSlide = {
  kind: 'cover' | 'story' | 'follow';
  storyKey: string | null;
  title: string;
  image: { kind: 'photo' | 'meme' | 'none'; url: string | null; credit: string | null };
};

export async function previewPost(db: Queryable, postRef: string): Promise<{ postRef: string; coverIsMeme: boolean; slides: PreviewSlide[]; mosaic: OriginalPhoto[] }> {
  if (!postRef.trim()) throw new ApiError(400, 'Which Last Few Days post?');
  const stories = (await listedFromDb(db)).filter((s) => s.postRef === postRef);
  const atts = await db.query<{ story_key: string | null; meme_id: string; role: string }>(
    `SELECT story_key, meme_id::text, role FROM memes.lfd_attachments WHERE post_ref = $1`,
    [postRef],
  );
  const cover = atts.rows.find((a) => a.role === 'cover');
  const byStory = new Map(atts.rows.filter((a) => a.role === 'slide').map((a) => [a.story_key, a.meme_id]));
  const slides: PreviewSlide[] = [
    {
      kind: 'cover',
      storyKey: null,
      title: cover ? 'Spread meme cover' : 'Cover mosaic (original photos)',
      image: cover
        ? { kind: 'meme', url: `/api/memes/image/${cover.meme_id}`, credit: null }
        : { kind: 'photo', url: stories.map((s) => s.originalPhoto?.url).find(Boolean) ?? null, credit: null },
    },
  ];
  if (!cover) {
    slides[0]!.image = { kind: 'photo', url: null, credit: null };
  }
  for (const s of stories) {
    const memeId = byStory.get(s.id);
    slides.push({
      kind: 'story',
      storyKey: s.id,
      title: s.title,
      image: memeId
        ? { kind: 'meme', url: `/api/memes/image/${memeId}`, credit: null }
        : { kind: 'photo', url: s.originalPhoto?.url ?? null, credit: s.originalPhoto?.credit ?? null },
    });
  }
  slides.push({ kind: 'follow', storyKey: null, title: 'Follow Helios', image: { kind: 'none', url: null, credit: null } });
  return { postRef, coverIsMeme: Boolean(cover), slides, mosaic: cover ? [] : stories.map((s) => s.originalPhoto).filter((p): p is OriginalPhoto => Boolean(p?.url)) };
}

export type ResultBucket = {
  key: string; n: number; passed: number; picked: number; failed: Record<string, number>;
  /** Memes Lucas rated, how many were 3 or 4, how many 4, and the mean rating. */
  rated: number; good: number; awesome: number; mean: number | null;
};

function failBar(dropped: string | null): string {
  if (!dropped) return '';
  const m = /judges:\s*([^:]+)/.exec(dropped);
  return (m?.[1] ?? dropped).replace(/^judges:\s*/, '').split(/[,;]/)[0]!.replace(/\s*\([\d.]+\)/, '').trim();
}

export async function labResults(db: Queryable): Promise<{
  totals: { memes: number; passed: number; picked: number; rated: number; good: number; awesome: number };
  byTemplate: ResultBucket[];
  bySituation: ResultBucket[];
  byKind: ResultBucket[];
  byFail: ResultBucket[];
  byVersion: ResultBucket[];
  byReason: ResultBucket[];
  byTurnType: ResultBucket[];
}> {
  const { rows } = await db.query<{
    template_id: string; situation_id: string | null; kind: string; judges: { dropped?: string | null }; verdict: string | null;
    rating: number | null; tags: string[] | null; pipeline: string | null; turn_type: string | null;
  }>(
    `SELECT m.template_id, m.situation_id, s.kind, m.judges, p.verdict, p.rating, p.tags, s.shape->>'pipeline' AS pipeline, m.mapping->>'turnType' AS turn_type
       FROM memes.memes m JOIN memes.slates s ON s.id = m.slate_id LEFT JOIN memes.picks p ON p.meme_id = m.id`,
  );
  const bucket = () => ({ n: 0, passed: 0, picked: 0, failed: {} as Record<string, number>, rated: 0, good: 0, awesome: 0, sum: 0 });
  type B = ReturnType<typeof bucket>;
  const add = (map: Map<string, B>, key: string, passed: boolean, picked: boolean, fail: string, rating: number | null) => {
    const b = map.get(key) ?? bucket();
    b.n += 1;
    if (passed) b.passed += 1;
    if (picked) b.picked += 1;
    if (!passed && fail) b.failed[fail] = (b.failed[fail] ?? 0) + 1;
    if (rating != null) {
      b.rated += 1;
      b.sum += rating;
      if (rating >= 3) b.good += 1;
      if (rating === 4) b.awesome += 1;
    }
    map.set(key, b);
  };
  const maps = {
    templates: new Map<string, B>(), situations: new Map<string, B>(), kinds: new Map<string, B>(), fails: new Map<string, B>(),
    versions: new Map<string, B>(), reasons: new Map<string, B>(), turns: new Map<string, B>(),
  };
  const totals = { memes: rows.length, passed: 0, picked: 0, rated: 0, good: 0, awesome: 0 };
  for (const r of rows) {
    const dropped = (r.judges?.dropped as string | null) ?? null;
    const passed = !dropped;
    const picked = r.verdict === 'picked';
    const fail = failBar(dropped);
    const rating = r.rating;
    if (passed) totals.passed += 1;
    if (picked) totals.picked += 1;
    if (rating != null) {
      totals.rated += 1;
      if (rating >= 3) totals.good += 1;
      if (rating === 4) totals.awesome += 1;
    }
    add(maps.templates, r.template_id, passed, picked, fail, rating);
    add(maps.situations, r.situation_id ?? '(none)', passed, picked, fail, rating);
    add(maps.kinds, r.kind, passed, picked, fail, rating);
    add(maps.versions, r.pipeline ?? 'v2', passed, picked, fail, rating);
    if (r.turn_type) add(maps.turns, r.turn_type, passed, picked, fail, rating);
    if (fail) add(maps.fails, fail, false, picked, fail, rating);
    for (const t of r.tags ?? []) add(maps.reasons, t, passed, picked, fail, rating);
  }
  const toList = (m: Map<string, B>): ResultBucket[] =>
    [...m.entries()].map(([key, { sum, ...b }]) => ({ key, ...b, mean: b.rated ? sum / b.rated : null })).sort((a, b) => b.n - a.n);
  return {
    totals,
    byTemplate: toList(maps.templates),
    bySituation: toList(maps.situations),
    byKind: toList(maps.kinds),
    byFail: toList(maps.fails),
    byVersion: toList(maps.versions),
    byReason: toList(maps.reasons),
    byTurnType: toList(maps.turns),
  };
}

/** The PNG for a meme, only from inside the lab's render folder. */
export async function memeImage(db: Queryable, id: string): Promise<Buffer> {
  const { rows } = await db.query<{ image_path: string | null }>(`SELECT image_path FROM memes.memes WHERE id = $1`, [id]);
  const rel = rows[0]?.image_path;
  if (!rel) throw new ApiError(404, 'No image.');
  const root = path.join(process.cwd(), '.memes-local');
  const file = path.resolve(process.cwd(), rel);
  if (!file.startsWith(root + path.sep)) throw new ApiError(404, 'No image.');
  return fs.promises.readFile(file);
}
