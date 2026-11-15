import type { Queryable } from '@/lib/explainers/db';
import { readUsedLedger, usedMatch, type LedgerReadOptions } from '@/lib/photos/used';

import { isPhash } from './filters';

/**
 * The used-photo rule (CI-32, replacing MD-45's render-time rule): a photo any post published in the last
 * `reuseDays` (20) can't appear in a reel. `db` is the database holding the one ledger (social.used_photos, the hub's
 * Supabase), not the Explainers database; the pipeline passes `deps.ledgerDb`. Character images (a person's banked
 * cutout, a company's banked logo) are exempt (MD-41; the caller leaves them out). Keys are perceptual hashes when
 * known, so a re-sized copy of a published photo counts as used; other keys (URLs) match exactly.
 */
export async function recentlyUsed(db: Queryable, assetKeys: readonly string[], reuseDays: number, now: Date): Promise<Set<string>> {
  const out = new Set<string>();
  if (!assetKeys.length || reuseDays <= 0) return out;
  const ledger = await readUsedLedger((text, params) => db.query(text, params) as Promise<{ rows: any[] }>, now, reuseDays);
  for (const key of assetKeys) {
    if (usedMatch(ledger, isPhash(key) ? { phash: key } : { url: key })) out.add(key);
  }
  return out;
}

/**
 * The candidates the ledger refuses, each checked by everything it has (CI-32: by URL and by pHash, so a candidate
 * with no pHash yet is still refused by URL). One ledger read. The caller leaves brand assets out.
 */
export async function usedCandidates<T extends { url?: string | null; phash?: string | null }>(
  db: Queryable,
  cands: readonly T[],
  reuseDays: number,
  now: Date,
  opts: LedgerReadOptions = {},
): Promise<Map<T, string>> {
  const out = new Map<T, string>();
  if (!cands.length || reuseDays <= 0) return out;
  const ledger = await readUsedLedger((text, params) => db.query(text, params) as Promise<{ rows: any[] }>, now, reuseDays, opts);
  for (const c of cands) {
    const why = usedMatch(ledger, { url: c.url, phash: c.phash });
    if (why) out.set(c, why);
  }
  return out;
}

/**
 * The item a remake must not be blocked by (Bald-Eagle D3 photo hold, lib/photos/pending.ts): the ledger holds the
 * photos of the pitch's newest finished reel while it waits to post, and a remake of that pitch (this job) would
 * otherwise refuse its own earlier pictures. That reel is the pitch's newest ok job (this one, when it is ok and the
 * newest), in the hold's own order. `db` is the drama database. Null: no earlier reel, or no job.
 */
export async function ownHeldItem(db: Queryable, jobId: string | null): Promise<{ vertical: 'reel_ai_drama'; id: string } | null> {
  if (!jobId) return null;
  const { rows } = await db.query<{ id: string }>(
    `SELECT o.id::text AS id FROM reel_ai_drama.jobs me
       JOIN reel_ai_drama.jobs o ON o.pitch_id = me.pitch_id AND o.status = 'ok'
      WHERE me.id = $1
      ORDER BY coalesce(o.finished_at, o.requested_at) DESC, o.id DESC LIMIT 1`,
    [jobId],
  );
  return rows[0] ? { vertical: 'reel_ai_drama', id: rows[0].id } : null;
}

/**
 * The reel's own record of what it rendered (reel_ai_drama.asset_uses). No longer the reuse rule's source (CI-32);
 * kept because the published-photo log reads it to know which photos a published AI Drama reel showed.
 */

export async function recordUses(
  db: Queryable,
  jobId: string,
  uses: readonly { assetKey: string; purpose: string; characterImage: boolean }[],
  now?: Date,
): Promise<void> {
  for (const u of uses) {
    await db.query(
      `INSERT INTO reel_ai_drama.asset_uses (asset_key, job_id, purpose, character_image, used_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))`,
      [u.assetKey, jobId, u.purpose, u.characterImage, now?.toISOString() ?? null],
    );
  }
}
