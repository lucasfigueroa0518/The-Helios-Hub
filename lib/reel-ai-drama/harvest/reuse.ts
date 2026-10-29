import type { Queryable } from '@/lib/explainers/db';

import { hamming, isPhash, NEAR_DUPLICATE } from './filters';

/**
 * The 20-day rule (MD-45): a photo shown in a delivered reel can appear in another reel only after
 * `reuseDays`. Character images (a person's banked cutout, a company's banked logo) are exempt (MD-41).
 * Keys are perceptual hashes when known, so a re-sized copy of a used photo counts as used; other keys
 * (URLs, made files) match exactly.
 */

export async function recentlyUsed(db: Queryable, assetKeys: readonly string[], reuseDays: number, now: Date): Promise<Set<string>> {
  const out = new Set<string>();
  if (!assetKeys.length || reuseDays <= 0) return out;
  const since = new Date(now.getTime() - reuseDays * 86_400_000).toISOString();
  const { rows } = await db.query<{ asset_key: string }>(
    `SELECT DISTINCT asset_key FROM reel_ai_drama.asset_uses
      WHERE character_image = false AND used_at >= $1 AND used_at <= $2`,
    [since, now.toISOString()],
  );
  const used = rows.map((r) => r.asset_key);
  const exact = new Set(used);
  const hashes = used.filter(isPhash);
  for (const key of assetKeys) {
    if (exact.has(key) || (isPhash(key) && hashes.some((h) => hamming(h, key) <= NEAR_DUPLICATE))) out.add(key);
  }
  return out;
}

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
