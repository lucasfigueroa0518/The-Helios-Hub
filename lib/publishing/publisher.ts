import type { PublishDriver } from './drivers/types';
import type { SpineQuery, SpineVertical } from '@/lib/social-hub/spine';

/**
 * The single publisher (unification Move 6, D40). Every content type places
 * its own content on the calendar; the publisher does the rest for all of
 * them against one Instagram account: due slots become attempts (each type's
 * rules, through its driver), then ONE attempt at a time across every type is
 * carried to Instagram, oldest first, through the account gate.
 *
 * `publisher_mode` (social_hub.settings) decides who posts:
 *   off    – each type's own worker loop, as before; the publisher idles.
 *   shadow – the publisher only reads and logs what it would do; the type
 *            workers still post. Compare a day of logs before going live.
 *   live   – the publisher posts and polls insights; the type workers stand
 *            down while its heartbeat says it drives their type.
 * Both may run at once safely: every release is a guarded UPDATE and a post
 * can be published only once (publish_once). Two claimers racing in the same
 * instant can each start a different post (the in-flight check reads a
 * snapshot), as two type workers could before; once live, the publisher is
 * the only claimer. In-flight attempts older than the 30-minute stale limit
 * never block a claim, so one type's crash can't stop every type.
 */

export type PublisherMode = 'off' | 'shadow' | 'live';

export async function publisherMode(query: SpineQuery): Promise<PublisherMode> {
  try {
    const { rows } = await query(`SELECT value FROM social_hub.settings WHERE key = 'publisher_mode'`);
    const value = rows[0]?.value;
    return value === 'shadow' || value === 'live' ? value : 'off';
  } catch {
    return 'off';
  }
}

/** A live publisher that has not reported for this long is treated as gone: the type workers resume. */
export const HEARTBEAT_STALE_MS = 5 * 60_000;

/** The publisher reports each pass which types it drives (social_hub.settings `publisher_heartbeat`). */
export async function recordHeartbeat(query: SpineQuery, verticals: readonly SpineVertical[], now = new Date()): Promise<void> {
  await query(
    `INSERT INTO social_hub.settings (key, value, updated_at) VALUES ('publisher_heartbeat', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
    [JSON.stringify({ at: now.toISOString(), verticals })],
  );
}

/**
 * A type worker asks this before its own release / publish / insights steps.
 * It stands down only when the publisher is live AND has reported in the last
 * few minutes that it drives this type (D41): a publisher that is down, or
 * that cannot reach this type's database, never leaves the type unposted.
 */
export async function publisherOwnsPublishing(query: SpineQuery, vertical: SpineVertical, now = new Date()): Promise<boolean> {
  if ((await publisherMode(query)) !== 'live') return false;
  try {
    const { rows } = await query(`SELECT value FROM social_hub.settings WHERE key = 'publisher_heartbeat'`);
    const beat = rows[0]?.value as { at?: string; verticals?: string[] } | undefined;
    if (!beat?.at || !Array.isArray(beat.verticals)) return false;
    return now.getTime() - Date.parse(beat.at) < HEARTBEAT_STALE_MS && beat.verticals.includes(vertical);
  } catch {
    return false;
  }
}

/** The oldest queued attempt among `verticals`, claimed only while nothing is in flight on the account. */
export async function claimNextAttempt(query: SpineQuery, verticals: readonly SpineVertical[]): Promise<{ id: string; vertical: SpineVertical } | null> {
  if (verticals.length === 0) return null;
  const { rows } = await query(
    `UPDATE social_hub.publish_attempts SET status = 'creating', started_at = now()
      WHERE id = (
        SELECT id FROM social_hub.publish_attempts
         WHERE status = 'requested' AND vertical = ANY($1::text[])
           AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing') AND a.started_at > now() - interval '30 minutes')
         ORDER BY requested_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id, vertical`,
    [verticals],
  );
  return rows[0] ? { id: rows[0].id as string, vertical: rows[0].vertical as SpineVertical } : null;
}

export type ShadowPlan = {
  /** Due slots and what each type's rules would do with them. */
  due: Array<{ vertical: SpineVertical; scheduleId: string; action: 'release' | 'cancel' | 'fail'; why: string }>;
  /** The attempt the publisher would carry next, if any. */
  next: { attemptId: string; vertical: SpineVertical } | null;
};

/** What a live tick would do, read only. */
export async function shadowPlan(query: SpineQuery, drivers: readonly PublishDriver[]): Promise<ShadowPlan> {
  const live: PublishDriver[] = [];
  for (const d of drivers) if (await d.live()) live.push(d);
  const verticals = live.map((d) => d.vertical);
  const due: ShadowPlan['due'] = [];
  if (verticals.length > 0) {
    const { rows } = await query(
      `SELECT s.id, s.vertical,
              -- A rejection wins; Trial Reels may approve the idea's slot before its video exists (D39).
              CASE WHEN a.decision = 'rejected' THEN 'rejected' WHEN s.approved_at IS NOT NULL THEN 'approved' ELSE a.decision END AS decision
         FROM social_hub.schedule s
         LEFT JOIN social_hub.approvals a ON a.content_item_id = s.content_item_id
        WHERE s.status = 'scheduled' AND s.publish_at <= now() AND s.vertical = ANY($1::text[])
        ORDER BY s.publish_at`,
      [verticals],
    );
    for (const row of rows) {
      const driver = live.find((d) => d.vertical === row.vertical)!;
      const needs = await driver.requireApproval();
      // Each type's own outcome for content it may not post: Carousels cancel the slot, Explainers fail it.
      const refuse = driver.refusesAtRelease;
      if (row.decision === 'rejected') due.push({ vertical: row.vertical, scheduleId: row.id, action: refuse, why: 'rejected' });
      else if (needs && row.decision !== 'approved') due.push({ vertical: row.vertical, scheduleId: row.id, action: refuse, why: 'not approved' });
      else due.push({ vertical: row.vertical, scheduleId: row.id, action: 'release', why: row.decision === 'approved' ? 'approved' : 'approval not required' });
    }
  }
  const { rows: next } = await query(
    `SELECT id, vertical FROM social_hub.publish_attempts
      WHERE status = 'requested' AND vertical = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing') AND a.started_at > now() - interval '30 minutes')
      ORDER BY requested_at LIMIT 1`,
    [verticals],
  );
  return { due, next: next[0] ? { attemptId: next[0].id, vertical: next[0].vertical } : null };
}

export type TickResult =
  | { mode: 'off' }
  | { mode: 'shadow'; plan: ShadowPlan }
  | { mode: 'live'; released: number; published: { id: string; vertical: SpineVertical; status: 'published' | 'failed' } | null };

/** One publisher pass. */
export async function publisherTick(query: SpineQuery, drivers: readonly PublishDriver[]): Promise<TickResult> {
  const mode = await publisherMode(query);
  if (mode === 'off') return { mode };
  if (mode === 'shadow') return { mode, plan: await shadowPlan(query, drivers) };

  const live: PublishDriver[] = [];
  for (const d of drivers) if (await d.live()) live.push(d);
  let released = 0;
  for (const d of live) {
    await d.failStale();
    released += await d.releaseDue();
  }
  const claimed = await claimNextAttempt(query, live.map((d) => d.vertical));
  if (!claimed) return { mode, released, published: null };
  const driver = live.find((d) => d.vertical === claimed.vertical)!;
  const out = await driver.carry(claimed.id);
  return { mode, released, published: { id: out.id, vertical: claimed.vertical, status: out.status } };
}
