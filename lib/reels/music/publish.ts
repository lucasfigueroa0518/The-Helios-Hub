import { dbQuery } from '@/lib/db';
import {
  PUBLISH_POLL_SECONDS,
  PUBLISH_POLL_TIMEOUT_MINUTES,
  PUBLISH_STALE_MINUTES,
  PUBLISH_VIDEO_URL_SECONDS,
  TRIAL_GRADUATION_STRATEGY,
} from '@/lib/reels/config';
import { fullCaption } from '@/lib/reels/copy/report';
import { setPublished } from '@/lib/reels/repository';
import { createLiveMetaClient, metaConfigured, type MetaClient } from '@/lib/reels/music/meta';
import { getSetting, publishMix, type MixSetting } from '@/lib/reels/music/store';
import { signFrameObject } from '@/lib/reels/visual/storage';

/**
 * Stage 5 (D-153, D-155 to D-159, D-162, D-167). Approve (or auto-publish)
 * queues an attempt; the worker creates the Reels container with the song
 * attached by audio_id, waits for FINISHED, and publishes it as a trial reel.
 * Success also marks the post idea published (D-005, D-061).
 */

export type PublishTrigger = 'approve' | 'auto' | 'mix_test' | 'force';
export type PublishStatus = 'requested' | 'creating' | 'processing' | 'publishing' | 'published' | 'failed';

type Queued = { queued: true; id: string } | { queued: false; status: number; note: string };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** OPEN-3 is undecided: null leaves `share_to_feed` off the request. */
async function shareToFeed(): Promise<boolean | null> {
  const value = await getSetting<boolean>('share_to_feed');
  return typeof value === 'boolean' ? value : null;
}

type PublishReel = {
  postIdeaId: string;
  pickId: string;
  audioId: string;
  title: string | null;
  artist: string | null;
  caption: string;
  mix: MixSetting;
};

export async function publishReadiness(
  videoJobId: string,
  options?: { trigger?: PublishTrigger; mixOverride?: MixSetting },
): Promise<{ ok: true; postIdeaId: string; reel: PublishReel } | { ok: false; status: number; note: string }> {
  const trigger = options?.trigger ?? 'approve';
  const { rows } = await dbQuery<{
    post_idea_id: string;
    status: string;
    video_storage_path: string | null;
    caption: string | null;
    call_to_action: string | null;
    hashtags: string[] | null;
    pick_id: string | null;
    picked_audio_id: string | null;
    picked_title: string | null;
    picked_artist: string | null;
    published: boolean;
  }>(
    `SELECT v.post_idea_id, v.status, v.video_storage_path, c.caption, c.call_to_action, c.hashtags,
            p.id AS pick_id, p.picked_audio_id, p.picked_title, p.picked_artist,
            EXISTS (SELECT 1 FROM reels.publish_attempts a
                     WHERE a.video_job_id = v.id AND a.status = 'published' AND a.trigger <> 'mix_test') AS published
       FROM reels.video_jobs v
       LEFT JOIN reels.idea_copy c ON c.post_idea_id = v.post_idea_id AND c.slate_id = v.slate_id AND c.status = 'ok'
       LEFT JOIN LATERAL (
         SELECT id, picked_audio_id, picked_title, picked_artist FROM reels.song_picks
          WHERE video_job_id = v.id AND status = 'ok' ORDER BY finished_at DESC LIMIT 1
       ) p ON true
      WHERE v.id = $1`,
    [videoJobId],
  );
  const reel = rows[0];
  if (!reel || reel.status !== 'ok' || !reel.video_storage_path) {
    return { ok: false, status: 400, note: 'This reel has no finished video.' };
  }
  if (!reel.pick_id || !reel.picked_audio_id) {
    return { ok: false, status: 409, note: 'Song pending: this reel has no song yet (D-170).' };
  }
  if (trigger !== 'mix_test' && reel.published) {
    return { ok: false, status: 409, note: 'This reel is already published.' };
  }
  if (!reel.caption) return { ok: false, status: 409, note: 'This reel has no caption.' };
  // The preview already plays both at full when no mix has been chosen.
  // Posting uses that same pair so Live and Force post are not stuck waiting
  // on a volume control the page does not have.
  const mix = options?.mixOverride ?? (await publishMix()) ?? { audioVolume: 100, videoVolume: 100 };
  return {
    ok: true,
    postIdeaId: reel.post_idea_id,
    reel: {
      postIdeaId: reel.post_idea_id,
      pickId: reel.pick_id,
      audioId: reel.picked_audio_id,
      title: reel.picked_title,
      artist: reel.picked_artist,
      caption: fullCaption({
        caption: reel.caption,
        callToAction: reel.call_to_action ?? '',
        hashtags: reel.hashtags ?? [],
      }),
      mix,
    },
  };
}

export async function queuePublish(
  videoJobId: string,
  trigger: PublishTrigger,
  mixOverride?: MixSetting,
): Promise<Queued> {
  const ready = await publishReadiness(videoJobId, { trigger, mixOverride });
  if (!ready.ok) return { queued: false, status: ready.status, note: ready.note };
  const reel = ready.reel;
  const caption = reel.caption;
  const mix = reel.mix;
  try {
    const inserted = await dbQuery<{ id: string }>(
      `INSERT INTO reels.publish_attempts (
          video_job_id, post_idea_id, song_pick_id, trigger, status, audio_id, song_title, song_artist,
          audio_volume, video_volume, caption, graduation_strategy, share_to_feed)
       VALUES ($1,$2,$3,$4,'requested',$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        videoJobId,
        reel.postIdeaId,
        reel.pickId,
        trigger,
        reel.audioId,
        reel.title,
        reel.artist,
        mix.audioVolume,
        mix.videoVolume,
        caption,
        TRIAL_GRADUATION_STRATEGY,
        await shareToFeed(),
      ],
    );
    return { queued: true, id: inserted.rows[0].id };
  } catch (error) {
    if (isUniqueViolation(error)) return { queued: false, status: 200, note: 'This reel is already publishing.' };
    throw error;
  }
}

async function claimPublish(): Promise<string | null> {
  await dbQuery(
    `UPDATE reels.publish_attempts
        SET status = 'failed', finished_at = now(),
            error = 'The worker stopped while this reel was publishing. Check Instagram before approving again.'
      WHERE status IN ('creating', 'processing', 'publishing')
        AND started_at < now() - ($1::int * interval '1 minute')`,
    [PUBLISH_STALE_MINUTES],
  );
  try {
    const { rows } = await dbQuery<{ id: string }>(
      `UPDATE reels.publish_attempts SET status = 'creating', started_at = now()
        WHERE id = (
          SELECT id FROM reels.publish_attempts
           WHERE status = 'requested'
             AND NOT EXISTS (SELECT 1 FROM reels.publish_attempts a WHERE a.status IN ('creating', 'processing', 'publishing'))
           ORDER BY requested_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
        RETURNING id`,
    );
    return rows[0]?.id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

async function update(id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  const sets = keys.map((key, index) => `${key} = $${index + 2}`);
  await dbQuery(`UPDATE reels.publish_attempts SET ${sets.join(', ')} WHERE id = $1`, [id, ...keys.map((key) => fields[key])]);
}

export type PublishDeps = {
  meta?: MetaClient;
  signVideo?: (objectPath: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** Claim one queued publish and carry it to Instagram. Leaves the queue alone until Meta is configured. */
export async function claimAndPublish(deps: PublishDeps = {}): Promise<{ id: string; status: PublishStatus } | null> {
  if (!deps.meta && !metaConfigured()) return null;
  const id = await claimPublish();
  if (!id) return null;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const statusLog: Array<{ at: string; statusCode: string; status: string | null }> = [];
  try {
    const { rows } = await dbQuery<{
      post_idea_id: string;
      video_storage_path: string | null;
      audio_id: string;
      audio_volume: number;
      video_volume: number;
      caption: string;
      graduation_strategy: string;
      share_to_feed: boolean | null;
    }>(
      `SELECT a.post_idea_id, v.video_storage_path, a.audio_id, a.audio_volume, a.video_volume, a.caption,
              a.graduation_strategy, a.share_to_feed
         FROM reels.publish_attempts a
         LEFT JOIN reels.video_jobs v ON v.id = a.video_job_id
        WHERE a.id = $1`,
      [id],
    );
    const attempt = rows[0];
    if (!attempt?.video_storage_path) throw new Error('The video for this reel is gone.');
    const meta = deps.meta ?? createLiveMetaClient();
    const videoUrl = await (deps.signVideo ?? ((objectPath) => signFrameObject(objectPath, PUBLISH_VIDEO_URL_SECONDS)))(
      attempt.video_storage_path,
    );

    const containerId = await meta.createReelContainer({
      videoUrl,
      caption: attempt.caption,
      audioId: attempt.audio_id,
      audioVolume: attempt.audio_volume,
      videoVolume: attempt.video_volume,
      graduationStrategy: attempt.graduation_strategy,
      shareToFeed: attempt.share_to_feed,
    });
    await update(id, { status: 'processing', container_id: containerId });

    const deadline = now() + PUBLISH_POLL_TIMEOUT_MINUTES * 60_000;
    for (;;) {
      const status = await meta.containerStatus(containerId);
      statusLog.push({ at: new Date(now()).toISOString(), ...status });
      if (status.statusCode === 'FINISHED') break;
      if (status.statusCode === 'ERROR' || status.statusCode === 'EXPIRED') {
        throw new Error(`Instagram could not process the reel (${status.statusCode}): ${status.status ?? 'no detail'}`);
      }
      if (now() >= deadline) {
        throw new Error(`The container was still ${status.statusCode} after ${PUBLISH_POLL_TIMEOUT_MINUTES} minutes.`);
      }
      await sleep(PUBLISH_POLL_SECONDS * 1000);
    }

    await update(id, { status: 'publishing', status_log: JSON.stringify(statusLog) });
    const mediaId = await meta.publishContainer(containerId);
    const permalink = await meta.permalink(mediaId).catch(() => null);
    await update(id, {
      status: 'published',
      media_id: mediaId,
      permalink,
      finished_at: new Date(now()).toISOString(),
      status_log: JSON.stringify(statusLog),
    });
    await setPublished(attempt.post_idea_id, true);
    const { markScheduleForAttempt } = await import('@/lib/reels/publish/schedule');
    await markScheduleForAttempt(id, 'published', null).catch(() => undefined);
    return { id, status: 'published' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await update(id, {
      status: 'failed',
      error: message,
      finished_at: new Date(now()).toISOString(),
      status_log: JSON.stringify(statusLog),
    }).catch(() => undefined);
    const { markScheduleForAttempt } = await import('@/lib/reels/publish/schedule');
    await markScheduleForAttempt(id, 'failed', message).catch(() => undefined);
    return { id, status: 'failed' };
  }
}
