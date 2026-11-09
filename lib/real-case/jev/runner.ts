import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { Queryable } from '@/lib/explainers/db';
import { recordRealCaseCost } from '@/lib/real-case/repository';
import type { Mode } from '@/lib/real-case/types';
import type { QuestionSet } from '@/lib/reels/jev/question-set';
import { jevUsd, type JevTransport } from '@/lib/reels/jev/runner';

export type RealCaseJevRequest<Q extends Questions> = {
  /** Pipeline step, for the log and the cost ledger. */
  component: string;
  state: EntryType;
  set: QuestionSet;
  /** The set's questions, or a subset of them (a short pairwise batch). */
  questions: Q;
  storyId?: string | null;
};

export interface RealCaseJevRunner {
  ask<const Q extends Questions>(request: RealCaseJevRequest<Q>): Promise<SystemOneResult<Q>>;
  readonly callCount: number;
}

/**
 * Same transport as the other verticals, this route's own ledger: every call is logged to
 * real_case.jev_logs and priced into real_case.cost_events, never into the Explainer tables.
 */
export class RecordingRealCaseJevRunner implements RealCaseJevRunner {
  private calls = 0;

  constructor(
    private readonly transport: JevTransport,
    private readonly db: Queryable,
    /** jobId: a render's own Jev calls (the understanding test), on that job's spend. */
    private readonly context: { mode: Mode; cycleId?: string | null; jobId?: string | null },
  ) {}

  get callCount(): number {
    return this.calls;
  }

  async ask<const Q extends Questions>(request: RealCaseJevRequest<Q>): Promise<SystemOneResult<Q>> {
    for (const key of Object.keys(request.questions)) {
      if (!(key in request.set.questions)) throw new Error(`Question ${key} is not in ${request.set.id}`);
    }
    const result = await this.transport.systemOne(request.state, request.questions);
    this.calls += 1;
    await this.db.query(
      `INSERT INTO real_case.jev_logs
         (cycle_id, story_id, component, question_set_id, question_set_version, resolved_model, state, answers, input_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
      [
        this.context.cycleId ?? null,
        request.storyId ?? null,
        request.component,
        request.set.id,
        request.set.version,
        result.model,
        JSON.stringify(request.state),
        JSON.stringify(result.answers),
        result.usage.input_tokens,
      ],
    );
    await recordRealCaseCost(this.db, {
      cycleId: this.context.cycleId ?? null,
      jobId: this.context.jobId ?? null,
      storyId: request.storyId ?? null,
      mode: this.context.mode,
      vendor: 'jev',
      component: request.component,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      usd: jevUsd(result.usage.input_tokens),
    });
    return result;
  }
}
