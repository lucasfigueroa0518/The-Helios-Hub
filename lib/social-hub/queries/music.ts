import type { HubQuery } from '@/lib/social-hub/db';

/**
 * The Meta trending-audio pool Trial Reels draw from (reels.songs, refreshed
 * at 12:30 AM; planning/Trial Reels/MUSIC_SELECTION_PLAN.md). SELECT only.
 * Previews play through the existing /api/reels/songs/preview/[audioId].
 */

export type MusicSong = {
  audioId: string;
  type: 'music' | 'original_sound';
  title: string;
  artist: string | null;
  cover: string | null;
  durationMs: number | null;
  trendingRank: number;
  firstIngestedAt: string;
  lastSeenTrendingAt: string;
  genre: string | null;
  bpm: number | null;
  vibes: string[];
  instruments: string[];
  tagged: boolean;
  uses: number;
  lastUsedAt: string | null;
};

export type MusicRead =
  | { present: false }
  | { present: true; songs: MusicSong[]; lastIngest: { status: string; finishedAt: string | null; added: number } | null };

const SONGS_SQL = `
  SELECT s.audio_id, s.audio_type, s.title, s.display_artist, s.ig_username, s.cover_artwork_thumbnail_uri,
         s.duration_in_ms, s.trending_rank, s.first_ingested_at::text, s.last_seen_trending_at::text,
         s.genre, s.bpm, s.vibes, s.instruments, s.tagged_at IS NOT NULL AS tagged,
         coalesce(u.uses, 0)::int AS uses, u.last_used::text
    FROM reels.songs s
    LEFT JOIN (
      SELECT picked_audio_id, count(*) AS uses, max(finished_at) AS last_used
        FROM reels.song_picks
       WHERE status = 'ok' AND picked_audio_id IS NOT NULL
       GROUP BY picked_audio_id
    ) u ON u.picked_audio_id = s.audio_id
   ORDER BY s.trending_list, s.trending_rank, s.audio_id`;

const INGEST_SQL = `
  SELECT status, finished_at::text, coalesce(array_length(added, 1), 0)::int AS added
    FROM reels.song_ingests
   ORDER BY started_at DESC
   LIMIT 1`;

type SongRow = {
  audio_id: string; audio_type: 'music' | 'original_sound'; title: string | null; display_artist: string | null; ig_username: string | null;
  cover_artwork_thumbnail_uri: string | null; duration_in_ms: number | null; trending_rank: number; first_ingested_at: string;
  last_seen_trending_at: string; genre: string | null; bpm: number | null; vibes: string[] | null; instruments: string[] | null;
  tagged: boolean; uses: number; last_used: string | null;
};

export async function readMusic(q: HubQuery): Promise<MusicRead> {
  const exists = await q<{ ok: boolean }>(`SELECT to_regclass('reels.songs') IS NOT NULL AS ok`);
  if (!exists.rows[0]?.ok) return { present: false };
  const [songs, ingest] = await Promise.all([
    q<SongRow>(SONGS_SQL),
    q<{ status: string; finished_at: string | null; added: number }>(INGEST_SQL).catch(() => ({ rows: [] })),
  ]);
  return {
    present: true,
    songs: songs.rows.map((r) => ({
      audioId: r.audio_id,
      type: r.audio_type,
      title: r.title ?? (r.ig_username ? `Original sound · @${r.ig_username}` : 'Untitled sound'),
      artist: r.display_artist ?? (r.ig_username ? `@${r.ig_username}` : null),
      cover: r.cover_artwork_thumbnail_uri,
      durationMs: r.duration_in_ms,
      trendingRank: r.trending_rank,
      firstIngestedAt: r.first_ingested_at,
      lastSeenTrendingAt: r.last_seen_trending_at,
      genre: r.genre,
      bpm: r.bpm == null ? null : Number(r.bpm),
      vibes: r.vibes ?? [],
      instruments: r.instruments ?? [],
      tagged: r.tagged,
      uses: Number(r.uses) || 0,
      lastUsedAt: r.last_used,
    })),
    lastIngest: ingest.rows[0] ? { status: ingest.rows[0].status, finishedAt: ingest.rows[0].finished_at, added: Number(ingest.rows[0].added) || 0 } : null,
  };
}
