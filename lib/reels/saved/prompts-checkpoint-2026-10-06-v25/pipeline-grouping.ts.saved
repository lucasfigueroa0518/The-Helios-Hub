import {
  GROUP_SIZE_CAP,
  HIGH_CONFIDENCE,
  IDEA_MERGE_EXCERPT_CHARS,
  IDEA_MERGE_PASSES,
  SHORTLIST_LIMIT,
} from '@/lib/reels/config';
import {
  contentCandidates,
  contentIdeaPairs,
  loadMatchPool,
  loadPoolMembership,
  unionCandidates,
  unionIdeaPairs,
  type MatchPool,
} from '@/lib/reels/grouping/content-candidates';
import { GROUPING } from '@/lib/reels/jev/questions/grouping';
import { IDEA_MERGE } from '@/lib/reels/jev/questions/idea-merge';
import type { JevRunner } from '@/lib/reels/jev/runner';
import { excerpt } from '@/lib/reels/jev/state';
import { errorText, guardItem } from '@/lib/reels/pipeline/guard';
import {
  addMember,
  createPostIdea,
  findDecision,
  findUrlTwin,
  listUngroupedSources,
  mergeIdeas,
  recordDecision,
  resetTimelyFlags,
  shortlistCandidates,
  shortlistIdeaMerges,
  summarizeIdea,
  type IdeaSummary,
  type PoolSource,
  type ShortlistCandidate,
} from '@/lib/reels/repository';
import { dbQuery } from '@/lib/db';
import type { GroupingAction } from '@/lib/reels/types';

export type GroupingSummary = {
  created: number;
  joined: number;
  merges: number;
  links: number;
  comparisons: number;
  /** Whole ideas fused into another because they covered one event (D-071). */
  ideaMerges: number;
  /** One source or pair threw. The rest of the night still groups. */
  failures: string[];
};

export type GroupingDeps = { jev: JevRunner };

/**
 * Phase 2. Each new source either joins an existing post idea or becomes one.
 *
 * Code narrows first and Jev only sees what survived: an exact canonical-URL
 * match is an automatic merge with no model call at all, and everything else
 * comes from a trigram shortlist against the 72-hour reference pool (GRP-01 /
 * D-055). Decisions are stored by URL pair and never re-asked, which is what
 * keeps a re-run from reshuffling last night's groups (GRP-07 / D-058).
 */
export async function groupRun(
  runId: string,
  runStartedAt: Date,
  deps: GroupingDeps,
): Promise<GroupingSummary> {
  const summary: GroupingSummary = {
    created: 0,
    joined: 0,
    merges: 0,
    links: 0,
    comparisons: 0,
    ideaMerges: 0,
    failures: [],
  };

  const newSources = await listUngroupedSources();
  // D-265. One content pool per run. If it cannot load, grouping still runs
  // on the headline shortlist alone, as it did before.
  const pool = await loadMatchPool().catch((error) => {
    summary.failures.push(`Content pool: ${errorText(error)}`);
    return null;
  });

  // Placing one source can pull an unplaced neighbour into an idea with it, so
  // the set is re-checked as we go rather than trusted from the first read.
  const placed = new Set<string>();

  for (const source of newSources) {
    if (placed.has(source.id)) continue;
    const failure = await guardItem(source.headline, () => placeSource(source, runId, deps, summary, placed, pool));
    if (failure) summary.failures.push(failure);
  }

  summary.ideaMerges = await mergeSameEventIdeas(runId, deps, summary, pool);

  await resetTimelyFlags(runStartedAt);
  return summary;
}

/**
 * Second pass: fuse ideas that turn out to be the same event (D-071).
 *
 * Placement only ever attaches a source to its single best idea, so two ideas
 * can form independently around one event. Code proposes the pairs from
 * headline similarity across their members; Jev decides. Runs until no pair
 * merges, because merging A into B can make B a match for C.
 */
async function mergeSameEventIdeas(
  runId: string,
  deps: GroupingDeps,
  summary: GroupingSummary,
  pool: MatchPool | null,
): Promise<number> {
  let merged = 0;

  for (let pass = 0; pass < IDEA_MERGE_PASSES; pass += 1) {
    // D-265. Headline pairs plus pairs whose stories overlap in content.
    const candidates = unionIdeaPairs(
      await shortlistIdeaMerges(),
      pool ? contentIdeaPairs(pool, await loadPoolMembership(pool)) : [],
    );
    let mergedThisPass = 0;

    for (const candidate of candidates) {
      let left: IdeaSummary | null;
      let right: IdeaSummary | null;
      try {
        [left, right] = await Promise.all([
          summarizeIdea(candidate.left_id),
          summarizeIdea(candidate.right_id),
        ]);
      } catch (error) {
        summary.failures.push(errorText(error));
        continue;
      }
      try {
        // A merge earlier in this pass may have already absorbed one of them.
        if (!left || !right || !left.primary_url || !right.primary_url) continue;

        const stored = await findDecision(left.primary_url, right.primary_url);
        if (stored) {
          if (storedAction(stored) === 'leave') continue;
        } else if (!(await askIdeaMerge(left, right, runId, deps, summary))) {
          continue;
        }

        // Keep the older idea so a long-running story holds its identity.
        const [target, absorbed] = left.member_count >= right.member_count
          ? [left, right]
          : [right, left];

        await mergeIdeas(target.id, absorbed.id, runId, 'jev: same event as another idea');
        merged += 1;
        mergedThisPass += 1;
      } catch (error) {
        summary.failures.push(errorText(error));
      }
    }

    if (mergedThisPass === 0) break;
  }

  return merged;
}

async function askIdeaMerge(
  left: IdeaSummary,
  right: IdeaSummary,
  runId: string,
  deps: GroupingDeps,
  summary: GroupingSummary,
): Promise<boolean> {
  summary.comparisons += 1;

  const { answers } = await deps.jev.ask({
    component: 'idea-merge',
    state: {
      group_a: {
        headlines: left.headlines,
        untrusted_content: excerpt(left.excerpt ?? '', IDEA_MERGE_EXCERPT_CHARS),
      },
      group_b: {
        headlines: right.headlines,
        untrusted_content: excerpt(right.excerpt ?? '', IDEA_MERGE_EXCERPT_CHARS),
      },
    },
    sets: [IDEA_MERGE],
    questions: IDEA_MERGE.questions,
    runId,
    postIdeaId: left.id,
  });

  const merge = resolveIdeaMerge(answers.sameEvent.noul, answers.action);

  await recordDecision({
    a: left.primary_url as string,
    b: right.primary_url as string,
    action: merge ? 'merge' : 'leave',
    sameEventP: answers.sameEvent.noul,
    confidence: answers.action.confidence,
    runId,
  });

  return merge;
}

async function placeSource(
  source: PoolSource,
  runId: string,
  deps: GroupingDeps,
  summary: GroupingSummary,
  placed: Set<string>,
  pool: MatchPool | null = null,
): Promise<void> {
  const twin = await findUrlTwin(source.id, source.canonical_url);
  if (twin) {
    const joined = await attach(twin, source, 'merged_duplicate', runId, 'auto-merge: same URL', summary, placed);
    if (joined) {
      summary.merges += 1;
      summary.joined += 1;
      placed.add(source.id);
      await recordDecision({
        a: source.canonical_url,
        b: twin.canonical_url,
        action: 'merge',
        sameEventP: 1,
        confidence: 1,
        runId,
      });
      return;
    }
  }

  // D-265. The headline shortlist, plus the sources whose content overlaps
  // most, including members of recently published ideas.
  const candidates = unionCandidates(
    await shortlistCandidates(source.id, source.headline, SHORTLIST_LIMIT),
    pool ? await contentCandidates(pool, source) : [],
  );

  // Score the whole shortlist rather than taking the first acceptable match.
  // Candidates are ordered by headline similarity, which is not the same as
  // being the best story match: on the first real night a launch story
  // attached to the first candidate that cleared the bar while a stronger
  // match sat further down the list.
  let best: { candidate: ShortlistCandidate; action: GroupingAction; strength: number } | null = null;

  for (const candidate of candidates) {
    const { action, strength } = await decide(source, candidate, runId, deps, summary);
    if (action === 'leave') continue;
    if (!best || strength > best.strength) best = { candidate, action, strength };
  }

  if (best) {
    const role = best.action === 'merge' ? 'merged_duplicate' : 'supporting';
    const joined = await attach(
      best.candidate,
      source,
      role,
      runId,
      `jev: ${best.action}`,
      summary,
      placed,
    );
    if (joined) {
      if (best.action === 'merge') summary.merges += 1;
      else summary.links += 1;
      summary.joined += 1;
      placed.add(source.id);
      return;
    }
  }

  await createPostIdea(source.id, runId, 'new post idea');
  summary.created += 1;
  placed.add(source.id);
}

/** How good a match this is, for choosing between several acceptable ones. */
type Verdict = { action: GroupingAction; strength: number };

async function decide(
  source: PoolSource,
  candidate: ShortlistCandidate,
  runId: string,
  deps: GroupingDeps,
  summary: GroupingSummary,
): Promise<Verdict> {
  const stored = await findDecision(source.canonical_url, candidate.canonical_url);
  if (stored) {
    return {
      action: storedAction(stored),
      strength: stored.same_event_p ?? 0,
    };
  }

  summary.comparisons += 1;

  // Both questions go in one request; the planted-instruction check already ran
  // on both items at ingest, so it is not repeated here.
  const { answers } = await deps.jev.ask({
    component: 'grouping',
    state: {
      item_a: {
        headline: source.headline,
        source: source.source_name,
        source_type: source.source_type,
        published: source.publish_time,
        untrusted_content: excerpt(source.body),
      },
      item_b: {
        headline: candidate.headline,
        source: candidate.source_name,
        source_type: candidate.source_type,
        published: candidate.publish_time,
        untrusted_content: excerpt(candidate.body),
      },
    },
    sets: [GROUPING],
    questions: GROUPING.questions,
    runId,
    sourceId: source.id,
    postIdeaId: candidate.post_idea_id,
  });

  const action = resolveAction(answers.sameEvent.noul, answers.relationship);

  await recordDecision({
    a: source.canonical_url,
    b: candidate.canonical_url,
    action,
    sameEventP: answers.sameEvent.noul,
    confidence: answers.relationship.confidence,
    runId,
  });

  // D-265. Strength is how sure Jev is that it is the same story; merge or
  // link only decides the member's role.
  return { action, strength: answers.sameEvent.noul };
}

/**
 * GRP-03 / D-057, revised by D-265. The same-story probability decides
 * whether the source joins; the relationship only decides its role. Being
 * unsure between merge and link is not doubt that it is the same story, and
 * the old rule threw those away: 15 of the 43 pairs Jev judged the same event
 * at 0.8 or more, including a Flock duplicate at 0.98. A merge needs its own
 * confidence; otherwise the source joins as a link. Only a confident
 * "unrelated" overrides a same-story yes.
 */
export function resolveAction(
  sameEventProbability: number,
  relationship: { choice: string; confidence: number },
): GroupingAction {
  if (sameEventProbability < HIGH_CONFIDENCE) return 'leave';
  if (relationship.choice === 'unrelated' && relationship.confidence >= HIGH_CONFIDENCE) return 'leave';
  if (relationship.choice === 'merge' && relationship.confidence >= HIGH_CONFIDENCE) return 'merge';
  return 'link';
}

/**
 * D-265. A decision stored under the old rule as "leave" with a same-story
 * probability at the bar was a role tie, not a no. It reads as a link now.
 * A human override always stands.
 */
export function storedAction(stored: {
  action: GroupingAction;
  same_event_p: number | null;
  confidence: number | null;
  override?: boolean | string | null;
}): GroupingAction {
  if (stored.override) return stored.action;
  if (stored.action === 'leave' && (stored.same_event_p ?? 0) >= HIGH_CONFIDENCE && (stored.confidence ?? 0) < HIGH_CONFIDENCE) {
    return 'link';
  }
  return stored.action;
}

/** D-265. Same rule for two ideas: the same story merges unless Jev is sure to keep them apart. */
export function resolveIdeaMerge(
  sameEventProbability: number,
  action: { choice: string; confidence: number },
): boolean {
  if (sameEventProbability < HIGH_CONFIDENCE) return false;
  return !(action.choice === 'keep_separate' && action.confidence >= HIGH_CONFIDENCE);
}

/**
 * The cap counts distinct angles, so a near-duplicate still folds into the
 * primary once an idea is full rather than spawning a second idea for the same
 * event (GRP-06 / D-058).
 */
async function countCappedMembers(postIdeaId: string): Promise<number> {
  const { rows } = await dbQuery<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM reels.post_idea_members
      WHERE post_idea_id = $1
        AND role <> 'merged_duplicate'`,
    [postIdeaId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function attach(
  candidate: ShortlistCandidate,
  source: PoolSource,
  role: 'supporting' | 'merged_duplicate',
  runId: string,
  reason: string,
  summary: GroupingSummary,
  placed: Set<string>,
): Promise<boolean> {
  let postIdeaId = candidate.post_idea_id;

  if (!postIdeaId) {
    // The match is another source from tonight that nothing has placed yet, so
    // it becomes the primary of a new idea and the current source joins it.
    postIdeaId = await createPostIdea(candidate.source_id, runId, 'new post idea');
    summary.created += 1;
    placed.add(candidate.source_id);
  }

  if (role === 'supporting' && (await countCappedMembers(postIdeaId)) >= GROUP_SIZE_CAP) {
    return false;
  }

  await addMember(postIdeaId, source.id, role, runId, reason);
  return true;
}
