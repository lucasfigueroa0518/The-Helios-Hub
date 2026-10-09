import { rankCopyLines, type CopyLineJudgment } from '@/lib/reels/copy/pick';
import { rankForSlate, type BucketId, type FrameworkId, type RankedIdea } from '@/lib/reels/scoring/decide';

/**
 * A night posts two or three reels. Slot 1 is the knowledge lane: the
 * highest-net curiosity or identity idea in Ball Knowledge, or in The Number
 * when curiosity won. That idea is written once (drafts, then one rewrite)
 * and ships on its best line whether or not it clears the gate. A writer
 * failure tries the next idea in the lane. Slot 2 is the highest idea outside
 * that lane. It gets four tries, and the best graded line ships when all four
 * miss, so the day still has two. Slot 3 opens only when slot 2 cleared the
 * gate, and a miss there is not posted. Tomorrow's carryover reads the
 * original net, not the day's penalty.
 */

/** Ideas tried for one general slot before the best line among them ships. */
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
  /** Winning framework. Absent on a fixture that has not been scored. */
  framework?: FrameworkId | null;
  /** Winning bucket. Absent on a fixture that has not been scored. */
  bucket?: BucketId | null;
};

export type SlotLock = { slot: number; postIdeaId: string };

export type GradedLine = CopyLineJudgment & { inRange: boolean; ideaId: string; lineIndex: number };

export type FilledSlot = {
  slot: number;
  postIdeaId: string;
  passed: boolean;
  locked: boolean;
  /** Daily fill (D54): the idea's finished, unposted video from an earlier day takes the slot; nothing is written or rendered. */
  reused?: boolean;
};

export type SlotAttempt = {
  passed: boolean;
  /** False when the writer failed before Jev judged any line. That idea is not penalized. */
  judged: boolean;
  lines: GradedLine[];
};

/**
 * Curiosity or identity, in Ball Knowledge, or in The Number when curiosity
 * won. Saga, Warning, and Personal Profile stay in the general pool.
 */
export function inKnowledgeLane(idea: { framework?: FrameworkId | null; bucket?: BucketId | null }): boolean {
  if (idea.framework !== 'curiosity' && idea.framework !== 'identity') return false;
  if (idea.bucket === 'ball_knowledge') return true;
  return idea.framework === 'curiosity' && idea.bucket === 'the_number';
}

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
 * Fill up to `count` reels. The first open slot is the knowledge lane, unless
 * a lock already holds one. The next open slot can ship a miss. Later slots
 * ship only a line that clears the gate, and stop when one does not. Locked
 * slots count toward the count and are not written again. `penalties` is
 * updated in place as general ideas miss.
 *
 * `reusable` (daily fill, D54): ideas that already have a finished, unposted
 * video. They rank in the same order as every other idea; when one comes up
 * for a slot it takes it as it is, like a lock (no attempt, so no copy and
 * no render), and counts as passing. One that never comes up is not used.
 */
export async function fillSlots(input: {
  ideas: readonly SlotIdea[];
  locks: readonly SlotLock[];
  count: number;
  penalties: Map<string, number>;
  attempt: (idea: SlotIdea, rewrite: boolean) => Promise<SlotAttempt>;
  onPenalty: (idea: SlotIdea, penalty: number) => Promise<void> | void;
  onFallback: (idea: SlotIdea, line: GradedLine) => Promise<void> | void;
  reusable?: ReadonlySet<string>;
}): Promise<FilledSlot[]> {
  if (!Number.isInteger(input.count) || input.count < 1) {
    throw new Error(`A generation needs a whole number of reels, not ${input.count}.`);
  }
  const lockAt = new Map<number, SlotLock>();
  for (const lock of input.locks) {
    if (lock.slot >= 1 && lock.slot <= input.count) lockAt.set(lock.slot, lock);
  }
  const used = new Set(input.locks.map((lock) => lock.postIdeaId));
  const byId = new Map(input.ideas.map((idea) => [idea.id, idea]));
  const filled: FilledSlot[] = [];
  for (const [slot, lock] of [...lockAt.entries()].sort((a, b) => a[0] - b[0])) {
    filled.push({ slot, postIdeaId: lock.postIdeaId, passed: true, locked: true });
  }

  const penaltyOf = (id: string) => input.penalties.get(id) ?? 0;
  let reservedSatisfied = false;
  let passingGeneral = 0;
  for (const lock of lockAt.values()) {
    const idea = byId.get(lock.postIdeaId);
    if (idea && inKnowledgeLane(idea) && !reservedSatisfied) reservedSatisfied = true;
    else passingGeneral += 1;
  }

  const pool = (mode: 'reserved' | 'general', tried: ReadonlySet<string>): SlotIdea[] => {
    const available = orderedForSlots(input.ideas, penaltyOf).filter(
      (idea) => !used.has(idea.id) && !tried.has(idea.id),
    );
    if (mode === 'reserved') {
      const lane = available.filter(inKnowledgeLane);
      return lane.length > 0 ? lane : available;
    }
    const general = available.filter((idea) => !inKnowledgeLane(idea));
    return general.length > 0 ? general : available;
  };

  const penalize = async (idea: SlotIdea, tried: ReadonlySet<string>, mode: 'reserved' | 'general') => {
    const upcoming = pool(mode, tried)
      .slice(0, COPY_SLOT_ATTEMPTS - 1)
      .map((candidate) => candidate.net - penaltyOf(candidate.id));
    const penalty = Math.max(penaltyOf(idea.id), dayPenalty(idea.net, upcoming));
    input.penalties.set(idea.id, penalty);
    await input.onPenalty(idea, penalty);
  };

  const reuse = (slot: number, idea: SlotIdea): FilledSlot => {
    used.add(idea.id);
    return { slot, postIdeaId: idea.id, passed: true, locked: false, reused: true };
  };

  const fillReserved = async (slot: number): Promise<FilledSlot | null> => {
    const tried = new Set<string>();
    let opener = true;
    while (tried.size < input.ideas.length) {
      const idea = pool('reserved', tried)[0];
      if (!idea) return null;
      if (input.reusable?.has(idea.id)) return reuse(slot, idea);
      tried.add(idea.id);
      const result = await input.attempt(idea, opener);
      opener = false;
      if (!result.judged) continue;
      if (result.passed) {
        used.add(idea.id);
        return { slot, postIdeaId: idea.id, passed: true, locked: false };
      }
      const best = bestGradedLine(result.lines);
      if (!best) continue;
      await input.onFallback(idea, best);
      used.add(idea.id);
      return { slot, postIdeaId: idea.id, passed: false, locked: false };
    }
    return null;
  };

  const fillGeneral = async (slot: number, shipMiss: boolean): Promise<FilledSlot | null> => {
    const tried: Array<{ idea: SlotIdea; lines: GradedLine[] }> = [];
    const triedIds = () => new Set(tried.map((row) => row.idea.id));
    let passed: SlotIdea | null = null;

    for (let index = 0; index < COPY_SLOT_ATTEMPTS; index += 1) {
      const idea = pool('general', triedIds())[0];
      if (!idea) break;
      if (input.reusable?.has(idea.id)) return reuse(slot, idea);
      const result = await input.attempt(idea, index === 0);
      tried.push({ idea, lines: result.lines });
      if (result.passed) {
        passed = idea;
        used.add(idea.id);
        break;
      }
      if (!result.judged) continue;
      await penalize(idea, triedIds(), 'general');
    }

    if (passed) return { slot, postIdeaId: passed.id, passed: true, locked: false };
    if (!shipMiss) return null;

    const best = bestGradedLine(tried.flatMap((row) => row.lines));
    const idea = best ? tried.find((row) => row.idea.id === best.ideaId)?.idea : undefined;
    if (!best || !idea) return null;
    await input.onFallback(idea, best);
    used.add(idea.id);
    return { slot, postIdeaId: idea.id, passed: false, locked: false };
  };

  const open: number[] = [];
  for (let slot = 1; slot <= input.count; slot += 1) {
    if (!lockAt.has(slot)) open.push(slot);
  }

  let shippedGeneralMiss = false;
  for (const slot of open) {
    if (!reservedSatisfied) {
      const row = await fillReserved(slot);
      reservedSatisfied = true;
      if (row) filled.push(row);
      continue;
    }
    if (shippedGeneralMiss) break;
    if (passingGeneral === 0) {
      const row = await fillGeneral(slot, true);
      if (!row) break;
      filled.push(row);
      if (row.passed) passingGeneral += 1;
      else shippedGeneralMiss = true;
      continue;
    }
    const row = await fillGeneral(slot, false);
    if (!row) break;
    filled.push(row);
    passingGeneral += 1;
  }

  return filled.sort((a, b) => a.slot - b.slot);
}
