import Anthropic from '@anthropic-ai/sdk';

import { COPY_MODEL, PASSING_REELS_PER_NIGHT } from '@/lib/reels/config';
import { resolveCopyModel } from '@/lib/reels/copy/model';
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
  usd: number;
  failures: string[];
};

/**
 * D-224, D-225. Produce `count` reels that clear the copy gate. A locked reel
 * already fills its slot. An idea that misses its tries is demoted for the
 * day, and the next idea tries. After four misses, the best graded line from
 * that pool ships. Frames are queued only for the reels this run wrote.
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
  if (!copyPromptApproved()) return { status: 'skipped', filled: [], usd: 0, failures: [] };
  if (!input.client && !process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set.');
  const client: CopyClient = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

  const [ideas, locks, penalties] = await Promise.all([
    loadSlotIdeas(input.slateId),
    locksForSlate(input.slateId),
    loadDayPenalties(nyDate),
  ]);
  const targets = new Map<string, CopyTarget>();
  for (const target of await loadCopyTargets(input.slateId, { all: true })) {
    targets.set(target.postIdeaId, target);
  }
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
    status: failures.length === 0 && made >= count ? 'ok' : 'partial',
    filled,
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
