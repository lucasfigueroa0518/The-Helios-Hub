import { newAnthropic } from '@/lib/anthropic-client';

import { COPY_MODEL, PASSING_REELS_PER_NIGHT } from '@/lib/reels/config';
import { resolveCopyModel } from '@/lib/reels/copy/model';
import { holdOutReasons, loadPublishedStoryKeys, loadWideCopyMisses, type HeldOutReason } from '@/lib/reels/copy/held-out';
import { fillSlots, type GradedLine, type SlotIdea } from '@/lib/reels/copy/slots';
import { loadCopyTargets, type CopyTarget } from '@/lib/reels/copy/store';
import type { CopyClient } from '@/lib/reels/copy/writer';
import type { JevRunner } from '@/lib/reels/jev/runner';
import {
  clearDayPenalty,
  loadDayPenalties,
  loadSlotIdeas,
  locksForSlate,
  saveDayPenalty,
  selectFilledIdeas,
} from '@/lib/reels/locks';
import { shipStoredCopy, writeTargetCopy, type IdeaCopyOutcome } from '@/lib/reels/pipeline/copy';
import { placedIdeas, reusableVideos } from '@/lib/reels/pipeline/fill';
import { requestFinish } from '@/lib/reels/visual/finish';
import { dbQuery } from '@/lib/db';

export type PassingGeneration = {
  status: 'skipped' | 'ok' | 'partial';
  filled: Array<{ slot: number; postIdeaId: string; passed: boolean; locked: boolean; reused?: boolean }>;
  /** D-245, D-247. Ideas kept out of the slots tonight, and why. */
  heldOut: Array<{ postIdeaId: string; reason: HeldOutReason }>;
  /** Daily fill (D55): slots taken by an earlier day's finished, unposted video; no copy, no render. */
  reused?: Array<{ postIdeaId: string; videoJobId: string }>;
  /** Daily fill (D54): ideas a person already placed, left out of tonight's slots. */
  placed?: string[];
  usd: number;
  failures: string[];
};

/**
 * D-272. Produce up to `count` reels. One slot is the knowledge lane and ships on
 * its best line. One more can ship a miss so the day still has two. A third
 * ships only when another idea clears the gate. A locked reel already fills
 * its slot. Frames are queued only for the reels this run wrote. A story
 * already published, an idea built only from teasers, or an idea whose earlier
 * attempt missed widely never takes a slot (D-245, D-247, D-258).
 *
 * With `dailyFill` (the nightly run, D54/D55): an idea a person already
 * placed sits out, and a carryover idea whose finished video from an
 * earlier day never posted ranks with the rest and, when it comes up for a
 * slot, takes it with that video: no copy is written and nothing is queued.
 */
export async function generatePassingReels(input: {
  runId: string | null;
  slateId: string;
  count?: number;
  client?: CopyClient;
  signal?: AbortSignal;
  jev?: JevRunner;
  /**
   * The nightly daily fill (D54/D55): ideas a person already placed sit out,
   * and a carryover idea whose finished video never posted takes its slot
   * with that video (no copy, no render). Off for hand-run generations.
   */
  dailyFill?: boolean;
}): Promise<PassingGeneration> {
  const count = input.count ?? PASSING_REELS_PER_NIGHT;
  if (!input.client && !process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  const client: CopyClient = input.client ?? newAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = await resolveCopyModel(() => {
    const listed = client as CopyClient & { models?: { list: () => AsyncIterable<{ id: string }> } };
    if (!listed.models) return [];
    return listed.models.list();
  });

  const { rows } = await dbQuery<{ ny_date: string }>(
    `SELECT ny_date::text AS ny_date FROM reels.score_slates WHERE id = $1::uuid`,
    [input.slateId],
  );
  const nyDate = rows[0]?.ny_date;
  if (!nyDate) throw new Error('That slate does not exist.');

  const [slotIdeas, locks, penalties, published, wideMisses] = await Promise.all([
    loadSlotIdeas(input.slateId),
    locksForSlate(input.slateId),
    loadDayPenalties(nyDate),
    loadPublishedStoryKeys(),
    loadWideCopyMisses(nyDate),
  ]);
  const targets = new Map<string, CopyTarget>();
  for (const target of await loadCopyTargets(input.slateId, { all: true })) {
    targets.set(target.postIdeaId, target);
  }
  const held = holdOutReasons(targets.values(), published, wideMisses);
  const heldOut = [...held].map(([postIdeaId, reason]) => ({ postIdeaId, reason }));
  if (heldOut.length > 0) {
    console.info(`[reels] held out of tonight's slots: ${heldOut.map((row) => `${row.postIdeaId} (${row.reason})`).join(', ')}`);
  }
  // Daily fill (D54/D55): a person's placement isn't made again; a finished, unposted carryover video is reused.
  const placed = input.dailyFill ? await placedIdeas(slotIdeas.map((idea) => idea.id)) : new Set<string>();
  const ideas = slotIdeas.filter((idea) => !held.has(idea.id) && !placed.has(idea.id));
  const reusable = input.dailyFill ? await reusableVideos(input.slateId, ideas.map((idea) => idea.id)) : new Map<string, string>();
  if (placed.size > 0) console.info(`[reels] placed by a person, not made again tonight: ${[...placed].join(', ')}`);
  const outcomes = new Map<string, IdeaCopyOutcome>();
  let usd = 0;
  const failures: string[] = [];

  const filled = await fillSlots({
    ideas,
    locks,
    count,
    penalties,
    attempt: async (idea, rewrite) => {
      const target = targets.get(idea.id);
      if (!target) return { passed: false, judged: false, lines: [] };
      const outcome = await writeTargetCopy(client, input.runId, input.slateId, target, {
        signal: input.signal,
        jev: input.jev,
        model: model || COPY_MODEL,
        rewrite,
        shipMiss: false,
      });
      outcomes.set(idea.id, outcome);
      usd += outcome.usd;
      if (!outcome.judged && outcome.error) failures.push(`${idea.id}: ${outcome.error}`);
      return { passed: outcome.passed, judged: outcome.judged, lines: gradedLines(idea, outcome) };
    },
    onPenalty: (idea, penalty) => saveDayPenalty(input.slateId, nyDate, idea.id, penalty),
    reusable: new Set(reusable.keys()),
    onFallback: async (idea, line) => {
      penalties.delete(idea.id);
      await clearDayPenalty(input.slateId, nyDate, idea.id);
      const target = targets.get(idea.id);
      const outcome = outcomes.get(idea.id);
      if (!target || !outcome?.variants) return;
      const shipped = await shipStoredCopy(
        input.runId,
        input.slateId,
        target,
        outcome.variants,
        line.lineIndex,
        outcome,
        { jev: input.jev },
      );
      if (!shipped.ok) failures.push(`${idea.id}: ${shipped.error ?? 'could not ship the best line'}`);
    },
  });

  await selectFilledIdeas(
    input.slateId,
    filled.map((slot) => slot.postIdeaId),
  );
  for (const slot of filled) {
    // A lock stays as it is; a reused video is already made (D55).
    if (slot.locked || slot.reused) continue;
    await requestFinish(slot.postIdeaId, input.slateId, { start: 'frame' }).catch((error) => {
      failures.push(
        `${slot.postIdeaId}: ${error instanceof Error ? error.message : 'could not queue the frame'}`,
      );
    });
  }

  const made = filled.length;
  const reused = filled.flatMap((slot) => {
    const videoJobId = slot.reused ? reusable.get(slot.postIdeaId) : undefined;
    return videoJobId ? [{ postIdeaId: slot.postIdeaId, videoJobId }] : [];
  });
  if (reused.length > 0) console.info(`[reels] reused finished videos: ${reused.map((row) => `${row.postIdeaId} (${row.videoJobId})`).join(', ')}`);
  return {
    status: failures.length === 0 && made >= 1 ? 'ok' : 'partial',
    filled,
    heldOut,
    ...(input.dailyFill ? { reused, placed: [...placed] } : {}),
    usd,
    failures,
  };
}

function gradedLines(idea: SlotIdea, outcome: IdeaCopyOutcome): GradedLine[] {
  const lines = outcome.variants?.lines ?? [];
  return lines.flatMap((line, lineIndex) => {
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
        ideaId: idea.id,
        lineIndex,
        plain: line.plain,
        stake: line.stake,
        loop: line.loop,
        care: line.care,
        reward: line.reward,
        sameStory: line.sameStory,
        payoff: line.payoff,
        inRange: line.inRange,
      },
    ];
  });
}
