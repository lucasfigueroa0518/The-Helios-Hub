import { randomBytes, timingSafeEqual } from 'node:crypto';

import { dbQuery } from '@/lib/db';
import { fullCaption } from '@/lib/reels/copy/report';
import { getSetting, publishMix, setSetting } from '@/lib/reels/music/store';
import { nyDateKey, previousNyDateKey } from '@/lib/reels/scoring/decide';
import { signFrameObject } from '@/lib/reels/visual/storage';

/**
 * Private reel review. The unguessable token in the URL is the only gate.
 * There is no Auth.js session. Each visit reads the database again: the
 * latest slate for today and yesterday in America/New_York, and for each
 * selected idea the newest finished video on that slate. A regeneration
 * replaces the clip on the next load once that video is ok.
 */

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
  ny_date: string;
  rank: number | null;
  caption: string | null;
  call_to_action: string | null;
  hashtags: string[] | null;
  picked_title: string | null;
  picked_artist: string | null;
  picked_audio_id: string | null;
  preview_storage_path: string | null;
};

export async function loadReviewClips(token: string, at: Date = new Date()): Promise<ReviewClip[]> {
  const { today, yesterday } = reviewDates(at);
  const { rows } = await dbQuery<ReviewRow>(
    `WITH latest AS (
       SELECT DISTINCT ON (ny_date) id, ny_date::text AS ny_date
         FROM reels.score_slates
        WHERE ny_date IN ($1::date, $2::date)
        ORDER BY ny_date, scored_at DESC
     )
     SELECT v.id AS video_id,
            latest.ny_date,
            s.rank,
            c.caption,
            c.call_to_action,
            c.hashtags,
            song.picked_title,
            song.picked_artist,
            song.picked_audio_id,
            song.preview_storage_path
       FROM latest
       JOIN reels.idea_scores s ON s.slate_id = latest.id AND s.selected
       JOIN LATERAL (
         SELECT id
           FROM reels.video_jobs
          WHERE post_idea_id = s.post_idea_id
            AND slate_id = latest.id
            AND status = 'ok'
            AND video_storage_path IS NOT NULL
          ORDER BY finished_at DESC NULLS LAST, requested_at DESC
          LIMIT 1
       ) v ON true
       LEFT JOIN reels.idea_copy c
         ON c.slate_id = latest.id AND c.post_idea_id = s.post_idea_id AND c.status = 'ok'
       LEFT JOIN LATERAL (
         SELECT p.picked_title, p.picked_artist, p.picked_audio_id, pool.preview_storage_path
           FROM reels.song_picks p
           LEFT JOIN reels.songs pool ON pool.audio_id = p.picked_audio_id
          WHERE p.video_job_id = v.id AND p.status = 'ok' AND p.picked_audio_id IS NOT NULL
          ORDER BY p.finished_at DESC NULLS LAST
          LIMIT 1
       ) song ON true
      ORDER BY latest.ny_date DESC, s.rank ASC NULLS LAST`,
    [today, yesterday],
  );

  const mix = await publishMix();
  const songVolume = mix ? mix.audioVolume / 100 : 1;
  const videoVolume = mix ? mix.videoVolume / 100 : 1;
  const encoded = encodeURIComponent(token);

  return rows.map((row) => {
    const tags = Array.isArray(row.hashtags) ? row.hashtags : [];
    const audioId = row.preview_storage_path && row.picked_audio_id ? row.picked_audio_id : null;
    return {
      id: row.video_id,
      label: reviewDateLabel(row.ny_date, today),
      caption: fullCaption({
        caption: row.caption ?? '',
        callToAction: row.call_to_action ?? '',
        hashtags: tags,
      }),
      videoSrc: `/api/watch/${encoded}/video/${row.video_id}`,
      song: audioId
        ? {
            title: row.picked_title?.trim() || 'Original audio',
            artist: row.picked_artist?.trim() || '',
            src: `/api/watch/${encoded}/audio/${encodeURIComponent(audioId)}`,
          }
        : null,
      songVolume,
      videoVolume,
    };
  });
}

async function latestSlateIds(today: string, yesterday: string): Promise<string[]> {
  const { rows } = await dbQuery<{ id: string }>(
    `SELECT DISTINCT ON (ny_date) id
       FROM reels.score_slates
      WHERE ny_date IN ($1::date, $2::date)
      ORDER BY ny_date, scored_at DESC`,
    [today, yesterday],
  );
  return rows.map((row) => row.id);
}

/** Storage path for a finished selected reel on today's or yesterday's latest slate. */
export async function reviewVideoStoragePath(token: string, videoId: string): Promise<string | null> {
  if (!(await reviewTokenMatches(token))) return null;
  const { today, yesterday } = reviewDates();
  const slateIds = await latestSlateIds(today, yesterday);
  if (slateIds.length === 0) return null;
  const { rows } = await dbQuery<{ video_storage_path: string }>(
    `SELECT v.video_storage_path
       FROM reels.video_jobs v
       JOIN reels.idea_scores s
         ON s.slate_id = v.slate_id AND s.post_idea_id = v.post_idea_id AND s.selected
      WHERE v.id = $1::uuid
        AND v.status = 'ok'
        AND v.video_storage_path IS NOT NULL
        AND v.slate_id = ANY($2::uuid[])`,
    [videoId, slateIds],
  );
  return rows[0]?.video_storage_path ?? null;
}

/** Preview path only when that song is on one of the review reels and still in the pool. */
export async function reviewAudioStoragePath(token: string, audioId: string): Promise<string | null> {
  if (!(await reviewTokenMatches(token))) return null;
  const { today, yesterday } = reviewDates();
  const slateIds = await latestSlateIds(today, yesterday);
  if (slateIds.length === 0) return null;
  const { rows } = await dbQuery<{ preview_storage_path: string }>(
    `SELECT pool.preview_storage_path
       FROM reels.song_picks p
       JOIN reels.video_jobs v ON v.id = p.video_job_id
       JOIN reels.idea_scores s
         ON s.slate_id = v.slate_id AND s.post_idea_id = v.post_idea_id AND s.selected
       JOIN reels.songs pool ON pool.audio_id = p.picked_audio_id
      WHERE p.picked_audio_id = $1
        AND p.status = 'ok'
        AND v.status = 'ok'
        AND v.slate_id = ANY($2::uuid[])
        AND pool.preview_storage_path IS NOT NULL
      ORDER BY p.finished_at DESC NULLS LAST
      LIMIT 1`,
    [audioId, slateIds],
  );
  return rows[0]?.preview_storage_path ?? null;
}

export async function signedReviewUrl(objectPath: string): Promise<string> {
  return signFrameObject(objectPath, SIGNED_SECONDS);
}

export const REVIEW_SIGNED_SECONDS = SIGNED_SECONDS;
