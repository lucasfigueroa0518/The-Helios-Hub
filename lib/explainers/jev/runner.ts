import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { Queryable } from '@/lib/explainers/db';
import { recordCost } from '@/lib/explainers/repository';
import type { Mode } from '@/lib/explainers/types';
import type { QuestionSet } from '@/lib/reels/jev/question-set';
import { jevUsd, type JevTransport } from '@/lib/reels/jev/runner';

export type ExplainersJevRequest<Q extends Questions> = {
  /** Pipeline step, for the log and the cost ledger. */
  component: string;
  state: EntryType;
  set: QuestionSet;
  /** The set's questions, or a subset of them (a partial dedupe batch). */
  questions: Q;
  topicId?: string | null;
};

export interface ExplainersJevRunner {
  ask<const Q extends Questions>(request: ExplainersJevRequest<Q>): Promise<SystemOneResult<Q>>;
  readonly callCount: number;
  readonly usd: number;
}

/**
 * Same transport as Trial Reels, different ledger. Every call is logged to
 * explainers.jev_logs and priced into explainers.cost_events, so explainer Jev
 * spend never lands in the reels tables or the Reels monthly watch.
 */
export class RecordingExplainersJevRunner implements ExplainersJevRunner {
  private calls = 0;
  private spent = 0;

  constructor(
    private readonly transport: JevTransport,
    private readonly db: Queryable,
    private readonly context: { mode: Mode; ideaCycleId?: string | null },
  ) {}

  get callCount(): number {
    return this.calls;
  }

  get usd(): number {
    return this.spent;
  }

  async ask<const Q extends Questions>(request: ExplainersJevRequest<Q>): Promise<SystemOneResult<Q>> {
    for (const key of Object.keys(request.questions)) {
      if (!(key in request.set.questions)) {
        throw new Error(`Question ${key} is not in ${request.set.id}`);
      }
    }
    const result = await this.transport.systemOne(request.state, request.questions);
    this.calls += 1;
    const usd = jevUsd(result.usage.input_tokens);
    this.spent += usd;

    await this.db.query(
      `INSERT INTO explainers.jev_logs
         (idea_cycle_id, topic_id, component, question_set_id, question_set_version,
          resolved_model, state, answers, input_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
      [
        this.context.ideaCycleId ?? null,
        request.topicId ?? null,
        request.component,
        request.set.id,
        request.set.version,
        result.model,
        JSON.stringify(request.state),
        JSON.stringify(result.answers),
        result.usage.input_tokens,
      ],
    );
    await recordCost(this.db, {
      ideaCycleId: this.context.ideaCycleId ?? null,
      mode: this.context.mode,
      vendor: 'jev',
      component: request.component,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      usd,
    });
    return result;
  }
}
