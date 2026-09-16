import type { Article } from '@/lib/social/types';

/** Hard cap on how many articles reach the batch board per session. */
export const HELIOS_SOCIAL_BATCH_CAP = 15;

/**
 * Cluster key for cross-source dedup. Same primary entity + primary topic =
 * "same story" — five outlets covering "OpenAI valuation" collapse to one row.
 * Deliberately excludes product so a GPT-5 launch and a Sora launch stay
 * separate even though both cluster under OpenAI.
 */
export function clusterKey(a: Article): string {
  const entity =
    a.companies[0]?.toLowerCase()
    ?? a.people[0]?.toLowerCase()
    ?? 'general';
  const topic = a.topics[0]?.toLowerCase() ?? 'none';
  return `${entity}::${topic}`;
}
