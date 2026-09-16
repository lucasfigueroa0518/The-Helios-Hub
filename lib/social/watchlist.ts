/**
 * Helios Social watchlist — the editorial focus that drives the relevance
 * filter. Every article ingested from RSS is scored against this list;
 * anything not touching a listed company / person / product / topic gets
 * auto-rejected before it ever reaches human review.
 *
 * Edit freely. Order does not matter. Matching is case-insensitive and uses
 * both the canonical name and any listed aliases.
 */

export type WatchlistEntry = {
  /** Canonical name — what the LLM stores in the extraction packet. */
  name: string;
  /** Optional alternate names (nicknames, product families, common typos). */
  aliases?: string[];
};

export const HELIOS_SOCIAL_COMPANIES: WatchlistEntry[] = [
  { name: 'OpenAI' },
  { name: 'Anthropic' },
  { name: 'Google DeepMind', aliases: ['DeepMind'] },
  { name: 'Meta AI', aliases: ['Meta', 'FAIR', 'Facebook AI Research'] },
  { name: 'xAI' },
  { name: 'Microsoft AI', aliases: ['Microsoft', 'Copilot'] },
  { name: 'Apple Intelligence', aliases: ['Apple'] },
  { name: 'Mistral', aliases: ['Mistral AI'] },
  { name: 'Cohere' },
  { name: 'Perplexity', aliases: ['Perplexity AI'] },
  { name: 'NVIDIA', aliases: ['Nvidia'] },
  { name: 'Hugging Face' },
  { name: 'Runway', aliases: ['Runway ML'] },
  { name: 'Midjourney' },
  { name: 'Stability AI' },
  { name: 'Palantir' },
];

export const HELIOS_SOCIAL_PEOPLE: WatchlistEntry[] = [
  { name: 'Sam Altman' },
  { name: 'Dario Amodei' },
  { name: 'Sundar Pichai' },
  { name: 'Elon Musk' },
  { name: 'Yann LeCun' },
  { name: 'Demis Hassabis' },
  { name: 'Andrej Karpathy' },
  { name: 'Fei-Fei Li' },
  { name: 'Ilya Sutskever' },
  { name: 'Aravind Srinivas' },
  { name: 'Simon Willison' },
  { name: 'Ethan Mollick' },
  { name: 'Alex Karp' },
  { name: 'Donald Trump' },
  { name: 'John Ternus' },
  { name: 'John Giannandrea' },
];

export const HELIOS_SOCIAL_PRODUCTS: WatchlistEntry[] = [
  { name: 'GPT-5', aliases: ['GPT5', 'o1', 'o3', 'o-series'] },
  { name: 'Claude', aliases: ['Claude Sonnet', 'Claude Opus', 'Claude Haiku'] },
  { name: 'Gemini', aliases: ['Gemini Pro', 'Gemini Ultra'] },
  { name: 'Llama', aliases: ['LLaMA'] },
  { name: 'Grok' },
  { name: 'Copilot', aliases: ['GitHub Copilot', 'Microsoft Copilot'] },
  { name: 'Cursor' },
  { name: 'Claude Code' },
  { name: 'Codex' },
  { name: 'Runway Gen', aliases: ['Gen-3', 'Gen-4'] },
  { name: 'Sora' },
  { name: 'Veo' },
];

export const HELIOS_SOCIAL_TOPICS: string[] = [
  'frontier model launches',
  'agentic AI + computer-use',
  'model safety and alignment',
  'image and video generation',
  'AI + advertising',
  'AI use cases with visible outcomes',
  'AI marketing campaigns',
  'AI tools',
  'AI regulation',
  'chip supply / GPU costs / infrastructure',
  'enterprise AI adoption',
  'AI startup funding ($100M+)',
  'coding assistants',
];

/** Flatten to plain lists of canonical names, suitable for LLM prompts. */
export function watchlistCanonicalNames(entries: WatchlistEntry[]): string[] {
  return entries.map((e) => e.name);
}

/**
 * Formats the watchlist as a compact prompt-friendly block. Called once at
 * module load and cached; the resulting string becomes part of the cached
 * system prompt Haiku sees.
 */
export function formatWatchlistForPrompt(): string {
  const companies = HELIOS_SOCIAL_COMPANIES.map((e) => e.name).join(', ');
  const people = HELIOS_SOCIAL_PEOPLE.map((e) => e.name).join(', ');
  const products = HELIOS_SOCIAL_PRODUCTS.map((e) => e.name).join(', ');
  const topics = HELIOS_SOCIAL_TOPICS.join(', ');
  return [
    `Companies: ${companies}`,
    `People: ${people}`,
    `Products: ${products}`,
    `Topics: ${topics}`,
  ].join('\n');
}
