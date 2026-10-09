import type { SpineQuery } from '@/lib/social-hub/spine';

import type { InstagramContainerOps } from './graph';

/**
 * The account gate (unification Move 5, D40): every content type posts to one
 * Instagram account with one rolling 24-hour publishing limit. Before any
 * container is made, the publisher asks here once: is there room for `need`
 * posts (a Story set needs one per frame) and still `reserve` left over?
 * Each answer is recorded in social_hub.publishing_quota, so the hub shows
 * the real number instead of parsing it out of error text.
 */

export const DEFAULT_QUOTA_RESERVE = 5;

export type GateResult = { ok: true; left: number | null } | { ok: false; message: string };

/** The account's quota reserve (social_hub.settings `quota_reserve`), else the default. */
export async function quotaReserve(query: SpineQuery | null): Promise<number> {
  if (!query) return DEFAULT_QUOTA_RESERVE;
  try {
    const { rows } = await query(`SELECT value FROM social_hub.settings WHERE key = 'quota_reserve'`);
    const value = Number(rows[0]?.value);
    return Number.isInteger(value) && value >= 0 ? value : DEFAULT_QUOTA_RESERVE;
  } catch {
    return DEFAULT_QUOTA_RESERVE;
  }
}

export async function checkAccountQuota(input: {
  ops: Pick<InstagramContainerOps, 'publishingLimit'>;
  /** Posts this publish uses: 1, or one per Story frame. */
  need?: number;
  /** Where to read the reserve and record the reading; null in tests that only check the rule. */
  query?: SpineQuery | null;
  reserve?: number;
}): Promise<GateResult> {
  const need = input.need ?? 1;
  const reserve = input.reserve ?? (await quotaReserve(input.query ?? null));
  const limit = await input.ops.publishingLimit();
  if (input.query) {
    // captured_at is the key: a reading taken in the same clock tick as the last one (two
    // workers at once, or a coarse clock) gets the next millisecond instead of being dropped.
    await input.query(
      `INSERT INTO social_hub.publishing_quota (captured_at, quota_usage, quota_total)
       SELECT GREATEST(clock_timestamp(), (SELECT max(captured_at) FROM social_hub.publishing_quota) + interval '1 millisecond'), $1, $2
       ON CONFLICT DO NOTHING`,
      [limit.quotaUsage, limit.quotaTotal],
    ).catch(() => undefined);
  }
  if (limit.quotaTotal == null) return { ok: true, left: null };
  const left = limit.quotaTotal - limit.quotaUsage;
  // The hub's quota reader matches "24-hour quota" in this message.
  // One post: refused below `reserve` left (the rule every publisher had). A
  // Story set's extra frames each need room on top of that.
  if (left < reserve + (need - 1)) return { ok: false, message: `The Instagram account has ${left} of ${limit.quotaTotal} posts left in its 24-hour quota.` };
  return { ok: true, left };
}
