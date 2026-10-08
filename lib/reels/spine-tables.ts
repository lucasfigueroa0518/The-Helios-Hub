/**
 * Trial Reels' lifecycle rows on the spine (social_hub, D39), in the shape the
 * old reels.publish_attempts / posting_schedule / media_insights had. Readers
 * (analytics, scoring, health, the hub) select from these instead of the old
 * tables; writers write the spine directly. Constants only (no imports), so
 * read code can use them freely.
 *
 * A Reels item is the video: video_job_id = the item's native_ref (NULL for a
 * record whose video was already gone when it was copied), post_idea_id = its
 * idea_ref. A slot booked before any video carries only its idea_ref.
 */

const VIDEO_ID = (ref: string) => `CASE WHEN ${ref} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN ${ref}::uuid END`;

/** reels.publish_attempts, from the spine. Use with an alias: `FROM ${REEL_ATTEMPTS} a`. */
export const REEL_ATTEMPTS = `(
  SELECT a.id, a.content_item_id,
         ${VIDEO_ID('ci.native_ref')} AS video_job_id,
         ci.idea_ref::uuid AS post_idea_id,
         (a.payload->>'song_pick_id')::uuid AS song_pick_id,
         a.trigger, a.status, a.requested_at, a.started_at, a.finished_at,
         a.payload->>'audio_id' AS audio_id,
         a.payload->>'song_title' AS song_title,
         a.payload->>'song_artist' AS song_artist,
         (a.payload->>'audio_volume')::int AS audio_volume,
         (a.payload->>'video_volume')::int AS video_volume,
         a.caption,
         a.payload->>'graduation_strategy' AS graduation_strategy,
         (a.payload->>'share_to_feed')::boolean AS share_to_feed,
         a.container_id, a.media_id, a.permalink, a.status_log, a.error,
         a.insights_checked_at, a.insights_settled_at
    FROM social_hub.publish_attempts a
    JOIN social_hub.content_items ci ON ci.id = a.content_item_id
   WHERE a.vertical = 'reels'
)`;

/** reels.posting_schedule, from the spine (approved_at: the slot's own approval). Use with an alias. */
export const REEL_SCHEDULE = `(
  SELECT s.id, s.content_item_id,
         s.idea_ref::uuid AS post_idea_id,
         ${VIDEO_ID('ci.native_ref')} AS video_job_id,
         s.ny_date, s.slot, s.publish_at, s.status, s.source, s.publish_attempt_id, s.error,
         s.created_at, s.approved_at
    FROM social_hub.schedule s
    LEFT JOIN social_hub.content_items ci ON ci.id = s.content_item_id
   WHERE s.vertical = 'reels'
)`;

/** reels.media_insights, from the spine. Use with an alias. */
export const REEL_INSIGHTS = `(
  SELECT media_id, ny_date, publish_attempt_id, captured_at,
         views, reach, likes, comments, saved, shares, reposts, total_interactions,
         avg_watch_time_ms, total_watch_time_ms, skip_rate, shared_to_feed AS is_shared_to_feed, raw
    FROM social_hub.media_insights
   WHERE vertical = 'reels'
)`;
