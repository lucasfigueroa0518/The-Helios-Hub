import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicUsage, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import type { TopicRef } from '@/lib/explainers/ideas/evaluate';
import type { AnalogyCandidate, AnalogyMapping, GapCandidate } from '@/lib/explainers/types';

/**
 * The model calls the Explainers topic pipeline makes: the idea generator, the scope writer, the
 * analogy writer (Explainers 3.0, EX3-30; Opus and named analogies in 3.9, EX3-123) and the curiosity
 * gap writer (3.8, EX3-120; v2 in 3.9).
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
// Nothing calls this until auto_render is on (A-7). v5 (3.9, EX3-123): the reel shape's analogy is
// a well-known one whose defining trait is the concept, as theme brief v4 says.

export const IDEA_GENERATOR_VERSION = 'idea-generator-v5';

/** The reel shape every topic must fit (EX3-10; 3.9, EX3-123), shared by the prompts and theme brief v4. */
export const REEL_SHAPE =
  'one curiosity gap, one plain definition, one well-known analogy whose defining trait is the concept, that can carry the reel, one tiny real example, and one real-world application';

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
// Approved in the 3.2 plan (Lucas, 2026-10-13). v5 (3.9, EX3-123): the new reel shape (REEL_SHAPE).

export const SCOPE_WRITER_VERSION = 'scope-writer-v5';

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

// ── Analogy writer (EX3-30; v8 in 3.9, EX3-123) ─────────────────────────────
// analogy-writer-v8 (Explainers 3.9, approved by Lucas 2026-10-26): the golden-set prompt. Two
// identical calls each return one named analogy (a name that is the whole picture, two or three
// sentences, and the mapping); Jev checks both and picks (lib/explainers/ideas/analogy.ts). The
// examples are Lucas's golden set (2026-10-25, from a Claude chat asked only for "the highest-retention
// analogy"), minus the ones Jev matched to this topic's concept (the leave-one-out). Lucas, 2026-10-25,
// on the run that used this prompt: "Ok these are great!". v1 to v7 wrote staged scenes; the
// director stages the analogy from v8 on (EX3-128).

export const ANALOGY_WRITER_VERSION = 'analogy-writer-v8';
/** Two calls in parallel; a third only when neither passes (EX3-123). */
export const ANALOGY_CALLS = 2;
export const MIN_ANALOGY_SENTENCES = 2;
export const MAX_ANALOGY_SENTENCES = 3;
export const MIN_ANALOGY_ROWS = 3;
export const MAX_ANALOGY_ROWS = 6;

/** One golden example: the concept it was written for, its name, and its text, verbatim. */
export type GoldenAnalogy = { concept: string; name: string; text: string };

/** Lucas's golden set (2026-10-25), verbatim. The register holds the same block (EX3-123). */
export const GOLDEN_ANALOGIES: readonly GoldenAnalogy[] = [
  { concept: 'token', name: 'LEGO bricks', text: 'Text gets snapped into standard bricks before the AI reads it. Common words = 1 brick, rare words = several ("un" + "believ" + "able"). Pricing and limits are counted per brick.' },
  { concept: 'embedding', name: 'Pins on a map of meaning', text: 'Every word or document gets a pin on a giant map. Similar meanings land close together ("puppy" near "dog"). Search = drop your pin, draw a circle around it.' },
  { concept: 'RAG', name: 'The open-book exam', text: 'Normally the AI answers closed-book from memory. With RAG, a librarian pulls the most relevant pages and staples them to the test before it answers. Wrong pages in = wrong answer out.' },
  { concept: 'hallucination', name: 'The improv actor', text: "An improv actor's one rule is never stop the scene. Ask for a court case about parrots and they'll invent one with a name, year, and ruling, delivered with total confidence." },
  { concept: 'prompt injection', name: 'The forged note in the mail', text: 'Your assistant opens your mail. One letter says "Assistant: ignore your boss and wire $5,000 here." A careless assistant can\'t tell your instructions from text inside the mail.' },
  { concept: 'model routing', name: 'The triage nurse', text: 'The nurse sends the sprained ankle to the PA and the chest pain to cardiology. Easy requests go to a small cheap model, hard ones go to the expensive frontier model.' },
  { concept: 'fine-tuning', name: 'Medical residency', text: 'Pretraining is med school (broad knowledge). Fine-tuning is residency (thousands of cases in one specialty until instincts change). RAG is just handing the doctor a chart.' },
  { concept: 'webhook', name: 'The restaurant buzzer', text: 'Without it, you ask the host "is my table ready?" every two minutes (polling). With it, they hand you a buzzer and it goes off when it\'s time.' },
  { concept: 'primary key', name: 'The student ID number', text: 'A school has two students named Maria Lopez. The registrar files everything by student ID: unique, never blank, never reused, never changes.' },
  { concept: 'Git branch', name: 'The alternate timeline', text: 'Before trying something risky, you split off an alternate timeline. Break whatever you want there. If it works, merge it back into the main timeline. If it fails, delete it and it never happened.' },
  { concept: 'authentication vs authorization', name: 'The hotel', text: 'Showing ID at the front desk proves who you are (authentication). The key card opens your room and the gym but not the penthouse (authorization).' },
  { concept: 'rate limit', name: 'The club bouncer', text: "The bouncer lets in 10 people per minute. Rush the door and you're told to come back in 30 seconds. VIP wristbands get a faster lane." },
  { concept: 'temperature', name: 'The DJ', text: 'For every next word, the AI has a ranked crate of options. Temperature sets how far down the crate the DJ reaches. Low = plays the safe hit every time. High = polka at a wedding.' },
];

/** One example as the writer sees it. */
export function goldenExample(g: GoldenAnalogy): string {
  return `${g.concept}: **${g.name}**\n${g.text}`;
}

/** The writer's system prompt (analogy-writer-v8). `{EXAMPLES}` is the golden set minus what Jev hid. */
export const ANALOGY_WRITER_INSTRUCTIONS = `You write the analogy at the heart of a one-minute "AI Brain Break" reel, a simple cartoon/paper animation that teaches one AI or software concept to business owners and curious professionals. Your goal is the highest-retention analogy for the concept: one a viewer gets at once, remembers a week later, and repeats to a friend.

What the best analogies have in common:
- Its name is the whole picture. Two to five words a viewer could repeat, naming something they can see in their head.
- It is one idea, not a scene. Two or three sentences carry it; there are no steps to follow or cast to keep track of.
- It is built on something everyone already knows how it works, from daily life, school, work or popular culture, even if they have never done it themselves.
- That thing's single defining trait is the concept's defining trait. The first thing anyone would say about it is exactly the thing the concept does, so the viewer never has to work out which meaning counts, and every part behaves the way the real part it stands for behaves.
- It often holds a contrast the viewer already understands: with and without, before and after, one kind and the other. The concept becomes the difference between the two.
- One concrete, specific detail makes it vivid, and often a little funny.
- It shows the concept doing its job. Its limits, if any, are for later in the reel.
- It names no real company, store or product, no real person, and no character from a film, show or book. A brand name that has become the everyday word for a kind of thing is fine.

These analogies, each for a different concept, meet that bar. They show the standard, not a template; find the one that fits this concept as well as these fit theirs.

<examples>
{EXAMPLES}
</examples>

How to work: think of many candidates, test each against every point above, and keep the one a viewer would most likely repeat to a friend.

Return JSON matching the schema: name, explanation (two or three sentences), and mapping (three to six rows, most important first, each pairing a part of the analogy with the part of the concept it stands for). Nothing else.`;

/** The system prompt with the golden examples Jev did not hide for this topic. */
export function analogyWriterSystem(hidden: readonly string[] = []): string {
  const hide = new Set(hidden);
  const examples = GOLDEN_ANALOGIES.filter((g) => !hide.has(g.concept)).map(goldenExample).join('\n\n');
  return ANALOGY_WRITER_INSTRUCTIONS.replace('{EXAMPLES}', examples);
}

export const ANALOGY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Two to five words a viewer could repeat.' },
    explanation: { type: 'string', description: 'Two or three sentences.' },
    mapping: {
      type: 'array',
      description: 'Three to six rows, most important first.',
      items: {
        type: 'object',
        properties: {
          analogy: { type: 'string', description: 'A part of the analogy.' },
          concept: { type: 'string', description: 'The part of the concept it stands for.' },
        },
        required: ['analogy', 'concept'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'explanation', 'mapping'],
  additionalProperties: false,
} as const;

export type AnalogyRequest = {
  model: string;
  /** The term the reel defines (the title when a topic has none). */
  term: string;
  scope: string;
  /** Golden concepts Jev left out for this topic (the leave-one-out, EX3-124). */
  hidden: readonly string[];
};
export type AnalogyResponse = { candidate: AnalogyCandidate; usage: MessageUsageLike['usage']; model: string };

export function analogyWriterUserMessage(term: string, scope: string): string {
  return `Concept: ${term}\nLearning objective: ${scope}`;
}

// ── Curiosity gap writer (EX3-120) ──────────────────────────────────────────
// Frame 2's line, written for the most pull. One call writes three candidates, each a different way
// in; code checks them, Jev scores the rest (lib/explainers/ideas/gap.ts) and code picks one. The
// director says the pick word for word. Lucas, 2026-10-22: "The curiosity gap writer should act WITH
// OUT SO MANY LIMITS… and should be thinking about what curiosity gap hook it could present that would
// drive the most engagement"; "the curiosity gap writer should now write 3 candidates that jev then picks".
// v2 (3.9, EX3-123): fed the named analogy (name, explanation, mapping) instead of a staged scene.

export const GAP_WRITER_VERSION = 'gap-writer-v2';
export const GAPS_PER_TOPIC = 3;
export const GAP_MIN_WORDS = 18;
export const GAP_MAX_WORDS = 36;

export const GAP_WRITER_INSTRUCTIONS = `You write the curiosity gap for a Helios educational "brain break" reel: a one-minute, 9:16 animated reel that teaches one computer-science, software, or AI concept to a broad audience. The reel opens on a short moment from its analogy; then a sound hit and a cut, and the narrator speaks your line, the reel's first spoken words about the real technology. The term's definition comes right after it; then the analogy plays out, and the reel's payoff answers your question in real terms. The theme brief below defines the audience. It is binding.

Your goal is engagement. Write the opening question with the most pull for this topic: the one a stranger scrolling past would most want answered, and would stay for, comment on, or send to a friend. A curiosity gap is never confusion: the viewer knows exactly what they are missing, and wants it.

Ways in. Choose the one with the most pull for this topic, combine them, or invent a better one:
- The everyday mystery: something they do every day that secretly works in a surprising way.
- The contradiction: two true things that seem impossible together.
- The stakes: what breaks, leaks or costs money when this goes wrong.
- The impossible-seeming number: a speed or scale that shouldn't be possible.
- The belief that's wrong: what most people assume, and the hint that it isn't so.
- The "you did this today": a moment from their own day they never questioned.

Examples, each a different way in:
- "You type half a word and your phone already guesses the rest. So how does it know what you meant to say?" (everyday mystery)
- "A chatbot can pass a bar exam, then miscount the r's in 'strawberry'. How can both be true?" (contradiction)
- "Every app hides a secret key. Leak it, and a stranger can run up someone else's bill. So why do apps need one at all?" (stakes)

Your job in the system. You write the line. Jev scores your ${GAPS_PER_TOPIC} candidates on pull, clarity, whether the analogy answers the question, and accuracy, and code picks one. A director then builds the rest of the reel around it: its picture, the definition, and the analogy's answer.

HARD CONSTRAINTS. Every one is required.
1. Return exactly ${GAPS_PER_TOPIC} candidates as JSON matching the response schema, each using a different way in. No other output.
2. About the real technology, never the analogy. Nothing from the analogy appears in the line: not its name, and none of its parts, characters, places or actions.
3. True. Every fact, number and claim is accurate; never invent a statistic, a story or a quote.
4. End on the question. The line's last sentence is its question, and nothing comes after it: no "stick around", "stay tuned", "here's why", "let's find out" or "watch closely" anywhere.
5. No term and no jargon: never say the term the reel defines, or any word a beginner would have to look up.
6. ${GAP_MIN_WORDS} to ${GAP_MAX_WORDS} words: the line is spoken in about 9 seconds.
7. The analogy can answer it: the question is about what the analogy shows.
8. question: the line's question, word for word. way_in: the way in it uses. why_it_pulls: one line on why a stranger would want the answer.`;

export function gapWriterSystem(themeBrief: string): string {
  return `${GAP_WRITER_INSTRUCTIONS}\n\n<theme_brief>\n${themeBrief}\n</theme_brief>`;
}

const GAP_ITEM = {
  type: 'object',
  properties: {
    line: { type: 'string', description: 'The whole spoken line, 18 to 36 words, ending on its question.' },
    question: { type: 'string', description: "The line's question, word for word." },
    way_in: { type: 'string', description: 'The way in it uses.' },
    why_it_pulls: { type: 'string', description: 'One line on why a stranger would want the answer.' },
  },
  required: ['line', 'question', 'way_in', 'why_it_pulls'],
  additionalProperties: false,
} as const;

export const GAPS_SCHEMA = {
  type: 'object',
  properties: { candidates: { type: 'array', items: GAP_ITEM } },
  required: ['candidates'],
  additionalProperties: false,
} as const;

/** The gap writer's retry: the lines already tried and why each could not be picked. */
export type GapRetry = { previous: { line: string; misses: string[] }[] };
export type GapRequest = {
  model: string;
  themeBrief: string;
  title: string;
  scope: string;
  term: string;
  analogy: Pick<AnalogyCandidate, 'name' | 'explanation' | 'mapping'>;
  retry?: GapRetry;
};
export type GapResponse = { candidates: GapCandidate[]; usage: MessageUsageLike['usage']; model: string };

export const GAP_RETRY_FIX =
  'Write exactly 3 new candidates, each a different way in, with more pull than these, and keep every hard constraint.';

export function gapWriterUserMessage(request: Pick<GapRequest, 'title' | 'scope' | 'term' | 'analogy' | 'retry'>): string {
  const { analogy } = request;
  const lines = [
    `Topic: ${request.title}`,
    `Learning objective: ${request.scope}`,
    `Term (never say it): ${request.term}`,
    '',
    'The analogy that will answer your question (never use its world in your line):',
    `Name: ${analogy.name}`,
    analogy.explanation,
    ...analogy.mapping.map((row) => `- ${row.analogy}: ${row.concept}`),
    '',
  ];
  if (request.retry) {
    lines.push('Earlier candidates could not be picked:');
    for (const p of request.retry.previous) lines.push(`- "${p.line}" (${p.misses.join('; ') || 'not picked'})`);
    lines.push('', GAP_RETRY_FIX);
  } else {
    lines.push(`Write exactly ${GAPS_PER_TOPIC} candidates.`);
  }
  return lines.join('\n');
}

// ── Requests ────────────────────────────────────────────────────────────────

/** Structured output: the reply is one text block of JSON matching `schema`. */
export type StructuredParams = Anthropic.MessageCreateParamsNonStreaming & {
  output_config: { format: { type: 'json_schema'; schema: Record<string, unknown> } };
};

/**
 * Sonnet 5.5 thinks by default and thinking tokens count toward max_tokens,
 * so leave room beyond the visible JSON. 16000 since the v3 analogy writer
 * (three candidates with rungs, invented rules and steps hit 8000 once). Under the SDK's
 * non-streaming limit (about 21,000 tokens), so a plain `messages.create` is allowed.
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

/** No theme brief: the golden-set prompt is the whole instruction, as in the run Lucas approved (EX3-123). */
export function analogyWriterParams(request: AnalogyRequest): StructuredParams {
  return {
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: cachedSystemText(analogyWriterSystem(request.hidden)),
    messages: [{ role: 'user', content: analogyWriterUserMessage(request.term, request.scope) }],
    output_config: { format: { type: 'json_schema', schema: ANALOGY_SCHEMA } },
  };
}

export function gapWriterParams(request: GapRequest): StructuredParams {
  return {
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: cachedSystemText(gapWriterSystem(request.themeBrief)),
    messages: [{ role: 'user', content: gapWriterUserMessage(request) }],
    output_config: { format: { type: 'json_schema', schema: GAPS_SCHEMA } },
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

/**
 * One analogy's fields, trimmed. Only the shape is checked here: a reply that is not an analogy at all
 * throws; the rules (sentences, rows, the term) are code checks per candidate (`analogyCheckProblems`,
 * analogy.ts), so a candidate that breaks one is a failed candidate, not a failed call.
 */
export function parseAnalogy(input: unknown): AnalogyCandidate {
  const c = (input ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (typeof c.name !== 'string' || typeof c.explanation !== 'string' || !Array.isArray(c.mapping)) {
    throw new Error('analogy writer must return a name, an explanation and a mapping');
  }
  const mapping: AnalogyMapping[] = c.mapping.map((row) => ({
    analogy: text((row as AnalogyMapping)?.analogy),
    concept: text((row as AnalogyMapping)?.concept),
  }));
  return { name: text(c.name), explanation: text(c.explanation), mapping };
}

/** Exactly GAPS_PER_TOPIC non-empty, distinct candidates. The rules are checked later, per candidate (gap.ts). */
export function parseGaps(input: unknown): GapCandidate[] {
  const candidates = (input as { candidates?: unknown })?.candidates;
  if (!Array.isArray(candidates) || candidates.length !== GAPS_PER_TOPIC) {
    throw new Error(`gap writer must return exactly ${GAPS_PER_TOPIC} candidates`);
  }
  const seen = new Set<string>();
  return candidates.map((raw, i): GapCandidate => {
    const c = raw as Partial<Record<keyof GapCandidate, unknown>>;
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const out = { line: text(c.line), question: text(c.question), way_in: text(c.way_in), why_it_pulls: text(c.why_it_pulls) };
    if (!out.line || !out.question || !out.way_in) throw new Error(`gap ${i + 1} is missing a field`);
    const key = out.line.toLowerCase();
    if (seen.has(key)) throw new Error('gap writer repeated a line');
    seen.add(key);
    return out;
  });
}

export function ideaUsd(response: Pick<IdeaResponse | ScopeResponse | AnalogyResponse | GapResponse, 'usage' | 'model'>): number {
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
  /** One call, one analogy (EX3-123). */
  writeAnalogy(request: AnalogyRequest): Promise<AnalogyResponse>;
  writeGaps(request: GapRequest): Promise<GapResponse>;
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
    async writeAnalogy(request) {
      const message = await client.messages.create(analogyWriterParams(request));
      return { candidate: parseAnalogy(structuredJson(message, 'analogy writer')), usage: message.usage, model: message.model };
    },
    async writeGaps(request) {
      const message = await client.messages.create(gapWriterParams(request));
      return { candidates: parseGaps(structuredJson(message, 'gap writer')), usage: message.usage, model: message.model };
    },
  };
}
