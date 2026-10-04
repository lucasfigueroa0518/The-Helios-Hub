/**
 * Skips that need no judgment (spec §5B "drop listicles, promotional
 * posts"): headline shapes only. Non-news is left to Jev's relevance
 * question. Every skip is returned with its reason for the log.
 */
import type { IngestArticle, SkipEntry } from './types';

const RULES: Array<{ reason: string; re: RegExp }> = [
  { reason: 'listicle', re: /^\s*(the\s+)?\d+\s+(best|top|ways|things|tips|tools|apps|reasons|ai\s+tools)\b/i },
  { reason: 'listicle', re: /\b(best|top)\s+\d+\b/i },
  { reason: 'deal', re: /(\d+%\s*off|\bpromo code\b|\bcoupon\b|\bdeals?\b.*\b(today|sale)\b|\bon sale\b|\bprime day\b|\bblack friday\b)/i },
  { reason: 'tutorial', re: /^\s*how to\b/i },
  { reason: 'promotional', re: /\b(sponsored|partner content|paid post)\b/i },
];

export function codeFilterReason(headline: string): string | null {
  for (const rule of RULES) if (rule.re.test(headline)) return rule.reason;
  return null;
}

export function applyCodeFilters(articles: IngestArticle[]): { kept: IngestArticle[]; skipped: SkipEntry[] } {
  const kept: IngestArticle[] = [];
  const skipped: SkipEntry[] = [];
  for (const a of articles) {
    const reason = codeFilterReason(a.headline);
    if (reason) skipped.push({ id: a.sourceUrl, reason, stage: 'code-filter' });
    else kept.push(a);
  }
  return { kept, skipped };
}
