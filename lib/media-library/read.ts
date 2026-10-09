/**
 * The photo library, read side (DECISIONS_LOG D49), for the hub's library
 * page: SELECT only, and no network module (the hub scope test walks every
 * import a hub page makes). Images are shown through
 * /api/media-library/thumb/<id>, which signs a short URL for the private
 * bucket; nothing here signs or fetches.
 *
 *   listLibrary     a page of photos with filters and facets
 *   libraryPhoto    one photo, its sources and its sightings
 *   librarySummary  the fullness line: stored, reusable, added this week
 *   photoObjectPath the bucket path of a photo's thumbnail or master
 *
 * Each returns `{ absent: true }` (or null) until the schema is applied.
 */
import type { Licence, Query } from './types';

export type LibraryFilters = {
  /** A tag the photo carries (exact, lowercase). */
  tag?: string | null;
  /** A finder lane one of its sources came from (headshot, stocksnap, logo …). */
  lane?: string | null;
  /** A source kind (commons, stock, article …). */
  source?: string | null;
  /** true: published at least once (social.used_photos); false: never. */
  used?: boolean | null;
  licence?: Licence | null;
  /** A verified Wikidata id. */
  qid?: string | null;
  /** Default 'stored'. */
  status?: 'stored' | 'removed';
  /** 1-based. */
  page?: number;
  /** Default 48, at most 200. */
  pageSize?: number;
};

export type LibraryItem = {
  id: string;
  /** The thumbnail route (signs a 10-minute URL; the bucket stays private). */
  thumbUrl: string;
  width: number;
  height: number;
  credit: string;
  licence: Licence;
  reuseOk: boolean;
  tags: string[];
  qids: string[];
  subjects: string[];
  scenes: string[];
  lanes: string[];
  sources: string[];
  visionPass: boolean;
  status: 'stored' | 'removed';
  firstSeenAt: string;
  lastSeenAt: string;
  useCount: number;
  lastUsedAt: string | null;
};

export type Facet = { value: string; count: number };
export type LibraryFacets = { lanes: Facet[]; sources: Facet[]; licences: Facet[]; tags: Facet[] };

export type LibraryPage = { absent: true } | { absent?: false; items: LibraryItem[]; total: number; page: number; pageSize: number; facets: LibraryFacets };

export type LibrarySource = { url: string; source: string | null; lane: string | null; title: string | null; credit: string | null; licence: Licence | null; reuseOk: boolean; status: string; lastOkAt: string | null; firstSeenAt: string };
export type LibrarySighting = { url: string; runKind: string; runRef: string; slide: number; requestKind: string | null; requestQuery: string; outcome: string; qid: string | null; subject: string | null; verified: boolean; tileTags: string[]; fit: number | null; visionPass: boolean | null; whatItShows: string | null; at: string };
export type LibraryPhoto = { item: LibraryItem; dhash: string | null; mime: string; bytes: number; removedReason: string | null; sources: LibrarySource[]; sightings: LibrarySighting[] };

export type LibrarySummary = { absent: true } | { absent?: false; stored: number; reusable: number; addedLast7d: number; lastAddedAt: string | null; bySource: Record<string, number> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPhotoId = (id: string) => UUID.test(id);

export const thumbRoute = (id: string) => `/api/media-library/thumb/${id}`;

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

async function present(query: Query): Promise<{ photos: boolean; used: boolean }> {
  const { rows } = await query(`SELECT to_regclass('media_library.photos') IS NOT NULL AS photos, to_regclass('social.used_photos') IS NOT NULL AS used`);
  return { photos: Boolean(rows[0]?.photos), used: Boolean(rows[0]?.used) };
}

/** Use count and last use, by any of the photo's source URLs. */
const usedJoin = (hasUsed: boolean) =>
  hasUsed
    ? `LEFT JOIN LATERAL (SELECT count(*)::int AS use_count, max(u.used_at) AS last_used_at FROM social.used_photos u
         WHERE u.url IN (SELECT s.url FROM media_library.photo_sources s WHERE s.photo_id = p.id)) u ON true`
    : `LEFT JOIN LATERAL (SELECT 0 AS use_count, NULL::timestamptz AS last_used_at) u ON true`;

const SELECT_ITEM = `p.id, p.width, p.height, p.credit, p.licence, p.reuse_ok, p.tags, p.qids, p.subjects, p.scenes, p.vision_pass, p.status,
       p.first_seen_at, p.last_seen_at, p.dhash, p.mime, p.bytes, p.removed_reason,
       COALESCE((SELECT array_agg(DISTINCT s.lane) FROM media_library.photo_sources s WHERE s.photo_id = p.id AND s.lane IS NOT NULL), '{}') AS lanes,
       COALESCE((SELECT array_agg(DISTINCT s.source) FROM media_library.photo_sources s WHERE s.photo_id = p.id AND s.source IS NOT NULL), '{}') AS sources,
       u.use_count, u.last_used_at`;

function toItem(r: Record<string, any>): LibraryItem {
  return {
    id: r.id,
    thumbUrl: thumbRoute(r.id),
    width: Number(r.width),
    height: Number(r.height),
    credit: r.credit,
    licence: r.licence,
    reuseOk: Boolean(r.reuse_ok),
    tags: r.tags ?? [],
    qids: r.qids ?? [],
    subjects: r.subjects ?? [],
    scenes: r.scenes ?? [],
    lanes: r.lanes ?? [],
    sources: r.sources ?? [],
    visionPass: Boolean(r.vision_pass),
    status: r.status,
    firstSeenAt: iso(r.first_seen_at)!,
    lastSeenAt: iso(r.last_seen_at)!,
    useCount: Number(r.use_count) || 0,
    lastUsedAt: iso(r.last_used_at),
  };
}

export async function listLibrary(query: Query, filters: LibraryFilters = {}): Promise<LibraryPage> {
  const has = await present(query);
  if (!has.photos) return { absent: true };
  const pageSize = Math.min(200, Math.max(1, Math.floor(filters.pageSize ?? 48)));
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const params: unknown[] = [filters.status === 'removed' ? 'removed' : 'stored'];
  const where = ['p.status = $1'];
  const add = (sql: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(sql(params.length));
  };
  if (filters.tag?.trim()) add((n) => `$${n}::text = ANY(p.tags)`, filters.tag.trim().toLowerCase());
  if (filters.qid?.trim()) add((n) => `$${n}::text = ANY(p.qids)`, filters.qid.trim());
  if (filters.licence) add((n) => `p.licence = $${n}`, filters.licence);
  if (filters.lane?.trim()) add((n) => `EXISTS (SELECT 1 FROM media_library.photo_sources s WHERE s.photo_id = p.id AND s.lane = $${n})`, filters.lane.trim());
  if (filters.source?.trim()) add((n) => `EXISTS (SELECT 1 FROM media_library.photo_sources s WHERE s.photo_id = p.id AND s.source = $${n})`, filters.source.trim());
  if (typeof filters.used === 'boolean') where.push(filters.used ? 'u.use_count > 0' : 'u.use_count = 0');
  const from = `FROM media_library.photos p ${usedJoin(has.used)} WHERE ${where.join(' AND ')}`;
  const total = Number((await query(`SELECT count(*)::int AS n ${from}`, params)).rows[0]?.n) || 0;
  const { rows } = await query(`SELECT ${SELECT_ITEM} ${from} ORDER BY p.last_seen_at DESC, p.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
  const status = params[0];
  const facet = async (sql: string): Promise<Facet[]> => (await query(sql, [status])).rows.map((r) => ({ value: String(r.value), count: Number(r.count) || 0 }));
  const facets: LibraryFacets = {
    lanes: await facet(`SELECT s.lane AS value, count(DISTINCT p.id)::int AS count FROM media_library.photos p JOIN media_library.photo_sources s ON s.photo_id = p.id
                         WHERE p.status = $1 AND s.lane IS NOT NULL GROUP BY s.lane ORDER BY count DESC, value`),
    sources: await facet(`SELECT s.source AS value, count(DISTINCT p.id)::int AS count FROM media_library.photos p JOIN media_library.photo_sources s ON s.photo_id = p.id
                           WHERE p.status = $1 AND s.source IS NOT NULL GROUP BY s.source ORDER BY count DESC, value`),
    licences: await facet(`SELECT p.licence AS value, count(*)::int AS count FROM media_library.photos p WHERE p.status = $1 GROUP BY p.licence ORDER BY count DESC, value`),
    tags: await facet(`SELECT t AS value, count(*)::int AS count FROM media_library.photos p, unnest(p.tags) AS t WHERE p.status = $1 GROUP BY t ORDER BY count DESC, value LIMIT 40`),
  };
  return { items: rows.map(toItem), total, page, pageSize, facets };
}

export async function libraryPhoto(query: Query, id: string): Promise<LibraryPhoto | null> {
  if (!isPhotoId(id)) return null;
  const has = await present(query);
  if (!has.photos) return null;
  const { rows } = await query(`SELECT ${SELECT_ITEM} FROM media_library.photos p ${usedJoin(has.used)} WHERE p.id = $1`, [id]);
  const r = rows[0];
  if (!r) return null;
  const sources = (
    await query(
      `SELECT url, source, lane, title, credit, licence, reuse_ok, status, last_ok_at, first_seen_at FROM media_library.photo_sources WHERE photo_id = $1 ORDER BY first_seen_at, url`,
      [id],
    )
  ).rows.map((s): LibrarySource => ({ url: s.url, source: s.source, lane: s.lane, title: s.title, credit: s.credit, licence: s.licence, reuseOk: Boolean(s.reuse_ok), status: s.status, lastOkAt: iso(s.last_ok_at), firstSeenAt: iso(s.first_seen_at)! }));
  const sightings = (
    await query(
      `SELECT url, run_kind, run_ref, slide, request_kind, request_query, outcome, qid, subject, verified, tile_tags, fit, vision, at
         FROM media_library.sightings WHERE url = ANY($1::text[]) ORDER BY at DESC, id DESC LIMIT 200`,
      [sources.map((s) => s.url)],
    )
  ).rows.map((g): LibrarySighting => {
    const vision = typeof g.vision === 'string' ? JSON.parse(g.vision) : g.vision;
    return {
      url: g.url, runKind: g.run_kind, runRef: g.run_ref, slide: Number(g.slide), requestKind: g.request_kind, requestQuery: g.request_query, outcome: g.outcome,
      qid: g.qid, subject: g.subject, verified: Boolean(g.verified), tileTags: g.tile_tags ?? [], fit: g.fit == null ? null : Number(g.fit),
      visionPass: vision ? Boolean(vision.pass) : null, whatItShows: vision?.what_it_shows ?? null, at: iso(g.at)!,
    };
  });
  return { item: toItem(r), dhash: r.dhash ?? null, mime: r.mime, bytes: Number(r.bytes), removedReason: r.removed_reason ?? null, sources, sightings };
}

export async function librarySummary(query: Query): Promise<LibrarySummary> {
  const has = await present(query);
  if (!has.photos) return { absent: true };
  const { rows } = await query(
    `SELECT count(*)::int AS stored,
            count(*) FILTER (WHERE reuse_ok)::int AS reusable,
            count(*) FILTER (WHERE first_seen_at > now() - interval '7 days')::int AS recent,
            max(first_seen_at) AS last
       FROM media_library.photos WHERE status = 'stored'`,
  );
  const by = await query(
    `SELECT s.source AS value, count(DISTINCT p.id)::int AS count FROM media_library.photos p JOIN media_library.photo_sources s ON s.photo_id = p.id
      WHERE p.status = 'stored' AND s.source IS NOT NULL GROUP BY s.source ORDER BY s.source`,
  );
  const r = rows[0] ?? {};
  return {
    stored: Number(r.stored) || 0,
    reusable: Number(r.reusable) || 0,
    addedLast7d: Number(r.recent) || 0,
    lastAddedAt: iso(r.last),
    bySource: Object.fromEntries(by.rows.map((x) => [String(x.value), Number(x.count) || 0])),
  };
}

/** The bucket path of a stored photo's thumbnail (or master), or null (unknown id, removed, or no schema). */
export async function photoObjectPath(query: Query, id: string, variant: 'thumb' | 'master' = 'thumb'): Promise<string | null> {
  if (!isPhotoId(id)) return null;
  const has = await present(query);
  if (!has.photos) return null;
  const { rows } = await query(`SELECT thumb_path, master_path FROM media_library.photos WHERE id = $1 AND status = 'stored'`, [id]);
  const r = rows[0];
  if (!r) return null;
  return (variant === 'master' ? r.master_path : r.thumb_path) ?? null;
}
