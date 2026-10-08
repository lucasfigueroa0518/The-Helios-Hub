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

/**
 * A Noul answer (`noul`: the probability of yes), or a Choice answer (the
 * picked label and every label's probability; the slide bucket and variant
 * picks, sixth round).
 */
export type JevAnswer = { noul: number; choice?: undefined; probabilities?: undefined } | { choice: string; probabilities: Record<string, number>; noul?: undefined };

export type JevResult = {
  answers: Record<string, JevAnswer>;
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
      if (answer.type === 'noul') answers[id] = { noul: answer.noul };
      else if (answer.type === 'choice') answers[id] = { choice: answer.choice, probabilities: { ...answer.probabilities } };
      else throw new Error(`Jev answer ${id} is ${answer.type}; Social sets use noul and choice only`);
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

/**
 * Refuse further calls once `tally` reaches `capUsd` (an approved spend
 * limit for a live run). Calls already in flight can finish, so the
 * overshoot is at most one concurrent batch, a fraction of a cent.
 */
export function capped(ask: JevAsk, tally: JevTally, capUsd: number): JevAsk {
  return async (request, meta) => {
    if (tally.costUsd >= capUsd) {
      throw new Error(`Jev spend cap $${capUsd} reached ($${tally.costUsd.toFixed(5)} spent)`);
    }
    return ask(request, meta);
  };
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
