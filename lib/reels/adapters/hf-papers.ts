import { canonicalizeUrl, fetchJson } from '@/lib/reels/net/http';
import { normalizeText } from '@/lib/reels/net/html';
import type { Adapter, AdapterItem } from '@/lib/reels/types';

type DailyPaper = {
  paper?: {
    id?: string;
    title?: string;
    summary?: string;
    upvotes?: number;
    publishedAt?: string;
    authors?: Array<{ name?: string }>;
  };
  title?: string;
  publishedAt?: string;
  thumbnail?: string;
};

/**
 * A3 (D-050): Daily Papers only. Hub trending models and datasets are not
 * pulled.
 *
 * The abstract plus metadata counts as full text for papers (ING-06 follow-up /
 * D-067), so these never need the destination fetched and a failed PDF parse
 * cannot drop a paper. No upvote floor: engagement ranks, it does not gate
 * (ING-05 / D-034).
 */
export const hfDailyPapers: Adapter = {
  id: 'hf-daily-papers',
  name: 'Hugging Face Daily Papers',
  type: 'A3',
  bucket: 'A',
  kind: 'ranked',

  async fetchItems({ signal }) {
    const papers = await fetchJson<DailyPaper[]>(
      'https://huggingface.co/api/daily_papers?limit=50',
      { signal },
    );

    const items: AdapterItem[] = [];
    for (const [index, entry] of papers.entries()) {
      const paper = entry.paper;
      const id = paper?.id?.trim();
      const title = (paper?.title ?? entry.title ?? '').trim();
      const abstract = normalizeText(paper?.summary ?? '');
      if (!id || !title || !abstract) continue;

      const authors = (paper?.authors ?? [])
        .map((author) => author.name)
        .filter((name): name is string => Boolean(name));

      const published = paper?.publishedAt ?? entry.publishedAt ?? null;

      items.push({
        // arXiv is the identity other sources are most likely to cite too.
        canonicalUrl: canonicalizeUrl(`https://arxiv.org/abs/${id}`),
        headline: title,
        body: abstract,
        author: authors[0] ?? null,
        byline: authors.length > 0 ? authors.slice(0, 6).join(', ') : null,
        publishTime: published ? new Date(published) : null,
        engagement: { upvotes: paper?.upvotes ?? 0, rank: index + 1 },
        mediaUrls: entry.thumbnail ? [entry.thumbnail] : [],
        citationUrls: [`https://huggingface.co/papers/${id}`],
        textIsComplete: true,
        rawPayload: entry,
      });
    }
    return items;
  },
};
