/**
 * Candidate shaping: an adapter item becomes a TipCandidate with no model.
 * Subject and use-with-result are filled later by the writing stage; leaf, want,
 * tier, purposes and fresh by scoring (or the seeder, for leaf and want).
 *
 * Scraped text (title and body) lives ONLY in `untrustedContent`. Everything
 * else on a candidate is trusted metadata (our own labels, the URL, the date).
 */
import { canonicalizeUrl } from '@/lib/reels/net/http';
import type { AdapterItem } from '@/lib/reels/types';
import type { Tip, TipSourceKind } from '@/lib/field-notes/types';

/** Cap on scraped text carried forward, so one page cannot flood a Jev state. */
export const UNTRUSTED_MAX_CHARS = 6000;

export type TipCandidate = {
  /** Canonical source URL: the dedupe key (unique index on field_notes.tips.source_url). */
  sourceUrl: string;
  sourceKind: TipSourceKind;
  /** Our registry label for the source, never scraped. */
  sourceLabel: string;
  publishedAt: string | null;
  /** Item metadata with every scraped text field removed. */
  item: Omit<AdapterItem, 'headline' | 'body' | 'author' | 'byline' | 'rawPayload' | 'canonicalUrl'>;
  /** Scraped title and body. Data only; never goes into instructions. */
  untrustedContent: string;
};

/** The fragments that mean "the repo's front page" on github.com (the README anchor GitHub adds). */
const GITHUB_ROOT_FRAGMENTS = new Set(['', '#readme']);

/**
 * Canonical form used for dedupe: tracking params gone, www and trailing slash
 * dropped. Fragments are kept: a dated changelog section is its own tip.
 *
 * github.com repo links have one more rule, because HN posts, feeds and searches spell the same repo many ways:
 * the repo root, `/tree/<branch>`, `#readme` and a `.git` suffix all become the lowercase
 * `https://github.com/owner/repo` (no query); a deeper path keeps its path (and fragment) with owner/repo lowercased.
 */
export function canonicalSourceUrl(url: string): string {
  const out = canonicalizeUrl(url);
  let u: URL;
  try {
    u = new URL(out);
  } catch {
    return out;
  }
  if (u.hostname !== 'github.com') return out;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return out;
  const owner = parts[0]!.toLowerCase();
  const repo = parts[1]!.replace(/\.git$/i, '').toLowerCase();
  if (!repo) return out;
  const rest = parts.slice(2);
  const isRoot = rest.length === 0 || (rest.length === 2 && rest[0] === 'tree');
  if (isRoot && GITHUB_ROOT_FRAGMENTS.has(u.hash.toLowerCase())) return `https://github.com/${owner}/${repo}`;
  u.pathname = `/${[owner, repo, ...rest].join('/')}`;
  return u.toString();
}

/** github.com paths that are not a repo owner (topics, orgs, search and site pages). */
const NOT_REPO_OWNERS = new Set(['topics', 'orgs', 'collections', 'trending', 'search', 'marketplace', 'sponsors', 'features', 'settings', 'apps', 'about', 'login', 'explore']);
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;

/** A GitHub repo a link points at: `owner` and `repo` as written (for raw.githubusercontent.com), `slug` lowercase `owner/repo` (a dedupe key). */
export type GithubRepo = { owner: string; repo: string; slug: string };

/**
 * The GitHub repo of a github.com link (the repo root or anything inside it, `www.` and a `.git` suffix allowed);
 * null for any other link and for site pages such as /topics/... The one parser for both enrichment and selection.
 */
export function githubRepoOf(url: string | null | undefined): GithubRepo | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./i, '').toLowerCase() !== 'github.com') return null;
    const [owner, rawRepo] = u.pathname.split('/').filter(Boolean);
    const repo = rawRepo?.replace(/\.git$/i, '');
    if (!owner || !repo || NOT_REPO_OWNERS.has(owner.toLowerCase()) || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) return null;
    return { owner, repo, slug: `${owner}/${repo}`.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * The candidate's own title: the first non-empty line of its scraped text (toCandidate puts the headline there).
 * Used only as a deterministic dedupe key (selection); it never goes into an instruction.
 */
export function candidateTitle(c: { untrustedContent?: string | null }): string {
  const line = (c.untrustedContent ?? '').split(/\r?\n/).find((l) => l.trim());
  return (line ?? '').trim().slice(0, 200);
}

export function toCandidate(item: AdapterItem, sourceKind: TipSourceKind, sourceLabel: string): TipCandidate {
  const { headline, body, author: _a, byline: _b, rawPayload: _r, canonicalUrl, ...meta } = item;
  const text = `${headline}\n\n${body}`.trim().slice(0, UNTRUSTED_MAX_CHARS);
  return {
    sourceUrl: canonicalSourceUrl(canonicalUrl),
    sourceKind,
    sourceLabel,
    publishedAt: item.publishTime ? item.publishTime.toISOString() : null,
    item: meta,
    untrustedContent: text,
  };
}

/**
 * Keep the first candidate per canonical URL; on a repeat keep the one with
 * the longer text (a complete page beats a teaser).
 */
export function dedupeCandidates(candidates: readonly TipCandidate[]): TipCandidate[] {
  const byUrl = new Map<string, TipCandidate>();
  for (const c of candidates) {
    const key = canonicalSourceUrl(c.sourceUrl);
    const existing = byUrl.get(key);
    if (!existing || c.untrustedContent.length > existing.untrustedContent.length) byUrl.set(key, { ...c, sourceUrl: key });
  }
  return [...byUrl.values()];
}

/** The part of a Tip known before the writing stage. */
export type TipDraft = Pick<Tip, 'sourceKind' | 'sourceUrl' | 'sourceLabel' | 'untrustedContent' | 'score' | 'status'>;

export function candidateToTipDraft(c: TipCandidate, score: number | null = null): TipDraft {
  return {
    sourceKind: c.sourceKind,
    sourceUrl: c.sourceUrl,
    sourceLabel: c.sourceLabel,
    untrustedContent: c.untrustedContent,
    score,
    status: 'candidate',
  };
}
