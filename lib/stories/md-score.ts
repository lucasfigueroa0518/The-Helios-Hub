/**
 * Morning Download's pool score (Lucas, 2026-10-09). One 0–1 scale for both
 * sources, so a carousel story and a Text on Screen idea rank against each
 * other instead of each source's #1 tying at the top. The source itself adds
 * no points: a story is judged on its own merit.
 *
 * Morning Download is recent, major AI news: model releases, announcements
 * from the major companies, government and political developments, advances
 * in the technology (big or small), big business moves, and product updates
 * (a launch, a pivot, a limitation). Not warnings, forecasts or opinion.
 *
 * Plain code over what the pool already holds (no model call, so the nightly
 * refresh stays free). The build still ranks the open pool with major-news;
 * this score orders the pool and shows where the points came from.
 */
import type { ScoreBreakdown, ScorePart } from '@/lib/social-hub/types';
import type { StoryCandidate } from '@/lib/stories/sources/reels';

/** A story is judged on its own merit: where it came from adds nothing (Lucas, 2026-10-09). */
export const MD_POOL_POINTS = {
  newsKind: 0.45,
  majorPlayer: 0.25,
  fresh24h: 0.3,
  fresh48h: 0.15,
  speculative: -0.45,
} as const;

/** The kinds of news Morning Download is for, checked against the headline in this order. */
export const NEWS_KINDS: Array<{ label: string; test: RegExp }> = [
  {
    label: 'Model release',
    test: /\b(?:GPT|o\d|Claude|Gemini|Gemma|Llama|Grok|Qwen|DeepSeek|Mistral|Sora|Veo|Kling|Midjourney|Phi|Nova)(?:[- ](?:Opus|Sonnet|Haiku|Fable|Pro|Flash|Ultra|Nano|Lite|mini|Turbo|Coder|V|R))?[- ]?\d|\b(?:releas\w*|launch\w*|unveil\w*|debut\w*|ships?|introduc\w*|open[- ]sourc\w*|drops?)\b.{0,60}\b(?:model|LLM|reasoning|weights)\b/i,
  },
  {
    label: 'Government or policy',
    test: /\b(?:bill|law|laws|act|senate|senators?|congress\w*|parliament|regulat\w*|FTC|SEC|DOJ|FCC|EU|European Commission|White House|executive order|courts?|judge|ruling|rules?|lawsuit|sues?|sued|antitrust|governors?|ministry|government|policy|tariffs?|export controls?|legislat\w*|attorneys? general)\b/i,
  },
  {
    label: 'Business move',
    test: /\b(?:acquir\w*|acquisition|buys|bought|merg\w*|raises?|raised|funding|valuation|valued|IPO|invest\w*|deal|partners? with|partnership|layoffs?|lays off|cuts? \d|hires?|hired|poach\w*|appoint\w*|steps down|resign\w*|CEO|revenue|earnings|stake)\b|\$\d/i,
  },
  {
    label: 'Product update',
    test: /\b(?:launch\w*|debut\w*|release notes|rolls? out|rolling out|now available|available (?:to|in|for)|adds?|added|new feature|feature|updat\w*|pivot\w*|limits?|limited|restrict\w*|bans?|banned|pauses?|paused|shuts? down|discontinu\w*|pric\w*|subscription|free tier|app|agent|browser|API)\b/i,
  },
  {
    label: 'Technology advance',
    test: /\b(?:breakthrough|benchmark\w*|paper|researchers?|study finds|record|chips?|GPUs?|TPUs?|data ?cent(?:er|re)s?|robot\w*|beats?|outperform\w*|achiev\w*|discover\w*|solv\w*)\b/i,
  },
  {
    label: 'Announcement',
    test: /\b(?:announc\w*|unveil\w*|reveal\w*|confirms?|confirmed|plans? to|says it will|introduc\w*)\b/i,
  },
];

/** Forecasts, warnings, fear and opinion: what Morning Download is not. */
export const SPECULATIVE =
  /\b(?:warns?|warning|could|might|fears?|doom\w*|existential|\w*ocalyp\w*|extinction|threat\w*|dangers?|dangerous|scar(?:y|e|ed|iest)|terrif\w*|nightmare|end of|will replace|replac\w* (?:all|your|human|workers|jobs)|(?:take|steal)s? (?:your|our|their) jobs?|wipe out|godfather|predicts?|prediction|opinion|op-ed|here'?s why|why you should|is coming for|crisis|collapse|bubble|rogue|superintelligen\w*)\b|\?\s*$/i;

/** Companies, labs and people whose moves count as major AI news. */
export const MAJOR_PLAYERS =
  /\b(?:OpenAI|ChatGPT|Anthropic|Claude|Google|DeepMind|Gemini|Meta|Llama|Microsoft|Copilot|Nvidia|Apple|Amazon|AWS|xAI|Grok|Mistral|DeepSeek|Perplexity|Hugging Face|Alibaba|Qwen|Tesla|SpaceX|Samsung|IBM|Oracle|TSMC|AMD|Intel|Altman|Musk|Amodei|Zuckerberg|Jensen Huang|Nadella|Hassabis|Pichai|Sutskever|Karpathy)\b/;

const HOUR = 3_600_000;
const round = (n: number) => Number(n.toFixed(4));

export type MdPoolScore = { score: number; breakdown: ScoreBreakdown };

export function morningDownloadScore(c: Pick<StoryCandidate, 'origin' | 'headline' | 'publishedAt' | 'blockbuster'>, now: Date): MdPoolScore {
  const parts: ScorePart[] = [];
  const P = MD_POOL_POINTS;
  const text = c.headline ?? '';

  parts.push({ label: 'Source', points: null, detail: c.origin === 'carousel' ? 'Carousel (adds nothing)' : 'Text on Screen (adds nothing)' });

  const kind = NEWS_KINDS.find((k) => k.test.test(text));
  parts.push(kind ? { label: 'News kind', points: P.newsKind, detail: kind.label } : { label: 'News kind', points: 0, detail: 'No release, move, policy or product news in the headline' });

  const player = text.match(MAJOR_PLAYERS)?.[0] ?? null;
  const major = player ?? ((c.blockbuster ?? 0) > 0 ? 'Blockbuster subject' : null);
  parts.push({ label: 'Major player', points: major ? P.majorPlayer : 0, detail: major ?? 'None named' });

  const published = c.publishedAt ? Date.parse(c.publishedAt) : NaN;
  const age = Number.isFinite(published) ? (now.getTime() - published) / HOUR : null;
  if (age == null) parts.push({ label: 'Recent', points: 0, detail: 'No publish time' });
  else {
    const hours = Math.max(0, Math.round(age));
    const ago = hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)} days ago`;
    parts.push({ label: 'Recent', points: age <= 24 ? P.fresh24h : age <= 48 ? P.fresh48h : 0, detail: ago });
  }

  const spec = text.match(SPECULATIVE)?.[0];
  if (spec) parts.push({ label: 'Speculation', points: P.speculative, detail: spec.trim() === '?' ? 'Headline is a question' : `“${spec.trim()}”` });

  const score = round(Math.max(0, parts.reduce((s, p) => s + (p.points ?? 0), 0)));
  return {
    score,
    breakdown: {
      formula: 'News kind + major player + recency − speculation, 0 to 1. Where the story came from adds nothing.',
      parts,
    },
  };
}

/** Guess the Number and Free vs. Paid keep their source's own order: the breakdown says so. */
export function rankBreakdown(sourceLabel: string, index: number, total: number): ScoreBreakdown {
  return {
    formula: 'Rank within its own source: first is 1.00, last is near 0. Compare only within this series.',
    parts: [{ label: 'Source', points: null, detail: sourceLabel }, { label: 'Rank in source', points: round((total - index) / total), detail: `#${index + 1} of ${total}` }],
  };
}
