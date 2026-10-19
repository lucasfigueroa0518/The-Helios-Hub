import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { TopicRef } from '@/lib/explainers/ideas/evaluate';
import type { AnalogyCandidate, AnalogyElement, AnalogyStep } from '@/lib/explainers/types';

/**
 * The three Sonnet calls the Explainers topic pipeline makes: the idea generator, the scope
 * writer, and (Explainers 3.0, EX3-30; v2 in 3.1, EX3-66) the analogy writer.
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
// One call returns exactly three {topic_title, topic_scope, term}. Version
// idea-generator-v4 (Explainers 3.2, EX3-86): v3's one-minute reel and AI skew
// (two AI ideas and one computer-science or tech idea per call, EX3-73), plus
// the term each reel defines. Approved in the 3.2 plan (Lucas, 2026-10-13).
// Nothing calls this until auto_render is on (A-7).

export const IDEA_GENERATOR_VERSION = 'idea-generator-v4';

/** The reel shape every topic must fit (EX3-10), shared by the three prompts. */
export const REEL_SHAPE =
  'one curiosity gap, one plain definition, one everyday analogy that can carry the whole reel as a single scene, one tiny real example, and one real-world application';

/** The AI skew per call (EX3-73). */
export const AI_IDEAS_PER_CALL = 2;

/** What a topic's term is, shared by the idea generator and the scope writer (EX3-86). */
export const TERM_RULE =
  'term: the exact name of the one concept the reel defines, as a viewer would search for it, 1 to 4 words, lowercase unless it is an acronym or a proper name. The title, the term and the scope agree: the reel defines this term, not a broader concept it belongs to and not a narrower part of it. The scope says what the reel covers and stops short of.';

export const IDEA_GENERATOR_INSTRUCTIONS = `You propose topics for Helios Explainer Reels: one-minute, 9:16 animated reels that each teach one computer-science, software, or AI concept to a broad business audience. The theme brief below defines the audience, the topic areas, the tone, the banned topics, and what counts as a duplicate. It is binding.

HARD CONSTRAINTS. Every one is required.
1. Return exactly ${IDEAS_PER_CALL} ideas as JSON matching the response schema. No other output.
2. Each idea teaches exactly one complete thought that fits one minute with ${REEL_SHAPE}.
3. Skew toward AI. Exactly ${AI_IDEAS_PER_CALL} of the ${IDEAS_PER_CALL} ideas teach an AI concept (how models, agents, context, tokens, training, retrieval, or other parts of artificial intelligence work). The other idea teaches a computer-science or tech concept: those are still part of the curriculum, and they matter most when they help someone understand AI.
4. topic_title: the viewer-facing title or question, 12 words or fewer.
5. topic_scope: one sentence that states the exact learning objective, beginning with "Explain".
6. ${TERM_RULE}
7. The ${IDEAS_PER_CALL} ideas are mutually distinct, and each is distinct from every topic in the current pool and the recently rendered list in the user message. Two ideas are duplicates when the viewer would learn essentially the same core concept or leave with the same primary takeaway, even if the title, hook, analogy, or example differs.
8. Never propose a banned topic or angle from the brief.
9. Do not write hooks, analogies, scripts, scores, or reasoning. Titles, terms and scopes only.`;

export function ideaGeneratorSystem(themeBrief: string): string {
  return `${IDEA_GENERATOR_INSTRUCTIONS}\n\n<theme_brief>\n${themeBrief}\n</theme_brief>`;
}

const TOPIC_ITEM = {
  type: 'object',
  properties: {
    topic_title: { type: 'string', description: 'Viewer-facing title or question, 12 words or fewer.' },
    topic_scope: { type: 'string', description: 'One sentence stating the learning objective, beginning with "Explain".' },
    term: { type: 'string', description: 'The exact name of the one concept the reel defines, 1 to 4 words.' },
  },
  required: ['topic_title', 'topic_scope', 'term'],
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

export type GeneratedIdea = { topic_title: string; topic_scope: string; term: string };

export type IdeaResponse = {
  ideas: GeneratedIdea[];
  usage: MessageUsageLike['usage'];
  model: string;
};

// ── Scope writer (A-9) ──────────────────────────────────────────────────────
// Every topic carries a scope written by the model alongside its title. The
// daily generator writes both in one call. Titles Lucas enters by hand get
// their scopes from one call per click, all titles together. Version
// scope-writer-v4 (Explainers 3.2, EX3-86): v3's one-minute reel, plus the term
// each reel defines. It also backfills the terms of topics written before 3.2.
// Approved in the 3.2 plan (Lucas, 2026-10-13).

export const SCOPE_WRITER_VERSION = 'scope-writer-v4';

export const SCOPE_WRITER_INSTRUCTIONS = `You write the one-sentence learning objective (topic_scope) and the term for Helios Explainer Reel titles that a person entered by hand. Each reel runs about one minute, 9:16, and teaches one computer-science, software, or AI concept to a broad business audience. The theme brief below defines the audience and what one reel can teach. It is binding.

HARD CONSTRAINTS. Every one is required.
1. Return one scope per title as JSON matching the response schema, in the same order, with each title copied exactly. No other output.
2. Each topic_scope is one sentence that states the exact learning objective, beginning with "Explain".
3. Narrow each scope to one complete thought that fits one minute with ${REEL_SHAPE}.
4. ${TERM_RULE}
5. Keep the title's intent. Do not change, merge, or drop titles, and do not judge whether a title is a good topic. Scoring happens later.
6. Do not write hooks, analogies, scripts, or reasoning.`;

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
export type ScopeResponse = { scopes: string[]; terms: string[]; usage: MessageUsageLike['usage']; model: string };

// ── Analogy writer (EX3-30, EX3-66) ─────────────────────────────────────────
// When a topic makes the pool, one call writes exactly three candidate analogies;
// Jev scores them (lib/explainers/ideas/analogy.ts) and code picks one. The pick
// becomes the reel's anchor scene. Version analogy-writer-v3 (Explainers 3.2,
// EX3-77, EX3-85, EX3-88): v2 (Lucas's wording, at most four elements, no example
// scenes, the hook and the steps) plus the ladder of simplicity with no invented
// rules, critters as the only characters, and a hook judged on its own. Approved
// in the 3.2 plan (Lucas, 2026-10-13).

export const ANALOGY_WRITER_VERSION = 'analogy-writer-v3';
export const ANALOGIES_PER_TOPIC = 3;
/** At most this many elements per candidate, a hard limit (EX3-66). */
export const MAX_ANALOGY_ELEMENTS = 4;
export const MIN_ANALOGY_STEPS = 3;
export const MAX_ANALOGY_STEPS = 5;

/** What the analogy writer asks for, in Lucas's words (2026-10-13, EX3-66). Verbatim. */
export const ANALOGY_ASK =
  'The simplest physical or conceptual metaphor that carries the mechanism. Start from basic elements, situations, objects that are universally understandable or part of everyday life. Use an everyday place only if it requires 3 or fewer recognizable parts for the viewer to understand the everyday place.';

/** The ladder of simplicity (EX3-85; Lucas, 2026-10-13). */
export const ANALOGY_LADDER =
  'The ladder of simplicity. Rung 1: one object or physical effect. Rung 2: one everyday action by one character, with at most 3 objects. Rung 3: a familiar everyday situation or place almost everyone has lived. For each metaphor, use the lowest rung that carries the whole mechanism, including why the concept matters, with zero invented rules. An invented rule is anything the viewer must be told about how the analogy itself works: an object with a property it does not really have, or a contraption built to fit the concept. If a lower rung needs an invented rule, climb to the next rung.';

export const ANALOGY_WRITER_INSTRUCTIONS = `You write analogies for Helios Explainer Reels: one-minute, 9:16 animated reels that each teach one computer-science, software, or AI concept to a broad audience. The analogy is the reel's visual anchor: one scene, drawn as simple paper animation with small cartoon characters called critters, that the whole reel revolves around. The reel opens on a hook moment inside this scene, asks its question inside it, plays it out step by step, maps each element onto the real component it stands for, and walks a tiny real example through it. The theme brief below defines the audience. It is binding.

What to write: ${ANALOGY_ASK}

HARD CONSTRAINTS. Every one is required.
1. Return exactly ${ANALOGIES_PER_TOPIC} candidate analogies as JSON matching the response schema. No other output.
2. The ${ANALOGIES_PER_TOPIC} candidates are genuinely different metaphors, never one scene reworded, and sit on different rungs of the ladder when the mechanism allows.
3. ${ANALOGY_LADDER} rung: the candidate's rung, 1, 2 or 3.
4. invented_rules: every rule the viewer would have to be told for the analogy to work. It must be empty: a candidate that needs one is not finished, so change the metaphor or climb a rung.
5. Each candidate is understood instantly, with no setup, by almost anyone, whatever their country, job, or age: the viewer already knows how everything in it behaves.
6. At most ${MAX_ANALOGY_ELEMENTS} elements (a group of identical things counts as one). Every element stands for one real component of the concept, and says which. Each element is recognizable as a simple drawing at phone size without a label.
7. Anyone who acts in the scene is a critter: a small cartoon character that can hold, carry, write, reach, point, walk, and react. An element is never a person's body part (a hand, an arm, a finger, a face, a head). actor: the role the critter plays, in a few words, or "none" when no one acts.
8. The process is the real mechanism: the elements interact for the same reasons and in the same order as the real system. Never lean on a part of the metaphor where the comparison breaks.
9. The scene is drawable as simple animation: critters and everyday objects. Its mechanism is visible as motion and changing state.
10. The scene builds to a satisfying visual payoff: a clear, physical result that comes from the mechanism.
11. hook: the reel's opening moment inside this scene, already in motion, that makes a viewer ask a question the reel answers. It is judged on its own: a viewer with no context, no title and no narration knows what they are looking at within one second (a familiar situation, recognizable critters and objects, an obvious problem or surprise) and wants to see what happens. Never niche, strange for its own sake, or dependent on the analogy's own rules. It is not the payoff. Fit it to the nature of this metaphor. If it has characters: a reaction whose behavior grows out of what the setting is. If it is made of objects with no characters: an object or state moment (something mid-collapse, about to overflow, a connection snapping, something in a wrong or impossible state, a near-miss frozen at the critical instant, one against many). If it is conceptual or abstract: a visible contradiction in its elements (identical things behaving differently, a pattern with one piece breaking it, an effect with no visible cause). These are families of devices to choose from to match the metaphor, not a default; use what this metaphor naturally offers.
12. steps: the process as ${MIN_ANALOGY_STEPS} to ${MAX_ANALOGY_STEPS} steps, in order. Each step has analogy (what happens in the scene, one short line) and technical (the real step's name, 4 words or fewer, as an engineer would label it).
13. Do not write narration, scripts, or scores.`;

export function analogyWriterSystem(themeBrief: string): string {
  return `${ANALOGY_WRITER_INSTRUCTIONS}\n\n<theme_brief>\n${themeBrief}\n</theme_brief>`;
}

const ANALOGY_ITEM = {
  type: 'object',
  properties: {
    scene: { type: 'string', description: 'The everyday scene, one line.' },
    elements: {
      type: 'array',
      description: 'The few elements a viewer follows, each with the real component it stands for.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The everyday element.' },
          stands_for: { type: 'string', description: 'The real component of the concept it stands for.' },
        },
        required: ['name', 'stands_for'],
        additionalProperties: false,
      },
    },
    process: { type: 'string', description: 'How the elements interact, step by step, mirroring the real mechanism.' },
    payoff: { type: 'string', description: 'The satisfying visual payoff the scene builds to.' },
    visual: { type: 'string', description: 'What moves and changes state, and why it is strong as a picture.' },
    rung: { type: 'integer', description: 'The rung of the ladder of simplicity: 1, 2 or 3.' },
    invented_rules: { type: 'array', description: 'Rules the viewer must be told for the analogy to work. Must be empty.', items: { type: 'string' } },
    actor: { type: 'string', description: 'The role the critter plays, in a few words, or "none".' },
    hook: { type: 'string', description: "The reel's opening moment in this scene, already in motion, clear on its own within one second." },
    steps: {
      type: 'array',
      description: 'The process as 3 to 5 steps, in order.',
      items: {
        type: 'object',
        properties: {
          analogy: { type: 'string', description: 'What happens in the scene, one short line.' },
          technical: { type: 'string', description: "The real step's name, 4 words or fewer." },
        },
        required: ['analogy', 'technical'],
        additionalProperties: false,
      },
    },
  },
  required: ['scene', 'elements', 'process', 'payoff', 'visual', 'rung', 'invented_rules', 'actor', 'hook', 'steps'],
  additionalProperties: false,
} as const;

export const ANALOGIES_SCHEMA = {
  type: 'object',
  properties: { candidates: { type: 'array', items: ANALOGY_ITEM } },
  required: ['candidates'],
  additionalProperties: false,
} as const;

export type AnalogyRequest = { model: string; themeBrief: string; title: string; scope: string };
export type AnalogyResponse = { candidates: AnalogyCandidate[]; usage: MessageUsageLike['usage']; model: string };

export function analogyWriterUserMessage(title: string, scope: string): string {
  return [
    `Topic: ${title}`,
    `Learning objective: ${scope}`,
    '',
    `Write exactly ${ANALOGIES_PER_TOPIC} candidate analogies.`,
  ].join('\n');
}

// ── Requests ────────────────────────────────────────────────────────────────

/** Structured output: the reply is one text block of JSON matching `schema`. */
export type StructuredParams = Anthropic.MessageCreateParamsNonStreaming & {
  output_config: { format: { type: 'json_schema'; schema: Record<string, unknown> } };
};

/**
 * Sonnet 5.5 thinks by default and thinking tokens count toward max_tokens,
 * so leave room beyond the visible JSON. 16000 since the v3 analogy writer
 * (three candidates with rungs, invented rules and steps hit 8000 once).
 */
const MAX_TOKENS = 16000;

export function ideaGeneratorParams(request: IdeaRequest): StructuredParams {
  return {
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: cachedSystemText(ideaGeneratorSystem(request.themeBrief)),
    messages: [{ role: 'user', content: ideaGeneratorUserMessage(request.pool, request.rendered) }],
    output_config: { format: { type: 'json_schema', schema: IDEAS_SCHEMA } },
  };
}

export function analogyWriterParams(request: AnalogyRequest): StructuredParams {
  return {
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: cachedSystemText(analogyWriterSystem(request.themeBrief)),
    messages: [{ role: 'user', content: analogyWriterUserMessage(request.title, request.scope) }],
    output_config: { format: { type: 'json_schema', schema: ANALOGIES_SCHEMA } },
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
        content: `Write a topic_scope and a term for each of these ${request.titles.length} titles, in order:\n${JSON.stringify(request.titles)}`,
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
    const term = typeof idea.term === 'string' ? idea.term.trim() : '';
    if (!title || !scope || !term) throw new Error(`idea ${i + 1} is missing a title, scope, or term`);
    const key = title.toLowerCase();
    if (seen.has(key)) throw new Error(`idea generator repeated the title "${title}"`);
    seen.add(key);
    return { topic_title: title, topic_scope: scope, term };
  });
}

/** One non-empty scope and term per title, in order, with the titles echoed unchanged. */
export function parseScopes(input: unknown, titles: readonly string[]): { scopes: string[]; terms: string[] } {
  const scopes = (input as { scopes?: unknown })?.scopes;
  if (!Array.isArray(scopes) || scopes.length !== titles.length) {
    throw new Error(`scope writer must return ${titles.length} scopes`);
  }
  const parsed = scopes.map((raw, i) => {
    const entry = raw as Partial<GeneratedIdea>;
    if (typeof entry.topic_title !== 'string' || entry.topic_title.trim() !== titles[i].trim()) {
      throw new Error(`scope ${i + 1} does not match the title "${titles[i]}"`);
    }
    const scope = typeof entry.topic_scope === 'string' ? entry.topic_scope.trim() : '';
    const term = typeof entry.term === 'string' ? entry.term.trim() : '';
    if (!scope) throw new Error(`scope ${i + 1} is empty`);
    if (!term) throw new Error(`scope ${i + 1} has no term`);
    return { scope, term };
  });
  return { scopes: parsed.map((p) => p.scope), terms: parsed.map((p) => p.term) };
}

/** Exactly three complete, distinct candidates. */
export function parseAnalogies(input: unknown): AnalogyCandidate[] {
  const candidates = (input as { candidates?: unknown })?.candidates;
  if (!Array.isArray(candidates) || candidates.length !== ANALOGIES_PER_TOPIC) {
    throw new Error(`analogy writer must return exactly ${ANALOGIES_PER_TOPIC} candidates`);
  }
  const seen = new Set<string>();
  return candidates.map((raw, i) => {
    const c = raw as Partial<Record<keyof AnalogyCandidate, unknown>>;
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const scene = text(c.scene);
    const process = text(c.process);
    const payoff = text(c.payoff);
    const visual = text(c.visual);
    if (!scene || !process || !payoff || !visual) throw new Error(`analogy ${i + 1} is missing a field`);
    const elements = Array.isArray(c.elements)
      ? c.elements.map((e) => ({ name: text((e as AnalogyElement)?.name), stands_for: text((e as AnalogyElement)?.stands_for) }))
      : [];
    if (elements.length === 0 || elements.some((e) => !e.name || !e.stands_for)) {
      throw new Error(`analogy ${i + 1} needs elements, each with what it stands for`);
    }
    if (elements.length > MAX_ANALOGY_ELEMENTS) {
      throw new Error(`analogy ${i + 1} has ${elements.length} elements (at most ${MAX_ANALOGY_ELEMENTS})`);
    }
    const hook = text(c.hook);
    if (!hook) throw new Error(`analogy ${i + 1} is missing its hook`);
    const steps: AnalogyStep[] = Array.isArray(c.steps)
      ? c.steps.map((st) => ({ analogy: text((st as AnalogyStep)?.analogy), technical: text((st as AnalogyStep)?.technical) }))
      : [];
    if (steps.length < MIN_ANALOGY_STEPS || steps.length > MAX_ANALOGY_STEPS || steps.some((st) => !st.analogy || !st.technical)) {
      throw new Error(`analogy ${i + 1} needs ${MIN_ANALOGY_STEPS} to ${MAX_ANALOGY_STEPS} steps, each with its analogy and technical name`);
    }
    const rung = c.rung === 1 || c.rung === 2 || c.rung === 3 ? c.rung : null;
    if (rung === null) throw new Error(`analogy ${i + 1} needs its rung (1, 2 or 3)`);
    if (!Array.isArray(c.invented_rules)) throw new Error(`analogy ${i + 1} needs invented_rules (an empty list when it has none)`);
    const invented_rules = c.invented_rules.map((rule) => text(rule)).filter(Boolean);
    const actor = text(c.actor) || 'none';
    const key = scene.toLowerCase();
    if (seen.has(key)) throw new Error(`analogy writer repeated the scene "${scene}"`);
    seen.add(key);
    return { scene, elements, process, payoff, visual, rung, invented_rules, actor, hook, steps };
  });
}

export function ideaUsd(response: Pick<IdeaResponse | ScopeResponse | AnalogyResponse, 'usage' | 'model'>): number {
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
  writeAnalogies(request: AnalogyRequest): Promise<AnalogyResponse>;
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
      const { scopes, terms } = parseScopes(structuredJson(message, 'scope writer'), request.titles);
      return { scopes, terms, usage: message.usage, model: message.model };
    },
    async writeAnalogies(request) {
      const message = await client.messages.create(analogyWriterParams(request));
      const candidates = parseAnalogies(structuredJson(message, 'analogy writer'));
      return { candidates, usage: message.usage, model: message.model };
    },
  };
}
