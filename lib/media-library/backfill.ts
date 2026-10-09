/**
 * Photos already published, into the bank (DECISIONS_LOG D49): the rows of
 * social.used_photos (and, optionally, the pre-database file log
 * 'Claude outputs/social-used-photos.json'), as `used` sightings plus pending
 * sources for the ones the policy keeps.
 *
 *   lane       from the row's source (stock → openverse, or stocksnap when
 *              the credit says so; commons → headshot; the rest as named)
 *   vision     a carousel's stock or Commons-search photo passed its
 *              close-up check to be published: vision_pass is inferred
 *              (vision.inferred = true). Stories never ran that check.
 *   licence    the same pass as live offers, with the row's verified subject
 *              (and an official image's company, from its "Image: X" credit)
 *              as the brief; an article photo credited to a company the row
 *              doesn't name is not stored
 *   watermark  media_library.settings.used_photos_after_id: the last row
 *              imported, so the next import starts after it (rows chosen by
 *              --since don't move it)
 *
 * Idempotent: sightings and sources are upserts. The bank's drain() runs
 * the same import (passive), a bounded batch at a time.
 */
import { laneForUsedSource, licenceOf, shouldStore } from './policy';
import { writeRows } from './store';
import type { BankRows, Query, SightingRow, SourceRow } from './types';

export type UsedRow = {
  id?: number | string | null;
  url: string;
  used_at: string | Date;
  story_id: string;
  slide: number;
  source?: string | null;
  qid?: string | null;
  subject?: string | null;
  credit?: string | null;
  scene?: string | null;
};

/** The file log's entries (lib/social/photos/used-photos.ts UsedPhoto) as rows. */
export function fromFileEntries(entries: Array<{ url: string; usedAt: string; storyId: string; slide: number; source?: string; qid?: string | null; subject?: string | null; credit?: string; scene?: string }>): UsedRow[] {
  return entries.filter((e) => e?.url).map((e) => ({ id: null, url: e.url, used_at: e.usedAt, story_id: e.storyId, slide: e.slide, source: e.source ?? null, qid: e.qid ?? null, subject: e.subject ?? null, credit: e.credit ?? null, scene: e.scene ?? null }));
}

const isStories = (storyId: string) => storyId.startsWith('stories:');
/** Unverified lanes a carousel only published after the close-up check. */
const CLOSE_UP_LANES = new Set(['stocksnap', 'openverse', 'commons-search']);

export type PlannedUsed = BankRows & { skipped: Array<{ url: string; reason: string }> };

/** used_photos rows as bank rows. Pure. */
export function planUsedRows(rows: UsedRow[]): PlannedUsed {
  const out: PlannedUsed = { sources: [], sightings: [], skipped: [] };
  for (const r of rows) {
    if (!r.url) continue;
    const at = r.used_at instanceof Date ? r.used_at.toISOString() : new Date(r.used_at).toISOString();
    const lane = laneForUsedSource(r.source, r.credit);
    const carousel = !isStories(r.story_id);
    const scene = r.scene?.trim() || null;
    const sighting: SightingRow = {
      url: r.url,
      run_kind: 'backfill',
      run_ref: r.story_id,
      slide: Number(r.slide) || 0,
      request_query: scene ?? r.subject?.trim() ?? '',
      request_kind: null,
      request_qid: r.qid ?? null,
      qid: r.qid ?? null,
      subject: r.qid ? (r.subject ?? null) : null,
      verified: Boolean(r.qid),
      outcome: 'used',
      vision: carousel && lane && CLOSE_UP_LANES.has(lane) ? { scene: scene ?? '', pass: true, inferred: true } : null,
      tile_tags: [],
      fit: null,
      faces: null,
      plate: null,
      at,
    };
    out.sightings.push(sighting);
    const credit = r.credit?.trim() ?? '';
    // The official image's company, from the credit code wrote ("Image: <Company>"); otherwise only the row's subject.
    const official = r.source === 'official' ? /^Image:\s*(.+)$/.exec(credit)?.[1]?.trim() : undefined;
    const subjects = [r.subject, official].filter((s): s is string => !!s);
    const licence = licenceOf({ url: r.url, credit, source: r.source && lane ? r.source : 'stock' }, subjects);
    if (!shouldStore('used', { lane, verified: Boolean(r.qid) }, licence) || !licence.licence) {
      out.skipped.push({ url: r.url, reason: licence.reason });
      continue;
    }
    const src: SourceRow = { url: r.url, source: r.source ?? null, lane, title: scene ?? r.subject ?? null, date: null, credit, licence: licence.licence, reuse_ok: licence.reuseOk };
    out.sources.push(src);
  }
  return out;
}

export async function readWatermark(query: Query): Promise<number> {
  const { rows } = await query(`SELECT value FROM media_library.settings WHERE key = 'used_photos_after_id'`);
  const n = Number(rows[0]?.value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Move the watermark forward only (never back). */
export async function advanceWatermark(query: Query, id: number): Promise<void> {
  await query(
    `INSERT INTO media_library.settings (key, value, updated_at) VALUES ('used_photos_after_id', to_jsonb($1::bigint), now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      WHERE COALESCE((media_library.settings.value #>> '{}')::bigint, 0) < $1::bigint`,
    [id],
  );
}

export type ImportResult = { read: number; sightings: number; sources: number; skipped: Array<{ url: string; reason: string }>; watermark: number | null; dryRun: boolean };

/**
 * Import used photos. Default: social.used_photos rows past the watermark,
 * in id order, at most `limit`, then the watermark moves to the last one.
 * `since`: rows used at or after that time instead (the watermark stays).
 * `file`: extra rows from the file log (no ids). `dryRun`: plan only.
 */
export async function importUsedPhotos(query: Query, opts: { limit?: number; since?: Date; dryRun?: boolean; fileRows?: UsedRow[]; log?: (line: string) => void } = {}): Promise<ImportResult> {
  const limit = Math.max(1, opts.limit ?? 500);
  const exists = await query(`SELECT to_regclass('social.used_photos') IS NOT NULL AS ok`);
  let rows: UsedRow[] = [];
  let lastId: number | null = null;
  if (exists.rows[0]?.ok) {
    const cols = `id, url, used_at, story_id, slide, source, qid, subject, credit, scene`;
    if (opts.since) {
      rows = (await query(`SELECT ${cols} FROM social.used_photos WHERE used_at >= $1 ORDER BY id LIMIT $2`, [opts.since.toISOString(), limit])).rows as UsedRow[];
    } else {
      const after = await readWatermark(query);
      rows = (await query(`SELECT ${cols} FROM social.used_photos WHERE id > $1 ORDER BY id LIMIT $2`, [after, limit])).rows as UsedRow[];
      lastId = rows.length ? Number(rows[rows.length - 1]!.id) : null;
    }
  }
  const all = [...rows, ...(opts.fileRows ?? [])];
  const plan = planUsedRows(all);
  if (!opts.dryRun) {
    if (plan.sightings.length || plan.sources.length) await writeRows(query, plan);
    if (lastId !== null) await advanceWatermark(query, lastId);
  }
  return { read: all.length, sightings: plan.sightings.length, sources: plan.sources.length, skipped: plan.skipped, watermark: lastId, dryRun: Boolean(opts.dryRun) };
}
