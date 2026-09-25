import { awesomeLists } from '@/lib/reels/adapters/awesome-lists';
import { githubTrending } from '@/lib/reels/adapters/github-trending';
import { hackerNews } from '@/lib/reels/adapters/hacker-news';
import { hfDailyPapers } from '@/lib/reels/adapters/hf-papers';
import { markdownChangelogAdapter } from '@/lib/reels/adapters/markdown-changelog';
import { rssAdapter } from '@/lib/reels/adapters/rss-feed';
import { claudeWebSearch } from '@/lib/reels/adapters/web-search';
import type { Adapter } from '@/lib/reels/types';

/**
 * The roster from D-050. Out of Build 1: Wikipedia (D-010), GH Archive
 * (D-026), oral history (D-003), Wired and The Verge (paywalls would empty
 * them under D-036), Hub trending, Bytes, JavaScript Weekly, and the vendors
 * not named here.
 *
 * Feed URLs were delegated at implementation and each one was probed before
 * being wired. Where an outlet publishes an AI-section feed, that is what we
 * take. Anthropic publishes no news RSS, so A5 reads its platform release
 * notes, which is the changelog the source type asks for.
 */
export const ADAPTERS: Adapter[] = [
  // A1
  githubTrending,
  // A2
  hackerNews,
  // A3
  hfDailyPapers,
  // A5 — vendor changelogs and release notes
  rssAdapter({
    id: 'openai-news',
    name: 'OpenAI',
    type: 'A5',
    bucket: 'A',
    feedUrl: 'https://openai.com/news/rss.xml',
  }),
  markdownChangelogAdapter({
    id: 'anthropic-release-notes',
    name: 'Anthropic platform release notes',
    type: 'A5',
    bucket: 'A',
    sourceUrl: 'https://docs.claude.com/en/release-notes/api.md',
    pageUrl: 'https://platform.claude.com/docs/en/release-notes/api',
  }),
  rssAdapter({
    id: 'cursor-changelog',
    name: 'Cursor changelog',
    type: 'A5',
    bucket: 'A',
    feedUrl: 'https://cursor.com/changelog/rss.xml',
  }),
  // A6 — curated dev newsletters
  rssAdapter({
    id: 'tldr',
    name: 'TLDR',
    type: 'A6',
    bucket: 'A',
    feedUrl: 'https://tldr.tech/api/rss/tech',
  }),
  rssAdapter({
    id: 'console-dev',
    name: 'Console.dev',
    type: 'A6',
    bucket: 'A',
    feedUrl: 'https://console.dev/rss.xml',
  }),
  // B1 — tech press
  rssAdapter({
    id: 'techcrunch',
    name: 'TechCrunch',
    type: 'B1',
    bucket: 'B',
    feedUrl: 'https://techcrunch.com/category/artificial-intelligence/feed/',
  }),
  rssAdapter({
    id: 'ars-technica',
    name: 'Ars Technica',
    type: 'B1',
    bucket: 'B',
    feedUrl: 'https://arstechnica.com/ai/feed/',
  }),
  rssAdapter({
    id: '404-media',
    name: '404 Media',
    type: 'B1',
    bucket: 'B',
    feedUrl: 'https://www.404media.co/rss/',
  }),
  // B3 — company blogs, post-mortems, model cards
  rssAdapter({
    id: 'cloudflare-blog',
    name: 'Cloudflare blog',
    type: 'B3',
    bucket: 'B',
    feedUrl: 'https://blog.cloudflare.com/rss/',
  }),
  rssAdapter({
    id: 'deepmind-blog',
    name: 'Google DeepMind',
    type: 'B3',
    bucket: 'B',
    feedUrl: 'https://deepmind.google/blog/rss.xml',
  }),
  // A4 and B6 read what tonight already ingested, so they run last.
  awesomeLists,
  claudeWebSearch,
];

export function primaryAdapters(): Adapter[] {
  return ADAPTERS.filter((adapter) => adapter.phase !== 'derived');
}

export function derivedAdapters(): Adapter[] {
  return ADAPTERS.filter((adapter) => adapter.phase === 'derived');
}

export function adapterById(id: string): Adapter | undefined {
  return ADAPTERS.find((adapter) => adapter.id === id);
}
