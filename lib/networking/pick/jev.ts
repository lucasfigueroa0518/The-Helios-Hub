/**
 * Jev for the weekly event ranking (Stories pattern, lib/stories/jev.ts): the reels transport,
 * networking's own log and cost rows (networking.jev_logs, networking.cost_events) keyed by
 * week and ai_events run, and a spend cap per run. Tests pass a stub transport; nothing here
 * calls Jev on its own.
 *
 * One jev_logs row per question set in the call (each with that set's answers); cost_events
 * is the ledger, one row per call.
 */
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { NetworkingQuery } from '@/lib/networking/repository';
import type { QuestionSet } from '@/lib/reels/jev/question-set';
import { jevUsd, type JevTransport } from '@/lib/reels/jev/runner';

/** Default spend cap for one ranking run (plan M2 step 6; expected about $0.02). */
export const RUN_CAP_USD = 0.5;

export type NetworkingJevRequest<Q extends Questions> = {
  component: string;
  sets: ReadonlyArray<QuestionSet>;
  questions: Q;
  state: EntryType;
  eventId: string | null;
};

export interface NetworkingJev {
  ask<const Q extends Questions>(req: NetworkingJevRequest<Q>): Promise<SystemOneResult<Q>>;
  readonly calls: number;
  readonly usd: number;
}

export class JevSpendCapError extends Error {
  constructor(capUsd: number, spentUsd: number) {
    super(`Jev spend cap $${capUsd} reached ($${spentUsd.toFixed(5)} spent)`);
    this.name = 'JevSpendCapError';
  }
}

export function createNetworkingJev(
  transport: JevTransport,
  query: NetworkingQuery,
  options: { weekKey: string | null; runId: string | null; capUsd?: number },
): NetworkingJev {
  const capUsd = options.capUsd ?? RUN_CAP_USD;
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
      // Calls already in flight can finish, so the overshoot is at most one concurrent batch.
      if (usd >= capUsd) throw new JevSpendCapError(capUsd, usd);
      const result = await transport.systemOne(req.state, req.questions);
      calls++;
      const cost = jevUsd(result.usage.input_tokens);
      usd += cost;
      const answers = result.answers as Record<string, unknown>;
      for (const set of req.sets) {
        const own: Record<string, unknown> = {};
        for (const key of Object.keys(set.questions)) own[key] = answers[key];
        await query(
          `INSERT INTO networking.jev_logs (event_id, week_key, component, question_set_id, question_set_version, resolved_model, state, answers, input_tokens)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
          [req.eventId, options.weekKey, req.component, set.id, set.version, result.model ?? null, JSON.stringify(req.state), JSON.stringify(own), result.usage.input_tokens],
        );
      }
      await query(
        `INSERT INTO networking.cost_events (event_id, week_key, run_id, vendor, component, model, input_tokens, output_tokens, usd)
         VALUES ($1, $2, $3, 'jev', $4, $5, $6, $7, $8)`,
        [req.eventId, options.weekKey, options.runId, req.component, result.model ?? null, result.usage.input_tokens, result.usage.output_tokens, cost],
      );
      return result;
    },
  };
}
