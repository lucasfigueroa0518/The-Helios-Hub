import { ARTICLE_FEED_CAP } from '@/lib/reels/config';
import { canonicalizeUrl, fetchJson } from '@/lib/reels/net/http';
import { htmlToText } from '@/lib/reels/net/html';
import type { Adapter, AdapterItem } from '@/lib/reels/types';

type AlgoliaHit = {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string | null;
  story_text: string | null;
};

type AlgoliaResponse = { hits: AlgoliaHit[] };

const SEARCH = 'https://hn.algolia.com/api/v1/search';

function discussionUrl(objectId: string): string {
  return `https://news.ycombinator.com/item?id=${objectId}`;
}

/**
 * A2 (D-068): front page and Show HN.
 *
 * The record body is the destination, not the thread (REC-02 / D-040), so a
 * story submitted here and pulled from its outlet's own feed share a canonical
 * URL and auto-merge. Points and comment count are stored as engagement only;
 * full comment threads would blow Jev's state budget and are not ingested.
 *
 * Whether a story is on topic is left to the ingest screen, not a keyword gate.
 */
export const hackerNews: Adapter = {
  id: 'hacker-news',
  name: 'Hacker News',
  type: 'A2',
  bucket: 'A',
  kind: 'ranked',

  async fetchItems({ signal }) {
    const [frontPage, showHn] = await Promise.all([
      fetchJson<AlgoliaResponse>(`${SEARCH}?tags=front_page&hitsPerPage=30`, { signal }),
      fetchJson<AlgoliaResponse>(`${SEARCH}?tags=show_hn&hitsPerPage=${ARTICLE_FEED_CAP}`, { signal }),
    ]);

    const seen = new Set<string>();
    const items: AdapterItem[] = [];

    for (const [index, hit] of [...frontPage.hits, ...showHn.hits].entries()) {
      if (!hit.title || seen.has(hit.objectID)) continue;
      seen.add(hit.objectID);

      const selfText = hit.story_text ? htmlToText(hit.story_text) : '';
      const target = hit.url?.trim();
      // Ask HN and other text posts carry their own body; link posts are
      // pointers the pipeline follows to the destination (REC-03 / D-041).
      if (!target && selfText.length === 0) continue;

      items.push({
        canonicalUrl: canonicalizeUrl(target || discussionUrl(hit.objectID)),
        headline: hit.title,
        body: selfText,
        author: hit.author,
        byline: hit.author ? `${hit.author} on Hacker News` : null,
        publishTime: hit.created_at ? new Date(hit.created_at) : null,
        engagement: {
          points: hit.points ?? 0,
          comments: hit.num_comments ?? 0,
          rank: index + 1,
        },
        destinationUrl: target || undefined,
        textIsComplete: !target,
        citationUrls: [discussionUrl(hit.objectID)],
        rawPayload: hit,
      });
    }

    return items;
  },
};
