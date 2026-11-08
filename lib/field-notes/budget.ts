/**
 * The run's spend meter and cap (CLAUDE.md Rule 1 and the run cap in field_notes.settings).
 * It wraps the injected Claude client and the injected Jev transport: before a call it refuses
 * when the call could pass the cap, after it prices the response (lib/anthropic-pricing for
 * Claude, the Jev input-token rate for Jev). The wrapped clients are the only transports the
 * engine uses, so the meter sees every paid call.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { jevUsd, type JevTransport } from '@/lib/reels/jev/runner';

import { FIELD_NOTES_CALL_RESERVE_USD } from './config';
import type { FieldNotesClient } from './write/call';

export class FieldNotesBudgetExhausted extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldNotesBudgetExhausted';
  }
}

export type PricedCall = { stage: 'claude' | 'jev'; model: string; usd: number; inputTokens: number; outputTokens: number };

export type FieldNotesBudget = {
  readonly capUsd: number;
  guardClaude(client: FieldNotesClient): FieldNotesClient;
  guardJev(transport: JevTransport): JevTransport;
  claudeUsd(): number;
  jevUsd(): number;
  spent(): number;
  /** True once a call was refused for the cap. */
  exhausted(): boolean;
  /** Whether one more call of `reserveUsd` still fits. */
  canSpend(reserveUsd?: number): boolean;
  calls(): PricedCall[];
};

export function createFieldNotesBudget(o: { capUsd: number; reserveUsd?: number }): FieldNotesBudget {
  if (!Number.isFinite(o.capUsd) || o.capUsd <= 0) throw new Error(`Field Notes run cap must be a positive number (got ${String(o.capUsd)})`);
  const reserve = o.reserveUsd ?? FIELD_NOTES_CALL_RESERVE_USD;
  let claude = 0;
  let jev = 0;
  let refused = false;
  const log: PricedCall[] = [];
  const spent = () => claude + jev;
  const refuse = (what: string): never => {
    refused = true;
    throw new FieldNotesBudgetExhausted(`run cap $${o.capUsd}: $${spent().toFixed(4)} spent, a ${what} call could pass it`);
  };
  return {
    capUsd: o.capUsd,
    claudeUsd: () => claude,
    jevUsd: () => jev,
    spent,
    exhausted: () => refused,
    canSpend: (r = reserve) => spent() + r <= o.capUsd,
    calls: () => [...log],
    guardClaude: (client) => ({
      messages: {
        create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
          if (spent() + reserve > o.capUsd) refuse('Claude');
          const res = await client.messages.create(params);
          const usd = Number(priceAnthropicMessages([res as unknown as MessageUsageLike], { modelId: params.model }).costUsd);
          claude += usd;
          log.push({ stage: 'claude', model: params.model, usd, inputTokens: Number(res.usage?.input_tokens ?? 0), outputTokens: Number(res.usage?.output_tokens ?? 0) });
          return res;
        },
      },
    }),
    guardJev: (transport) => ({
      async systemOne<const Q extends Questions>(state: EntryType, questions: Q): Promise<SystemOneResult<Q>> {
        if (spent() + reserve > o.capUsd) refuse('Jev');
        const res = await transport.systemOne(state, questions);
        const usd = jevUsd(res.usage.input_tokens);
        jev += usd;
        log.push({ stage: 'jev', model: 'jev', usd, inputTokens: res.usage.input_tokens, outputTokens: Number((res.usage as { output_tokens?: number }).output_tokens ?? 0) });
        return res;
      },
    }),
  };
}
