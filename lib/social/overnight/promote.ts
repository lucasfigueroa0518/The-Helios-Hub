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

/**
 * The pool standard's night (2026-10-21): what the run is told besides its pins. `archived` stories are never made, and
 * `archivedUrls` are the member URLs of archived stories (a group's id is a representative URL that can change night to
 * night, so an archived story is matched by any shared URL as well as by id); `placed` is where a drag left a fresh story.
 */
export type CarouselNight = { archived?: ReadonlySet<string>; archivedUrls?: ReadonlySet<string>; placed?: ReadonlyMap<string, number> };

/**
 * Selection as usual, then: tonight's pins above every fresh score, in the order pinned (before the pool standard, one
 * promote); archived stories removed; placed stories at their key; demoted stories (types not on the queue) below every other.
 */
export function promotedStages(stages: PipelineStages, promoted: ScoredCandidate | readonly ScoredCandidate[] | null, demoted: ReadonlySet<string>, night: CarouselNight = {}): PipelineStages {
  const pins: readonly ScoredCandidate[] = promoted == null ? [] : Array.isArray(promoted) ? promoted : [promoted as ScoredCandidate];
  return {
    ...stages,
    async score(articles, now) {
      const res = await stages.score(articles, now);
      if (!res.ok) return res;
      // Same story under another id: group ids are a representative URL, which can change night to night,
      // so a fresh group that shares any member URL with a pinned story is that story, not a new one.
      const pinnedUrls = new Set(pins.flatMap((p) => [p.url, ...p.members.map((m) => m.url)]));
      const urlsOf = (c: ScoredCandidate) => [c.url, ...c.members.map((m) => m.url)];
      const sameStory = (c: ScoredCandidate) => pins.some((p) => p.id === c.id) || urlsOf(c).some((u) => pinnedUrls.has(u));
      const archived = (c: ScoredCandidate) => night.archived?.has(c.id) === true || urlsOf(c).some((u) => night.archivedUrls?.has(u));
      const fresh = res.value.filter((c) => !sameStory(c) && !archived(c)).map((c) => (night.placed?.has(c.id) ? { ...c, score: night.placed.get(c.id)! } : c));
      const scores = res.value.filter((c) => !sameStory(c) && !archived(c)).map((c) => c.score);
      const top = Math.max(0, ...scores);
      const bottom = Math.min(0, ...scores);
      const kept = fresh.filter((c) => !demoted.has(c.id)).sort((a, b) => b.score - a.score);
      const sunk = fresh.filter((c) => demoted.has(c.id)).map((c, i) => ({ ...c, score: bottom - 1 - i }));
      const leading = pins.filter((p) => !archived(p)).map((p, i, all) => ({ ...p, score: top + all.length - i }));
      return { ...res, value: [...leading, ...kept, ...sunk] };
    },
  };
}

/**
 * Every pin tonight, as candidates in the order pinned: each is checked as a single promote is (not found, already posted,
 * on the calendar: skipped with why on the move) and one that is gone does not stop the rest. Done before the run spends
 * anything. Never throws.
 */
export async function pickPins(query: Query, storyIds: readonly string[]): Promise<ScoredCandidate[]> {
  const out: ScoredCandidate[] = [];
  for (const id of storyIds) {
    try {
      const found = await loadPromoted(query, id);
      if (found) out.push(found);
    } catch {
      // degrade: this pin is not made tonight
    }
  }
  return out;
}

/** The member URLs of archived stories, from the stored shortlists, so a story whose id drifted is still caught. Never throws. */
export async function loadArchivedUrls(query: Query, storyIds: readonly string[]): Promise<Set<string>> {
  const urls = new Set<string>();
  for (const id of storyIds) {
    try {
      for (const c of await loadPinnedCandidates(query, [id])) for (const u of [c.url, ...c.members.map((m) => m.url)]) urls.add(u);
    } catch {
      // Not in any recent shortlist: matched by id only.
    }
  }
  return urls;
}

/** After the run: every pin the run shipped is used; one it did not is skipped with why. */
export async function settlePins(query: Query, storyIds: readonly string[], result: Pick<RunDayResult, 'shipped' | 'onCalendar' | 'setAsides'>): Promise<void> {
  for (const id of storyIds) await settlePromote(query, id, result);
}

/** After the run: the promote is used when shipped (made or a stored post reused); otherwise why, on the move. */
export async function settlePromote(query: Query, storyId: string, result: Pick<RunDayResult, 'shipped' | 'onCalendar' | 'setAsides'>): Promise<void> {
  const ideaId = carouselIdeaId(storyId);
  if (result.shipped.some((e) => e.storyId === storyId)) {
    await markPromoteUsed(query, 'carousels', ideaId);
    return;
  }
  const aside = result.setAsides.find((s) => s.storyId === storyId);
  // The run stopping before it is transient: no skip is recorded, so the promote is tried again next night.
  const reason = result.onCalendar.includes(storyId)
    ? ON_CALENDAR
    : aside
      ? `The pipeline set it aside at ${aside.stage} (${aside.reasonCode}).`
      : null;
  if (reason) await recordPromoteSkip(query, 'carousels', ideaId, reason);
}
