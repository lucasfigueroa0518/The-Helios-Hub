import { dbQuery } from '@/lib/db';
import { SONG_PICK_STALE_MINUTES, SONG_SHORTLIST_SIZE } from '@/lib/reels/config';
import { claimNextSongByRank } from '@/lib/reels/pipeline/claim';
import { createLiveJevRunner } from '@/lib/reels/jev/client';
import { songPickSet, songPickState, SONG_PICK_VERSION } from '@/lib/reels/jev/questions/song-pick';
import { jevUsd, type JevRunner } from '@/lib/reels/jev/runner';
import { recordCost } from '@/lib/reels/repository';
import { clapConfigured, createLiveClapClient, type ClapClient } from '@/lib/reels/music/clap';
import {
  audioIdsHeldByOtherIdeas,
  claimsForAssignment,
  cosine,
  excludeUsedToday,
  reelMatchText,
  shortlistSongs,
  songHeldByIdea,
} from '@/lib/reels/music/pool';
import { autoPublishOn, okPicksForAssignment, taggedSongs, type OkPickToday, type TaggedSong } from '@/lib/reels/music/store';

/**
 * Stage 4 (D-147 to D-151, D-161, D-163, D-169, D-170, D-184, D-185, D-194).
 * Queued when a video job finishes ok. Embeds the reel's on-screen copy and
 * caption body, shortlists exactly 12 tagged songs by tag-text similarity, and
 * asks Jev to pick one. A song stays with the calendar day that reel is
 * assigned to, the slate's New York date (D-200). Other ideas assigned to
 * that day cannot use it. Regenerating this post idea keeps the song.
 * The best selected idea on the slate picks before a worse one (D-199). The
 * record keeps a snapshot of all 12 so it outlives eviction.
 */

export type PickStatus = 'requested' | 'running' | 'ok' | 'failed';

/** P-13's wording still needs Lucas (R6). Nothing picks until this is set. */
export function songPickApproved(): boolean {
  return process.env.REELS_SONG_PICK_APPROVED === 'true';
}

export type ShortlistEntry = {
  audioId: string;
  label: string;
  title: string | null;
  artist: string | null;
  genre: string;
  bpm: number | null;
  instruments: string[];
  vibes: string[];
  similarity: number;
  /** Copy text vs. the song's audio embedding: gate 2 evidence only (D-169). */
  audioSimilarity: number | null;
  probability: number | null;
};

export type StoredShortlist = {
  candidates: ShortlistEntry[];
  /** The top 12 had the ranking used the audio embedding instead (D-169). */
  audioRanking: Array<{ audioId: string; title: string | null; similarity: number }>;
};

export async function queueSongPick(videoJobId: string): Promise<{ queued: boolean; note?: string }> {
  const { rows } = await dbQuery<{ post_idea_id: string; status: string }>(
    `SELECT post_idea_id, status FROM reels.video_jobs WHERE id = $1`,
    [videoJobId],
  );
  const video = rows[0];
  if (!video) return { queued: false, note: 'No such video.' };
  if (video.status !== 'ok') return { queued: false, note: 'The video has not finished.' };
  const inserted = await dbQuery<{ id: string }>(
    `INSERT INTO reels.song_picks (video_job_id, post_idea_id, status)
     VALUES ($1, $2, 'requested')
     ON CONFLICT (video_job_id) WHERE status IN ('requested', 'running') DO NOTHING
     RETURNING id`,
    [videoJobId, video.post_idea_id],
  );
  return inserted.rows[0] ? { queued: true } : { queued: false, note: 'A song pick is already queued for this reel.' };
}

async function claimPick(): Promise<string | null> {
  await dbQuery(
    `UPDATE reels.song_picks
        SET status = 'failed', finished_at = now(), error = 'The worker stopped while this song pick was running.'
      WHERE status = 'running' AND started_at < now() - ($1::int * interval '1 minute')`,
    [SONG_PICK_STALE_MINUTES],
  );
  return claimNextSongByRank();
}

/** The copy burned into the video, and the calendar day that reel is assigned to. */
async function loadPickTarget(
  pickId: string,
): Promise<{ videoJobId: string; postIdeaId: string; onScreenCopy: string | null; caption: string; assignmentDate: string | null } | null> {
  const { rows } = await dbQuery<{
    video_job_id: string;
    post_idea_id: string;
    on_screen_copy: string | null;
    caption: string | null;
    assignment_date: string | null;
  }>(
    `SELECT p.video_job_id, p.post_idea_id, c.on_screen_copy, c.caption, sl.ny_date::text AS assignment_date
       FROM reels.song_picks p
       JOIN reels.video_jobs v ON v.id = p.video_job_id
       LEFT JOIN reels.score_slates sl ON sl.id = v.slate_id
       LEFT JOIN reels.idea_copy c ON c.post_idea_id = v.post_idea_id AND c.slate_id = v.slate_id AND c.status = 'ok'
      WHERE p.id = $1`,
    [pickId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    videoJobId: row.video_job_id,
    postIdeaId: row.post_idea_id,
    onScreenCopy: row.on_screen_copy,
    caption: row.caption ?? '',
    assignmentDate: row.assignment_date,
  };
}

async function finishPick(id: string, status: 'ok' | 'failed', fields: Record<string, unknown>): Promise<void> {
  await dbQuery(
    `UPDATE reels.song_picks
        SET status = $2, finished_at = now(), copy_text = $3, shortlist = $4, picked_audio_id = $5,
            picked_title = $6, picked_artist = $7, probabilities = $8, confidence = $9,
            question_set_version = $10, resolved_model = $11, error = $12, usd = $13
      WHERE id = $1`,
    [
      id,
      status,
      fields.copyText ?? null,
      fields.shortlist ? JSON.stringify(fields.shortlist) : null,
      fields.pickedAudioId ?? null,
      fields.pickedTitle ?? null,
      fields.pickedArtist ?? null,
      fields.probabilities ? JSON.stringify(fields.probabilities) : null,
      fields.confidence ?? null,
      fields.questionSetVersion ?? null,
      fields.resolvedModel ?? null,
      fields.error ?? null,
      fields.usd ?? 0,
    ],
  );
}

export function buildShortlist(copyEmbedding: number[], songs: TaggedSong[]): StoredShortlist | { tagged: number } {
  const ranked = shortlistSongs(copyEmbedding, songs, SONG_SHORTLIST_SIZE);
  if (!ranked.ok) return { tagged: ranked.tagged };
  const audioRanking = songs
    .filter((song) => song.audioEmbedding)
    .map((song) => ({ audioId: song.audioId, title: song.title, similarity: cosine(copyEmbedding, song.audioEmbedding!) }))
    .sort((a, b) => b.similarity - a.similarity || a.audioId.localeCompare(b.audioId))
    .slice(0, SONG_SHORTLIST_SIZE);
  return {
    // Shortlist order, most similar first (D-185).
    candidates: ranked.songs.map((song, index) => ({
      audioId: song.audioId,
      label: `song_${index + 1}`,
      title: song.title,
      artist: song.artist,
      genre: song.genre,
      bpm: song.bpm,
      instruments: song.instruments,
      vibes: song.vibes,
      similarity: song.similarity,
      audioSimilarity: song.audioEmbedding ? cosine(copyEmbedding, song.audioEmbedding) : null,
      probability: null,
    })),
    audioRanking,
  };
}

export type PickDeps = {
  clap?: ClapClient;
  jev?: JevRunner;
  /** Called after an ok pick when auto-publish is on (D-156). */
  onPicked?: (videoJobId: string) => Promise<void>;
};

/** Copy the song this post idea already claimed today onto a new video. No CLAP call, no Jev call. */
async function reuseHeldSong(id: string, copyText: string, held: OkPickToday, usd: number): Promise<void> {
  await finishPick(id, 'ok', {
    copyText,
    shortlist: held.shortlist,
    pickedAudioId: held.audioId,
    pickedTitle: held.title,
    pickedArtist: held.artist,
    probabilities: held.probabilities,
    confidence: held.confidence,
    questionSetVersion: held.questionSetVersion,
    resolvedModel: held.resolvedModel,
    usd,
  });
}

async function publishPicked(deps: PickDeps, videoJobId: string): Promise<void> {
  if (deps.onPicked) {
    await deps.onPicked(videoJobId);
    return;
  }
  if (await autoPublishOn()) {
    const { queuePublish } = await import('@/lib/reels/music/publish');
    await queuePublish(videoJobId, 'auto');
  }
}

/** Claim one queued pick. Leaves the queue alone until P-13 is approved and CLAP is configured. */
export async function claimAndPickSong(deps: PickDeps = {}): Promise<{ id: string; status: PickStatus } | null> {
  if (!songPickApproved()) return null;
  if (!deps.clap && !clapConfigured()) return null;
  const id = await claimPick();
  if (!id) return null;
  let usd = 0;
  try {
    const target = await loadPickTarget(id);
    if (!target?.onScreenCopy?.trim()) {
      await finishPick(id, 'failed', { error: 'This reel has no on-screen copy to match a song to.' });
      return { id, status: 'failed' };
    }
    if (!target.assignmentDate) {
      await finishPick(id, 'failed', { error: 'This reel is not assigned to a calendar day.' });
      return { id, status: 'failed' };
    }
    const copyText = reelMatchText(target.onScreenCopy, target.caption);
    const assigned = claimsForAssignment(await okPicksForAssignment(target.assignmentDate), target.assignmentDate);
    const held = songHeldByIdea(assigned, target.postIdeaId);
    if (held) {
      await reuseHeldSong(id, copyText, held, usd);
      await publishPicked(deps, target.videoJobId);
      return { id, status: 'ok' };
    }

    const clap = deps.clap ?? createLiveClapClient();
    const [copyEmbedding] = await clap.embedTexts([copyText]);
    await recordCost({ runId: null, vendor: 'huggingface', component: 'song-narrow', inputTokens: 0, usd: 0 });

    const heldByOthers = audioIdsHeldByOtherIdeas(assigned, target.postIdeaId);
    const open = excludeUsedToday(await taggedSongs(), heldByOthers);
    const shortlist = buildShortlist(copyEmbedding, open);
    if ('tagged' in shortlist) {
      const available =
        heldByOthers.size > 0
          ? `${shortlist.tagged} tagged song(s) still free on ${target.assignmentDate} (${heldByOthers.size} already used)`
          : `only ${shortlist.tagged} tagged song(s) in the pool`;
      await finishPick(id, 'failed', {
        copyText,
        error: `Song pending: ${available}, and the pick needs ${SONG_SHORTLIST_SIZE}.`,
      });
      return { id, status: 'failed' };
    }

    const set = songPickSet(shortlist.candidates);
    const jev = deps.jev ?? createLiveJevRunner();
    const result = await jev.ask({
      component: 'song-pick',
      state: songPickState({ onScreenCopy: target.onScreenCopy, captionBody: target.caption }),
      sets: [set],
      questions: set.questions,
      runId: null,
      postIdeaId: target.postIdeaId,
    });
    usd += jevUsd(result.usage.input_tokens);
    const answer = result.answers.song;
    const picked = shortlist.candidates.find((candidate) => candidate.label === answer.choice);
    if (!picked) throw new Error(`Jev returned an unknown option: ${String(answer.choice)}`);
    const probabilities = answer.probabilities as Record<string, number>;
    for (const candidate of shortlist.candidates) candidate.probability = probabilities[candidate.label] ?? null;

    // Always use Jev's pick, at any confidence (D-151).
    await finishPick(id, 'ok', {
      copyText,
      shortlist,
      pickedAudioId: picked.audioId,
      pickedTitle: picked.title,
      pickedArtist: picked.artist,
      probabilities: Object.fromEntries(shortlist.candidates.map((candidate) => [candidate.audioId, candidate.probability])),
      confidence: answer.confidence,
      questionSetVersion: SONG_PICK_VERSION,
      resolvedModel: result.model,
      usd,
    });
    await publishPicked(deps, target.videoJobId);
    return { id, status: 'ok' };
  } catch (error) {
    await finishPick(id, 'failed', { error: error instanceof Error ? error.message : String(error), usd }).catch(() => undefined);
    return { id, status: 'failed' };
  }
}
