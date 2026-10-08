/**
 * Photos for Stories (plan §5.4, §12): one adapter around Tommy's finder
 * (lib/social/photos/find.ts, called as-is, never edited) and the
 * `social.used_photos` log. Builds call `PhotoFinder`; tests stub it.
 *
 * The live finder gets a minimal brief (the story's subjects, its sources and
 * date) and the read pages of its source URLs, then runs `searchVisual` with
 * Jev for identity checks, and Tommy's close-up vision check on Haiku 5.5
 * (S-70; priced by Stories, lib/stories/cost.ts). His face and contact-sheet
 * steps stay inside his design stage.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { createJevAsk, type JevAsk } from '@/lib/social/jev/client';
import { newSearchContext, searchVisual, type Candidate } from '@/lib/social/photos/find';
import { createVisionCheck } from '@/lib/social/photos/vision';
import { priceCall } from '@/lib/stories/cost';
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

export const PHOTO_VISION_MODEL = 'claude-haiku-5-5';

export function createLivePhotoFinder(opts: { jev?: JevAsk; http?: typeof fetch; create?: (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> } = {}): PhotoFinder {
  let usd = 0;
  // The vision check on Haiku 5.5; its cost counted at Haiku 5.5's price.
  const vision = opts.create
    ? createVisionCheck({
        model: PHOTO_VISION_MODEL,
        http: opts.http,
        create: async (p) => {
          const res = await opts.create!(p);
          usd += priceCall(PHOTO_VISION_MODEL, res.usage).usd;
          return res;
        },
      })
    : undefined;
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
      const { candidates } = await searchVisual({ kind: req.kind as VisualKind, query: req.query }, ctx, { jev: tallied, http: opts.http ?? fetch, ...(vision ? { vision } : {}) });
      const pick = candidates.find((c) => !req.exclude.has(c.url));
      return pick ? toStoryPhoto(pick, req.kind) : null;
    },
  };
}
