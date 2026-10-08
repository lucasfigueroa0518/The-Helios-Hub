import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { TopicRef } from '@/lib/explainers/ideas/evaluate';

/**
 * The two Sonnet calls the Explainers topic pipeline makes.
 *
 * Output: structured outputs (`output_config.format`, a JSON schema), not a
 * forced tool call. Sonnet 5.5 rejects `tool_choice` `tool`/`any` with a 400.
 * The SDK in this repo (0.65) does not type `output_config` but forwards it
 * in the request body unchanged. The API ignores `minItems`/`maxItems`, so
 * counts are checked in code (`parseIdeas`, `parseScopes`).
 *
 * Caching (CLAUDE.md): the system prompt (instructions + theme brief) is the
 * stable prefix and carries the breakpoint. Everything that changes per call
 * goes in the user message after it.
 */

export const IDEAS_PER_CALL = 3;

// ── Idea generator (E-16) ───────────────────────────────────────────────────
// One call returns exactly three {topic_title, topic_scope}. Version
// idea-generator-v1, approved by Lucas on 2026-10-07 (R6). Nothing calls this
// until auto_render is on (A-7).

export const IDEA_GENERATOR_VERSION = 'idea-generator-v1';

export const IDEA_GENERATOR_INSTRUCTIONS = `You propose topics for Helios Explainer Reels: 45-second, 9:16 animated reels that each teach one computer-science, software, or AI concept to a broad business audience. The theme brief below defines the audience, the topic areas, the tone, the banned topics, and what counts as a duplicate. It is binding.

HARD CONSTRAINTS. Every one is required.
1. Return exactly ${IDEAS_PER_CALL} ideas as JSON matching the response schema. No other output.
2. Each idea teaches exactly one complete thought that fits 45 seconds with one everyday analogy, one tiny worked example, one technical insight or caveat, and one real-world application.
3. topic_title: the viewer-facing title or question, 12 words or fewer.
4. topic_scope: one sentence that states the exact learning objective, beginning with "Explain".
5. The ${IDEAS_PER_CALL} ideas are mutually distinct, and each is distinct from every topic in the current pool and the recently rendered list in the user message. Two ideas are duplicates when the viewer would learn essentially the same core concept or leave with the same primary takeaway, even if the title, hook, analogy, or example differs.
6. Never propose a banned topic or angle from the brief.
7. Do not write hooks, analogies, scripts, scores, or reasoning. Titles and scopes only.`;

export function ideaGeneratorSystem(themeBrief: string): string {
  return `${IDEA_GENERATOR_INSTRUCTIONS}\n\n<theme_brief>\n${themeBrief}\n</theme_brief>`;
}

const TOPIC_ITEM = {
  type: 'object',
  properties: {
    topic_title: { type: 'string', description: 'Viewer-facing title or question, 12 words or fewer.' },
    topic_scope: { type: 'string', description: 'One sentence stating the learning objective, beginning with "Explain".' },
  },
  required: ['topic_title', 'topic_scope'],
  additionalProperties: false,
} as const;

export const IDEAS_SCHEMA = {
  type: 'object',
  properties: { ideas: { type: 'array', items: TOPIC_ITEM } },
  required: ['ideas'],
  additionalProperties: false,
} as const;

export function ideaGeneratorUserMessage(pool: readonly TopicRef[], rendered: readonly TopicRef[]): string {
  return [
    'Current candidate pool (do not duplicate):',
    JSON.stringify(pool),
    '',
    'Rendered in the duplicate lookback window (do not duplicate):',
    JSON.stringify(rendered),
    '',
    `Propose exactly ${IDEAS_PER_CALL} new ideas.`,
  ].join('\n');
}

export type IdeaRequest = {
  model: string;
  themeBrief: string;
  pool: readonly TopicRef[];
  rendered: readonly TopicRef[];
};

export type GeneratedIdea = { topic_title: string; topic_scope: string };

export type IdeaResponse = {
  ideas: GeneratedIdea[];
  usage: MessageUsageLike['usage'];
  model: string;
};

// ── Scope writer (A-9) ──────────────────────────────────────────────────────
// Every topic carries a scope written by the model alongside its title. The
// daily generator writes both in one call. Titles Lucas enters by hand get
// their scopes from one call per click, all titles together. Version
// scope-writer-v1, approved by Lucas on 2026-10-07 after its first live run (R6).

export const SCOPE_WRITER_VERSION = 'scope-writer-v1';

export const SCOPE_WRITER_INSTRUCTIONS = `You write the one-sentence learning objective (topic_scope) for Helios Explainer Reel titles that a person entered by hand. Each reel is 45 seconds, 9:16, and teaches one computer-science, software, or AI concept to a broad business audience. The theme brief below defines the audience and what one reel can teach. It is binding.

HARD CONSTRAINTS. Every one is required.
1. Return one scope per title as JSON matching the response schema, in the same order, with each title copied exactly. No other output.
2. Each topic_scope is one sentence that states the exact learning objective, beginning with "Explain".
3. Narrow each scope to one complete thought that fits 45 seconds with one everyday analogy, one tiny worked example, one technical insight or caveat, and one real-world application.
4. Keep the title's intent. Do not change, merge, or drop titles, and do not judge whether a title is a good topic. Scoring happens later.
5. Do not write hooks, analogies, scripts, or reasoning.`;

export function scopeWriterSystem(themeBrief: string): string {
  return `${SCOPE_WRITER_INSTRUCTIONS}\n\n<theme_brief>\n${themeBrief}\n</theme_brief>`;
}

export const SCOPES_SCHEMA = {
  type: 'object',
  properties: { scopes: { type: 'array', items: TOPIC_ITEM } },
  required: ['scopes'],
  additionalProperties: false,
} as const;

export type ScopeRequest = { model: string; themeBrief: string; titles: readonly string[] };
export type ScopeResponse = { scopes: string[]; usage: MessageUsageLike['usage']; model: string };

// ── Requests ────────────────────────────────────────────────────────────────

/** Structured output: the reply is one text block of JSON matching `schema`. */
export type StructuredParams = Anthropic.MessageCreateParamsNonStreaming & {
  output_config: { format: { type: 'json_schema'; schema: Record<string, unknown> } };
};

/**
 * Sonnet 5.5 thinks by default and thinking tokens count toward max_tokens,
 * so leave room beyond the visible JSON.
 */
const MAX_TOKENS = 8000;

export function ideaGeneratorParams(request: IdeaRequest): StructuredParams {
  return {
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: cachedSystemText(ideaGeneratorSystem(request.themeBrief)),
    messages: [{ role: 'user', content: ideaGeneratorUserMessage(request.pool, request.rendered) }],
    output_config: { format: { type: 'json_schema', schema: IDEAS_SCHEMA } },
  };
}

export function scopeWriterParams(request: ScopeRequest): StructuredParams {
  return {
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: cachedSystemText(scopeWriterSystem(request.themeBrief)),
    messages: [
      {
        role: 'user',
        content: `Write a topic_scope for each of these ${request.titles.length} titles, in order:\n${JSON.stringify(request.titles)}`,
      },
    ],
    output_config: { format: { type: 'json_schema', schema: SCOPES_SCHEMA } },
  };
}

// ── Response parsing ────────────────────────────────────────────────────────

/** The JSON body of a structured-output reply, after checking why it stopped. */
export function structuredJson(message: Pick<Anthropic.Message, 'content' | 'stop_reason'>, label: string): unknown {
  if (message.stop_reason === 'refusal') throw new Error(`${label}: the model declined the request`);
  if (message.stop_reason === 'max_tokens') throw new Error(`${label}: the reply hit max_tokens`);
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (!text.trim()) throw new Error(`${label}: the reply had no JSON`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: the reply was not valid JSON`);
  }
}

/** Exactly three non-empty, distinct ideas. */
export function parseIdeas(input: unknown): GeneratedIdea[] {
  const ideas = (input as { ideas?: unknown })?.ideas;
  if (!Array.isArray(ideas) || ideas.length !== IDEAS_PER_CALL) {
    throw new Error(`idea generator must return exactly ${IDEAS_PER_CALL} ideas`);
  }
  const seen = new Set<string>();
  return ideas.map((raw, i) => {
    const idea = raw as Partial<GeneratedIdea>;
    const title = typeof idea.topic_title === 'string' ? idea.topic_title.trim() : '';
    const scope = typeof idea.topic_scope === 'string' ? idea.topic_scope.trim() : '';
    if (!title || !scope) throw new Error(`idea ${i + 1} is missing a title or scope`);
    const key = title.toLowerCase();
    if (seen.has(key)) throw new Error(`idea generator repeated the title "${title}"`);
    seen.add(key);
    return { topic_title: title, topic_scope: scope };
  });
}

/** One non-empty scope per title, in order, with the titles echoed unchanged. */
export function parseScopes(input: unknown, titles: readonly string[]): string[] {
  const scopes = (input as { scopes?: unknown })?.scopes;
  if (!Array.isArray(scopes) || scopes.length !== titles.length) {
    throw new Error(`scope writer must return ${titles.length} scopes`);
  }
  return scopes.map((raw, i) => {
    const entry = raw as Partial<GeneratedIdea>;
    if (typeof entry.topic_title !== 'string' || entry.topic_title.trim() !== titles[i].trim()) {
      throw new Error(`scope ${i + 1} does not match the title "${titles[i]}"`);
    }
    const scope = typeof entry.topic_scope === 'string' ? entry.topic_scope.trim() : '';
    if (!scope) throw new Error(`scope ${i + 1} is empty`);
    return scope;
  });
}

export function ideaUsd(response: Pick<IdeaResponse | ScopeResponse, 'usage' | 'model'>): number {
  return Number(
    priceAnthropicUsage(usageBucketsFromMessage({ usage: response.usage }, '1h'), {
      modelId: response.model,
    }).costUsd,
  );
}

// ── The model calls ─────────────────────────────────────────────────────────

/** Stubbed in tests; the live one is `anthropicIdeaModel`. */
export interface IdeaModel {
  propose(request: IdeaRequest): Promise<IdeaResponse>;
  writeScopes(request: ScopeRequest): Promise<ScopeResponse>;
}

export function anthropicIdeaModel(client: Anthropic): IdeaModel {
  return {
    async propose(request) {
      const message = await client.messages.create(ideaGeneratorParams(request));
      const ideas = parseIdeas(structuredJson(message, 'idea generator'));
      return { ideas, usage: message.usage, model: message.model };
    },
    async writeScopes(request) {
      const message = await client.messages.create(scopeWriterParams(request));
      const scopes = parseScopes(structuredJson(message, 'scope writer'), request.titles);
      return { scopes, usage: message.usage, model: message.model };
    },
  };
}
