/**
 * D-199. Rank 1 is the best post idea. The nightly run claims copy, frame,
 * video, and song work in that order. A worse idea waits while a better
 * selected idea on the same slate is still being made and has no song for
 * that slate's calendar day, so the best idea picks while that day's songs
 * are still free.
 */

export type RankedClaim = {
  id: string;
  slateId: string | null;
  rank: number | null;
  requestedAt: string;
};

export type SlateSongGate = {
  slateId: string;
  rank: number | null;
  selected: boolean;
  hasSongForAssignment: boolean;
  stillInPipeline: boolean;
};

/** Lower rank is better. A missing rank sorts after every numbered rank. */
export function compareIdeaRank(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

/**
 * A claim waits when a better selected idea on its slate is still on the way
 * to a song and has not claimed one for that slate's calendar day. An unranked claim waits for every
 * ranked idea in that position. The idea does not wait for itself.
 */
export function claimWaitsForBetterIdea(candidate: RankedClaim, ideas: readonly SlateSongGate[]): boolean {
  return ideas.some((idea) => {
    if (!idea.selected || idea.slateId !== candidate.slateId) return false;
    if (idea.hasSongForAssignment || !idea.stillInPipeline) return false;
    if (idea.rank == null) return false;
    if (candidate.rank == null) return true;
    return idea.rank < candidate.rank;
  });
}

/** The next job to run: best rank, then the one queued earlier. */
export function chooseRankedClaim(candidates: readonly RankedClaim[], ideas: readonly SlateSongGate[]): string | null {
  const ready = candidates.filter((candidate) => !claimWaitsForBetterIdea(candidate, ideas));
  ready.sort(
    (a, b) =>
      compareIdeaRank(a.rank, b.rank) ||
      (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return ready[0]?.id ?? null;
}

/** ORDER BY fragment. `alias` is the job or finish table alias. */
export function ideaRankOrderBy(alias: string): string {
  if (!/^[a-z]+$/.test(alias)) throw new Error(`Bad job alias: ${alias}`);
  return `(
    SELECT s.rank FROM reels.idea_scores s
     WHERE s.post_idea_id = ${alias}.post_idea_id
       AND s.slate_id = ${alias}.slate_id
  ) ASC NULLS LAST, ${alias}.requested_at`;
}
