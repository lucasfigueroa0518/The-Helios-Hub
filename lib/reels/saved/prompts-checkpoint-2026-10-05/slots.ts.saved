import { rankCopyLines, type CopyLineJudgment } from '@/lib/reels/copy/pick';
import { rankForSlate, type RankedIdea } from '@/lib/reels/scoring/decide';

/**
 * D-224. A generation of N reels fills N slots with copy that clears the gate.
 * The idea that opens a slot gets two tries (the drafts, then one rewrite).
 * Each idea that replaces it gets one try. An idea that misses its tries is
 * penalized for that New York day and the next idea comes up. After four
 * ideas have missed a slot, the highest-graded line from those four ships.
 * Tomorrow's carryover reads the original net, not the penalty.
 */

/** Ideas tried for one slot before the best line among them ships. */
export const COPY_SLOT_ATTEMPTS = 4;

/**
 * Floor for a day's demotion. One full scoring component. On a real slate the
 * top few nets sit well inside that gap, so a demoted idea cannot re-enter
 * the same pool of four.
 */
export const COPY_GATE_DAY_PENALTY = 1;

export type SlotIdea = {
  id: string;
  /** The stored net. Carryover reads this. The penalty is applied only for today's order. */
  net: number;
  bucketScore: number;
  psychologyScore: number;
  lastJoinedMs: number;
  confidence: number;
};

export type SlotLock = { slot: number; postIdeaId: string };

export type GradedLine = CopyLineJudgment & { inRange: boolean; ideaId: string; lineIndex: number };

export type FilledSlot = {
  slot: number;
  postIdeaId: string;
  passed: boolean;
  locked: boolean;
};

export type SlotAttempt = {
  passed: boolean;
  /** False when the writer failed before Jev judged any line. That idea is not penalized. */
  judged: boolean;
  lines: GradedLine[];
};

export function orderedForSlots(ideas: readonly SlotIdea[], penaltyOf: (id: string) => number): SlotIdea[] {
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  const ranked: RankedIdea[] = ideas.map((idea) => ({
    id: idea.id,
    net: idea.net - penaltyOf(idea.id),
    bucketScore: idea.bucketScore,
    psychologyScore: idea.psychologyScore,
    lastJoinedMs: idea.lastJoinedMs,
    confidence: idea.confidence,
  }));
  return rankForSlate(ranked)
    .map((idea) => byId.get(idea.id))
    .filter((idea): idea is SlotIdea => idea != null);
}

/**
 * How far to drop an idea so it sits under every story still in this pool of
 * four. Never smaller than COPY_GATE_DAY_PENALTY.
 */
export function dayPenalty(ideaNet: number, nextNets: readonly number[]): number {
  if (nextNets.length === 0) return COPY_GATE_DAY_PENALTY;
  const toClear = ideaNet - Math.min(...nextNets) + 0.01;
  return Math.round(Math.max(COPY_GATE_DAY_PENALTY, toClear) * 100) / 100;
}

/** The line rankCopyLines would ship from a pool where nothing cleared the gate. */
export function bestGradedLine(lines: readonly GradedLine[]): GradedLine | null {
  if (lines.length === 0) return null;
  const { winner } = rankCopyLines(lines);
  return lines[winner] ?? null;
}

/**
 * Fill slots 1 through `count`. Locked slots count toward the count and are
 * not written again. `penalties` is updated in place as ideas miss.
 */
export async function fillSlots(input: {
  ideas: readonly SlotIdea[];
  locks: readonly SlotLock[];
  count: number;
  penalties: Map<string, number>;
  attempt: (idea: SlotIdea, rewrite: boolean) => Promise<SlotAttempt>;
  onPenalty: (idea: SlotIdea, penalty: number) => Promise<void> | void;
  onFallback: (idea: SlotIdea, line: GradedLine) => Promise<void> | void;
}): Promise<FilledSlot[]> {
  if (!Number.isInteger(input.count) || input.count < 1) {
    throw new Error(`A generation needs a whole number of reels, not ${input.count}.`);
  }
  const lockAt = new Map(input.locks.map((lock) => [lock.slot, lock]));
  const used = new Set(input.locks.map((lock) => lock.postIdeaId));
  const filled: FilledSlot[] = [];
  const penaltyOf = (id: string) => input.penalties.get(id) ?? 0;

  for (let slot = 1; slot <= input.count; slot += 1) {
    const lock = lockAt.get(slot);
    if (lock) {
      filled.push({ slot, postIdeaId: lock.postIdeaId, passed: true, locked: true });
      continue;
    }

    const tried: Array<{ idea: SlotIdea; lines: GradedLine[] }> = [];
    let passed: SlotIdea | null = null;

    for (let index = 0; index < COPY_SLOT_ATTEMPTS; index += 1) {
      const idea = orderedForSlots(input.ideas, penaltyOf).find(
        (candidate) => !used.has(candidate.id) && !tried.some((row) => row.idea.id === candidate.id),
      );
      if (!idea) break;
      const result = await input.attempt(idea, index === 0);
      tried.push({ idea, lines: result.lines });
      if (result.passed) {
        passed = idea;
        used.add(idea.id);
        break;
      }
      if (!result.judged) continue;
      const upcoming = orderedForSlots(input.ideas, penaltyOf)
        .filter(
          (candidate) =>
            candidate.id !== idea.id &&
            !used.has(candidate.id) &&
            !tried.some((row) => row.idea.id === candidate.id),
        )
        .slice(0, COPY_SLOT_ATTEMPTS - 1)
        .map((candidate) => candidate.net - penaltyOf(candidate.id));
      const penalty = Math.max(penaltyOf(idea.id), dayPenalty(idea.net, upcoming));
      input.penalties.set(idea.id, penalty);
      await input.onPenalty(idea, penalty);
    }

    if (passed) {
      filled.push({ slot, postIdeaId: passed.id, passed: true, locked: false });
      continue;
    }

    const best = bestGradedLine(tried.flatMap((row) => row.lines));
    const idea = best ? tried.find((row) => row.idea.id === best.ideaId)?.idea : undefined;
    if (!best || !idea) continue;
    await input.onFallback(idea, best);
    used.add(idea.id);
    filled.push({ slot, postIdeaId: idea.id, passed: false, locked: false });
  }

  return filled;
}
