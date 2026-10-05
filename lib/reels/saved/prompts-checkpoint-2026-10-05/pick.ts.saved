import { COPY_PAYOFF } from '@/lib/reels/jev/questions/copy-payoff';
import { COPY_PICK } from '@/lib/reels/jev/questions/copy-pick';
import { COPY_STORY_MATCH } from '@/lib/reels/jev/questions/copy-story-match';
import { ON_SCREEN_WORD_RANGE, countWords, type CopyCall } from '@/lib/reels/copy/report';
import { normalizeJevScore, type BucketId } from '@/lib/reels/scoring/decide';

/**
 * D-195, D-216. Rank on-screen lines after Jev has judged each one alone.
 *
 * A line clears the gate when plain read and stake are both at least 0.75,
 * its word count is inside the bucket range, and Jev says it tells the same
 * story as its caption's opening. On Ball Knowledge, payoff stands in for
 * plain read (D-231). Eligible lines rank on performance: loop,
 * care, and reward, weighed equally. Ties break on plain read, then reward,
 * then the earlier line.
 *
 * When no line from the two draft calls clears the gate, the pipeline makes
 * one rewrite call with the scores attached. When still no line clears it,
 * the line nearest the bar is the one a single idea would ship: in-range
 * lines first, then the higher of each line's weaker gate score (plain or
 * stake), then performance. The weaker-score rule keeps a clear but pointless
 * line, or a compelling but confusing one, from winning. A generation of
 * several reels does not ship that miss until four ideas have been tried
 * (D-224). The Scores button for one idea still ships it.
 */

export const COPY_CALLS_PER_IDEA = 2;
export const COPY_REWRITE_CALLS = 1;
export const COMPREHENSION_GATE = 0.75;
export const STAKE_GATE = 0.75;
export const SAME_STORY_BAR = 0.5;
export const COPY_PICK_WEIGHTS = { loop: 1 / 3, care: 1 / 3, reward: 1 / 3 } as const;

/** Raw Jev scores for one line, 0 to 4. */
export type CopyLineScore = {
  plain: number;
  stake: number;
  loop: number;
  care: number;
  reward: number;
};

/**
 * The five scores plus Jev's same-story probability, 0 to 1.
 * `payoff` is set only for Ball Knowledge, raw 0 to 4 before ranking, and
 * 0 to 1 once stored. When it is set, it replaces plain read on the gate.
 */
export type CopyLineJudgment = CopyLineScore & { sameStory: number; payoff?: number | null };

export type RankedCopyLine = {
  index: number;
  plain: number;
  stake: number;
  loop: number;
  care: number;
  reward: number;
  sameStory: number;
  /** Normalized 0 to 1 when this line was judged as Ball Knowledge. */
  payoff: number | null;
  inRange: boolean;
  /** The weaker of plain and stake: how near the line is to clearing both bars. */
  gate: number;
  performance: number;
  eligible: boolean;
};

export type CopyVariantLine = {
  callIndex: number;
  lineIndex: number;
  onScreenCopy: string;
  viewerStake: string;
  caption: string;
  callToAction: string;
  hashtags: string[];
  sources: CopyCall['sources'];
  words: number;
  inRange: boolean;
  plain: number | null;
  stake: number | null;
  loop: number | null;
  care: number | null;
  reward: number | null;
  sameStory: number | null;
  payoff: number | null;
  gate: number | null;
  performance: number | null;
  eligible: boolean | null;
  winner: boolean;
};

export type CopyCallKind = 'draft' | 'rewrite';

export type CopyVariants = {
  complete: boolean;
  questionSetVersion: string;
  storyQuestionSetVersion: string;
  /** Set when the lines were judged as Ball Knowledge. */
  payoffQuestionSetVersion: string | null;
  /** True when a rewrite call was made because no draft line cleared the gate. */
  rewrote: boolean;
  /** Whether the shipped line cleared the gate, or was the nearest miss. */
  winnerEligible: boolean | null;
  calls: Array<{
    index: number;
    kind: CopyCallKind;
    error: string | null;
    working: CopyCall['working'] | null;
  }>;
  lines: CopyVariantLine[];
  winnerIndex: number | null;
};

export type DraftCall = { call: CopyCall | null; error: string | null; kind?: CopyCallKind };

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

const PLAIN_UNITS = units(COMPREHENSION_GATE);
const STAKE_UNITS = units(STAKE_GATE);
const STORY_UNITS = units(SAME_STORY_BAR);

export function performanceScore(line: Pick<RankedCopyLine, 'loop' | 'care' | 'reward'>): number {
  return (
    COPY_PICK_WEIGHTS.loop * line.loop +
    COPY_PICK_WEIGHTS.care * line.care +
    COPY_PICK_WEIGHTS.reward * line.reward
  );
}

export function wordsInRange(onScreenCopy: string, bucket: BucketId): boolean {
  const range = ON_SCREEN_WORD_RANGE[bucket];
  const words = countWords(onScreenCopy);
  return words >= range.min && words <= range.max;
}

function byPerformance(a: RankedCopyLine, b: RankedCopyLine): number {
  return (
    units(b.performance) - units(a.performance) ||
    units(comprehensionOf(b)) - units(comprehensionOf(a)) ||
    units(b.reward) - units(a.reward) ||
    a.index - b.index
  );
}

/** Plain read, or payoff when this line was judged as Ball Knowledge. */
function comprehensionOf(line: { plain: number; payoff: number | null }): number {
  return line.payoff ?? line.plain;
}

function byNearestMiss(a: RankedCopyLine, b: RankedCopyLine): number {
  return (
    Number(b.inRange) - Number(a.inRange) ||
    units(b.gate) - units(a.gate) ||
    units(b.performance) - units(a.performance) ||
    units(comprehensionOf(b)) - units(comprehensionOf(a)) ||
    a.index - b.index
  );
}

/** Raw judgments, one per line, in line order. Returns the winner's index. */
export function rankCopyLines(
  raw: ReadonlyArray<CopyLineJudgment & { inRange: boolean }>,
): { winner: number; eligible: boolean; ranked: RankedCopyLine[] } {
  if (raw.length === 0) throw new Error('Copy pick needs at least one on-screen line.');
  const ranked = raw.map((line, index) => {
    const plain = normalizeJevScore(line.plain);
    const stake = normalizeJevScore(line.stake);
    const loop = normalizeJevScore(line.loop);
    const care = normalizeJevScore(line.care);
    const reward = normalizeJevScore(line.reward);
    const sameStory = Math.min(1, Math.max(0, line.sameStory));
    const payoff = line.payoff == null ? null : normalizeJevScore(line.payoff);
    const comprehension = payoff ?? plain;
    const eligible =
      units(comprehension) >= PLAIN_UNITS &&
      units(stake) >= STAKE_UNITS &&
      line.inRange &&
      units(sameStory) >= STORY_UNITS;
    const scored = {
      index,
      plain,
      stake,
      loop,
      care,
      reward,
      sameStory,
      payoff,
      inRange: line.inRange,
      gate: Math.min(comprehension, stake),
      performance: 0,
      eligible,
    };
    return { ...scored, performance: performanceScore(scored) };
  });
  const eligible = ranked.filter((line) => line.eligible);
  const winner =
    eligible.length > 0 ? [...eligible].sort(byPerformance)[0] : [...ranked].sort(byNearestMiss)[0];
  return { winner: winner.index, eligible: eligible.length > 0, ranked };
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
 * Build the stored decision. `judgments` is null when Jev did not judge, and
 * then nothing is marked the winner.
 */
export function buildCopyVariants(
  calls: readonly DraftCall[],
  judgments: readonly CopyLineJudgment[] | null,
  bucket: BucketId,
): {
  variants: CopyVariants;
  winner: { call: CopyCall; onScreenCopy: string; eligible: boolean } | null;
} {
  const lines = flattenCopyCalls(calls);
  if (judgments && judgments.length !== lines.length) {
    throw new Error(`Copy pick judged ${judgments.length} lines and held ${lines.length}.`);
  }
  const inRange = lines.map((line) => wordsInRange(line.onScreenCopy, bucket));
  const ranked = judgments
    ? rankCopyLines(judgments.map((judgment, index) => ({ ...judgment, inRange: inRange[index] })))
    : null;
  const picked = ranked?.winner ?? null;
  const drafts = calls.filter((draft) => (draft.kind ?? 'draft') === 'draft');

  return {
    winner:
      picked == null || !ranked
        ? null
        : { call: lines[picked].call, onScreenCopy: lines[picked].onScreenCopy, eligible: ranked.eligible },
    variants: {
      complete: drafts.length === COPY_CALLS_PER_IDEA && calls.every((draft) => draft.call != null),
      questionSetVersion: COPY_PICK.version,
      storyQuestionSetVersion: COPY_STORY_MATCH.version,
      payoffQuestionSetVersion: bucket === 'ball_knowledge' && judgments ? COPY_PAYOFF.version : null,
      rewrote: calls.some((draft) => draft.kind === 'rewrite'),
      winnerEligible: ranked ? ranked.eligible : null,
      calls: calls.map((draft, index) => ({
        index,
        kind: draft.kind ?? 'draft',
        error: draft.error,
        working: draft.call?.working ?? null,
      })),
      lines: lines.map((line) => {
        const score = ranked?.ranked.find((entry) => entry.index === line.index) ?? null;
        return {
          callIndex: line.callIndex,
          lineIndex: line.lineIndex,
          onScreenCopy: line.onScreenCopy,
          viewerStake: line.call.viewerStake,
          caption: line.call.caption,
          callToAction: line.call.callToAction,
          hashtags: line.call.hashtags,
          sources: line.call.sources,
          words: countWords(line.onScreenCopy),
          inRange: inRange[line.index],
          plain: score?.plain ?? null,
          stake: score?.stake ?? null,
          loop: score?.loop ?? null,
          care: score?.care ?? null,
          reward: score?.reward ?? null,
          sameStory: score?.sameStory ?? null,
          payoff: score?.payoff ?? null,
          gate: score?.gate ?? null,
          performance: score?.performance ?? null,
          eligible: score?.eligible ?? null,
          winner: picked === line.index,
        };
      }),
      winnerIndex: picked,
    },
  };
}

/** What the rewrite call is shown: each draft line with its judged scores, 0 to 1. */
export type CopyRewriteLine = {
  onScreenCopy: string;
  words: number;
  inRange: boolean;
  scores: { plain: number; stake: number; loop: number; care: number; reward: number; payoff?: number | null };
  sameStory: boolean;
};

export function rewriteLines(lines: readonly CopyVariantLine[]): CopyRewriteLine[] {
  return lines.flatMap((line) => {
    if (
      line.plain == null ||
      line.stake == null ||
      line.loop == null ||
      line.care == null ||
      line.reward == null ||
      line.sameStory == null
    ) {
      return [];
    }
    return [
      {
        onScreenCopy: line.onScreenCopy,
        words: line.words,
        inRange: line.inRange,
        scores: {
          plain: line.plain,
          stake: line.stake,
          loop: line.loop,
          care: line.care,
          reward: line.reward,
          payoff: line.payoff,
        },
        sameStory: units(line.sameStory) >= STORY_UNITS,
      },
    ];
  });
}
