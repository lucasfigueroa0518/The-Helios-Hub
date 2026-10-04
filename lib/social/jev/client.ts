/**
 * Helios Social's own Jev (TypeSafe System One) client. Written fresh for
 * Social; shares nothing with Trial Reels' Jev setup (plan §Trial Reels).
 *
 * Every caller takes a `JevAsk`, so tests pass a stub and nothing reaches
 * the live API without a deliberate `createJevAsk()` in a runner.
 */
import { TypeSafeClient, type Questions, type SystemOneRequest } from '@typesafe-ai/sdk';

/** Jev pricing (docs.typesafe.ai/models, checked 2026-10-04): $0.042/Mtok input, output free. */
export const JEV_INPUT_USD_PER_MTOK = 0.042;

export type JevUsage = { input_tokens: number; output_tokens: number };

/** All Social question sets use Nouls; `noul` is the probability of yes. */
export type JevResult = {
  answers: Record<string, { noul: number }>;
  usage: JevUsage;
  model: string;
};

/**
 * Metadata for logging and stubs: which question set and which subject
 * (article URL, group id). Never sent to the model.
 */
export type JevMeta = { version: string; subjectId: string };

export type JevAsk = (request: SystemOneRequest<Questions>, meta: JevMeta) => Promise<JevResult>;

export function jevCostUsd(usage: JevUsage): number {
  return (usage.input_tokens * JEV_INPUT_USD_PER_MTOK) / 1_000_000;
}

/**
 * Live Jev. The TypeSafe client is built on first call, so importing this
 * module never needs TYPESAFE_API_KEY.
 */
export function createJevAsk(config: ConstructorParameters<typeof TypeSafeClient>[0] = {}): JevAsk {
  let client: TypeSafeClient | null = null;
  return async (request) => {
    client ??= new TypeSafeClient(config);
    const res = await client.systemOne(request);
    const answers: JevResult['answers'] = {};
    for (const [id, answer] of Object.entries(res.answers)) {
      if (answer.type !== 'noul') throw new Error(`Jev answer ${id} is ${answer.type}; Social sets use noul only`);
      answers[id] = { noul: answer.noul };
    }
    return {
      answers,
      usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
      model: res.model,
    };
  };
}

/** Running tally of Jev calls and cost across one selection run. */
export type JevTally = { calls: number; inputTokens: number; costUsd: number };

export function createJevTally(): JevTally {
  return { calls: 0, inputTokens: 0, costUsd: 0 };
}

/** Wrap an ask so every call is counted and priced. */
export function tallied(ask: JevAsk, tally: JevTally): JevAsk {
  return async (request, meta) => {
    const res = await ask(request, meta);
    tally.calls += 1;
    tally.inputTokens += res.usage.input_tokens;
    tally.costUsd += jevCostUsd(res.usage);
    return res;
  };
}
