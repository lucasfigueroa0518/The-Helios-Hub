/**
 * Canonical outlet names, so one outlet counts once whether it arrives
 * through its own feed or through Google News.
 *
 * The pulled fetcher names a native article after its feed's <title>
 * ("AI | The Verge", "Feed: Artificial Intelligence Latest") and a Google
 * News article after its <source> ("The Verge", "Bloomberg.com",
 * "reuters.com"). Neither is usable as is for counting outlets, which
 * feeds ranking (spec §5B tie-break), so both are mapped here.
 */
import type { IngestArticle } from './types';

/** Host (without www.) → outlet name. */
const BY_HOST: Record<string, string> = {
  'theverge.com': 'The Verge',
  'techcrunch.com': 'TechCrunch',
  'wired.com': 'Wired',
  'nytimes.com': 'The New York Times',
  'bloomberg.com': 'Bloomberg',
  'arstechnica.com': 'Ars Technica',
  'venturebeat.com': 'VentureBeat',
  'simonwillison.net': 'Simon Willison',
  'importai.substack.com': 'Import AI',
  'charonhub.deeplearning.ai': 'The Batch',
  'deeplearning.ai': 'The Batch',
  'semafor.com': 'Semafor',
  'wsj.com': 'The Wall Street Journal',
  'reuters.com': 'Reuters',
  'ft.com': 'Financial Times',
  'abcnews.com': 'ABC News',
  'abcnews.go.com': 'ABC News',
  'thestreet.com': 'TheStreet',
  'forbes.com': 'Forbes',
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

export function outletName(article: Pick<IngestArticle, 'feedKind' | 'source' | 'sourceUrl'>): string {
  if (article.feedKind === 'native') {
    const host = hostOf(article.sourceUrl);
    if (host) return BY_HOST[host] ?? host;
    return article.source;
  }
  // Google News <source>: a display name ("The Verge") or a bare domain ("Bloomberg.com").
  const source = article.source.trim();
  if (DOMAIN_RE.test(source)) {
    const host = source.toLowerCase().replace(/^www\./, '');
    return BY_HOST[host] ?? source;
  }
  return source;
}

/** Comparison key: "WIRED", "Wired" and wired.com all become "wired". */
export function outletKey(outlet: string): string {
  return outlet.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
