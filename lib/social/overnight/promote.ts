import { loadPinnedCandidates } from '@/lib/social/overnight/pinned';
import type { RunDayResult } from '@/lib/social/pipeline/orchestrator';
import type { PipelineStages } from '@/lib/social/pipeline/stages';
import type { ScoredCandidate } from '@/lib/social/pipeline/types';
import { storyOnCalendar, type Query } from '@/lib/social/store/pg';
import { markPromoteUsed, readMoves, recordPromoteSkip, withSkip } from '@/lib/social-hub/moves-store';
import { ideaRef, tonightMoves } from '@/lib/social-hub/views/moves';

/**
 * Carousels' side of the shared queue (spec 2026-10-14 §4). The 3 AM run
 * keeps its fresh fetch and selection; tonight's promoted story (from an
 * earlier run's shortlist) goes ahead of every fresh candidate and takes one
 * of the usual posts; demoted stories go below every other. The existing
 * guards still apply (storedPostFor, storyOnCalendar in runDay); a story that
 * already posted is the one check added, since a promote skips selection's
 * already-posted check (Spec correction 4). Distinct from --story-id pinning.
 */

export const NOT_IN_SHORTLIST = 'It isn’t in any recent run’s shortlist any more.';
export const ALREADY_POSTED = 'This story already posted.';
export const ON_CALENDAR = 'It’s already on the calendar.';

export const carouselIdeaId = (storyId: string) => `carousels:story:${storyId}`;

/** True when any post of the story went out (its post is published, or a publish try for it was). */
async function storyPosted(query: Query, storyId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT EXISTS (
       SELECT 1 FROM social.posts p
         LEFT JOIN social_hub.content_items ci ON ci.vertical = 'carousels' AND ci.native_ref = p.id::text
        WHERE p.story_id = $1
          AND (p.status = 'published'
               OR EXISTS (SELECT 1 FROM social_hub.publish_attempts a WHERE a.content_item_id = ci.id AND a.status = 'published'))) AS posted`,
    [storyId],
  );
  return rows[0]?.posted === true;
}

/** Tonight's promoted story as a candidate, or null (skipped with why on the move; a failed read: no promote, as before). No model call. */
export async function loadPromoted(query: Query, storyId: string): Promise<ScoredCandidate | null> {
  const skip = async (reason: string) => {
    await recordPromoteSkip(query, 'carousels', carouselIdeaId(storyId), reason);
    return null;
  };
  try {
    if (await storyPosted(query, storyId)) return await skip(ALREADY_POSTED);
    if (await storyOnCalendar(query, storyId)) return await skip(ON_CALENDAR);
  } catch {
    return null;
  }
  try {
    return (await loadPinnedCandidates(query, [storyId]))[0] ?? null;
  } catch (e) {
    // Only "in no recent shortlist" is a skip; any other failure runs the night as before.
    return /not in any recent run's shortlist/.test(e instanceof Error ? e.message : '') ? await skip(NOT_IN_SHORTLIST) : null;
  }
}

/**
 * Tonight's promote, stepping aside in the same run: a promote that can't be
 * used (not found, already posted, on the calendar) is skipped with why, and
 * the next eligible promote is tried, until one is usable or none is left.
 * Done before the run spends anything. Never throws.
 */
export async function pickPromoted(query: Query, firstStoryId: string): Promise<ScoredCandidate | null> {
  try {
    let moves = await readMoves(query, 'carousels');
    const tried = new Set<string>();
    let storyId: string | null = firstStoryId;
    while (storyId && !tried.has(storyId)) {
      tried.add(storyId);
      const found = await loadPromoted(query, storyId);
      if (found) return found;
      moves = withSkip(moves, carouselIdeaId(storyId), 'stepped aside');
      const next = tonightMoves(moves, 'carousels').promote;
      storyId = next ? ideaRef(next.ideaId) : null;
    }
  } catch {
    // degrade: no promote
  }
  return null;
}

/** Selection as usual, then: the promoted story above every fresh score (once), demoted stories below every other. */
export function promotedStages(stages: PipelineStages, promoted: ScoredCandidate | null, demoted: ReadonlySet<string>): PipelineStages {
  return {
    ...stages,
    async score(articles, now) {
      const res = await stages.score(articles, now);
      if (!res.ok) return res;
      const fresh = res.value.filter((c) => c.id !== promoted?.id);
      const scores = fresh.map((c) => c.score);
      const top = Math.max(0, ...scores);
      const bottom = Math.min(0, ...scores);
      const kept = fresh.filter((c) => !demoted.has(c.id));
      const sunk = fresh.filter((c) => demoted.has(c.id)).map((c, i) => ({ ...c, score: bottom - 1 - i }));
      return { ...res, value: [...(promoted ? [{ ...promoted, score: top + 1 }] : []), ...kept, ...sunk] };
    },
  };
}

/** After the run: the promote is used when shipped (made or a stored post reused); otherwise why, on the move. */
export async function settlePromote(query: Query, storyId: string, result: Pick<RunDayResult, 'shipped' | 'onCalendar' | 'setAsides'>): Promise<void> {
  const ideaId = carouselIdeaId(storyId);
  if (result.shipped.some((e) => e.storyId === storyId)) {
    await markPromoteUsed(query, 'carousels', ideaId);
    return;
  }
  const aside = result.setAsides.find((s) => s.storyId === storyId);
  const reason = result.onCalendar.includes(storyId)
    ? ON_CALENDAR
    : aside
      ? `The pipeline set it aside at ${aside.stage} (${aside.reasonCode}).`
      : 'Tonight’s run stopped before it.';
  await recordPromoteSkip(query, 'carousels', ideaId, reason);
}
