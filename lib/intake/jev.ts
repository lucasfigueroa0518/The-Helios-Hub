/**
 * The intake's one Jev surface (lib/intake/types.ts IntakeJev). Wraps the
 * TypeSafe transport, records every call in `intake.cost_events` (its own
 * bucket: never reels, stories or social tables), and enforces the run's
 * hard cap: once spent >= cap, every further ask throws IntakeCapReached.
 *
 * `asReelsRunner()` mirrors lib/reels/jev/runner RecordingJevRunner (for the
 * reels screen, grouping-v2 and reels-score); `asSocialAsk()` mirrors
 * lib/social/jev/client createJevAsk (for story-scoring@4 and major-news).
 */
import type { Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { jevUsd, type JevRequest, type JevRunner, type JevTransport } from '@/lib/reels/jev/runner';
import type { JevAsk, JevResult } from '@/lib/social/jev/client';

import type { IntakeJev, IntakeQuery } from './types';

/** Thrown by every ask once the run's spend reached its cap. The run stops asking and keeps what is stored. */
export class IntakeCapReached extends Error {
  constructor(readonly capUsd: number, readonly spentUsd: number) {
    super(`Intake Jev cap $${capUsd} reached ($${spentUsd.toFixed(5)} spent)`);
    this.name = 'IntakeCapReached';
  }
}

export function isIntakeCapReached(error: unknown): error is IntakeCapReached {
  return error instanceof IntakeCapReached || (error instanceof Error && error.name === 'IntakeCapReached');
}

/** IntakeJev plus what the run needs to know: its run id and whether the cap refused a call. */
export type IntakeJevHandle = IntakeJev & {
  readonly runId: string | null;
  readonly capUsd: number;
  /** True once an ask was refused for the cap. */
  readonly capHit: boolean;
};

export function createIntakeJev(
  transport: JevTransport,
  query: IntakeQuery,
  runId: string | null,
  capUsd: number,
): IntakeJevHandle {
  let usd = 0;
  let calls = 0;
  let capHit = false;

  const guard = () => {
    if (usd >= capUsd) {
      capHit = true;
      throw new IntakeCapReached(capUsd, usd);
    }
  };

  const record = async (component: string, inputTokens: number) => {
    const cost = jevUsd(inputTokens);
    usd += cost;
    calls += 1;
    await query.query(
      `INSERT INTO intake.cost_events (run_id, component, input_tokens, usd) VALUES ($1, $2, $3, $4)`,
      [runId, component, inputTokens, cost],
    );
  };

  const runner: JevRunner = {
    async ask<const Q extends Questions>(request: JevRequest<Q>): Promise<SystemOneResult<Q>> {
      guard();
      const result = await transport.systemOne(request.state, request.questions);
      await record(request.component, result.usage.input_tokens);
      return result;
    },
    get callCount() {
      return calls;
    },
  };

  const ask: JevAsk = async (request, meta) => {
    guard();
    const res = await transport.systemOne(request.state, request.questions);
    const answers: JevResult['answers'] = {};
    for (const [id, answer] of Object.entries(res.answers as Record<string, { type: string; noul?: number; choice?: string; probabilities?: Record<string, number> }>)) {
      if (answer.type === 'noul') answers[id] = { noul: answer.noul as number };
      else if (answer.type === 'choice') answers[id] = { choice: answer.choice as string, probabilities: { ...(answer.probabilities ?? {}) } };
      else throw new Error(`Jev answer ${id} is ${answer.type}; Social sets use noul and choice only`);
    }
    await record(meta.version, res.usage.input_tokens);
    return { answers, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens }, model: res.model };
  };

  return {
    asReelsRunner: () => runner,
    asSocialAsk: () => ask,
    get usd() {
      return usd;
    },
    get calls() {
      return calls;
    },
    runId,
    capUsd,
    get capHit() {
      return capHit;
    },
  };
}

/** Live Jev for one intake run (the reels transport: TypeSafe `jev-latest`, the same model social uses by default). */
export async function liveIntakeJev(query: IntakeQuery, runId: string | null, capUsd: number): Promise<IntakeJevHandle> {
  const { liveJevTransport } = await import('@/lib/reels/jev/client');
  return createIntakeJev(liveJevTransport, query, runId, capUsd);
}
