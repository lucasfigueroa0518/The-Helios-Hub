/**
 * Reel AI Drama and the photo bank (Lucas, 2026-11-03: the hub's photo bank
 * is the first stop and the shared store for real photos). Pure planning plus
 * one SELECT; no network.
 *
 *   offers    every photo the harvest keeps (picked) and every one the wish
 *             search passed but didn't take (passed), as the carousel offers
 *             its winner and runners-up: one source per URL in lane
 *             `reel-ai-drama` (a URL the bank already holds keeps its lane),
 *             licensed by the same pass as carousels (a credit it doesn't
 *             clear is `unknown`, reuse_ok false); a sighting for the want,
 *             carrying the harvest's look, source page and date basis; and a
 *             verified sighting per identity-verified person (QID, name), so
 *             the photo's qids/subjects carry them.
 *   lookups   lookupForDrama: by QIDs (any lane) or by tag overlap with the
 *             want's words; ANY licence (the reel credits every photo it
 *             runs; carousels read through reader.ts, cleared photos only).
 *             The freshest source URL is offered when it was fetched within
 *             SOURCE_FRESH_DAYS (the reader's rule); otherwise the bank copy's
 *             master path. Each hit carries the latest Reel AI Drama look that
 *             passed, so the harvest can skip the paid look for it.
 */
import { licenceOf, storedLicence, words } from './policy';
import { SOURCE_FRESH_DAYS } from './reader';
import type { BankRows, Licence, Query, SightingRow } from './types';

export const DRAMA_LANE = 'reel-ai-drama';
export const DRAMA_RUN_KIND = 'reel_ai_drama' as const;

/** A harvest source as the finder source the licence pass knows (C6 reads `article` and `official` specially). */
const LICENCE_SOURCE: Record<string, string> = {
  wikidata: 'commons',
  commons: 'commons-search',
  openverse: 'stock',
  serper: 'article',
  article: 'article',
  newsroom: 'article',
  logo: 'logo',
};

export type DramaOfferItem = {
  url: string;
  /** The harvest source (wikidata, commons, openverse, serper, article, newsroom, logo, photo_bank). */
  source: string;
  /** A bank hit's own source, so a re-offer is licensed as it was first. */
  bankSource?: string | null;
  credit: string;
  sourcePage: string | null;
  date: string | null;
  dateBasis: string | null;
  /** The visual kind (person_photo, event_photo …). */
  kind: string;
  /** What the want asked for. */
  request: string;
  shows: string;
  outcome: 'picked' | 'passed';
  /** Identity-verified people in the photo (QID when known). */
  verified: Array<{ name: string; qid: string | null }>;
  /** The harvest's look (it passed every check). */
  look: Record<string, unknown> | null;
  faces: unknown[] | null;
  /** Its V-number in the inventory, or its order among the wish search's finds. */
  slide: number;
};

export type DramaOfferInput = {
  /** The Reel AI Drama job id. */
  runRef: string;
  /** The story's people and companies (the licence pass's brief). */
  subjects: string[];
  /** The companies among them (who a "company's own photo" credit may name). */
  organizations?: string[];
  items: DramaOfferItem[];
  at?: Date;
};

/** The harvest's photos as bank rows. Pure. */
export function planDramaOffer(input: DramaOfferInput): BankRows {
  const at = (input.at ?? new Date()).toISOString();
  const rows: BankRows = { sources: [], sightings: [] };
  for (const item of input.items ?? []) {
    if (!item?.url) continue;
    const base = { url: item.url, run_kind: DRAMA_RUN_KIND, run_ref: input.runRef, slide: item.slide, tile_tags: [], fit: null, faces: item.faces ?? null, plate: null, at };
    const people = item.verified.map((v) => v.name);
    const sighting: SightingRow = {
      ...base,
      request_query: item.request || item.kind,
      request_kind: item.kind,
      request_qid: null,
      qid: null,
      subject: null,
      verified: false,
      outcome: item.outcome,
      vision: { scene: item.request || item.kind, pass: true, what_it_shows: item.shows || null, verdict: { look: item.look, source_page: item.sourcePage, date_basis: item.dateBasis, kind: item.kind, people } },
    };
    rows.sightings.push(sighting);
    for (const v of item.verified) {
      rows.sightings.push({ ...base, request_query: v.name, request_kind: 'person', request_qid: v.qid, qid: v.qid, subject: v.name, verified: true, outcome: item.outcome, vision: null });
    }
    const source = item.source === 'photo_bank' ? item.bankSource ?? 'stock' : LICENCE_SOURCE[item.source] ?? 'stock';
    const licence = storedLicence(licenceOf({ url: item.url, credit: item.credit, source }, input.subjects, input.organizations));
    rows.sources.push({ url: item.url, source: item.source === 'photo_bank' ? item.bankSource ?? null : item.source, lane: DRAMA_LANE, title: item.shows || null, date: item.date, credit: item.credit, licence: licence.licence, reuse_ok: licence.reuseOk });
  }
  return rows;
}

export type DramaLookup = {
  /** Wikidata ids: any photo verified to show one of them. */
  qids: string[];
  /** Words to match the photo's tags (when no QID applies). */
  words: string[];
  /** Tags a word match must share (default: 2, or every word when fewer). */
  minOverlap?: number;
  limit: number;
};

/** The latest Reel AI Drama look that passed, as recorded with its sighting. */
export type DramaVerdict = { look: Record<string, unknown> | null; source_page: string | null; date_basis: string | null; people: string[] };

export type DramaHit = {
  photoId: string;
  /** The freshest source URL (offered as is when `fresh`). */
  url: string;
  fresh: boolean;
  /** The bank copy (photo-bucket path), for a stale URL. */
  masterPath: string;
  source: string | null;
  lane: string | null;
  credit: string;
  licence: Licence;
  reuseOk: boolean;
  title: string;
  date: string | null;
  width: number;
  height: number;
  qids: string[];
  subjects: string[];
  tags: string[];
  overlap: number;
  faces: unknown[] | null;
  verdict: DramaVerdict | null;
};

const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

/** Bank photos for one want: by QID first, then by shared tags. SELECT only. */
export async function lookupForDrama(query: Query, q: DramaLookup, now: Date = new Date()): Promise<DramaHit[]> {
  const qids = [...new Set(q.qids.filter(Boolean))];
  const want = [...new Set(q.words.flatMap((w) => words(w)))];
  if (!qids.length && !want.length) return [];
  const minOverlap = Math.max(1, Math.min(q.minOverlap ?? 2, want.length || 1));
  const limit = Math.max(1, q.limit);
  const { rows } = await query(
    `SELECT p.id, p.width, p.height, p.credit, p.licence, p.reuse_ok, p.qids, p.subjects, p.tags, p.master_path,
            (p.qids && $1::text[]) AS by_qid,
            cardinality(ARRAY(SELECT unnest(p.tags) INTERSECT SELECT unnest($2::text[]))) AS overlap,
            (SELECT row_to_json(o) FROM (
               SELECT s.url, s.source, s.lane, s.title, s.date, s.last_ok_at FROM media_library.photo_sources s
                WHERE s.photo_id = p.id AND s.status = 'stored' ORDER BY s.last_ok_at DESC NULLS LAST, s.url LIMIT 1) o) AS pick,
            (SELECT g.faces FROM media_library.sightings g JOIN media_library.photo_sources a ON a.url = g.url
              WHERE a.photo_id = p.id AND g.faces IS NOT NULL ORDER BY g.at DESC LIMIT 1) AS faces,
            (SELECT g.vision -> 'verdict' FROM media_library.sightings g JOIN media_library.photo_sources a ON a.url = g.url
              WHERE a.photo_id = p.id AND g.run_kind = 'reel_ai_drama' AND (g.vision ->> 'pass') = 'true' AND g.vision -> 'verdict' -> 'look' IS NOT NULL
              ORDER BY g.at DESC LIMIT 1) AS verdict
       FROM media_library.photos p
      WHERE p.status = 'stored'
        AND (p.qids && $1::text[]
             OR (cardinality($2::text[]) > 0 AND cardinality(ARRAY(SELECT unnest(p.tags) INTERSECT SELECT unnest($2::text[]))) >= $3))
      ORDER BY by_qid DESC, overlap DESC, (p.width::bigint * p.height) DESC, p.id
      LIMIT $4`,
    [qids, want, minOverlap, limit],
  );
  const fresh = now.getTime() - SOURCE_FRESH_DAYS * 86_400_000;
  const hits: DramaHit[] = [];
  for (const r of rows) {
    const pick = json(r.pick) as { url: string; source: string | null; lane: string | null; title: string | null; date: string | null; last_ok_at: string | null } | null;
    if (!pick?.url) continue;
    const verdict = json(r.verdict) as Partial<DramaVerdict> | null;
    const faces = json(r.faces);
    hits.push({
      photoId: String(r.id),
      url: pick.url,
      fresh: pick.last_ok_at ? new Date(pick.last_ok_at).getTime() > fresh : false,
      masterPath: r.master_path,
      source: pick.source ?? null,
      lane: pick.lane ?? null,
      credit: r.credit ?? '',
      licence: r.licence as Licence,
      reuseOk: Boolean(r.reuse_ok),
      title: pick.title ?? '',
      date: pick.date ?? null,
      width: Number(r.width),
      height: Number(r.height),
      qids: r.qids ?? [],
      subjects: r.subjects ?? [],
      tags: r.tags ?? [],
      overlap: Number(r.overlap) || 0,
      faces: Array.isArray(faces) ? faces : null,
      verdict: verdict && typeof verdict === 'object' ? { look: (verdict.look as Record<string, unknown>) ?? null, source_page: verdict.source_page ?? null, date_basis: verdict.date_basis ?? null, people: Array.isArray(verdict.people) ? verdict.people : [] } : null,
    });
  }
  return hits;
}
