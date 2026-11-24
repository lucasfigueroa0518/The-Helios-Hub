import type { PeopleSearchParams } from '@/lib/auto-campaigns/types';

/**
 * The industry keywords to try, in order, without repeats. Pure: it lives apart from
 * filter-map.ts (which loads the Anthropic client) so client components that only
 * need expansion labels (lib/auto-campaigns/expansion.ts) don't ship the SDK.
 */
export function industryKeywordQueue(params: PeopleSearchParams): string[] {
  const queue: string[] = [];
  const seen = new Set<string>();
  for (const value of [...(params.industry_keywords ?? []), params.q_keywords ?? '']) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    queue.push(trimmed);
  }
  return queue;
}
