import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { JEV_USD_PER_MTOK } from '@/lib/reels/config';
import type { QuestionSet } from '@/lib/reels/jev/question-set';
import { insertJevLog, recordCost } from '@/lib/reels/repository';

export type JevRequest<Q extends Questions> = {
  /** Pipeline step, for the log and the cost ledger. */
  component: string;
  state: EntryType;
  /** Sets whose questions make up this call; one log row is written per set. */
  sets: ReadonlyArray<QuestionSet>;
  questions: Q;
  runId: string | null;
  sourceId?: string | null;
  postIdeaId?: string | null;
};

export interface JevRunner {
  ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>>;
  /** Calls made, for the run summary. */
  readonly callCount: number;
}

/** The single HTTP call. Stubbed in tests so the pipeline runs offline. */
export interface JevTransport {
  systemOne<const Q extends Questions>(
    state: EntryType,
    questions: Q,
  ): Promise<SystemOneResult<Q>>;
}

export function jevUsd(inputTokens: number): number {
  return (inputTokens / 1_000_000) * JEV_USD_PER_MTOK;
}

/**
 * Wraps a transport with the logging D-030 requires: the state sent, the
 * answers, the question-set version, and the versioned model ID the
 * `jev-latest` alias resolved to. That is what keeps "why were these grouped?"
 * answerable after the alias moves and after the bodies are deleted.
 *
 * Logging lives here rather than in the client so a stubbed transport is
 * logged the same way, and the behaviour is testable without a paid call.
 */
export class RecordingJevRunner implements JevRunner {
  private calls = 0;

  constructor(private readonly transport: JevTransport) {}

  get callCount(): number {
    return this.calls;
  }

  async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
    const result = await this.transport.systemOne(request.state, request.questions);
    this.calls += 1;

    const answers = result.answers as Record<string, unknown>;
    for (const set of request.sets) {
      const own: Record<string, unknown> = {};
      for (const key of Object.keys(set.questions)) own[key] = answers[key];
      await insertJevLog({
        runId: request.runId,
        component: request.component,
        questionSetId: set.id,
        questionSetVersion: set.version,
        resolvedModel: result.model,
        state: request.state,
        answers: own,
        inputTokens: result.usage.input_tokens,
        sourceId: request.sourceId ?? null,
        postIdeaId: request.postIdeaId ?? null,
      });
    }

    await recordCost({
      runId: request.runId,
      vendor: 'jev',
      component: request.component,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      usd: jevUsd(result.usage.input_tokens),
    });

    return result;
  }
}

/** Combine two sets into one request. Key collisions are a programming error. */
export function mergeSets<A extends Questions, B extends Questions>(
  a: QuestionSet<A>,
  b: QuestionSet<B>,
): { sets: ReadonlyArray<QuestionSet>; questions: A & B } {
  for (const key of Object.keys(b.questions)) {
    if (key in a.questions) {
      throw new Error(`Question key "${key}" appears in both ${a.id} and ${b.id}`);
    }
  }
  return {
    sets: [a as QuestionSet, b as QuestionSet],
    questions: { ...a.questions, ...b.questions } as A & B,
  };
}
