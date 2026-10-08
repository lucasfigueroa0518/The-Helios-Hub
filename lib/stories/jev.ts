/**
 * Jev for Stories (plan §2): the reels transport, Stories' own log and cost
 * rows (stories.jev_logs, stories.cost_events), so Stories spend never counts
 * toward the Reels watch. Tests pass a stub transport; nothing calls Jev
 * offline.
 */
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { QuestionSet } from '@/lib/reels/jev/question-set';
import { jevUsd, type JevTransport } from '@/lib/reels/jev/runner';
import type { StoriesDb } from '@/lib/stories/db';
import { recordCost, recordJevLog } from '@/lib/stories/repository';

export type StoriesJevRequest<Q extends Questions> = {
  component: string;
  set: QuestionSet<Q>;
  state: EntryType;
  setId: string | null;
};

export interface StoriesJev {
  ask<const Q extends Questions>(req: StoriesJevRequest<Q>): Promise<SystemOneResult<Q>>;
  readonly calls: number;
  readonly usd: number;
}

export function createStoriesJev(transport: JevTransport, db: StoriesDb): StoriesJev {
  let calls = 0;
  let usd = 0;
  return {
    get calls() {
      return calls;
    },
    get usd() {
      return usd;
    },
    async ask(req) {
      const result = await transport.systemOne(req.state, req.set.questions);
      calls++;
      const cost = jevUsd(result.usage.input_tokens);
      usd += cost;
      await recordJevLog(db, { setId: req.setId, component: req.component, questionSetId: req.set.id, questionSetVersion: req.set.version, resolvedModel: result.model, state: req.state, answers: result.answers, inputTokens: result.usage.input_tokens });
      await recordCost(db, { setId: req.setId, vendor: 'jev', component: req.component, inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens, usd: cost });
      return result;
    },
  };
}
