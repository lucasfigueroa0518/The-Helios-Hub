/**
 * Skips that need no judgment (spec §5B "drop listicles, promotional
 * posts"): headline shapes only. Non-news is left to Jev's relevance
 * question. Every skip is returned with its reason for the log.
 *
 * Content farms (2026-10-12): templated rewrites such as "Codex CLI 0.162 vs
 * Claude Code 2.1.296 [2026]" from tech-insider.org and shattered.io ranked in
 * the pool and padded outlet counts. A farm article is dropped by its title
 * pattern (a year in square brackets) or by its site (the outlet name,
 * Google News's " - site" suffix, or the URL). A story keeps its other
 * members; only the farm article goes.
 */
import type { IngestArticle, SkipEntry } from './types';

const RULES: Array<{ reason: string; re: RegExp }> = [
  { reason: 'listicle', re: /^\s*(the\s+)?\d+\s+(best|top|ways|things|tips|tools|apps|reasons|ai\s+tools)\b/i },
  { reason: 'listicle', re: /\b(best|top)\s+\d+\b/i },
  { reason: 'deal', re: /(\d+%\s*off|\bpromo code\b|\bcoupon\b|\bdeals?\b.*\b(today|sale)\b|\bon sale\b|\bprime day\b|\bblack friday\b|\bdeal days\b)/i },
  { reason: 'tutorial', re: /^\s*how to\b/i },
  { reason: 'promotional', re: /\b(sponsored|partner content|paid post)\b/i },
];

/** A year in square brackets anywhere in the headline: "… [2026]". */
export const FARM_TITLE = /\[\s*20\d{2}\s*\]/;
/** Known content farms. A new farm that copies the title habit is caught by FARM_TITLE. */
export const FARM_DOMAINS = ['tech-insider.org', 'shattered.io'] as const;

export function contentFarmReason(a: Pick<IngestArticle, 'headline' | 'source' | 'sourceUrl'>): string | null {
  if (FARM_TITLE.test(a.headline)) return 'content-farm';
  const where = `${a.source} ${a.sourceUrl} ${a.headline}`.toLowerCase();
  return FARM_DOMAINS.some((d) => where.includes(d)) ? 'content-farm' : null;
}

export function codeFilterReason(headline: string): string | null {
  for (const rule of RULES) if (rule.re.test(headline)) return rule.reason;
  return null;
}

export function applyCodeFilters(articles: IngestArticle[]): { kept: IngestArticle[]; skipped: SkipEntry[] } {
  const kept: IngestArticle[] = [];
  const skipped: SkipEntry[] = [];
  for (const a of articles) {
    const reason = codeFilterReason(a.headline) ?? contentFarmReason(a);
    if (reason) skipped.push({ id: a.sourceUrl, reason, stage: 'code-filter' });
    else kept.push(a);
  }
  return { kept, skipped };
}
