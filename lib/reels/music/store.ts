import { dbQuery } from '@/lib/db';
import { REEL_ATTEMPTS } from '@/lib/reels/spine-tables';
import type { IgAudio } from '@/lib/reels/music/meta';
import type { AudioType, PoolSong, TrendingSound } from '@/lib/reels/music/pool';
import type { SongTags } from '@/lib/reels/music/vocab';

/** Database access for the song pool, the ingest log, and the shared settings. */

export type StoredSong = {
  audioId: string;
  audioType: AudioType;
  title: string | null;
  displayArtist: string | null;
  igUsername: string | null;
  coverArtworkThumbnailUri: string | null;
  onPlatformAudioPreviewLink: string | null;
  durationInMs: number | null;
  trendingList: AudioType;
  trendingRank: number;
  firstIngestedAt: string;
  lastSeenTrendingAt: string;
  previewStoragePath: string;
  previewDurationMs: number | null;
  genre: string | null;
  bpm: number | null;
  instruments: string[] | null;
  vibes: string[] | null;
  tagVersion: string | null;
  taggedAt: string | null;
  attached: boolean;
};

type SongRow = {
  audio_id: string;
  audio_type: AudioType;
  title: string | null;
  display_artist: string | null;
  ig_username: string | null;
  cover_artwork_thumbnail_uri: string | null;
  on_platform_audio_preview_link: string | null;
  duration_in_ms: number | null;
  trending_list: AudioType;
  trending_rank: number;
  first_ingested_at: string;
  last_seen_trending_at: string;
  preview_storage_path: string;
  preview_duration_ms: number | null;
  genre: string | null;
  bpm: number | null;
  instruments: string[] | null;
  vibes: string[] | null;
  tag_version: string | null;
  tagged_at: string | null;
  attached: boolean;
};

/**
 * A song is attached while it is the pick on a reel that has not posted
 * (D-164): the latest ok pick of a video job with no published attempt.
 */
const ATTACHED_SQL = `
  EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT ON (p.video_job_id) p.video_job_id, p.picked_audio_id
        FROM reels.song_picks p
       WHERE p.status = 'ok'
       ORDER BY p.video_job_id, p.finished_at DESC
    ) latest
    WHERE latest.picked_audio_id = s.audio_id
      AND NOT EXISTS (
        SELECT 1 FROM ${REEL_ATTEMPTS} a
         WHERE a.video_job_id = latest.video_job_id AND a.status = 'published'
      )
  )`;

function toSong(row: SongRow): StoredSong {
  return {
    audioId: row.audio_id,
    audioType: row.audio_type,
    title: row.title,
    displayArtist: row.display_artist,
    igUsername: row.ig_username,
    coverArtworkThumbnailUri: row.cover_artwork_thumbnail_uri,
    onPlatformAudioPreviewLink: row.on_platform_audio_preview_link,
    durationInMs: row.duration_in_ms,
    trendingList: row.trending_list,
    trendingRank: row.trending_rank,
    firstIngestedAt: row.first_ingested_at,
    lastSeenTrendingAt: row.last_seen_trending_at,
    previewStoragePath: row.preview_storage_path,
    previewDurationMs: row.preview_duration_ms,
    genre: row.genre,
    bpm: row.bpm,
    instruments: row.instruments,
    vibes: row.vibes,
    tagVersion: row.tag_version,
    taggedAt: row.tagged_at,
    attached: row.attached,
  };
}

/** Oldest first, which is also eviction order (D-141). */
export async function listSongs(): Promise<StoredSong[]> {
  const { rows } = await dbQuery<SongRow>(
    `SELECT s.audio_id, s.audio_type, s.title, s.display_artist, s.ig_username,
            s.cover_artwork_thumbnail_uri, s.on_platform_audio_preview_link, s.duration_in_ms,
            s.trending_list, s.trending_rank, s.first_ingested_at::text, s.last_seen_trending_at::text,
            s.preview_storage_path, s.preview_duration_ms, s.genre, s.bpm, s.instruments, s.vibes,
            s.tag_version, s.tagged_at::text, ${ATTACHED_SQL} AS attached
       FROM reels.songs s
      ORDER BY s.first_ingested_at, s.audio_id`,
  );
  return rows.map(toSong);
}

export async function poolForEviction(): Promise<PoolSong[]> {
  const songs = await listSongs();
  return songs.map((song) => ({
    audioId: song.audioId,
    firstIngestedAt: new Date(song.firstIngestedAt),
    attached: song.attached,
  }));
}

export async function insertSong(input: {
  sound: TrendingSound;
  meta: IgAudio;
  previewStoragePath: string;
  previewDurationMs: number | null;
}): Promise<void> {
  const { sound, meta } = input;
  await dbQuery(
    `INSERT INTO reels.songs (
        audio_id, audio_type, title, display_artist, ig_username, profile_picture_url,
        cover_artwork_thumbnail_uri, on_platform_audio_preview_link, is_ads_eligible, duration_in_ms,
        trending_list, trending_rank, preview_storage_path, preview_duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (audio_id) DO NOTHING`,
    [
      sound.audioId,
      meta.audio_type ?? sound.list,
      meta.title ?? null,
      meta.display_artist ?? null,
      meta.ig_username ?? null,
      meta.profile_picture_url ?? null,
      meta.cover_artwork_thumbnail_uri ?? null,
      meta.on_platform_audio_preview_link ?? null,
      meta.is_ads_eligible ?? null,
      meta.duration_in_ms ?? null,
      sound.list,
      sound.rank,
      input.previewStoragePath,
      input.previewDurationMs,
    ],
  );
}

/** Reappearing in the lists is recorded but never resets a song's age (D-141). */
export async function markSeen(audioIds: string[]): Promise<void> {
  if (audioIds.length === 0) return;
  await dbQuery(`UPDATE reels.songs SET last_seen_trending_at = now() WHERE audio_id = ANY($1::text[])`, [audioIds]);
}

/** Hard-delete (D-141). Returns what was removed, for the ingest log and storage cleanup. */
export async function deleteSongs(
  audioIds: string[],
): Promise<Array<{ audioId: string; title: string | null; artist: string | null; previewStoragePath: string }>> {
  if (audioIds.length === 0) return [];
  const { rows } = await dbQuery<{ audio_id: string; title: string | null; display_artist: string | null; preview_storage_path: string }>(
    `DELETE FROM reels.songs WHERE audio_id = ANY($1::text[])
     RETURNING audio_id, title, display_artist, preview_storage_path`,
    [audioIds],
  );
  return rows.map((row) => ({
    audioId: row.audio_id,
    title: row.title,
    artist: row.display_artist,
    previewStoragePath: row.preview_storage_path,
  }));
}

export async function untaggedSongs(): Promise<Array<{ audioId: string; previewStoragePath: string }>> {
  const { rows } = await dbQuery<{ audio_id: string; preview_storage_path: string }>(
    `SELECT audio_id, preview_storage_path FROM reels.songs WHERE tagged_at IS NULL ORDER BY first_ingested_at`,
  );
  return rows.map((row) => ({ audioId: row.audio_id, previewStoragePath: row.preview_storage_path }));
}

export async function saveTags(input: {
  audioId: string;
  tags: SongTags;
  tagScores: Record<string, unknown>;
  tagVersion: string;
  clapModel: string;
  tagText: string;
  tagTextEmbedding: number[];
  audioEmbedding: number[];
}): Promise<void> {
  await dbQuery(
    `UPDATE reels.songs
        SET genre = $2, bpm = $3, instruments = $4, vibes = $5, tag_scores = $6, tag_version = $7,
            clap_model = $8, tag_text = $9, tag_text_embedding = $10, audio_embedding = $11, tagged_at = now()
      WHERE audio_id = $1`,
    [
      input.audioId,
      input.tags.genre,
      input.tags.bpm,
      input.tags.instruments,
      input.tags.vibes,
      JSON.stringify(input.tagScores),
      input.tagVersion,
      input.clapModel,
      input.tagText,
      input.tagTextEmbedding,
      input.audioEmbedding,
    ],
  );
}

export type TaggedSong = {
  audioId: string;
  title: string | null;
  artist: string | null;
  genre: string;
  bpm: number | null;
  instruments: string[];
  vibes: string[];
  tagTextEmbedding: number[];
  audioEmbedding: number[] | null;
};

/** Only tagged songs can be shortlisted (D-165). */
export async function taggedSongs(): Promise<TaggedSong[]> {
  const { rows } = await dbQuery<{
    audio_id: string;
    title: string | null;
    display_artist: string | null;
    ig_username: string | null;
    genre: string;
    bpm: number | null;
    instruments: string[];
    vibes: string[];
    tag_text_embedding: number[];
    audio_embedding: number[] | null;
  }>(
    `SELECT audio_id, title, display_artist, ig_username, genre, bpm, instruments, vibes,
            tag_text_embedding, audio_embedding
       FROM reels.songs
      WHERE tagged_at IS NOT NULL AND tag_text_embedding IS NOT NULL`,
  );
  return rows.map((row) => ({
    audioId: row.audio_id,
    title: row.title,
    artist: row.display_artist ?? row.ig_username,
    genre: row.genre,
    bpm: row.bpm,
    instruments: row.instruments,
    vibes: row.vibes,
    tagTextEmbedding: row.tag_text_embedding.map(Number),
    audioEmbedding: row.audio_embedding?.map(Number) ?? null,
  }));
}

export type OkPickToday = {
  postIdeaId: string;
  audioId: string;
  title: string | null;
  artist: string | null;
  finishedAt: string;
  /** Slate New York date this reel is assigned to (`YYYY-MM-DD`). */
  assignmentDate: string;
  copyText: string | null;
  shortlist: unknown;
  probabilities: unknown;
  confidence: number | null;
  questionSetVersion: string | null;
  resolvedModel: string | null;
};

/**
 * Ok song picks for reels assigned to this calendar day (D-194, D-197, D-200).
 * `day` is the slate's New York date (`YYYY-MM-DD`), not the day the pick
 * finished. A failed pick does not count. The caller keeps a post idea's own
 * song and blocks every other idea's.
 */
export async function okPicksForAssignments(days: readonly string[]): Promise<OkPickToday[]> {
  if (days.length === 0) return [];
  const { rows } = await dbQuery<{
    post_idea_id: string;
    picked_audio_id: string;
    picked_title: string | null;
    picked_artist: string | null;
    finished_at: Date | string;
    assignment_date: string;
    copy_text: string | null;
    shortlist: unknown;
    probabilities: unknown;
    confidence: number | null;
    question_set_version: string | null;
    resolved_model: string | null;
  }>(
    `SELECT p.post_idea_id, p.picked_audio_id, p.picked_title, p.picked_artist, p.finished_at,
            sl.ny_date::text AS assignment_date,
            p.copy_text, p.shortlist, p.probabilities, p.confidence, p.question_set_version, p.resolved_model
       FROM reels.song_picks p
       JOIN reels.video_jobs v ON v.id = p.video_job_id
       JOIN reels.score_slates sl ON sl.id = v.slate_id
      WHERE p.status = 'ok'
        AND p.picked_audio_id IS NOT NULL
        AND sl.ny_date = ANY($1::date[])`,
    [days],
  );
  return rows.map((row) => ({
    postIdeaId: row.post_idea_id,
    audioId: row.picked_audio_id,
    title: row.picked_title,
    artist: row.picked_artist,
    finishedAt: row.finished_at instanceof Date ? row.finished_at.toISOString() : String(row.finished_at),
    assignmentDate: row.assignment_date,
    copyText: row.copy_text,
    shortlist: row.shortlist,
    probabilities: row.probabilities,
    confidence: row.confidence,
    questionSetVersion: row.question_set_version,
    resolvedModel: row.resolved_model,
  }));
}

export async function okPicksForAssignment(day: string): Promise<OkPickToday[]> {
  return okPicksForAssignments([day]);
}

export async function songPreviewPath(audioId: string): Promise<string | null> {
  const { rows } = await dbQuery<{ preview_storage_path: string }>(
    `SELECT preview_storage_path FROM reels.songs WHERE audio_id = $1`,
    [audioId],
  );
  return rows[0]?.preview_storage_path ?? null;
}

/* ------------------------------------------------------------ ingest log */

export type IngestTrigger = 'scheduled' | 'manual';
export type IngestStatus = 'running' | 'ok' | 'partial' | 'failed';

export async function startIngest(trigger: IngestTrigger): Promise<string | null> {
  // A worker that died mid-ingest leaves a `running` row; an hour is far past any real ingest.
  await dbQuery(
    `UPDATE reels.song_ingests SET status = 'failed', finished_at = now(),
            note = 'The worker stopped while this ingest was running.'
      WHERE status = 'running' AND started_at < now() - interval '60 minutes'`,
  );
  try {
    const { rows } = await dbQuery<{ id: string }>(
      `INSERT INTO reels.song_ingests (trigger, status) VALUES ($1, 'running') RETURNING id`,
      [trigger],
    );
    return rows[0]?.id ?? null;
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') return null;
    throw error;
  }
}

export async function finishIngest(
  id: string,
  status: IngestStatus,
  fields: { fetched: unknown; added: string[]; skipped: unknown; evicted: unknown; note: string | null },
): Promise<void> {
  await dbQuery(
    `UPDATE reels.song_ingests
        SET status = $2, finished_at = now(), fetched = $3, added = $4, skipped = $5, evicted = $6, note = $7
      WHERE id = $1`,
    [id, status, JSON.stringify(fields.fetched), fields.added, JSON.stringify(fields.skipped), JSON.stringify(fields.evicted), fields.note],
  );
}

/** Day one lasts until an ingest has actually added songs (D-140). */
export async function hasCompletedIngest(): Promise<boolean> {
  const { rows } = await dbQuery<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM reels.song_ingests WHERE status IN ('ok', 'partial') AND cardinality(added) > 0
     ) AS found`,
  );
  return rows[0]?.found === true;
}

export type IngestSummary = {
  id: string;
  trigger: IngestTrigger;
  status: IngestStatus;
  startedAt: string;
  finishedAt: string | null;
  added: number;
  evicted: number;
  note: string | null;
};

export async function recentIngests(limit = 5): Promise<IngestSummary[]> {
  const { rows } = await dbQuery<{
    id: string;
    trigger: IngestTrigger;
    status: IngestStatus;
    started_at: string;
    finished_at: string | null;
    added: number;
    evicted: number;
    note: string | null;
  }>(
    `SELECT id, trigger, status, started_at::text, finished_at::text,
            cardinality(added) AS added, jsonb_array_length(evicted) AS evicted, note
       FROM reels.song_ingests ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    added: row.added,
    evicted: row.evicted,
    note: row.note,
  }));
}

/* -------------------------------------------------------------- settings */

export type MixSetting = { audioVolume: number; videoVolume: number };

export async function getSetting<T>(key: string): Promise<T | null> {
  const { rows } = await dbQuery<{ value: T }>(`SELECT value FROM reels.settings WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await dbQuery(
    `INSERT INTO reels.settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** MUS-V2 / D-159. Null until Lucas sets the mix from the test publishes. */
export async function publishMix(): Promise<MixSetting | null> {
  const mix = await getSetting<MixSetting>('mix');
  return mix && Number.isInteger(mix.audioVolume) && Number.isInteger(mix.videoVolume) ? mix : null;
}

/* ------------------------------------------------ trending observations */

export async function recordObservations(input: {
  ingestId: string;
  nyDate: string;
  audioType: AudioType;
  samples: IgAudio[][];
}): Promise<void> {
  const rows = input.samples.flatMap((sample, sampleIndex) =>
    sample.map((sound, index) => [sampleIndex + 1, index + 1, sound.audio_id, Boolean(sound.download_url)] as const),
  );
  if (rows.length === 0) return;
  await dbQuery(
    `INSERT INTO reels.sound_observations (ingest_id, ny_date, audio_type, sample_n, position, audio_id, has_preview)
     SELECT $1, $2::date, $3, s, p, a, h
       FROM unnest($4::int[], $5::int[], $6::text[], $7::boolean[]) AS t(s, p, a, h)`,
    [
      input.ingestId,
      input.nyDate,
      input.audioType,
      rows.map((row) => row[0]),
      rows.map((row) => row[1]),
      rows.map((row) => row[2]),
      rows.map((row) => row[3]),
    ],
  );
}

/** Nights on the list and average position within the window ending on `nyDate` (D-190). */
export async function trendStats(audioType: AudioType, nyDate: string, windowNights: number) {
  const { rows } = await dbQuery<{ audio_id: string; nights: number; avg_position: number }>(
    `SELECT audio_id, count(DISTINCT ny_date)::int AS nights, avg(position)::float8 AS avg_position
       FROM reels.sound_observations
      WHERE audio_type = $1 AND ny_date > $2::date - $3::int AND ny_date <= $2::date
      GROUP BY audio_id`,
    [audioType, nyDate, windowNights],
  );
  return rows.map((row) => ({ audioId: row.audio_id, nights: row.nights, avgPosition: Number(row.avg_position) }));
}

export async function pruneObservations(retentionDays: number): Promise<void> {
  await dbQuery(`DELETE FROM reels.sound_observations WHERE observed_at < now() - ($1::int * interval '1 day')`, [retentionDays]);
}
