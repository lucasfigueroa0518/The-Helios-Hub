import { GithubRateLimitError, buildRepoItem, fetchTrending } from '@/lib/reels/adapters/github';
import type { Adapter, AdapterItem } from '@/lib/reels/types';

/**
 * A1 (D-003, D-068): daily Trending, all languages, because the type is about
 * what is trending now. Language and topic filters are left to the ingest
 * screen rather than hardcoded here.
 *
 * Ranked lists ingest whole (ING-04 / D-035), but each repo costs two or three
 * API calls, so they are fetched a few at a time.
 */
export const githubTrending: Adapter = {
  id: 'github-trending',
  name: 'GitHub Trending',
  type: 'A1',
  bucket: 'A',
  kind: 'ranked',

  async fetchItems({ signal }) {
    const repos = await fetchTrending(signal);
    const items: AdapterItem[] = [];

    const batchSize = 4;
    for (let offset = 0; offset < repos.length; offset += batchSize) {
      const batch = repos.slice(offset, offset + batchSize);
      const built = await Promise.all(
        batch.map((repo) =>
          buildRepoItem(repo, signal).catch((error) => {
            // A throttle is worth reporting; one unreadable repo is not.
            if (error instanceof GithubRateLimitError) throw error;
            return null;
          }),
        ),
      );
      for (const item of built) if (item) items.push(item);
    }

    return items;
  },
};
