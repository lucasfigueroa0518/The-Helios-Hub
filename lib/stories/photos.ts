/**
 * Photos for Stories (plan §5.4, §12): one adapter around Tommy's finder
 * (lib/social/photos/find.ts, called as-is, never edited) and the
 * `social.used_photos` log. Builds call `PhotoFinder`; tests stub it.
 *
 * The live finder gets a minimal brief (the story's subjects, its sources and
 * date) and the read pages of its source URLs, then runs `searchVisual` with
 * Jev for identity checks. It runs without Tommy's vision, face and
 * contact-sheet steps (those are wired inside his design stage); the render
 * review (S-33) and Lucas's review of the first sets are the look checks.
 */
import { createJevAsk, type JevAsk } from '@/lib/social/jev/client';
import { newSearchContext, searchVisual, type Candidate } from '@/lib/social/photos/find';
import type { Brief } from '@/lib/social/reporter/brief';
import { readPage, type PageReadOk } from '@/lib/social/reporter/read-page';
import type { VisualKind } from '@/lib/social/writer/draft';
import type { Photo } from '@/lib/stories/render/types';

export type PhotoRequest = {
  kind: string;
  query: string;
  subjects: Array<{ name: string; type: 'person' | 'organization' }>;
  storyDate: string | null;
  sourceUrls: string[];
  /** Never pick these (photos used in the last 7 days, or already in this set). */
  exclude: Set<string>;
};

export interface PhotoFinder {
  find(req: PhotoRequest): Promise<Photo | null>;
  /** Vision and Jev spend so far, for the set's cost rows. */
  readonly usd: number;
}

const KINDS = new Set(['person', 'company', 'logo', 'product', 'event', 'thematic', 'setting']);

/** A finder candidate as a Stories photo. People are framed as person photos, logos as logos. */
export function toStoryPhoto(c: Pick<Candidate, 'url' | 'credit' | 'lane'>, kind: string): Photo {
  return { src: c.url, credit: c.credit || 'Photo', kind: c.lane === 'logo' || kind === 'logo' ? 'logo' : kind === 'person' || c.lane === 'headshot' || c.lane === 'second' || c.lane === 'ceo' ? 'person' : 'scene' };
}

export function minimalBrief(req: PhotoRequest): Brief {
  return {
    single_story: { yes: true, note: null },
    the_news: { text: req.query, ids: [] },
    why_it_matters: [],
    facts: [],
    background: [],
    quotes: [],
    numbers: [],
    terms: [],
    subjects: req.subjects.map((s, i) => ({ id: `S${i + 1}`, name: s.name, role: null, type: s.type })),
    events: [],
    article_photos: [],
    not_answered: [],
    sources: req.sourceUrls.map((url) => ({ outlet: new URL(url).host, date: req.storyDate, url, kind: 'original' as const })),
    fetch_failures: [],
  };
}

export function createLivePhotoFinder(opts: { jev?: JevAsk; http?: typeof fetch } = {}): PhotoFinder {
  let usd = 0;
  const jev: JevAsk = opts.jev ?? createJevAsk();
  const tallied: JevAsk = async (request, meta) => {
    const r = await jev(request, meta);
    usd += (r.usage?.input_tokens ?? 0) * 0.042 / 1_000_000;
    return r;
  };
  return {
    get usd() {
      return usd;
    },
    async find(req) {
      if (!KINDS.has(req.kind) || !req.query.trim()) return null;
      const pages: PageReadOk[] = [];
      for (const url of req.sourceUrls.slice(0, 3)) {
        const p = await readPage(url).catch(() => null);
        if (p && p.ok) pages.push(p);
      }
      const ctx = newSearchContext(minimalBrief(req), pages, { recent: req.exclude, storyDate: req.storyDate });
      const { candidates } = await searchVisual({ kind: req.kind as VisualKind, query: req.query }, ctx, { jev: tallied, http: opts.http ?? fetch });
      const pick = candidates.find((c) => !req.exclude.has(c.url));
      return pick ? toStoryPhoto(pick, req.kind) : null;
    },
  };
}
