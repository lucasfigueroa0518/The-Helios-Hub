/**
 * The photo bank's writes (media_library schema; DECISIONS_LOG D49):
 * queueing sources and recording sightings in one multi-row INSERT each, and
 * recomputing a stored photo's library fields from everything known about
 * it. Every write is idempotent (re-running a queue or an import changes
 * nothing but `last_seen_at`).
 */
import { metaOf, type MetaSighting, type MetaSource } from './policy';
import type { BankRows, Query, SightingRow, SourceRow } from './types';

/** open > government > company > unknown, as SQL (a re-offer only ever widens a source's licence). */
const rank = (col: string) => `(CASE ${col} WHEN 'open' THEN 3 WHEN 'government' THEN 2 WHEN 'company' THEN 1 ELSE 0 END)`;
const RETRY_ON_SIGHT = `s.status IN ('failed', 'gone', 'skipped')`;

const OUTCOME_RANK: Record<string, number> = { used: 5, picked: 4, passed: 3, verified: 2, rejected: 1 };

/** One row per URL (the first wins; a better licence later in the list wins). */
export function dedupeSources(rows: SourceRow[]): SourceRow[] {
  const by = new Map<string, SourceRow>();
  const r = (l: string) => ({ open: 3, government: 2, company: 1 })[l] ?? 0;
  for (const row of rows) {
    const had = by.get(row.url);
    if (!had || r(row.licence) > r(had.licence)) by.set(row.url, row);
  }
  return [...by.values()];
}

/** One row per sighting key (the strongest outcome wins). */
export function dedupeSightings(rows: SightingRow[]): SightingRow[] {
  const by = new Map<string, SightingRow>();
  for (const row of rows) {
    const key = JSON.stringify([row.url, row.run_kind, row.run_ref, row.slide, row.request_query]);
    const had = by.get(key);
    if (!had || (OUTCOME_RANK[row.outcome] ?? 0) > (OUTCOME_RANK[had.outcome] ?? 0)) by.set(key, row);
  }
  return [...by.values()];
}

/**
 * Queue the sources (pending) and record the sightings. A source already
 * stored stays stored (no new download); one that failed, went or was
 * skipped is tried again, since a finder just saw it live. Photos already
 * stored for these URLs get their library fields recomputed.
 */
export async function writeRows(query: Query, rows: BankRows): Promise<{ sources: number; sightings: number; refreshed: number }> {
  const sources = dedupeSources(rows.sources);
  const sightings = dedupeSightings(rows.sightings);
  if (sources.length) {
    await query(
      `INSERT INTO media_library.photo_sources AS s (url, source, lane, title, date, credit, licence, reuse_ok)
       SELECT x.url, x.source, x.lane, x.title, x.date, x.credit, x.licence, COALESCE(x.reuse_ok, false)
         FROM jsonb_to_recordset($1::jsonb) AS x(url text, source text, lane text, title text, date text, credit text, licence text, reuse_ok boolean)
       ON CONFLICT (url) DO UPDATE SET
         last_seen_at = now(),
         source = COALESCE(s.source, EXCLUDED.source),
         lane = COALESCE(s.lane, EXCLUDED.lane),
         title = COALESCE(NULLIF(s.title, ''), EXCLUDED.title),
         date = COALESCE(s.date, EXCLUDED.date),
         credit = CASE WHEN ${rank('EXCLUDED.licence')} > ${rank('s.licence')} THEN EXCLUDED.credit ELSE COALESCE(s.credit, EXCLUDED.credit) END,
         reuse_ok = CASE WHEN ${rank('EXCLUDED.licence')} > ${rank('s.licence')} THEN EXCLUDED.reuse_ok ELSE s.reuse_ok END,
         licence = CASE WHEN ${rank('EXCLUDED.licence')} > ${rank('s.licence')} THEN EXCLUDED.licence ELSE s.licence END,
         attempts = CASE WHEN ${RETRY_ON_SIGHT} THEN 0 ELSE s.attempts END,
         next_attempt_at = CASE WHEN ${RETRY_ON_SIGHT} THEN now() ELSE s.next_attempt_at END,
         status = CASE WHEN ${RETRY_ON_SIGHT} THEN 'pending' ELSE s.status END`,
      [JSON.stringify(sources)],
    );
  }
  if (sightings.length) {
    await query(
      `INSERT INTO media_library.sightings AS g (url, run_kind, run_ref, slide, request_query, request_kind, request_qid, qid, subject, verified, outcome, vision, tile_tags, fit, faces, plate, at)
       SELECT x.url, x.run_kind, x.run_ref, x.slide, x.request_query, x.request_kind, x.request_qid, x.qid, x.subject, COALESCE(x.verified, false), x.outcome,
              x.vision, COALESCE(x.tile_tags, '{}'::text[]), x.fit, x.faces, x.plate, COALESCE(x.at, now())
         FROM jsonb_to_recordset($1::jsonb) AS x(url text, run_kind text, run_ref text, slide integer, request_query text, request_kind text, request_qid text,
              qid text, subject text, verified boolean, outcome text, vision jsonb, tile_tags text[], fit real, faces jsonb, plate text, at timestamptz)
       ON CONFLICT (url, run_kind, run_ref, slide, request_query) DO UPDATE SET
         outcome = EXCLUDED.outcome,
         request_kind = COALESCE(EXCLUDED.request_kind, g.request_kind),
         request_qid = COALESCE(EXCLUDED.request_qid, g.request_qid),
         qid = COALESCE(EXCLUDED.qid, g.qid),
         subject = COALESCE(EXCLUDED.subject, g.subject),
         verified = EXCLUDED.verified OR g.verified,
         vision = COALESCE(EXCLUDED.vision, g.vision),
         tile_tags = CASE WHEN cardinality(EXCLUDED.tile_tags) > 0 THEN EXCLUDED.tile_tags ELSE g.tile_tags END,
         fit = COALESCE(EXCLUDED.fit, g.fit),
         faces = COALESCE(EXCLUDED.faces, g.faces),
         plate = COALESCE(EXCLUDED.plate, g.plate),
         at = EXCLUDED.at`,
      [JSON.stringify(sightings)],
    );
  }
  const urls = [...new Set([...sources.map((s) => s.url), ...sightings.map((s) => s.url)])];
  let refreshed = 0;
  if (urls.length) {
    const { rows: linked } = await query(`SELECT DISTINCT photo_id FROM media_library.photo_sources WHERE url = ANY($1::text[]) AND photo_id IS NOT NULL AND status = 'stored'`, [urls]);
    for (const r of linked) {
      await refreshPhotoMeta(query, r.photo_id as string);
      refreshed++;
    }
  }
  return { sources: sources.length, sightings: sightings.length, refreshed };
}

/** Recompute a stored photo's credit, licence, identities, scenes, tags and vision flag from its sources and sightings. */
export async function refreshPhotoMeta(query: Query, photoId: string): Promise<void> {
  const { rows: sources } = await query(
    `SELECT url, lane, credit, licence, reuse_ok, last_ok_at FROM media_library.photo_sources WHERE photo_id = $1 AND status = 'stored'`,
    [photoId],
  );
  if (!sources.length) return;
  const { rows: sightings } = await query(
    `SELECT url, outcome, tile_tags, request_query, request_kind, qid, subject, verified, vision FROM media_library.sightings WHERE url = ANY($1::text[]) ORDER BY at, id`,
    [sources.map((s) => s.url)],
  );
  const m = metaOf(sources as MetaSource[], sightings as MetaSighting[]);
  await query(
    `UPDATE media_library.photos SET credit = $2, licence = $3, reuse_ok = $4, qids = $5::text[], subjects = $6::text[], scenes = $7::text[], tags = $8::text[], vision_pass = $9, last_seen_at = now()
      WHERE id = $1`,
    [photoId, m.credit, m.licence, m.reuse_ok, m.qids, m.subjects, m.scenes, m.tags, m.vision_pass],
  );
}
