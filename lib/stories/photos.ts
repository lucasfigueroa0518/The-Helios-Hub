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
 *
 * Photo bank (DECISIONS_LOG D49): with a `bank`, every find offers its
 * vetted candidates (the pick, and identity-verified headshots, second
 * photos, CEOs, headquarters and logos) with runKind 'story'. Stories run
 * only the metadata pre-screen, not the close-up vision check, so their
 * offers carry no close-up pass unless a vision verdict was recorded. The
 * bank's reader also joins the search (off until its finder_source switch
 * is flipped). Offering never blocks or fails a find.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { PhotoBank } from '@/lib/media-library/bank';
import { createJevAsk, type JevAsk } from '@/lib/social/jev/client';
import { newSearchContext, searchVisual, type Candidate } from '@/lib/social/photos/find';
import { createVisionCheck } from '@/lib/social/photos/vision';
import { IDENTITY_LANES, recordVision, type VettedPhoto } from '@/lib/social/photos/vetted';
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

/** A Stories find's vetted candidates for the photo bank: the pick, and the identity-verified ones it didn't pick. Pure. */
export function storyVetted(seq: number, request: { kind: VisualKind; query: string }, candidates: Candidate[], picked: Candidate | null, verdicts: ReturnType<typeof recordVision>['verdicts']): VettedPhoto[] {
  const out: VettedPhoto[] = [];
  for (const c of candidates) {
    const outcome = c === picked ? 'picked' : c.verified && IDENTITY_LANES.has(c.lane) ? 'verified' : null;
    if (!outcome) continue;
    let vision = verdicts.get(`${c.url}|${request.query}`) ?? null;
    if (!vision) for (const [key, v] of verdicts) if (key.startsWith(`${c.url}|`)) { vision = v; break; }
    out.push({ slide: seq, request: { ...request }, outcome, candidate: { ...c }, tileTags: null, fit: null, vision });
  }
  return out;
}

export function createLivePhotoFinder(opts: { jev?: JevAsk; http?: typeof fetch; create?: (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>; bank?: PhotoBank; runRef?: string } = {}): PhotoFinder {
  let usd = 0;
  // The photo bank's run: this finder (one Stories build), its requests numbered in order.
  const runRef = opts.runRef ?? `stories-build:${new Date().toISOString()}`;
  let seq = 0;
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
  // Vision answers recorded for the bank (same answers); undefined without a vision check.
  const recorder = recordVision(vision);
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
      const request = { kind: req.kind as VisualKind, query: req.query };
      const { candidates } = await searchVisual(request, ctx, { jev: tallied, http: opts.http ?? fetch, ...(recorder.vision ? { vision: recorder.vision } : {}), ...(opts.bank ? { bank: opts.bank.reader } : {}) });
      const pick = candidates.find((c) => !req.exclude.has(c.url));
      seq++;
      if (opts.bank) {
        try {
          opts.bank.offer({
            runKind: 'story',
            runRef,
            subjects: req.subjects.map((s) => s.name),
            organizations: req.subjects.filter((s) => s.type === 'organization').map((s) => s.name),
            items: storyVetted(seq, request, candidates, pick ?? null, recorder.verdicts),
          });
        } catch {
          // The bank is best effort: a find never fails over it.
        }
      }
      return pick ? toStoryPhoto(pick, req.kind) : null;
    },
  };
}
