import { SONG_POOL_CAP, SONG_SHORTLIST_SIZE, SONG_TRENDING_TOP } from '@/lib/reels/config';

/**
 * The song pool's deterministic rules: which trending sounds enter, which old
 * songs leave, and which 12 go to Jev. No network, no database; the ingest and
 * the pick job call these with what they fetched.
 */

export type AudioType = 'music' | 'original_sound';

/** One sound as a trending list returned it. `rank` is 1-based within its list. */
export type TrendingSound = {
  audioId: string;
  list: AudioType;
  rank: number;
  /** False when Meta returned a null `download_url` (D-142). */
  hasPreview: boolean;
};

export type SkipReason = 'no_preview' | 'in_pool' | 'merged';

export type IngestPlan = {
  accept: TrendingSound[];
  skipped: Array<{ audioId: string; list: AudioType; rank: number; reason: SkipReason }>;
  /** Day one only: how many a list was short of its top N once it ran dry. */
  shortfall: Record<AudioType, number>;
};

const LIST_ORDER: AudioType[] = ['music', 'original_sound'];

/**
 * Day one fills exactly 10 music and 20 original sounds, replacing a skipped or
 * merged sound with the next-ranked sound from the same list (D-140, D-176).
 * Later days take only new entrants inside each list's top N, with no quota and
 * no replacement (D-140). Sounds are one song per `audio_id` (D-139).
 *
 * A list that runs dry on day one borrows its shortfall from the other list's
 * next-ranked sounds (D-178). `shortfall` is what is still missing after that,
 * which only happens when both lists run dry.
 */
export function planIngest(input: {
  lists: Record<AudioType, TrendingSound[]>;
  poolIds: ReadonlySet<string>;
  dayOne: boolean;
  top?: Record<AudioType, number>;
}): IngestPlan {
  const top = input.top ?? SONG_TRENDING_TOP;
  const taken = new Set<string>();
  const plan: IngestPlan = { accept: [], skipped: [], shortfall: { music: 0, original_sound: 0 } };

  const sorted = (list: AudioType) => [...input.lists[list]].sort((a, b) => a.rank - b.rank);
  // Where each list's walk stopped, so a day-one borrow picks up from there.
  const cursor: Record<AudioType, number> = { music: 0, original_sound: 0 };

  const walk = (list: AudioType, want: number, windowed: boolean): number => {
    const sounds = sorted(list);
    let accepted = 0;
    while (cursor[list] < sounds.length && (windowed || accepted < want)) {
      const sound = sounds[cursor[list]];
      if (windowed && sound.rank > top[list]) break;
      cursor[list] += 1;
      const reason: SkipReason | null = taken.has(sound.audioId)
        ? 'merged'
        : input.poolIds.has(sound.audioId)
          ? 'in_pool'
          : sound.hasPreview
            ? null
            : 'no_preview';
      if (reason) {
        plan.skipped.push({ audioId: sound.audioId, list, rank: sound.rank, reason });
        // A retried day one counts what the failed attempt already stored, so it ends at 30, not 30 more.
        if (reason === 'in_pool' && !windowed) {
          taken.add(sound.audioId);
          accepted += 1;
        }
        continue;
      }
      taken.add(sound.audioId);
      plan.accept.push(sound);
      accepted += 1;
    }
    return accepted;
  };

  if (!input.dayOne) {
    for (const list of LIST_ORDER) walk(list, 0, true);
    return plan;
  }

  const missing: Record<AudioType, number> = { music: 0, original_sound: 0 };
  for (const list of LIST_ORDER) missing[list] = top[list] - walk(list, top[list], false);
  for (const list of LIST_ORDER) {
    const other: AudioType = list === 'music' ? 'original_sound' : 'music';
    if (missing[list] > 0) missing[list] -= walk(other, missing[list], false);
  }
  plan.shortfall = { music: Math.max(0, missing.music), original_sound: Math.max(0, missing.original_sound) };
  return plan;
}

export type PoolSong = { audioId: string; firstIngestedAt: Date; attached: boolean };

/**
 * Hard-delete the oldest songs so the pool stays at the cap once `incoming`
 * songs land (D-141). Oldest means first ingested. A song attached to an
 * unpublished reel is never evicted; the next-oldest goes instead (D-164).
 * `overCap` is how far the pool still exceeds the cap when every remaining
 * song is attached. The new songs still land and the pool briefly runs over
 * (D-179); later ingests evict as soon as songs detach.
 */
export function planEviction(
  pool: ReadonlyArray<PoolSong>,
  incoming: number,
  cap: number = SONG_POOL_CAP,
): { evict: string[]; overCap: number } {
  const overflow = pool.length + incoming - cap;
  if (overflow <= 0) return { evict: [], overCap: 0 };
  const evict = pool
    .filter((song) => !song.attached)
    .sort((a, b) => a.firstIngestedAt.getTime() - b.firstIngestedAt.getTime() || a.audioId.localeCompare(b.audioId))
    .slice(0, overflow)
    .map((song) => song.audioId);
  return { evict, overCap: overflow - evict.length };
}

export function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length !== b.length || a.length === 0) throw new Error(`Embedding sizes differ: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export type RankableSong = { audioId: string; tagTextEmbedding: ReadonlyArray<number> | null };

export type Shortlist<S> =
  | { ok: true; songs: Array<S & { similarity: number }> }
  | { ok: false; tagged: number };

/**
 * Rank tagged songs by similarity between the reel's copy embedding and each
 * song's tag-text embedding, and take exactly `size` (D-147, D-148). Fewer
 * tagged songs than that is not a shortlist: the pick waits (D-170).
 */
export function shortlistSongs<S extends RankableSong>(
  copyEmbedding: ReadonlyArray<number>,
  songs: ReadonlyArray<S>,
  size: number = SONG_SHORTLIST_SIZE,
): Shortlist<S> {
  const tagged = songs.filter((song): song is S & { tagTextEmbedding: ReadonlyArray<number> } => song.tagTextEmbedding != null);
  if (tagged.length < size) return { ok: false, tagged: tagged.length };
  const ranked = tagged
    .map((song) => ({ ...song, similarity: cosine(copyEmbedding, song.tagTextEmbedding) }))
    .sort((a, b) => b.similarity - a.similarity || a.audioId.localeCompare(b.audioId));
  return { ok: true, songs: ranked.slice(0, size) };
}

/**
 * Songs already claimed by other ideas on this reel's assigned calendar day
 * are out of the shortlist (D-194, D-197, D-200). The day is the slate date,
 * not the day the reel was generated. Order of the songs that remain is unchanged.
 */
export function excludeUsedToday<S extends { audioId: string }>(
  songs: ReadonlyArray<S>,
  usedAudioIds: ReadonlySet<string>,
): S[] {
  if (usedAudioIds.size === 0) return [...songs];
  return songs.filter((song) => !usedAudioIds.has(song.audioId));
}

export type DaySongClaim = {
  postIdeaId: string;
  audioId: string;
  finishedAt: string;
  assignmentDate?: string;
};

/** The slate date before this assignment (`YYYY-MM-DD`, UTC calendar math). */
export function previousAssignmentDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/** Ok picks on these slate dates block the same audio for other ideas (D-194, review window). */
export function assignmentLockDates(assignmentDate: string): string[] {
  return [assignmentDate, previousAssignmentDate(assignmentDate)];
}

/**
 * Picks whose reel is assigned to this calendar day. A pick generated on
 * another wall-clock day still counts, and a pick generated today for a
 * different assignment does not (D-200).
 */
export function claimsForAssignment<T extends { assignmentDate: string }>(
  picks: readonly T[],
  assignmentDate: string,
): T[] {
  return picks.filter((pick) => pick.assignmentDate === assignmentDate);
}

/** The song this post idea already claimed for this assigned day. The earliest ok pick is the one that sticks. */
export function songHeldByIdea<T extends DaySongClaim>(picks: readonly T[], postIdeaId: string): T | null {
  const mine = picks.filter((pick) => pick.postIdeaId === postIdeaId && pick.audioId);
  mine.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt) || a.audioId.localeCompare(b.audioId));
  return mine[0] ?? null;
}

/** Songs claimed for this assigned day by any other post idea. This idea's own song is not a block. */
export function audioIdsHeldByOtherIdeas(picks: readonly DaySongClaim[], postIdeaId: string): Set<string> {
  return new Set(picks.filter((pick) => pick.postIdeaId !== postIdeaId && pick.audioId).map((pick) => pick.audioId));
}

/**
 * Audio ids another idea already claimed on this assignment date or the prior
 * slate day. Regenerating keeps this idea's song only when it does not collide.
 */
export function audioIdsBlockedForAssignment(
  picks: readonly DaySongClaim[],
  assignmentDate: string,
  postIdeaId: string,
): Set<string> {
  const lockDates = new Set(assignmentLockDates(assignmentDate));
  return new Set(
    picks
      .filter(
        (pick) =>
          pick.postIdeaId !== postIdeaId &&
          pick.audioId &&
          (pick.assignmentDate ? lockDates.has(pick.assignmentDate) : lockDates.has(assignmentDate)),
      )
      .map((pick) => pick.audioId),
  );
}

/**
 * What the narrowing embeds and what Jev reads for the reel: the on-screen copy
 * and the caption body only, never the call to action or hashtags (D-147, D-150).
 */
export function reelMatchText(onScreenCopy: string, captionBody: string): string {
  return [onScreenCopy.trim(), captionBody.trim()].filter(Boolean).join('\n\n');
}

export type TrendStat = { audioId: string; nights: number; avgPosition: number };

/**
 * D-190: our trending score for original sounds. Only sounds on tonight's
 * list are eligible. More nights on the list within the window ranks higher;
 * ties go to the better average position, then the id so a rerun is stable.
 * A sound with no stats yet counts as one night at the back.
 */
export function rankByTrend(tonight: ReadonlyArray<string>, stats: ReadonlyArray<TrendStat>): string[] {
  const byId = new Map(stats.map((stat) => [stat.audioId, stat]));
  const eligible = [...new Set(tonight)];
  return eligible.sort((a, b) => {
    const sa = byId.get(a) ?? { nights: 1, avgPosition: Number.MAX_SAFE_INTEGER };
    const sb = byId.get(b) ?? { nights: 1, avgPosition: Number.MAX_SAFE_INTEGER };
    return sb.nights - sa.nights || sa.avgPosition - sb.avgPosition || a.localeCompare(b);
  });
}
