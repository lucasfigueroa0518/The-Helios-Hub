import { dbQuery } from '@/lib/db';
import { REEL_ATTEMPTS, REEL_INSIGHTS, REEL_SCHEDULE } from '@/lib/reels/spine-tables';
import {
  PERFORMANCE_DRILL_LIMIT,
  PERFORMANCE_PAGE_SIZE,
  buildFactors,
  buildHeadlines,
  hasPerformanceNumbers,
  pageSlice,
  parseMotionFactors,
  performancePageNumber,
  performancePeriod,
  performanceQuery,
  performanceSort,
  periodDays,
  publishedSince,
  reelTitle,
  sortReels,
  withHistory,
  type InsightsNotice,
  type PerformancePage,
  type PerformanceReel,
  type PerformanceSnapshot,
} from '@/lib/reels/analytics/performance';
import { getSetting } from '@/lib/reels/music/store';
import { INSIGHTS_POLL_SETTING, type InsightsPollStatus } from '@/lib/reels/media-insights/poll';
import { colorProfileOrNoir } from '@/lib/reels/visual/color';
import { resolveSlot, slotCaption } from '@/lib/reels/publish/slots';

type AttemptRow = {
  attempt_id: string;
  media_id: string;
  post_idea_id: string;
  video_job_id: string | null;
  finished_at: Date | string;
  permalink: string | null;
  song_title: string | null;
  song_artist: string | null;
  motion_prompt: string | null;
  video_storage_path: string | null;
  visual_render: { colorProfile?: string } | null;
  audio_type: string | null;
  genre: string | null;
  schedule_slot: string | null;
  chosen_framework: string | null;
  chosen_bucket: string | null;
  blockbuster: number | string | null;
  net: number | string | null;
  origin: string | null;
  on_screen_copy: string | null;
  full_story_below: boolean | null;
  headline: string | null;
  graduation_strategy: string | null;
  ny_date: string | null;
  views: number | string | null;
  reach: number | string | null;
  likes: number | string | null;
  comments: number | string | null;
  saved: number | string | null;
  shares: number | string | null;
  reposts: number | string | null;
  total_interactions: number | string | null;
  avg_watch_time_ms: number | string | null;
  total_watch_time_ms: number | string | null;
  skip_rate: number | string | null;
  is_shared_to_feed: boolean | null;
};

type InsightRow = {
  media_id: string;
  ny_date: string;
  views: number | string | null;
  reach: number | string | null;
  likes: number | string | null;
  comments: number | string | null;
  saved: number | string | null;
  shares: number | string | null;
  reposts: number | string | null;
  total_interactions: number | string | null;
  avg_watch_time_ms: number | string | null;
  total_watch_time_ms: number | string | null;
  skip_rate: number | string | null;
  is_shared_to_feed: boolean | null;
};

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function notice(value: InsightsPollStatus | null): InsightsNotice | null {
  if (!value || typeof value !== 'object') return null;
  const blocked = value.blocked;
  if (blocked !== 'permission' && blocked !== 'token' && blocked !== 'unconfigured' && blocked !== null) return null;
  return {
    blocked,
    message: typeof value.message === 'string' ? value.message : null,
  };
}

function snapshot(row: InsightRow): PerformanceSnapshot {
  return {
    nyDate: row.ny_date,
    views: num(row.views),
    reach: num(row.reach),
    likes: num(row.likes),
    comments: num(row.comments),
    saved: num(row.saved),
    shares: num(row.shares),
    reposts: num(row.reposts),
    totalInteractions: num(row.total_interactions),
    avgWatchTimeMs: num(row.avg_watch_time_ms),
    totalWatchTimeMs: num(row.total_watch_time_ms),
    skipRate: num(row.skip_rate),
    sharedToFeed: typeof row.is_shared_to_feed === 'boolean' ? row.is_shared_to_feed : null,
  };
}

export async function loadPerformancePage(
  params: { period?: string; sort?: string; q?: string; page?: string },
  now = new Date(),
): Promise<PerformancePage> {
  const period = performancePeriod(params.period);
  const sort = performanceSort(params.sort);
  const query = performanceQuery(params.q);
  const since = publishedSince(periodDays(period), now);
  const reels = await loadPublishedReels(since, now, query);
  const sorted = sortReels(reels, sort);
  const visible = pageSlice(sorted, performancePageNumber(params.page), PERFORMANCE_PAGE_SIZE);
  const pageReels = await hydrateReelPage(visible.items);
  const poll = notice(await getSetting<InsightsPollStatus>(INSIGHTS_POLL_SETTING));
  return {
    period,
    sort,
    query,
    page: visible.page,
    pageCount: visible.pageCount,
    pageSize: PERFORMANCE_PAGE_SIZE,
    total: sorted.length,
    reels: pageReels,
    headlines: buildHeadlines(sorted, PERFORMANCE_DRILL_LIMIT),
    factors: buildFactors(sorted),
    hasNumbers: hasPerformanceNumbers(sorted),
    poll,
  };
}

function likePattern(query: string): string | null {
  if (!query) return null;
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

async function loadPublishedReels(since: Date | null, now: Date, query: string): Promise<PerformanceReel[]> {
  const { rows } = await dbQuery<AttemptRow>(
    `SELECT a.id AS attempt_id,
            a.media_id,
            a.post_idea_id,
            a.video_job_id,
            a.finished_at,
            a.permalink,
            a.song_title,
            a.song_artist,
            a.graduation_strategy,
            left(v.motion_prompt, 500) AS motion_prompt,
            v.video_storage_path,
            vis.render AS visual_render,
            song.audio_type,
            song.genre,
            sched.slot AS schedule_slot,
            score.chosen_framework,
            score.chosen_bucket,
            score.blockbuster,
            score.net,
            score.origin,
            copy.on_screen_copy,
            copy.full_story_below,
            src.headline,
            insight.ny_date,
            insight.views,
            insight.reach,
            insight.likes,
            insight.comments,
            insight.saved,
            insight.shares,
            insight.reposts,
            insight.total_interactions,
            insight.avg_watch_time_ms,
            insight.total_watch_time_ms,
            insight.skip_rate,
            insight.is_shared_to_feed
       FROM ${REEL_ATTEMPTS} a
       LEFT JOIN reels.video_jobs v ON v.id = a.video_job_id
       LEFT JOIN reels.visual_jobs vis ON vis.id = v.visual_job_id
       LEFT JOIN reels.songs song ON song.audio_id = a.audio_id
       LEFT JOIN LATERAL (
         SELECT slot
           FROM ${REEL_SCHEDULE} ps
          WHERE publish_attempt_id = a.id
          ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, publish_at DESC
          LIMIT 1
       ) sched ON true
       LEFT JOIN LATERAL (
         SELECT s.chosen_framework, s.chosen_bucket, s.blockbuster, s.net, s.origin
           FROM reels.idea_scores s
           JOIN reels.score_slates sl ON sl.id = s.slate_id
          WHERE s.post_idea_id = a.post_idea_id
          ORDER BY (v.slate_id IS NOT NULL AND s.slate_id = v.slate_id) DESC, sl.scored_at DESC
          LIMIT 1
       ) score ON true
       LEFT JOIN LATERAL (
         SELECT c.on_screen_copy, c.caption, c.full_story_below
           FROM reels.idea_copy c
           JOIN reels.score_slates sl ON sl.id = c.slate_id
          WHERE c.post_idea_id = a.post_idea_id
            AND c.status = 'ok'
          ORDER BY (v.slate_id IS NOT NULL AND c.slate_id = v.slate_id) DESC, sl.scored_at DESC
          LIMIT 1
       ) copy ON true
       LEFT JOIN LATERAL (
         SELECT s.headline
           FROM reels.post_idea_members m
           JOIN reels.sources s ON s.id = m.source_id
          WHERE m.post_idea_id = a.post_idea_id
          ORDER BY CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END, m.joined_at
          LIMIT 1
       ) src ON true
       LEFT JOIN LATERAL (
         SELECT ny_date::text AS ny_date,
                views, reach, likes, comments, saved, shares, reposts, total_interactions,
                avg_watch_time_ms, total_watch_time_ms, skip_rate, is_shared_to_feed
           FROM ${REEL_INSIGHTS} i
          WHERE i.media_id = a.media_id
          ORDER BY i.ny_date DESC
          LIMIT 1
       ) insight ON true
      WHERE a.status = 'published'
        AND a.media_id IS NOT NULL
        AND btrim(a.media_id) <> ''
        AND a.trigger <> 'mix_test'
        AND a.finished_at IS NOT NULL
        AND ($1::timestamptz IS NULL OR a.finished_at >= $1::timestamptz)
        AND a.finished_at <= $2::timestamptz
        AND ($3::text IS NULL
          OR COALESCE(copy.on_screen_copy, '') ILIKE $3 ESCAPE '\\'
          OR COALESCE(copy.caption, '') ILIKE $3 ESCAPE '\\'
          OR COALESCE(a.caption, '') ILIKE $3 ESCAPE '\\'
          OR COALESCE(src.headline, '') ILIKE $3 ESCAPE '\\'
          OR COALESCE(a.song_title, '') ILIKE $3 ESCAPE '\\'
          OR COALESCE(a.song_artist, '') ILIKE $3 ESCAPE '\\')
      ORDER BY a.finished_at DESC`,
    [since ? since.toISOString() : null, now.toISOString(), likePattern(query)],
  );

  return rows.map((row) => {
    const finishedAt = new Date(row.finished_at);
    const slot = resolveSlot(row.schedule_slot, finishedAt);
    const motion = parseMotionFactors(row.motion_prompt);
    const title = reelTitle(row.on_screen_copy, row.headline);
    const headline = row.headline?.trim() || null;
    const blockbuster = num(row.blockbuster);
    return withHistory(
      {
        attemptId: row.attempt_id,
        mediaId: row.media_id,
        postIdeaId: row.post_idea_id,
        videoJobId: row.video_job_id && row.video_storage_path ? row.video_job_id : null,
        finishedAt: finishedAt.toISOString(),
        permalink: row.permalink,
        title,
        subtitle: headline && headline !== title ? headline : null,
        onScreenCopy: row.on_screen_copy,
        caption: null,
        songTitle: row.song_title,
        songArtist: row.song_artist,
        genre: row.genre,
        audioType: row.audio_type,
        slot,
        slotLabel: slotCaption(slot),
        framework: row.chosen_framework,
        bucket: row.chosen_bucket,
        blockbuster: row.blockbuster == null && row.net == null && row.chosen_bucket == null && row.chosen_framework == null
          ? null
          : (blockbuster ?? 0) > 0,
        net: num(row.net),
        origin: row.origin,
        color: row.visual_render ? colorProfileOrNoir(row.visual_render.colorProfile) : null,
        hook: motion.hook,
        hookSound: motion.hookSound,
        fullStory: row.full_story_below,
        graduationStrategy: row.graduation_strategy,
      },
      row.ny_date ? [snapshot({
        media_id: row.media_id,
        ny_date: row.ny_date,
        views: row.views,
        reach: row.reach,
        likes: row.likes,
        comments: row.comments,
        saved: row.saved,
        shares: row.shares,
        reposts: row.reposts,
        total_interactions: row.total_interactions,
        avg_watch_time_ms: row.avg_watch_time_ms,
        total_watch_time_ms: row.total_watch_time_ms,
        skip_rate: row.skip_rate,
        is_shared_to_feed: row.is_shared_to_feed,
      })] : [],
    );
  });
}

async function hydrateReelPage(reels: PerformanceReel[]): Promise<PerformanceReel[]> {
  if (reels.length === 0) return reels;
  const mediaIds = [...new Set(reels.map((reel) => reel.mediaId))];
  const attemptIds = reels.map((reel) => reel.attemptId);
  const [insights, captions] = await Promise.all([
    dbQuery<InsightRow>(
      `SELECT media_id, ny_date::text AS ny_date,
              views, reach, likes, comments, saved, shares, reposts, total_interactions,
              avg_watch_time_ms, total_watch_time_ms, skip_rate, is_shared_to_feed
         FROM ${REEL_INSIGHTS} i
        WHERE media_id = ANY($1::text[])
        ORDER BY media_id, ny_date`,
      [mediaIds],
    ),
    dbQuery<{ id: string; caption: string }>(
      `SELECT id, caption FROM social_hub.publish_attempts WHERE vertical = 'reels' AND id = ANY($1::uuid[])`,
      [attemptIds],
    ),
  ]);
  const history = new Map<string, PerformanceSnapshot[]>();
  for (const row of insights.rows) {
    const list = history.get(row.media_id) ?? [];
    list.push(snapshot(row));
    history.set(row.media_id, list);
  }
  const captionById = new Map(captions.rows.map((row) => [row.id, row.caption]));
  return reels.map((reel) => withHistory(
    { ...reel, caption: captionById.get(reel.attemptId) ?? reel.caption },
    history.get(reel.mediaId) ?? (reel.metrics ? [reel.metrics] : []),
  ));
}
