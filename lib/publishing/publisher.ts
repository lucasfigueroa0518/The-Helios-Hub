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
 *   live   – the publisher posts and polls insights; the type workers stand down.
 * Both may run at once safely: every release and claim is a guarded UPDATE,
 * and a post can be published only once (publish_once).
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

/** A type worker asks this before its own release / publish / insights steps. */
export async function publisherOwnsPublishing(query: SpineQuery): Promise<boolean> {
  return (await publisherMode(query)) === 'live';
}

/** The oldest queued attempt among `verticals`, claimed only while nothing is in flight on the account. */
export async function claimNextAttempt(query: SpineQuery, verticals: readonly SpineVertical[]): Promise<{ id: string; vertical: SpineVertical } | null> {
  if (verticals.length === 0) return null;
  const { rows } = await query(
    `UPDATE social_hub.publish_attempts SET status = 'creating', started_at = now()
      WHERE id = (
        SELECT id FROM social_hub.publish_attempts
         WHERE status = 'requested' AND vertical = ANY($1::text[])
           AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing'))
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
  due: Array<{ vertical: SpineVertical; scheduleId: string; action: 'release' | 'cancel'; why: string }>;
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
      `SELECT s.id, s.vertical, a.decision
         FROM social_hub.schedule s
         LEFT JOIN social_hub.approvals a ON a.content_item_id = s.content_item_id
        WHERE s.status = 'scheduled' AND s.publish_at <= now() AND s.vertical = ANY($1::text[])
        ORDER BY s.publish_at`,
      [verticals],
    );
    for (const row of rows) {
      const driver = live.find((d) => d.vertical === row.vertical)!;
      const needs = await driver.requireApproval();
      if (row.decision === 'rejected') due.push({ vertical: row.vertical, scheduleId: row.id, action: 'cancel', why: 'rejected' });
      else if (needs && row.decision !== 'approved') due.push({ vertical: row.vertical, scheduleId: row.id, action: 'cancel', why: 'not approved' });
      else due.push({ vertical: row.vertical, scheduleId: row.id, action: 'release', why: row.decision === 'approved' ? 'approved' : 'approval not required' });
    }
  }
  const { rows: next } = await query(
    `SELECT id, vertical FROM social_hub.publish_attempts
      WHERE status = 'requested' AND vertical = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing'))
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
