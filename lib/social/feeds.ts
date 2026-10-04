export type FeedConfig = {
  /** Stable identifier; do not change without a data migration. */
  slug: string;
  /** Display name (used when RSS <title> is missing or generic). */
  name: string;
  /** RSS 2.0 / Atom feed URL, or a Google News search URL. */
  url: string;
  /** Feed shape: 'native' RSS from an outlet, or 'google-news' aggregated. */
  kind: 'native' | 'google-news';
};

const gnewsUrl = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

/**
 * The daily ingest job iterates this list, fetches each URL, drops entries
 * older than HELIOS_SOCIAL_FRESHNESS_HOURS, and hands the rest to the LLM
 * scorer. Errors on individual feeds are logged but never abort the run.
 *
 * Two flavours:
 *   - 'native'      — direct outlet RSS. Canonical URLs, real bylines.
 *   - 'google-news' — Google News search results as RSS. Wraps outlet URLs
 *                     in google.com redirect wrappers; the actual outlet
 *                     name comes from the RSS <source> tag.
 */
export const HELIOS_SOCIAL_FEEDS: FeedConfig[] = [
  // ── AI-native outlets ────────────────────────────────────────────────────
  { slug: 'the-verge-ai',    name: 'The Verge — AI',    kind: 'native',
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { slug: 'ars-technica',    name: 'Ars Technica',      kind: 'native',
    url: 'https://feeds.arstechnica.com/arstechnica/technology-lab' },
  { slug: 'techcrunch-ai',   name: 'TechCrunch — AI',   kind: 'native',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { slug: 'venturebeat-ai',  name: 'VentureBeat — AI',  kind: 'native',
    url: 'https://venturebeat.com/category/ai/feed/' },
  { slug: 'simon-willison',  name: 'Simon Willison',    kind: 'native',
    url: 'https://simonwillison.net/atom/everything/' },
  { slug: 'import-ai',       name: 'Import AI',         kind: 'native',
    url: 'https://importai.substack.com/feed' },
  { slug: 'the-batch',       name: 'The Batch',         kind: 'native',
    url: 'https://www.deeplearning.ai/the-batch/feed/' },
  { slug: 'wired-ai',        name: 'Wired — AI',        kind: 'native',
    url: 'https://www.wired.com/feed/tag/ai/latest/rss' },
  { slug: 'semafor-tech',    name: 'Semafor — Tech',    kind: 'native',
    url: 'https://www.semafor.com/section/tech/feed' },

  // ── Broader tech / business ──────────────────────────────────────────────
  { slug: 'bloomberg-tech',  name: 'Bloomberg Technology', kind: 'native',
    url: 'https://feeds.bloomberg.com/technology/news.rss' },
  { slug: 'wsj-tech',        name: 'WSJ — Tech',        kind: 'native',
    url: 'https://feeds.a.dj.com/rss/RSSWSJD.xml' },
  { slug: 'nyt-tech',        name: 'NYT — Technology',  kind: 'native',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml' },
  { slug: 'reuters-tech',    name: 'Reuters — Technology', kind: 'native',
    url: 'https://www.reutersagency.com/feed/?best-topics=tech&post_type=best' },

  // ── Google News aggregated (watchlist-focused queries) ───────────────────
  { slug: 'gnews-frontier-labs', name: 'Google News — Frontier Labs', kind: 'google-news',
    url: gnewsUrl('OpenAI OR Anthropic OR "Google DeepMind" OR "Meta AI" OR xAI OR Mistral') },
  { slug: 'gnews-ai-execs',      name: 'Google News — AI Executives', kind: 'google-news',
    url: gnewsUrl('"Sam Altman" OR "Dario Amodei" OR "Demis Hassabis" OR "John Ternus" OR "John Giannandrea"') },
  { slug: 'gnews-power-players', name: 'Google News — Power Players', kind: 'google-news',
    url: gnewsUrl('"Alex Karp" Palantir OR "Donald Trump" AI OR "Elon Musk" xAI') },
  { slug: 'gnews-ai-marketing',  name: 'Google News — AI Marketing',  kind: 'google-news',
    url: gnewsUrl('"AI marketing" OR "AI advertising" OR "AI campaign" OR "generative advertising"') },
  { slug: 'gnews-ai-products',   name: 'Google News — AI Products',   kind: 'google-news',
    url: gnewsUrl('"GPT-5" OR "Claude" OR "Gemini" OR "Llama" OR "Sora" OR "Veo"') },
  { slug: 'gnews-ai-policy',     name: 'Google News — AI Policy',     kind: 'google-news',
    url: gnewsUrl('"AI regulation" OR "AI Act" OR "AI executive order" OR "AI safety"') },
];

/** Freshness gate: articles older than this at ingest time are dropped. */
export const HELIOS_SOCIAL_FRESHNESS_HOURS = 48;

/** Any article scoring below this is auto-rejected without human review. */
export const HELIOS_SOCIAL_RELEVANCE_THRESHOLD = 0.6;
