/**
 * Which company a story is mainly about, from its headline, for the pool's
 * spread rule (rank.ts `spreadByCompany`): a few products map to their maker
 * (Claude → Anthropic, Gemini → Google). The first name in the headline wins.
 * Plain code, no model call; a story naming none of these has no key and is
 * never held back.
 */
const COMPANIES: ReadonlyArray<[key: string, pattern: RegExp]> = [
  ['anthropic', /\b(anthropic|claude|dario amodei)\b/i],
  ['openai', /\b(openai|chatgpt|gpt-\d|sora|sam altman|codex)\b/i],
  ['google', /\b(google|alphabet|gemini|deepmind|demis hassabis|sundar pichai|veo)\b/i],
  ['meta', /\b(meta|llama|zuckerberg|instagram|whatsapp)\b/i],
  ['microsoft', /\b(microsoft|copilot|satya nadella|bing)\b/i],
  ['xai', /\b(xai|grok|elon musk)\b/i],
  ['nvidia', /\b(nvidia|jensen huang)\b/i],
  ['apple', /\b(apple|siri|tim cook)\b/i],
  ['amazon', /\b(amazon|aws|alexa|andy jassy)\b/i],
  ['mistral', /\bmistral\b/i],
  ['deepseek', /\bdeepseek\b/i],
  ['perplexity', /\bperplexity\b/i],
];

export function companyKey(headline: string): string | null {
  let best: { key: string; at: number } | null = null;
  for (const [key, pattern] of COMPANIES) {
    const m = pattern.exec(headline);
    if (m && (best === null || m.index < best.at)) best = { key, at: m.index };
  }
  return best?.key ?? null;
}
