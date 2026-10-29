import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { Queryable } from '@/lib/explainers/db';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import type { Mode } from '@/lib/reel-ai-drama/types';
import type { QuestionSet } from '@/lib/reels/jev/question-set';
import { jevUsd, type JevTransport } from '@/lib/reels/jev/runner';

export type DramaJevRequest<Q extends Questions> = {
  /** Pipeline step, for the log and the cost ledger (e.g. `drama_score`, `material_score`, `facts_check`). */
  component: string;
  state: EntryType;
  set: QuestionSet;
  /** The set's questions, or a subset of them. */
  questions: Q;
  pitchId?: string | null;
};

export interface DramaJevRunner {
  ask<const Q extends Questions>(request: DramaJevRequest<Q>): Promise<SystemOneResult<Q>>;
  readonly callCount: number;
}

/**
 * The shared Jev transport, this route's own ledger: every call is logged to reel_ai_drama.jev_logs and
 * priced into reel_ai_drama.cost_events. Jev scores run on Jev's own configured model (MD-49).
 */
export class RecordingDramaJevRunner implements DramaJevRunner {
  private calls = 0;

  constructor(
    private readonly transport: JevTransport,
    private readonly db: Queryable,
    private readonly context: { mode: Mode; sessionId?: string | null; jobId?: string | null },
  ) {}

  get callCount(): number {
    return this.calls;
  }

  async ask<const Q extends Questions>(request: DramaJevRequest<Q>): Promise<SystemOneResult<Q>> {
    for (const key of Object.keys(request.questions)) {
      if (!(key in request.set.questions)) throw new Error(`Question ${key} is not in ${request.set.id}`);
    }
    const result = await this.transport.systemOne(request.state, request.questions);
    this.calls += 1;
    await this.db.query(
      `INSERT INTO reel_ai_drama.jev_logs
         (session_id, pitch_id, job_id, component, question_set_id, question_set_version, resolved_model, state, answers, input_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
      [
        this.context.sessionId ?? null,
        request.pitchId ?? null,
        this.context.jobId ?? null,
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
      sessionId: this.context.sessionId ?? null,
      jobId: this.context.jobId ?? null,
      pitchId: request.pitchId ?? null,
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
