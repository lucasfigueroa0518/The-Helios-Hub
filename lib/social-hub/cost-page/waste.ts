import type { HubQuery } from '@/lib/social-hub/db';

export type Waste = { rejected: number; failed: number; expired: number; selection: number; spend: number };
export type WasteInput = {
  itemMicros: Map<string, number>; firstDay: Map<string, string>;
  published: Set<string>; rejected: Set<string>; failed: Set<string>; inFlight: Set<string>; filtered: Set<string>;
  unattributedMicros: number; now: Date; spendMicros: number;
};

const EXPIRE_DAYS = 7;

/** Pure. Rejected wins over failed; anything unshipped, not in flight and older than 7 days is expired. */
export function classifyWaste(i: WasteInput): Waste {
  const w: Waste = { rejected: 0, failed: 0, expired: 0, selection: i.unattributedMicros, spend: i.spendMicros };
  const cutoff = new Date(i.now.getTime() - EXPIRE_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const [item, micros] of i.itemMicros) {
    if (i.published.has(item)) continue;
    if (i.filtered.has(item)) w.selection += micros;
    else if (i.rejected.has(item)) w.rejected += micros;
    else if (i.failed.has(item)) w.failed += micros;
    else if (!i.inFlight.has(item) && (i.firstDay.get(item) ?? '9999') < cutoff) w.expired += micros;
  }
  return w;
}

/**
 * Item keys (matching lib/social-hub/queries/costs.ts buildLedger) for rejected, regenerated, failed and filtered items.
 * Regenerated (an earlier unpublished attempt at the same idea) counts as rejected.
 */
export async function wasteSets(q: HubQuery, eq: HubQuery | null): Promise<{ rejected: Set<string>; failed: Set<string>; filtered: Set<string> }> {
  const rejected = new Set<string>();
  const failed = new Set<string>();
  const filtered = new Set<string>();
  const spine = await q<{ vertical: string; native_ref: string; idea_ref: string | null }>(
    `SELECT ci.vertical, ci.native_ref, ci.idea_ref FROM social_hub.approvals a JOIN social_hub.content_items ci ON ci.id = a.content_item_id WHERE a.decision = 'rejected'`,
  );
  const reelVideoIds: string[] = [];
  for (const r of spine.rows) {
    if (r.vertical === 'explainers') rejected.add(`explainers:${r.native_ref}`);
    if (r.vertical === 'stories') rejected.add(`stories:${r.native_ref}`);
    if (r.vertical === 'carousels' && r.idea_ref) rejected.add(`carousels:story:${r.idea_ref}`);
    if (r.vertical === 'reels') reelVideoIds.push(r.native_ref);
  }
  if (reelVideoIds.length) {
    const v = await q<{ post_idea_id: string; slate_id: string | null }>(
      `SELECT post_idea_id::text, slate_id::text FROM reels.video_jobs WHERE id::text = ANY($1::text[])`, [reelVideoIds],
    );
    for (const r of v.rows) rejected.add(`reels:${r.post_idea_id}:${r.slate_id ?? 'none'}`);
  }
  for (const r of (await q<{ id: string }>(`SELECT id::text FROM stories.sets WHERE status = 'rejected'`)).rows) rejected.add(`stories:${r.id}`);
  for (const r of (await q<{ id: string }>(`SELECT id::text FROM stories.sets WHERE status = 'failed'`)).rows) failed.add(`stories:${r.id}`);
  for (const r of (await q<{ i: string; s: string | null }>(`SELECT post_idea_id::text AS i, slate_id::text AS s FROM reels.video_jobs WHERE status = 'failed'`)).rows) failed.add(`reels:${r.i}:${r.s ?? 'none'}`);
  // Regenerated reels: an idea with more than one slate; every slate but the newest is an earlier attempt.
  for (const r of (await q<{ i: string; s: string | null }>(
    `SELECT post_idea_id::text AS i, slate_id::text AS s FROM (
       SELECT post_idea_id, slate_id, row_number() OVER (PARTITION BY post_idea_id ORDER BY max(finished_at) DESC NULLS LAST) AS rn
         FROM reels.video_jobs GROUP BY post_idea_id, slate_id) x WHERE rn > 1`,
  )).rows) rejected.add(`reels:${r.i}:${r.s ?? 'none'}`);
  for (const r of (await q<{ story_id: string; kind: string }>(`SELECT DISTINCT story_id, kind FROM social.set_asides`)).rows) {
    (r.kind === 'pipeline-fault' ? failed : filtered).add(`carousels:story:${r.story_id}`);
  }
  if (eq) {
    for (const r of (await eq<{ job_id: string }>(`SELECT job_id::text FROM explainers.feedback WHERE verdict = 'rejected'`)).rows) rejected.add(`explainers:${r.job_id}`);
    for (const r of (await eq<{ id: string }>(`SELECT id::text FROM explainers.jobs WHERE status = 'failed'`)).rows) failed.add(`explainers:${r.id}`);
    // Regenerated explainers: earlier jobs for a topic that has a later job.
    for (const r of (await eq<{ id: string }>(
      `SELECT id::text FROM (SELECT id, row_number() OVER (PARTITION BY topic_id ORDER BY requested_at DESC) AS rn FROM explainers.jobs) x WHERE rn > 1`,
    )).rows) rejected.add(`explainers:${r.id}`);
  }
  return { rejected, failed, filtered };
}
