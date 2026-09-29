import { randomBytes, timingSafeEqual } from 'node:crypto';

import { dbQuery } from '@/lib/db';
import { fullCaption } from '@/lib/reels/copy/report';
import { getSetting, publishMix, setSetting } from '@/lib/reels/music/store';
import { nyDateKey, previousNyDateKey } from '@/lib/reels/scoring/decide';
import { signFrameObject } from '@/lib/reels/visual/storage';

/**
 * Private reel review. The unguessable token in the URL is the only gate.
 * There is no Auth.js session. Each visit reads the database again.
 *
 * The feed is the September 29 new-scoring slate: the five highest ranks,
 * plus Sonnet 5.5 further down the list. Those are the ideas on that slate
 * that have a finished video. Each clip uses the newest finished video for
 * the idea, so a regeneration replaces it on the next load.
 */

/** `scoring-pass1-v2` slate for 2026-09-29. Ranks 1–5 and 11 (Sonnet 5.5) have videos. */
const REVIEW_SCORE_SLATE_ID = '83d3b27f-5dd1-4778-823a-d95d4894dc24';
const REVIEW_LABEL = 'Tue, Sep 29';

const REVIEW_TOKEN_KEY = 'review_token';
const SIGNED_SECONDS = 3600;

/** 32 bytes of base64url, no padding. */
export function reviewTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function tokensMatch(stored: string | null, given: string): boolean {
  if (!stored || !reviewTokenShape(stored) || !reviewTokenShape(given) || stored.length !== given.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(stored), Buffer.from(given));
}

export function reviewDates(at: Date = new Date()): { today: string; yesterday: string } {
  return { today: nyDateKey(at), yesterday: previousNyDateKey(at) };
}

/** "Today · Mon, Sep 28" — computed in UTC from the calendar key so SSR stays stable. */
export function reviewDateLabel(nyDate: string, today: string): string {
  const [year, month, day] = nyDate.split('-').map(Number);
  const formatted = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${nyDate === today ? 'Today' : 'Yesterday'} · ${formatted}`;
}

export async function reviewTokenMatches(token: string): Promise<boolean> {
  if (!reviewTokenShape(token)) return false;
  const stored = await getSetting<string>(REVIEW_TOKEN_KEY);
  return tokensMatch(typeof stored === 'string' ? stored : null, token);
}

/** Create the link token once. A later call returns the same token. */
export async function ensureReviewToken(): Promise<string> {
  const existing = await getSetting<string>(REVIEW_TOKEN_KEY);
  if (typeof existing === 'string' && reviewTokenShape(existing)) return existing;
  const token = randomBytes(32).toString('base64url');
  await setSetting(REVIEW_TOKEN_KEY, token);
  return token;
}

export type ReviewClip = {
  id: string;
  label: string;
  caption: string;
  videoSrc: string;
  song: { title: string; artist: string; src: string } | null;
  songVolume: number;
  videoVolume: number;
};

type ReviewRow = {
  video_id: string;
  video_storage_path: string | null;
  rank: number | null;
  caption: string | null;
  call_to_action: string | null;
  hashtags: string[] | null;
  picked_title: string | null;
  picked_artist: string | null;
  picked_audio_id: string | null;
  preview_storage_path: string | null;
};

function signOrFallback(objectPath: string, fallback: string): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), 2500);
    signedReviewUrl(objectPath).then(
      (url) => {
        clearTimeout(timer);
        resolve(url);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * Newest finished video for each idea on the review slate that has one.
 * Copy and the song come from that video, which may sit on an earlier slate
 * for the same idea (Sonnet 5.5).
 */
const REVIEW_VIDEOS_SQL = `
  SELECT DISTINCT ON (v.post_idea_id)
         v.id AS video_id,
         v.post_idea_id,
         v.slate_id,
         v.video_storage_path,
         s.rank
    FROM reels.idea_scores s
    JOIN reels.video_jobs v ON v.post_idea_id = s.post_idea_id
   WHERE s.slate_id = $1::uuid
     AND v.status = 'ok'
     AND v.video_storage_path IS NOT NULL
   ORDER BY v.post_idea_id, v.finished_at DESC NULLS LAST, v.requested_at DESC
`;

export async function loadReviewClips(token: string): Promise<ReviewClip[]> {
  const { rows } = await dbQuery<ReviewRow>(
    `WITH newest AS (${REVIEW_VIDEOS_SQL})
     SELECT newest.video_id,
            newest.video_storage_path,
            newest.rank,
            c.caption,
            c.call_to_action,
            c.hashtags,
            song.picked_title,
            song.picked_artist,
            song.picked_audio_id,
            song.preview_storage_path
       FROM newest
       LEFT JOIN reels.idea_copy c
         ON c.slate_id = newest.slate_id AND c.post_idea_id = newest.post_idea_id AND c.status = 'ok'
       LEFT JOIN LATERAL (
         SELECT p.picked_title, p.picked_artist, p.picked_audio_id, pool.preview_storage_path
           FROM reels.song_picks p
           LEFT JOIN reels.songs pool ON pool.audio_id = p.picked_audio_id
          WHERE p.video_job_id = newest.video_id AND p.status = 'ok' AND p.picked_audio_id IS NOT NULL
          ORDER BY p.finished_at DESC NULLS LAST
          LIMIT 1
       ) song ON true
      ORDER BY newest.rank ASC NULLS LAST`,
    [REVIEW_SCORE_SLATE_ID],
  );

  const mix = await publishMix();
  const songVolume = mix ? mix.audioVolume / 100 : 1;
  const videoVolume = mix ? mix.videoVolume / 100 : 1;
  const encoded = encodeURIComponent(token);

  // Sign here so the player requests storage directly. A redirect in front of
  // every byte range is what makes the first frame and the next swipe wait.
  return Promise.all(rows.map(async (row) => {
    const tags = Array.isArray(row.hashtags) ? row.hashtags : [];
    const audioId = row.preview_storage_path && row.picked_audio_id ? row.picked_audio_id : null;
    const videoFallback = `/api/watch/${encoded}/video/${row.video_id}`;
    const videoSrc = row.video_storage_path
      ? await signOrFallback(row.video_storage_path, videoFallback)
      : videoFallback;
    const songSrc = audioId && row.preview_storage_path
      ? await signOrFallback(
          row.preview_storage_path,
          `/api/watch/${encoded}/audio/${encodeURIComponent(audioId)}`,
        )
      : null;
    return {
      id: row.video_id,
      label: REVIEW_LABEL,
      caption: fullCaption({
        caption: row.caption ?? '',
        callToAction: row.call_to_action ?? '',
        hashtags: tags,
      }),
      videoSrc,
      song: audioId && songSrc
        ? {
            title: row.picked_title?.trim() || 'Original audio',
            artist: row.picked_artist?.trim() || '',
            src: songSrc,
          }
        : null,
      songVolume,
      videoVolume,
    };
  }));
}

/** Ideas on the review slate, best first. Used when regenerating that same set. */
export async function reviewIdeaTargets(): Promise<Array<{ postIdeaId: string; slateId: string; rank: number | null }>> {
  const { rows } = await dbQuery<{ post_idea_id: string; rank: number | null }>(
    `WITH newest AS (${REVIEW_VIDEOS_SQL})
     SELECT post_idea_id, rank FROM newest ORDER BY rank ASC NULLS LAST`,
    [REVIEW_SCORE_SLATE_ID],
  );
  return rows.map((row) => ({
    postIdeaId: row.post_idea_id,
    slateId: REVIEW_SCORE_SLATE_ID,
    rank: row.rank,
  }));
}

/** Storage path for one of the review reels' newest finished video. */
export async function reviewVideoStoragePath(token: string, videoId: string): Promise<string | null> {
  if (!(await reviewTokenMatches(token))) return null;
  const { rows } = await dbQuery<{ video_storage_path: string }>(
    `WITH newest AS (${REVIEW_VIDEOS_SQL})
     SELECT video_storage_path FROM newest WHERE video_id = $2::uuid`,
    [REVIEW_SCORE_SLATE_ID, videoId],
  );
  return rows[0]?.video_storage_path ?? null;
}

/** Preview path only when that song is on one of the review reels and still in the pool. */
export async function reviewAudioStoragePath(token: string, audioId: string): Promise<string | null> {
  if (!(await reviewTokenMatches(token))) return null;
  const { rows } = await dbQuery<{ preview_storage_path: string }>(
    `WITH newest AS (${REVIEW_VIDEOS_SQL})
     SELECT pool.preview_storage_path
       FROM newest
       JOIN reels.song_picks p ON p.video_job_id = newest.video_id
       JOIN reels.songs pool ON pool.audio_id = p.picked_audio_id
      WHERE p.picked_audio_id = $2
        AND p.status = 'ok'
        AND pool.preview_storage_path IS NOT NULL
      LIMIT 1`,
    [REVIEW_SCORE_SLATE_ID, audioId],
  );
  return rows[0]?.preview_storage_path ?? null;
}

export async function signedReviewUrl(objectPath: string): Promise<string> {
  return signFrameObject(objectPath, SIGNED_SECONDS);
}

export const REVIEW_SIGNED_SECONDS = SIGNED_SECONDS;
