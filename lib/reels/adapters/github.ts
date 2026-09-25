import { decodeEntities, markdownToText } from '@/lib/reels/net/html';
import { HttpError, canonicalizeUrl, fetchJson, fetchText } from '@/lib/reels/net/http';
import type { AdapterItem } from '@/lib/reels/types';

export type TrendingRepo = {
  fullName: string;
  description: string;
  starsToday: number;
  rank: number;
};

/**
 * Prefer a Reels-specific token. `GITHUB_TOKEN` is also the bootstrap fallback
 * for Client Dashboards' repo sync (`lib/dashboards/tokens.ts`), and the token
 * Reels wants is a public-read one with no scopes — handing that to Dashboards
 * would turn "no token configured" into a confusing 404 on private repos.
 */
export function githubToken(): string | undefined {
  return process.env.REELS_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || undefined;
}

function githubHeaders(): Record<string, string> {
  const token = githubToken();
  // GitHub accepts `Bearer` for classic and fine-grained PATs alike.
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Unauthenticated GitHub allows 60 calls an hour and each repo costs three, so
 * a single night exhausts it. Without this the throttle looks like a thin
 * Trending list and an empty A4 rather than a missing token.
 */
export class GithubRateLimitError extends Error {
  constructor() {
    super(
      githubToken()
        ? 'GitHub API rate limit reached for the configured token.'
        : 'GitHub API rate limit reached (60/hour unauthenticated). Set REELS_GITHUB_TOKEN to raise it to 5,000/hour.',
    );
    this.name = 'GithubRateLimitError';
  }
}

function asRateLimit(error: unknown): GithubRateLimitError | null {
  if (error instanceof HttpError && (error.status === 403 || error.status === 429)) {
    return new GithubRateLimitError();
  }
  return null;
}

/**
 * There is no official Trending API, so the page is scraped (D-068). Kept
 * tolerant: a markup change should yield zero repos and a failed source on the
 * run page, never a crash mid-night.
 */
export function parseTrendingHtml(html: string): TrendingRepo[] {
  const rows = html.split(/<article\b[^>]*class="[^"]*Box-row[^"]*"[^>]*>/i).slice(1);
  const repos: TrendingRepo[] = [];

  for (const [index, row] of rows.entries()) {
    const href = row.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="\/([^"?#]+)"/i)?.[1];
    if (!href) continue;
    const parts = href.split('/').filter(Boolean);
    if (parts.length !== 2) continue;

    const description = row.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '';
    const starsToday = row.match(/([\d,]+)\s*stars?\s+today/i)?.[1] ?? '0';

    repos.push({
      fullName: parts.join('/'),
      description: decodeEntities(description.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
      starsToday: Number(starsToday.replace(/,/g, '')) || 0,
      rank: index + 1,
    });
  }

  return repos;
}

type RepoInfo = {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  pushed_at: string | null;
  owner?: { login?: string };
};

type ReleaseInfo = { name: string | null; tag_name: string | null; body: string | null };

/** README plus the latest release notes is the record body (REC-02 / D-040). */
export async function buildRepoItem(
  repo: TrendingRepo,
  signal?: AbortSignal,
): Promise<AdapterItem | null> {
  const headers = githubHeaders();
  const info = await fetchJson<RepoInfo>(`https://api.github.com/repos/${repo.fullName}`, {
    headers: { ...headers, accept: 'application/vnd.github+json' },
    signal,
  }).catch((error) => {
    throw asRateLimit(error) ?? error;
  });

  const readme = await fetchText(`https://api.github.com/repos/${repo.fullName}/readme`, {
    headers: { ...headers, accept: 'application/vnd.github.raw' },
    signal,
  }).catch(() => '');

  const release = await fetchJson<ReleaseInfo>(
    `https://api.github.com/repos/${repo.fullName}/releases/latest`,
    { headers: { ...headers, accept: 'application/vnd.github+json' }, signal },
  ).catch(() => null);

  const sections = [
    info.description ?? repo.description,
    readme ? markdownToText(readme) : '',
    release?.body
      ? `Latest release ${release.name ?? release.tag_name ?? ''}\n${markdownToText(release.body)}`
      : '',
  ].filter((section) => section && section.trim().length > 0);

  const body = sections.join('\n\n').trim();
  if (!body) return null;

  return {
    canonicalUrl: canonicalizeUrl(info.html_url),
    headline: `${info.full_name}${info.description ? `: ${info.description}` : ''}`,
    body,
    author: info.owner?.login ?? null,
    byline: info.owner?.login ? `${info.owner.login} on GitHub` : null,
    publishTime: info.pushed_at ? new Date(info.pushed_at) : null,
    engagement: {
      stars: info.stargazers_count,
      starsToday: repo.starsToday,
      rank: repo.rank,
    },
    textIsComplete: true,
    rawPayload: { repo, release: release?.tag_name ?? null },
  };
}

export async function fetchTrending(signal?: AbortSignal): Promise<TrendingRepo[]> {
  const html = await fetchText('https://github.com/trending', { signal });
  return parseTrendingHtml(html);
}
