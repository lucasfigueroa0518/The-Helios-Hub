import { dbQuery } from '@/lib/db';
import { clapConfigured } from '@/lib/reels/music/clap';
import { metaConfigured } from '@/lib/reels/music/meta';
import { songPickApproved, type PickStatus, type ShortlistEntry, type StoredShortlist } from '@/lib/reels/music/pick';
import type { PublishStatus, PublishTrigger } from '@/lib/reels/music/publish';
import { getSetting, publishMix, recentIngests, type IngestSummary, type MixSetting } from '@/lib/reels/music/store';

/** What the hub shows about songs and publishing (D-171 to D-173). */

export type ReelSong = {
  /** The latest pick for this reel, whatever its state. */
  pick: { status: PickStatus; error: string | null; requestedAt: string } | null;
  /** The latest successful pick: the song the reel publishes with. */
  song: {
    pickId: string;
    audioId: string;
    title: string | null;
    artist: string | null;
    genre: string | null;
    bpm: number | null;
    instruments: string[];
    vibes: string[];
    confidence: number | null;
    coverUrl: string | null;
    /** Null once the song has left the pool and its preview is gone. */
    previewUrl: string | null;
    shortlist: ShortlistEntry[];
    audioRanking: StoredShortlist['audioRanking'];
  } | null;
  publish: {
    status: PublishStatus;
    trigger: PublishTrigger;
    error: string | null;
    permalink: string | null;
    finishedAt: string | null;
  } | null;
};

export type MusicStatus = {
  autoPublish: boolean;
  /** Nightly slot scheduling. Off until the Live switch is on. */
  publishingLive: boolean;
  mix: MixSetting | null;
  shareToFeed: boolean | null;
  metaReady: boolean;
  clapReady: boolean;
  pickApproved: boolean;
  pool: { size: number; tagged: number };
  ingests: IngestSummary[];
};

export async function loadReelSongs(videoJobIds: string[]): Promise<Record<string, ReelSong>> {
  if (videoJobIds.length === 0) return {};
  const [latest, ok, publishes] = await Promise.all([
    dbQuery<{ video_job_id: string; status: PickStatus; error: string | null; requested_at: string }>(
      `SELECT DISTINCT ON (video_job_id) video_job_id, status, error, requested_at::text
         FROM reels.song_picks WHERE video_job_id = ANY($1::uuid[])
        ORDER BY video_job_id, requested_at DESC`,
      [videoJobIds],
    ),
    dbQuery<{
      video_job_id: string;
      id: string;
      picked_audio_id: string;
      picked_title: string | null;
      picked_artist: string | null;
      confidence: number | null;
      shortlist: StoredShortlist | null;
      cover: string | null;
      in_pool: boolean;
    }>(
      `SELECT DISTINCT ON (p.video_job_id) p.video_job_id, p.id, p.picked_audio_id, p.picked_title,
              p.picked_artist, p.confidence, p.shortlist,
              s.cover_artwork_thumbnail_uri AS cover, s.audio_id IS NOT NULL AS in_pool
         FROM reels.song_picks p
         LEFT JOIN reels.songs s ON s.audio_id = p.picked_audio_id
        WHERE p.video_job_id = ANY($1::uuid[]) AND p.status = 'ok'
        ORDER BY p.video_job_id, p.finished_at DESC`,
      [videoJobIds],
    ),
    dbQuery<{
      video_job_id: string;
      status: PublishStatus;
      trigger: PublishTrigger;
      error: string | null;
      permalink: string | null;
      finished_at: string | null;
    }>(
      `SELECT DISTINCT ON (video_job_id) video_job_id, status, trigger, error, permalink, finished_at::text
         FROM reels.publish_attempts
        WHERE video_job_id = ANY($1::uuid[]) AND trigger <> 'mix_test'
        ORDER BY video_job_id, requested_at DESC`,
      [videoJobIds],
    ),
  ]);

  const out: Record<string, ReelSong> = {};
  const entry = (id: string) => (out[id] ??= { pick: null, song: null, publish: null });
  for (const row of latest.rows) {
    entry(row.video_job_id).pick = { status: row.status, error: row.error, requestedAt: row.requested_at };
  }
  for (const row of ok.rows) {
    const picked = row.shortlist?.candidates.find((candidate) => candidate.audioId === row.picked_audio_id);
    entry(row.video_job_id).song = {
      pickId: row.id,
      audioId: row.picked_audio_id,
      title: row.picked_title,
      artist: row.picked_artist,
      genre: picked?.genre ?? null,
      bpm: picked?.bpm ?? null,
      instruments: picked?.instruments ?? [],
      vibes: picked?.vibes ?? [],
      confidence: row.confidence,
      coverUrl: row.cover,
      previewUrl: row.in_pool ? `/api/reels/songs/preview/${encodeURIComponent(row.picked_audio_id)}` : null,
      shortlist: row.shortlist?.candidates ?? [],
      audioRanking: row.shortlist?.audioRanking ?? [],
    };
  }
  for (const row of publishes.rows) {
    entry(row.video_job_id).publish = {
      status: row.status,
      trigger: row.trigger,
      error: row.error,
      permalink: row.permalink,
      finishedAt: row.finished_at,
    };
  }
  return out;
}

export async function loadMusicStatus(): Promise<MusicStatus> {
  const [autoPublish, publishingLive, mix, shareToFeed, pool, ingests] = await Promise.all([
    getSetting<boolean>('auto_publish'),
    getSetting<boolean>('publishing_live'),
    publishMix(),
    getSetting<boolean>('share_to_feed'),
    dbQuery<{ size: number; tagged: number }>(
      `SELECT count(*)::int AS size, count(tagged_at)::int AS tagged FROM reels.songs`,
    ),
    recentIngests(5),
  ]);
  return {
    autoPublish: autoPublish === true,
    publishingLive: publishingLive === true,
    mix,
    shareToFeed: typeof shareToFeed === 'boolean' ? shareToFeed : null,
    metaReady: metaConfigured(),
    clapReady: clapConfigured(),
    pickApproved: songPickApproved(),
    pool: pool.rows[0] ?? { size: 0, tagged: 0 },
    ingests,
  };
}
