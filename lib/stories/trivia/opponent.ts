/**
 * The opponent (AT-74, AT-75): a small, cheap model answers each "Are you smarter than AI?" question once,
 * from what it already knows (no web search, no tools to look anything up), and must pick an option. The
 * slide names it before the reveal and shows what it picked, right or wrong, after.
 *
 * The opponent is GPT-5 nano (Lucas, 2026-11-16: Haiku 4.5 got 10 of 10 right; GPT-5 nano 7, Llama 3.1 8B 6).
 * If OpenAI stops serving it, Llama 3.1 8B (via fal) answers instead, on its own: a call that fails because
 * the model is gone moves to the next model in OPPONENTS; any other failure leaves the question without an
 * answer (never block a reel). The label always names the model that actually answered.
 *
 * Both keys already exist (OPENAI_API_KEY for the daily images, FAL_API_KEY). Neither is a Claude call, so
 * there is no cache_control to set; the shared system text still comes first in every request.
 */
import { recordCost } from '@/lib/stories/repository';
import type { StoriesDb } from '@/lib/stories/db';

import { LETTERS, type Letter, type TriviaOption } from './types';

type Via = 'openai' | 'fal';
/** One opponent model: where it is served and its price (USD per million tokens). */
type OpponentModel = { model: string; label: string; via: Via; price: { input: number; output: number } };

/** In order: the opponent, then who takes over if it is no longer served. */
export const OPPONENTS: readonly OpponentModel[] = [
  { model: 'gpt-5-nano', label: 'GPT-5 nano', via: 'openai', price: { input: 0.05, output: 0.4 } },
  // fal's any-llm returns no token counts: the row is an estimate (characters / 4) at a deliberately high rate.
  { model: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', via: 'fal', price: { input: 0.2, output: 0.2 } },
];
/** Shown under the opponent's name before the reveal. */
export const OPPONENT_TAG = '(no web search)';

/** What the slide shows: who answered and what it picked. */
export type Opponent = { model: string; label: string; picked: Letter };

const RULES = [
  'You are a contestant in a multiple-choice trivia game.',
  'Answer from what you already know. You cannot look anything up.',
  'You must choose exactly one of the options, your best guess, even when you are unsure. Not answering is not allowed.',
];
const TOOL_NAME = 'answer';

/** A failed opponent request: the HTTP status and the body as text. */
export class OpponentHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`${status} ${body.slice(0, 300)}`);
  }
}

/** The two endpoints the opponent can be asked through; each returns the parsed JSON or throws OpponentHttpError. */
export type OpponentClient = {
  openai: (body: Record<string, unknown>) => Promise<unknown>;
  fal: (body: Record<string, unknown>) => Promise<unknown>;
};

/** The live client (OpenAI chat completions; fal's any-llm), keys from the environment. */
export function liveOpponentClient(env: NodeJS.ProcessEnv = process.env): OpponentClient {
  const post = async (url: string, auth: string | null, body: Record<string, unknown>) => {
    if (!auth) throw new OpponentHttpError(401, `no key for ${url}`);
    const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new OpponentHttpError(res.status, text);
    return JSON.parse(text) as unknown;
  };
  return {
    openai: (body) => post('https://api.openai.com/v1/chat/completions', env.OPENAI_API_KEY ? `Bearer ${env.OPENAI_API_KEY}` : null, body),
    fal: (body) => post('https://fal.run/fal-ai/any-llm', env.FAL_API_KEY ? `Key ${env.FAL_API_KEY}` : null, body),
  };
}

/** The model is gone (retired, unknown, or nobody serves it), as opposed to busy, broken or refusing. */
export function modelGone(e: unknown): boolean {
  if (!(e instanceof OpponentHttpError)) return false;
  if (e.status === 404) return true;
  // OpenAI: a retired or unknown model is a 400 that says so (not a bad parameter on a live model).
  if (e.status === 400) return /model_not_found|has been deprecated|does not exist|no longer available/i.test(e.body);
  // fal: the model dropped from its list (a 422 on the model field), or no provider serves it.
  if (e.status === 422) return /"loc":\s*\[\s*"body"\s*,\s*"model"\s*\]|0 endpoints/i.test(e.body);
  return false;
}

type Asked = { picked: string | null; inputTokens: number; outputTokens: number };

async function viaOpenai(client: OpponentClient, m: OpponentModel, user: string, letters: string[]): Promise<Asked> {
  type Chat = { choices?: Array<{ message?: { refusal?: string | null; tool_calls?: Array<{ function?: { arguments?: string } }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const res = (await client.openai({
    model: m.model,
    messages: [{ role: 'system', content: [...RULES, 'Give your choice by calling the answer tool.'].join('\n') }, { role: 'user', content: user }],
    tools: [{ type: 'function', function: { name: TOOL_NAME, description: 'Your one answer: the letter of the option you choose.', strict: true, parameters: { type: 'object', properties: { choice: { type: 'string', enum: letters } }, required: ['choice'], additionalProperties: false } } }],
    tool_choice: { type: 'function', function: { name: TOOL_NAME } },
    reasoning_effort: 'minimal',
    max_completion_tokens: 2000,
  })) as Chat;
  const msg = res.choices?.[0]?.message;
  let picked: string | null = null;
  if (!msg?.refusal) {
    try {
      picked = (JSON.parse(msg?.tool_calls?.[0]?.function?.arguments ?? '{}') as { choice?: unknown }).choice as string ?? null;
    } catch {
      picked = null;
    }
  }
  return { picked, inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
}

async function viaFal(client: OpponentClient, m: OpponentModel, user: string, letters: string[]): Promise<Asked> {
  const system = [...RULES, 'Reply with only the letter of your choice.'].join('\n');
  const res = (await client.fal({ model: m.model, system_prompt: system, prompt: user })) as { output?: unknown; error?: unknown };
  const out = typeof res.output === 'string' && !res.error ? res.output.trim() : '';
  // the first standalone option letter in the reply
  const hit = out.match(/\b([A-Z])\b/g)?.find((l) => letters.includes(l)) ?? null;
  return { picked: hit, inputTokens: Math.ceil((system.length + user.length) / 4), outputTokens: Math.ceil(out.length / 4) };
}

type AskInput = {
  client: OpponentClient;
  db: StoriesDb;
  setId: string | null;
  question: string;
  options: TriviaOption[];
  log?: (line: string) => void;
};

/** Ask the opponent once. Null when it could not answer (the question then has no opponent). */
export async function askOpponent(a: AskInput): Promise<Opponent | null> {
  const log = a.log ?? ((line: string) => console.log(line));
  const user = [a.question, '', ...a.options.map((o) => `${o.letter}. ${o.text}`)].join('\n');
  const letters: string[] = a.options.map((o) => o.letter);
  let gone: string | null = null;
  for (const m of OPPONENTS) {
    let r: Asked;
    try {
      r = m.via === 'openai' ? await viaOpenai(a.client, m, user, letters) : await viaFal(a.client, m, user, letters);
    } catch (e) {
      if (modelGone(e)) {
        gone = m.model;
        log(`trivia-opponent: ${m.model} unavailable (${(e as Error).message.slice(0, 160)}); trying the next model`);
        continue;
      }
      log(`trivia-opponent: ${m.model} failed, no opponent answer (${(e as Error).message.slice(0, 160)})`);
      return null;
    }
    try {
      const usd = (r.inputTokens * m.price.input + r.outputTokens * m.price.output) / 1e6;
      await recordCost(a.db, { setId: a.setId, vendor: m.via, component: 'trivia-opponent', model: m.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, usd });
    } catch (e) {
      log(`trivia-opponent: cost not recorded (${(e as Error).message})`);
    }
    if (!r.picked || !LETTERS.includes(r.picked as Letter) || !letters.includes(r.picked)) {
      log(`trivia-opponent: ${m.model} gave no valid choice, no opponent answer`);
      return null;
    }
    if (gone) log(`trivia-opponent: ${gone} unavailable, answered with ${m.model}`);
    return { model: m.model, label: m.label, picked: r.picked as Letter };
  }
  log('trivia-opponent: no opponent model is served, no opponent answer');
  return null;
}
