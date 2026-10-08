/**
 * IG Stories on the lifecycle spine, as a projection (D44). `stories.sets`
 * (with its frames and captures) stays the source of truth for the Stories
 * app; after every transition the repository calls `projectSet`, which
 * rebuilds the set's place on the spine from those rows:
 *
 *   item       native_ref = set id, idea_ref = 'series:ny_date', format 'story'
 *   approval   approved_at → approved (auto series: 'auto'); rejected → rejected
 *   slot       one per set once it has a minute (slot = the series)
 *   attempt    one per set once it starts publishing; frames are the child
 *              containers; a set that stopped with frames live is 'partial'
 *   insights   each frame's latest capture of the day; navigation and `final`
 *              in `extra`
 *
 * Rebuilt, never patched, so it can't drift: re-running it for every set is
 * the backfill. What the account sees from it: other types never start a post
 * while a Story set is publishing, and the hub reads one identity per post.
 */
import type { Queryable } from '@/lib/stories/db';
import { approveItem, clearDecision, ensureContentItem, rejectItem, type SpineQuery } from '@/lib/social-hub/spine';

const spineOf = (db: Queryable): SpineQuery => (text, params) => db.query(text, params) as ReturnType<SpineQuery>;

/** Set statuses after which the set has a minute on the calendar, and what that slot shows. */
const SLOT_STATUS: Record<string, string> = {
  scheduled: 'scheduled',
  publishing: 'publishing',
  published: 'published',
  failed: 'failed',
  rejected: 'cancelled',
  skipped: 'cancelled',
};

/** A failure from the publish step (stage prefix written by the worker), not from building. */
const PUBLISH_FAILURE = /^(quota|container|publish|frames without)/;

export async function projectSet(db: Queryable, setId: string): Promise<void> {
  const { rows } = await db.query<{
    id: string; series: string; ny_date: string; status: string; trigger: string;
    publish_at: string | null; approved_at: string | null; published_at: string | null; updated_at: string; error: string | null;
  }>(
    `SELECT id::text AS id, series, to_char(ny_date, 'YYYY-MM-DD') AS ny_date, status, trigger,
            publish_at::text AS publish_at, approved_at::text AS approved_at, published_at::text AS published_at,
            updated_at::text AS updated_at, error
       FROM stories.sets WHERE id = $1`,
    [setId],
  );
  const set = rows[0];
  if (!set) return;
  const spine = spineOf(db);
  const itemId = await ensureContentItem(spine, { vertical: 'stories', format: 'story', nativeRef: set.id, ideaRef: `${set.series}:${set.ny_date}` });

  if (set.status === 'rejected') await rejectItem(spine, itemId);
  else if (set.approved_at) await approveItem(spine, itemId, set.trigger === 'auto' ? 'auto' : 'user');
  else await clearDecision(spine, itemId);

  const { rows: frames } = await db.query<{ id: string; seq: number; ig_container_id: string | null; ig_media_id: string | null }>(
    `SELECT id::text AS id, seq, ig_container_id, ig_media_id FROM stories.frames WHERE set_id = $1 ORDER BY seq`,
    [setId],
  );
  const live = frames.filter((f) => f.ig_media_id);
  const tried = set.status === 'publishing' || set.status === 'published'
    || (set.status === 'failed' && (frames.some((f) => f.ig_container_id) || PUBLISH_FAILURE.test(set.error ?? '')));

  let attemptId: string | null = null;
  if (tried) {
    const status = set.status === 'failed' ? (live.length > 0 ? 'partial' : 'failed') : set.status;
    const payload = { frames: frames.map((f) => ({ frame_id: f.id, seq: f.seq, container_id: f.ig_container_id, media_id: f.ig_media_id })) };
    const finished = status === 'publishing' ? null : set.published_at ?? set.updated_at;
    const { rows: attempt } = await db.query<{ id: string }>(
      `INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, requested_at, started_at, finished_at,
              caption, payload, child_container_ids, media_id, error, legacy_id)
       VALUES ($1, 'stories', $2, $3, coalesce($4::timestamptz, now()), now(), $5::timestamptz, '', $6::jsonb, $7::jsonb, $8, $9, $10::uuid)
       ON CONFLICT (legacy_id) DO UPDATE SET status = excluded.status, finished_at = excluded.finished_at, payload = excluded.payload,
              child_container_ids = excluded.child_container_ids, media_id = excluded.media_id, error = excluded.error
       RETURNING id`,
      [itemId, set.trigger === 'auto' ? 'auto' : 'approve', status, set.publish_at, finished, JSON.stringify(payload),
        JSON.stringify(frames.map((f) => f.ig_container_id).filter(Boolean)), live[0]?.ig_media_id ?? null,
        status === 'failed' || status === 'partial' ? set.error : null, set.id],
    );
    attemptId = attempt[0]!.id;
  }

  const slotStatus = SLOT_STATUS[set.status];
  if (set.publish_at && slotStatus) {
    await db.query(
      `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, publish_attempt_id, error, legacy_id)
       VALUES ($1, 'stories', $2::date, $3, $4::timestamptz, $5, $6, $7, $8, $9::uuid)
       ON CONFLICT (legacy_id) DO UPDATE SET ny_date = excluded.ny_date, publish_at = excluded.publish_at, status = excluded.status,
              publish_attempt_id = excluded.publish_attempt_id, error = excluded.error`,
      [itemId, set.ny_date, set.series, set.publish_at, slotStatus, set.trigger === 'auto' ? 'auto' : 'user', attemptId,
        slotStatus === 'failed' || slotStatus === 'cancelled' ? set.error : null, set.id],
    );
  }

  if (attemptId && live.length > 0) {
    await db.query(
      `INSERT INTO social_hub.media_insights (media_id, ny_date, vertical, publish_attempt_id, captured_at, views, reach, shares,
              follows, profile_visits, total_interactions, extra, raw)
       SELECT DISTINCT ON (f.ig_media_id, (i.captured_at AT TIME ZONE 'America/New_York')::date)
              f.ig_media_id, (i.captured_at AT TIME ZONE 'America/New_York')::date, 'stories', $2, i.captured_at,
              i.views, i.reach, i.shares, i.follows, i.profile_visits, i.total_interactions,
              jsonb_build_object('replies', i.replies, 'taps_forward', i.taps_forward, 'taps_back', i.taps_back,
                                 'exits', i.exits, 'swipe_forward', i.swipe_forward, 'final', i.final, 'seq', f.seq),
              i.raw
         FROM stories.insights i JOIN stories.frames f ON f.id = i.frame_id
        WHERE f.set_id = $1 AND f.ig_media_id IS NOT NULL
        ORDER BY f.ig_media_id, (i.captured_at AT TIME ZONE 'America/New_York')::date, i.captured_at DESC
       ON CONFLICT (media_id, ny_date) DO UPDATE SET captured_at = excluded.captured_at, views = excluded.views, reach = excluded.reach,
              shares = excluded.shares, follows = excluded.follows, profile_visits = excluded.profile_visits,
              total_interactions = excluded.total_interactions, extra = excluded.extra, raw = excluded.raw`,
      [setId, attemptId],
    );
  }
}

/** Another type's post is in flight on the account (fresh, not a stale leftover): a Story set waits its turn. */
export async function accountBusy(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ busy: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM social_hub.publish_attempts
                     WHERE vertical <> 'stories' AND status IN ('creating', 'processing', 'publishing')
                       AND started_at > now() - interval '30 minutes') AS busy`,
  );
  return rows[0]?.busy === true;
}

/** The backfill: project every set (idempotent). */
export async function projectAllSets(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string }>(`SELECT id::text AS id FROM stories.sets ORDER BY created_at`);
  for (const row of rows) await projectSet(db, row.id);
  return rows.length;
}
