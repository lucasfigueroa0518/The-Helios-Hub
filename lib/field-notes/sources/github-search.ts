/**
 * GitHub repository search as a source (skills, MCP servers, repos). One search
 * request per query; `fetchJson` is injected so tests use fixtures. The search
 * result carries only the description and topics, so `collectCandidates`
 * enriches each repo with its README (`enrich.ts`, raw.githubusercontent.com,
 * which is outside the unauthenticated API rate limit) before it becomes a
 * candidate.
 *
 * A query can be a function of the run's date, for "new repos created in the
 * last N days" searches (`createdWithinQuery`), so the window moves with the run
 * instead of being hard-coded.
 */
import type { AdapterItem } from '@/lib/reels/types';

export type GithubSearchRepo = {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count?: number;
  pushed_at?: string | null;
  topics?: string[];
  owner?: { login?: string };
};

export type FetchJson = <T>(url: string) => Promise<T>;

/** `updated` = most recently updated first (topic browsing); `stars` = most stars first (new-repo windows). */
export type GithubSearchSort = 'updated' | 'stars';

/** A fixed query, or one built from the run's date. */
export type GithubSearchQuery = string | ((now: Date) => string);

export function githubSearchUrl(query: string, perPage = 20, sort: GithubSearchSort = 'updated'): string {
  return `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=desc&per_page=${perPage}`;
}

/** `YYYY-MM-DD` for `now` minus `days`, in UTC. */
export function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Repos with `topic` created in the `days` before the run, above a stars floor. */
export function createdWithinQuery(topic: string, days: number, minStars: number): (now: Date) => string {
  return (now) => `topic:${topic} created:>${daysBefore(now, days)} stars:>${minStars}`;
}

export function resolveGithubQuery(query: GithubSearchQuery, now: Date): string {
  return typeof query === 'function' ? query(now) : query;
}

export async function fetchGithubSearchItems(
  query: string,
  fetchJson: FetchJson,
  perPage = 20,
  sort: GithubSearchSort = 'updated',
): Promise<AdapterItem[]> {
  const res = await fetchJson<{ items?: GithubSearchRepo[] }>(githubSearchUrl(query, perPage, sort));
  return (res.items ?? []).map((repo): AdapterItem => ({
    canonicalUrl: repo.html_url,
    headline: repo.full_name,
    body: [repo.description ?? '', repo.topics?.length ? `Topics: ${repo.topics.join(', ')}` : ''].filter(Boolean).join('\n'),
    author: repo.owner?.login ?? null,
    publishTime: repo.pushed_at ? new Date(repo.pushed_at) : null,
    engagement: { stars: repo.stargazers_count ?? 0 },
    textIsComplete: false,
  }));
}
