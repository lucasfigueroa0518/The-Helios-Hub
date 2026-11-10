import type { Queryable } from '@/lib/explainers/db';
import { readUsedLedger, usedMatch } from '@/lib/photos/used';

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
): Promise<Map<T, string>> {
  const out = new Map<T, string>();
  if (!cands.length || reuseDays <= 0) return out;
  const ledger = await readUsedLedger((text, params) => db.query(text, params) as Promise<{ rows: any[] }>, now, reuseDays);
  for (const c of cands) {
    const why = usedMatch(ledger, { url: c.url, phash: c.phash });
    if (why) out.set(c, why);
  }
  return out;
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
