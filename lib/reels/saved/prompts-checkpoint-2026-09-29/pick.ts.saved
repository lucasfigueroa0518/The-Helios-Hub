import { COPY_PICK } from '@/lib/reels/jev/questions/copy-pick';
import { countWords, type CopyCall } from '@/lib/reels/copy/report';
import { normalizeJevScore } from '@/lib/reels/scoring/decide';

/**
 * D-195. Rank on-screen lines after Jev has scored each one alone.
 * Plain read is a gate at 0.75. Loop, care, and reward weigh equally.
 * Ties break on higher plain read, then higher reward, then earlier line.
 * When every line is under the gate, the clearest one still ships.
 */

export const COPY_CALLS_PER_IDEA = 2;
export const COMPREHENSION_GATE = 0.75;
export const COPY_PICK_WEIGHTS = { loop: 1 / 3, care: 1 / 3, reward: 1 / 3 } as const;

export type CopyLineScore = {
  plain: number;
  loop: number;
  care: number;
  reward: number;
};

export type RankedCopyLine = {
  index: number;
  plain: number;
  loop: number;
  care: number;
  reward: number;
  performance: number;
  eligible: boolean;
};

export type CopyVariantLine = {
  callIndex: number;
  lineIndex: number;
  onScreenCopy: string;
  caption: string;
  callToAction: string;
  hashtags: string[];
  sources: CopyCall['sources'];
  words: number;
  plain: number | null;
  loop: number | null;
  care: number | null;
  reward: number | null;
  performance: number | null;
  eligible: boolean | null;
  winner: boolean;
};

export type CopyVariants = {
  complete: boolean;
  questionSetVersion: string;
  calls: Array<{ index: number; error: string | null; working: CopyCall['working'] | null }>;
  lines: CopyVariantLine[];
  winnerIndex: number | null;
};

export type DraftCall = { call: CopyCall | null; error: string | null };

export type FlattenedCopyLine = {
  index: number;
  callIndex: number;
  lineIndex: number;
  call: CopyCall;
  onScreenCopy: string;
};

function units(score: number): number {
  return Math.round(score * 10_000);
}

const GATE_UNITS = units(COMPREHENSION_GATE);

export function performanceScore(line: Pick<RankedCopyLine, 'loop' | 'care' | 'reward'>): number {
  return (
    COPY_PICK_WEIGHTS.loop * line.loop +
    COPY_PICK_WEIGHTS.care * line.care +
    COPY_PICK_WEIGHTS.reward * line.reward
  );
}

function byPerformance(a: RankedCopyLine, b: RankedCopyLine): number {
  return (
    units(b.performance) - units(a.performance) ||
    units(b.plain) - units(a.plain) ||
    units(b.reward) - units(a.reward) ||
    a.index - b.index
  );
}

function byClarity(a: RankedCopyLine, b: RankedCopyLine): number {
  return (
    units(b.plain) - units(a.plain) ||
    units(b.performance) - units(a.performance) ||
    units(b.reward) - units(a.reward) ||
    a.index - b.index
  );
}

/** Raw Jev scores, one per line, in line order. Returns the winner's index. */
export function rankCopyLines(raw: readonly CopyLineScore[]): { winner: number; ranked: RankedCopyLine[] } {
  if (raw.length === 0) throw new Error('Copy pick needs at least one on-screen line.');
  const ranked = raw.map((line, index) => {
    const plain = normalizeJevScore(line.plain);
    const loop = normalizeJevScore(line.loop);
    const care = normalizeJevScore(line.care);
    const reward = normalizeJevScore(line.reward);
    const scored = { index, plain, loop, care, reward, performance: 0, eligible: units(plain) >= GATE_UNITS };
    return { ...scored, performance: performanceScore(scored) };
  });
  const eligible = ranked.filter((line) => line.eligible);
  const pool = eligible.length > 0 ? eligible : ranked;
  const winner = [...pool].sort(eligible.length > 0 ? byPerformance : byClarity)[0];
  return { winner: winner.index, ranked };
}

export function flattenCopyCalls(calls: readonly DraftCall[]): FlattenedCopyLine[] {
  const lines: FlattenedCopyLine[] = [];
  calls.forEach((draft, callIndex) => {
    const call = draft.call;
    if (!call) return;
    call.onScreenCopies.forEach((onScreenCopy, lineIndex) => {
      lines.push({ index: lines.length, callIndex, lineIndex, call, onScreenCopy });
    });
  });
  return lines;
}

/**
 * Build the stored decision. `rawScores` is null when Jev did not score, and
 * then nothing is marked the winner.
 */
export function buildCopyVariants(
  calls: readonly DraftCall[],
  rawScores: readonly CopyLineScore[] | null,
): { variants: CopyVariants; winner: { call: CopyCall; onScreenCopy: string } | null } {
  const lines = flattenCopyCalls(calls);
  const ranked = rawScores ? rankCopyLines(rawScores) : null;
  if (ranked && ranked.ranked.length !== lines.length) {
    throw new Error(`Copy pick scored ${ranked.ranked.length} lines and held ${lines.length}.`);
  }
  const picked = ranked?.winner ?? null;

  return {
    winner: picked == null ? null : { call: lines[picked].call, onScreenCopy: lines[picked].onScreenCopy },
    variants: {
      complete: calls.length === COPY_CALLS_PER_IDEA && calls.every((draft) => draft.call != null),
      questionSetVersion: COPY_PICK.version,
      calls: calls.map((draft, index) => ({
        index,
        error: draft.error,
        working: draft.call?.working ?? null,
      })),
      lines: lines.map((line) => {
        const score = ranked?.ranked.find((entry) => entry.index === line.index) ?? null;
        return {
          callIndex: line.callIndex,
          lineIndex: line.lineIndex,
          onScreenCopy: line.onScreenCopy,
          caption: line.call.caption,
          callToAction: line.call.callToAction,
          hashtags: line.call.hashtags,
          sources: line.call.sources,
          words: countWords(line.onScreenCopy),
          plain: score?.plain ?? null,
          loop: score?.loop ?? null,
          care: score?.care ?? null,
          reward: score?.reward ?? null,
          performance: score?.performance ?? null,
          eligible: score?.eligible ?? null,
          winner: picked === line.index,
        };
      }),
      winnerIndex: picked,
    },
  };
}
