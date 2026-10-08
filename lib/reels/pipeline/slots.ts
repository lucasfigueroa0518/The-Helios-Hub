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
import { copyPromptApproved, shipStoredCopy, writeTargetCopy, type IdeaCopyOutcome } from '@/lib/reels/pipeline/copy';
import { requestFinish } from '@/lib/reels/visual/finish';
import { dbQuery } from '@/lib/db';

export type PassingGeneration = {
  status: 'skipped' | 'ok' | 'partial';
  filled: Array<{ slot: number; postIdeaId: string; passed: boolean; locked: boolean }>;
  /** D-245, D-247. Ideas kept out of the slots tonight, and why. */
  heldOut: Array<{ postIdeaId: string; reason: HeldOutReason }>;
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
 */
export async function generatePassingReels(input: {
  runId: string | null;
  slateId: string;
  count?: number;
  client?: CopyClient;
  signal?: AbortSignal;
  jev?: JevRunner;
}): Promise<PassingGeneration> {
  const count = input.count ?? PASSING_REELS_PER_NIGHT;
  if (!copyPromptApproved()) return { status: 'skipped', filled: [], heldOut: [], usd: 0, failures: [] };
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
  const ideas = slotIdeas.filter((idea) => !held.has(idea.id));
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
    if (slot.locked) continue;
    await requestFinish(slot.postIdeaId, input.slateId, { start: 'frame' }).catch((error) => {
      failures.push(
        `${slot.postIdeaId}: ${error instanceof Error ? error.message : 'could not queue the frame'}`,
      );
    });
  }

  const made = filled.length;
  return {
    status: failures.length === 0 && made >= 1 ? 'ok' : 'partial',
    filled,
    heldOut,
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
