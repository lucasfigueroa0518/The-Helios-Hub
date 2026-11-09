/**
 * Configured Field Notes sources: vendor-neutral. Every URL below was opened on
 * its `verifiedOn` date with a plain HTTP fetch and returned real feature, usage
 * or listing content; anything that did not load is left out (see the lists at
 * the bottom of this comment). No vendor is more than a third of the entries.
 *
 * `leaves` are the content-tree leaves the source mainly feeds (informational
 * only: scoring tags each tip's leaf). `vendor` is the tool maker the source is
 * about. `read` says how the adapter turns the page into items. `note` is what
 * the `verifiedOn` fetch showed. Every source must plausibly serve the middle
 * or higher AI know-how tier (PLAN 2026-11-06): no beginner material, nothing
 * written for Helios followers.
 *
 * Dropped 2026-11-06 (ingest audit): Hacker News front page (off-topic,
 * title-only; replaced by Show HN with a points floor), GitHub Trending (all
 * languages, and its per-repo API calls blow the unauthenticated rate limit),
 * the openai/codex README (duplicates the Codex changelog), Console.dev (general
 * developer tools), OpenAlternative (general SaaS clones, about 50 a day), the
 * GitHub open-data search (weather and law datasets, not AI), OpenAI news RSS
 * (corporate news and customer stories), Cursor agent docs (one undated page
 * whose only headings are site navigation, so it yields one item ever).
 *
 * Left out, with the reason (checked 2026-11-05):
 * - help.openai.com (ChatGPT release notes, Projects, memory, custom
 *   instructions): HTTP 403 to a plain fetch (bot wall); cannot be read here.
 * - github.com/openai/codex releases.atom: opens, but is alpha tags only.
 * - VoltAgent/awesome-agent-skills README: opens, but the first screen is
 *   sponsor markup and a 240 KB list; the topic search below reaches skills.
 * - latent.space and interconnects.ai feeds: open, but long essays, not tips.
 * - geminicli.com/docs/cli/skills: opens with real usage text, but its page date is
 *   old, so the `since` window drops it every run; no value as a source.
 * - GitHub org:anthropics search: dropped to keep Anthropic under a third.
 *
 * Left out, checked 2026-11-06 (thin-leaf search):
 * - registry.modelcontextprotocol.io: the official MCP Registry, but the page is
 *   "Loading servers..." until script runs, and its JSON API fits no adapter.
 * - modelcontextprotocol/servers README: opens, but holds only seven reference
 *   servers and itself points to the Registry; it rarely changes.
 * - blog.modelcontextprotocol.io feed: valid, but SDK and spec news (one post in
 *   45 days), not servers a reader can use.
 * - ai.google.dev / aistudio.google.com prompting-strategies HTML: renders by
 *   script (56 characters of text); its `.md` twin is used below instead.
 * - cookbook.openai.com RSS: 404.
 * - GitHub topic:dataset / topic:datasets: mostly labeling and eval tools, not data.
 * - GitHub topic:open-source-alternative: four repos above 500 stars; too thin.
 */
import { rssAdapter } from '@/lib/reels/adapters/rss-feed';
import type { JevRunner } from '@/lib/reels/jev/runner';
import type { Adapter, AdapterItem } from '@/lib/reels/types';
import type { ContentLeaf, TipSourceKind } from '@/lib/field-notes/types';
import { dedupeCandidates, toCandidate, type TipCandidate } from './candidate';
import { fetchDocsItems, type FetchText } from './docs-adapter';
import { ENRICH_CONCURRENCY, enrichItem, mapConcurrent, PAGE_MAX_BYTES, type EnrichMode, type FetchPage } from './enrich';
import {
  createdWithinQuery,
  fetchGithubSearchItems,
  resolveGithubQuery,
  type FetchJson,
  type GithubSearchQuery,
  type GithubSearchSort,
} from './github-search';

/** The day every entry below was last opened with a plain fetch. */
export const VERIFIED_ON = '2026-11-06';
/** Kept for importers: the thin-leaf sources were opened the same day. */
export const VERIFIED_ON_THIN_LEAVES = VERIFIED_ON;
/** Window for the "new repos" searches, counted back from the run's date. */
export const NEW_REPO_WINDOW_DAYS = 30;
/** Repos per GitHub search: each one is also a README fetch. */
export const GITHUB_SEARCH_PER_PAGE = 10;

/**
 * `leaves`, `vendor`, `verifiedOn`, `read` and `note` are optional in the type
 * so test fixtures stay small; every entry in SOURCE_REGISTRY carries all five
 * (the registry test asserts it).
 */
type Base = {
  id: string;
  label: string;
  kind: TipSourceKind;
  /** What the source mainly feeds. Informational only: the tip is still tagged by scoring. */
  leaves?: ContentLeaf[];
  /** The tool maker, or 'any' for a source that spans tools. */
  vendor?: string;
  /** Date the URL was opened and its content checked. */
  verifiedOn?: string;
  /** How the adapter reads it. */
  read?: string;
  /** One line: what the `verifiedOn` fetch showed. */
  note?: string;
  /** Fetch more text for thin items before they become candidates. GitHub searches default to `readme`. */
  enrich?: EnrichMode;
  why: string;
};

export type SourceEntry =
  | (Base & { type: 'adapter'; adapter: Adapter })
  | (Base & { type: 'docs'; pageUrl: string; fetchUrl?: string; format?: 'html' | 'markdown' | 'auto'; maxItems?: number; maxEntries?: number; split?: 'sections' | 'entries' })
  | (Base & { type: 'github-search'; query: GithubSearchQuery; sort?: GithubSearchSort; perPage?: number });

const V = VERIFIED_ON;
const rss = (id: string, name: string, feedUrl: string) => rssAdapter({ id, name, type: 'A6', bucket: 'A', feedUrl });

export const SOURCE_REGISTRY: readonly SourceEntry[] = [
  // ── Anthropic ──
  {
    type: 'docs', id: 'claude-code-changelog', label: 'Claude Code changelog', kind: 'docs', leaves: ['coding_agent_feature'], vendor: 'Anthropic', verifiedOn: V,
    pageUrl: 'https://code.claude.com/docs/en/changelog', fetchUrl: 'https://code.claude.com/docs/en/changelog.md', format: 'markdown', maxItems: 12, split: 'entries',
    read: 'docs adapter, markdown twin: newest 12 bold version blocks, one item per bullet (fix bullets and "N bug fixes" groups dropped)',
    note: '200, 1.2 MB markdown; newest block **2.1.319** dated November 6, 2026.',
    why: 'Dated, first-party list of what Claude Code can newly do.',
  },
  {
    type: 'docs', id: 'claude-app-release-notes', label: 'Claude apps release notes', kind: 'docs', leaves: ['llm_app_feature'], vendor: 'Anthropic', verifiedOn: V,
    pageUrl: 'https://support.claude.com/en/articles/12138966-release-notes',
    read: 'docs adapter, HTML: one item per dated h3 section',
    note: '200, 368 KB; dated h3 sections, newest November 6, 2026.',
    why: 'Help Center release notes for the Claude apps: features a non-developer can use today.',
  },
  {
    type: 'docs', id: 'claude-api-release-notes', label: 'Claude API release notes', kind: 'docs', leaves: ['coding_agent_feature', 'repo_agent_runtime'], vendor: 'Anthropic', verifiedOn: V,
    pageUrl: 'https://platform.claude.com/docs/en/release-notes/overview', fetchUrl: 'https://platform.claude.com/docs/en/release-notes/overview.md', format: 'markdown', maxItems: 12,
    read: 'docs adapter, markdown twin: one item per dated ### heading, newest 12',
    note: '200, 139 KB markdown; 92 "### Month D, YYYY" headings, newest November 5, 2026.',
    why: 'API, tool and agent features builders can use the day they ship.',
  },
  {
    type: 'docs', id: 'anthropic-skills-readme', label: 'anthropics/skills', kind: 'github', leaves: ['skill'], vendor: 'Anthropic', verifiedOn: V,
    pageUrl: 'https://github.com/anthropics/skills', fetchUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/README.md', format: 'markdown',
    read: 'docs adapter, raw README as one page item',
    note: '200, 5.5 KB README listing the reference skills with install steps.',
    why: 'The reference set of Agent Skills with install commands.',
  },
  {
    type: 'docs', id: 'claude-prompting-guide', label: 'Claude prompting best practices', kind: 'docs', leaves: ['technique'], vendor: 'Anthropic', verifiedOn: V,
    pageUrl: 'https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices',
    fetchUrl: 'https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices.md', format: 'markdown', split: 'sections',
    read: 'docs adapter, markdown twin split into one undated item per ## section (long ones per ###)',
    note: '200, 75 KB markdown; 9 ## sections (General principles, Output and formatting, Tool use, Agentic systems...).',
    why: "The vendor's own prompting guide: a cited source for technique tips.",
  },
  {
    type: 'github-search', id: 'gh-claude-code-topic', label: 'GitHub: claude-code topic', kind: 'github', leaves: ['skill', 'repo_mcp', 'repo_automation'], vendor: 'Anthropic', verifiedOn: V,
    query: 'topic:claude-code stars:>300', perPage: GITHUB_SEARCH_PER_PAGE,
    read: 'github-search adapter, recently updated first; README fetched per repo',
    note: 'API 200; 1,669 repos, top results pushed the same day.',
    why: 'Community tools built around Claude Code.',
  },
  // ── OpenAI ──
  {
    type: 'docs', id: 'codex-changelog', label: 'Codex changelog', kind: 'docs', leaves: ['coding_agent_feature', 'llm_app_feature'], vendor: 'OpenAI', verifiedOn: V,
    pageUrl: 'https://learn.chatgpt.com/docs/changelog', format: 'html', maxItems: 12, split: 'entries',
    read: 'docs adapter, HTML: newest 12 dated list entries (ISO date in the id, or a <time> for CLI releases), one item per top-level bullet (Bug Fixes, Chores, Documentation, Changelog groups dropped)',
    note: '200, 4.8 MB; list entries id="codex-2026-11-02-mobile" and id="github-release-435979892" (Codex CLI 0.167.0, <time>2026-11-06</time>).',
    why: 'Codex CLI and ChatGPT app changes with dates; developers.openai.com/codex redirects here.',
  },
  {
    type: 'docs', id: 'openai-prompting-guide', label: 'OpenAI prompt engineering guide', kind: 'docs', leaves: ['technique'], vendor: 'OpenAI', verifiedOn: V,
    pageUrl: 'https://developers.openai.com/api/docs/guides/prompt-engineering', format: 'html', split: 'sections',
    read: 'docs adapter, HTML split into one undated item per <h2 id> section in <main>',
    note: '200, 724 KB; 11 h2 sections with ids in <main> (few-shot-learning, message-formatting-with-markdown-and-xml...).',
    why: "The vendor's own prompting guide: a cited source for technique tips.",
  },
  {
    type: 'github-search', id: 'gh-openai-codex-topic', label: 'GitHub: openai-codex topic', kind: 'github', leaves: ['skill', 'repo_automation'], vendor: 'OpenAI', verifiedOn: V,
    query: 'topic:openai-codex stars:>300', perPage: GITHUB_SEARCH_PER_PAGE,
    read: 'github-search adapter, recently updated first; README fetched per repo',
    note: 'API 200; 52 repos.',
    why: 'Community tools built around Codex.',
  },
  // ── Google ──
  {
    type: 'docs', id: 'gemini-cli-releases', label: 'Gemini CLI release notes', kind: 'docs', leaves: ['coding_agent_feature'], vendor: 'Google', verifiedOn: V,
    pageUrl: 'https://geminicli.com/docs/changelogs/', format: 'html', maxItems: 12,
    read: 'docs adapter, HTML: one item per "Announcements: vX - YYYY-MM-DD" h2 section',
    note: '200, 240 KB; newest "Announcements: v0.64.0 - 2026-10-13".',
    why: 'Open source CLI with dated feature announcements.',
  },
  {
    type: 'docs', id: 'gemini-app-release-notes', label: 'Gemini app release notes', kind: 'docs', leaves: ['llm_app_feature'], vendor: 'Google', verifiedOn: V,
    pageUrl: 'https://gemini.google/release-notes/', format: 'html', maxItems: 12,
    read: 'docs adapter, HTML: one item per YYYY.MM.DD h2 card',
    note: '200, 319 KB; dated cards, newest 2026.10.13.',
    why: 'Dated Gemini app features (skills, customization, new apps).',
  },
  {
    type: 'adapter', id: 'workspace-gemini-updates', label: 'Google Workspace Updates: Gemini', kind: 'rss', leaves: ['llm_app_feature'], vendor: 'Google', verifiedOn: V,
    adapter: rss('workspace-gemini-updates', 'Google Workspace Updates', 'https://workspaceupdates.googleblog.com/feeds/posts/default/-/Gemini'),
    read: 'rss adapter (Atom, the blog\'s Gemini label feed)',
    note: '200, Atom; 25 dated posts, all Gemini features (newest Nov 5 "Gemini in Google Forms"), no weekly recaps.',
    why: 'Gemini features inside Docs, Sheets, Slides, Gmail and Meet that professionals use daily.',
  },
  {
    type: 'docs', id: 'gemini-prompting-guide', label: 'Gemini prompt design strategies', kind: 'docs', leaves: ['technique'], vendor: 'Google', verifiedOn: V,
    pageUrl: 'https://aistudio.google.com/docs/prompting-strategies', fetchUrl: 'https://aistudio.google.com/docs/prompting-strategies.md', format: 'markdown', split: 'sections',
    read: 'docs adapter, markdown twin split into one undated item per ## section, anchored by its {% id %}',
    note: '200, 37 KB markdown; 12 ## sections with explicit ids (few-shot, context, iteration, agentic-workflows...).',
    why: "The vendor's own prompting guide: a cited source for technique tips.",
  },
  {
    type: 'github-search', id: 'gh-gemini-cli-topic', label: 'GitHub: gemini-cli topic', kind: 'github', leaves: ['repo_mcp', 'repo_automation'], vendor: 'Google', verifiedOn: V,
    query: 'topic:gemini-cli stars:>300', perPage: GITHUB_SEARCH_PER_PAGE,
    read: 'github-search adapter, recently updated first; README fetched per repo',
    note: 'API 200; 145 repos.',
    why: 'Community tools built around Gemini CLI.',
  },
  // ── Cursor, GitHub Copilot ──
  {
    type: 'adapter', id: 'cursor-changelog', label: 'Cursor changelog', kind: 'rss', leaves: ['coding_agent_feature'], vendor: 'Cursor', verifiedOn: V,
    adapter: rssAdapter({ id: 'cursor-changelog', name: 'Cursor changelog', type: 'A5', bucket: 'A', feedUrl: 'https://cursor.com/changelog/rss.xml' }),
    read: 'rss adapter (RSS 2.0, full content:encoded)',
    note: '200, 133 KB RSS; newest item Nov 6, 2026.',
    why: 'A paid AI tool that ships features often.',
  },
  {
    type: 'adapter', id: 'copilot-changelog', label: 'GitHub Copilot changelog', kind: 'rss', leaves: ['coding_agent_feature'], vendor: 'GitHub', verifiedOn: V,
    adapter: rss('copilot-changelog', 'GitHub Changelog: Copilot', 'https://github.blog/changelog/label/copilot/feed/'),
    read: 'rss adapter (RSS 2.0, the changelog\'s copilot label)',
    note: '200, 67 KB RSS; 10 dated items, newest Nov 5 (Copilot in Xcode, JetBrains Air, Copilot Fusion); some are admin/API items.',
    why: 'The most used paid coding assistant: features its users can switch on.',
  },
  // ── Tool-agnostic GitHub searches (README fetched per repo) ──
  {
    type: 'github-search', id: 'gh-agent-skills', label: 'GitHub: agent-skills topic', kind: 'github', leaves: ['skill'], vendor: 'any', verifiedOn: V,
    query: 'topic:agent-skills stars:>300', perPage: GITHUB_SEARCH_PER_PAGE,
    read: 'github-search adapter, recently updated first; README fetched per repo',
    note: 'API 200; 612 repos.',
    why: 'Skills that work across Claude Code, Codex, Gemini CLI and Cursor.',
  },
  {
    type: 'github-search', id: 'gh-new-agent-skills', label: 'GitHub: new agent-skills repos', kind: 'github', leaves: ['skill'], vendor: 'any', verifiedOn: V,
    query: createdWithinQuery('agent-skills', NEW_REPO_WINDOW_DAYS, 50), sort: 'stars', perPage: GITHUB_SEARCH_PER_PAGE,
    read: 'github-search adapter: created in the 30 days before the run, most stars first; README fetched per repo',
    note: 'API 200; 136 repos created after 2026-10-07 (pixelfx 5.6k stars, stack-diagram).',
    why: 'Skills that just appeared and are already being starred: the newest useful ones.',
  },
  {
    type: 'github-search', id: 'gh-mcp-server-topic', label: 'GitHub: mcp-server topic', kind: 'github', leaves: ['repo_mcp'], vendor: 'any', verifiedOn: V,
    query: 'topic:mcp-server stars:>500', perPage: GITHUB_SEARCH_PER_PAGE,
    read: 'github-search adapter, recently updated first; README fetched per repo',
    note: 'API 200; 458 repos.',
    why: 'Open-source MCP servers and connectors, across every client.',
  },
  {
    type: 'github-search', id: 'gh-new-mcp-servers', label: 'GitHub: new mcp-server repos', kind: 'github', leaves: ['repo_mcp'], vendor: 'any', verifiedOn: V,
    query: createdWithinQuery('mcp-server', NEW_REPO_WINDOW_DAYS, 50), sort: 'stars', perPage: GITHUB_SEARCH_PER_PAGE,
    read: 'github-search adapter: created in the 30 days before the run, most stars first; README fetched per repo',
    note: 'API 200; 69 repos created after 2026-10-07 (reason-network, doory); a few are off-topic apps tagged mcp-server.',
    why: 'MCP servers released this month that people are already picking up.',
  },
  {
    type: 'github-search', id: 'gh-ai-memory', label: 'GitHub: ai-memory topic', kind: 'github', leaves: ['repo_memory'], vendor: 'any', verifiedOn: V,
    query: 'topic:ai-memory stars:>300', perPage: GITHUB_SEARCH_PER_PAGE,
    read: 'github-search adapter, recently updated first; README fetched per repo',
    note: 'API 200; 67 repos (cognee, magic-context, screenpipe).',
    why: 'Memory and knowledge tools: the only source aimed at the memory leaf.',
  },
  {
    type: 'github-search', id: 'gh-local-llm', label: 'GitHub: local-llm topic', kind: 'github', leaves: ['repo_agent_runtime', 'repo_free_alternative'], vendor: 'any', verifiedOn: V,
    query: 'topic:local-llm stars:>500', perPage: GITHUB_SEARCH_PER_PAGE,
    read: 'github-search adapter, recently updated first; README fetched per repo',
    note: 'API 200; 80 repos (qvac, Soup, row-bot).',
    why: 'Run models on your own machine: agent runtimes and a free path off paid APIs.',
  },
  {
    type: 'github-search', id: 'gh-self-hosted-ai', label: 'GitHub: self-hosted AI', kind: 'github', leaves: ['repo_free_alternative', 'repo_automation'], vendor: 'any', verifiedOn: V,
    query: 'topic:self-hosted topic:ai stars:>500', perPage: GITHUB_SEARCH_PER_PAGE,
    read: 'github-search adapter, recently updated first; README fetched per repo',
    note: 'API 200; 100 repos (onyx, CompanyOS, crw "Firecrawl alternative"); some general infra such as ClickHouse.',
    why: 'Self-hostable AI tools that replace a paid service.',
  },
  // ── Practitioners and launches ──
  {
    type: 'adapter', id: 'show-hn', label: 'Show HN (50+ points)', kind: 'hn', leaves: ['repo_agent_runtime', 'repo_free_alternative', 'repo_automation'], vendor: 'any', verifiedOn: V, enrich: 'linked-page',
    adapter: rss('show-hn', 'Show HN', 'https://hnrss.org/show?points=50'),
    read: 'rss adapter (hnrss); the linked page (or the linked repo\'s README) is fetched per item',
    note: '200, RSS; 20 dated Show HN items, mixed topics (Stroq agent audit, games); titles only until enriched.',
    why: 'Launches by the people who built them, past a points floor; scoring drops the off-topic ones.',
  },
  {
    type: 'adapter', id: 'simon-willison', label: 'Simon Willison weblog', kind: 'rss', leaves: ['technique', 'repo_agent_runtime'], vendor: 'any', verifiedOn: V,
    adapter: rss('simon-willison', 'Simon Willison', 'https://simonwillison.net/atom/everything/'),
    read: 'rss adapter (Atom, updated daily)',
    note: '200, 117 KB Atom; updated 2026-11-06.',
    why: 'A practitioner writing up AI tools he actually used.',
  },
  {
    type: 'adapter', id: 'one-useful-thing', label: 'One Useful Thing', kind: 'rss', leaves: ['technique', 'llm_app_feature'], vendor: 'any', verifiedOn: V,
    adapter: rss('one-useful-thing', 'One Useful Thing', 'https://www.oneusefulthing.org/feed'),
    read: 'rss adapter (RSS 2.0, full posts)',
    note: '200, 922 KB RSS; newest post Oct 20, 2026.',
    why: 'Practitioner advice on using AI tools at work.',
  },
];

export type CollectDeps = {
  fetchText: FetchText;
  fetchJson: FetchJson;
  /**
   * SSRF-guarded page fetch for `linked-page` enrichment (links come from a feed). Default: the seed path's
   * `fetchPageFollowingRedirects` with `blockPrivate`, loaded only when an item needs it. Tests pass a stub.
   */
  fetchPage?: FetchPage;
  /** The text fetch enrichment uses for READMEs (live: byte-capped at PAGE_MAX_BYTES). Default: `fetchText`. */
  fetchEnrichText?: FetchText;
  now: Date;
  /** Only items published on or after this (undated items pass). */
  since: Date;
  signal?: AbortSignal;
};

/** Reused adapters take a JevRunner in their context; Field Notes never lets them call it. */
const NO_JEV = {
  callCount: 0,
  ask() {
    throw new Error('Field Notes sources never call Jev through an adapter.');
  },
} as unknown as JevRunner;

export type CollectResult = {
  candidates: TipCandidate[];
  failures: { sourceId: string; error: string }[];
};

export async function fetchEntryItems(entry: SourceEntry, deps: CollectDeps): Promise<AdapterItem[]> {
  switch (entry.type) {
    case 'adapter':
      return entry.adapter.fetchItems({ since: deps.since, now: deps.now, runId: 'field-notes', signal: deps.signal, jev: NO_JEV });
    case 'docs':
      return fetchDocsItems({ id: entry.id, name: entry.label, pageUrl: entry.pageUrl, fetchUrl: entry.fetchUrl, format: entry.format, maxItems: entry.maxItems, maxEntries: entry.maxEntries, split: entry.split, fetchText: deps.fetchText }, deps.since);
    case 'github-search':
      return fetchGithubSearchItems(resolveGithubQuery(entry.query, deps.now), deps.fetchJson, entry.perPage, entry.sort);
  }
}

export function enrichModeOf(entry: SourceEntry): EnrichMode | null {
  return entry.enrich ?? (entry.type === 'github-search' ? 'readme' : null);
}

/** The seed path's guarded fetch, loaded on first use so tests and imports never touch the network module. */
const defaultFetchPage: FetchPage = async (url) => {
  const { fetchPageFollowingRedirects } = await import('@/lib/reels/net/http');
  return fetchPageFollowingRedirects(url, { retries: 0, timeoutMs: 15_000, blockPrivate: true, maxBytes: PAGE_MAX_BYTES });
};

export type ThinCollectResult = CollectResult & {
  /**
   * Enrich some of the collected candidates (README or linked page, per their source), at most ENRICH_CONCURRENCY
   * fetches at a time. Pass only what will be scored: the run calls it after dropping stored links and taking the
   * scoring slots, so nothing already in the database is fetched for. Order kept; a candidate whose source does not
   * enrich, or whose fetch fails, comes back as it was. Never throws.
   */
  enrich: (subset: readonly TipCandidate[]) => Promise<TipCandidate[]>;
};

/**
 * Every source's items as thin candidates (no page or README fetched yet), deduped by canonical URL, plus `enrich`
 * for the few the caller will score. One source failing never blocks the rest.
 */
export async function collectThinCandidates(entries: readonly SourceEntry[], deps: CollectDeps): Promise<ThinCollectResult> {
  const all: TipCandidate[] = [];
  const failures: CollectResult['failures'] = [];
  // The raw item behind each enrichable candidate (the first source that offered it), keyed by its canonical link.
  const raw = new Map<string, { item: AdapterItem; mode: EnrichMode; kind: TipSourceKind; label: string }>();
  for (const entry of entries) {
    try {
      const found = await fetchEntryItems(entry, deps);
      const mode = enrichModeOf(entry);
      for (const item of found) {
        const c = toCandidate(item, entry.kind, entry.label);
        all.push(c);
        if (mode && !raw.has(c.sourceUrl)) raw.set(c.sourceUrl, { item, mode, kind: entry.kind, label: entry.label });
      }
    } catch (error) {
      failures.push({ sourceId: entry.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const fetchDeps = { fetchText: deps.fetchEnrichText ?? deps.fetchText, fetchPage: deps.fetchPage ?? defaultFetchPage };
  const enrich: ThinCollectResult['enrich'] = (subset) =>
    mapConcurrent(subset, ENRICH_CONCURRENCY, async (c) => {
      const r = raw.get(c.sourceUrl);
      if (!r) return c;
      const item = await enrichItem(r.item, r.mode, fetchDeps);
      if (item === r.item) return c;
      // Keep the candidate's own link, source and date; take the enriched text and metadata.
      const e = toCandidate(item, r.kind, r.label);
      return { ...c, item: e.item, untrustedContent: e.untrustedContent };
    });
  return { candidates: dedupeCandidates(all), failures, enrich };
}

/** Every candidate collected and enriched (one-shots and tests). A run uses collectThinCandidates and enriches only what it scores. */
export async function collectCandidates(entries: readonly SourceEntry[], deps: CollectDeps): Promise<CollectResult> {
  const thin = await collectThinCandidates(entries, deps);
  return { candidates: await thin.enrich(thin.candidates), failures: thin.failures };
}
