/**
 * The photo search (photo spec §4, sixth round; Tommy 2026-10-07): a visual
 * request (tier 1: person, company, logo, product, event, thematic, setting)
 * goes to every source that serves its kind (tier 2), and the results are
 * ranked (rank.ts) down to at most 2 candidates. Tags, the fit check and the
 * pick happen once for the whole post (design.ts → sheet.ts, tag-sheet.ts,
 * pick.ts).
 *
 *   person            Wikidata main photo (identity-verified) → a second
 *                     photo of them → an article photo whose caption names them
 *   company           its CEO's headshot and its headquarters (org-pool.ts)
 *                     → official images → article photos naming it
 *   logo              Wikidata logo (P154)
 *   product           official images → article photos → Commons search
 *   event             article photos → Commons search → Openverse
 *   thematic, setting StockSnap lane → Commons search → Openverse
 *
 * Every source lives in sources/. People and logos come only from verified
 * sources: tags never decide who someone is (spec §3).
 *
 * AI calls here: Jev (identity, the stock metadata pre-screen, the
 * headquarters check) and the official-image text check (the vision call's
 * "mostly text or banner" answer). The close-up vision check of a winner is
 * pick.ts's.
 */
import type { OpenverseCandidate } from '@/lib/social/editorial/v2/image-step/openverse';
import type { JevAsk } from '@/lib/social/jev/client';
import type { FaceBox } from '@/lib/social/render/fit-check';
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import type { VisualKind, VisualRequest } from '@/lib/social/writer/draft';

import type { ListedPhoto } from './article-list';
import type { DetectFaces } from './faces';
import type { IdentityScores, SubjectType } from './identity';
import type { OrgPool } from './org-pool';
import { P18_MIN_SHORT_SIDE, type IdentityCache } from './p18';
import { rankCandidates } from './rank';
import type { SecondPhotos } from './second-photo';
import type { TagSheet } from './tag-sheet';
import { articleSource } from './sources/article';
import { commonsSearchSource, openverseSource, stocksnapSource } from './sources/stock';
import { companySource, logoSource, personSource } from './sources/wikidata';
import type { VisionCheck } from './vision';

/**
 * `article`: an article photo (caption names the subject); `official`: an image
 * from a company's own page; `commons`: a person's main photo (headshot);
 * `second`: a second photo of a person; `logo`: a logo card; `ceo`: a
 * company's CEO (or sole founder) headshot; `hq`: a company's headquarters;
 * `commons-search`: a Commons file found by search; `stock`: Openverse (the
 * StockSnap lane included).
 */
export type PhotoSource = 'article' | 'official' | 'commons' | 'second' | 'logo' | 'ceo' | 'hq' | 'commons-search' | 'stock';

export type Photo = {
  url: string;
  /** Short on-slide credit line. */
  credit: string;
  source: PhotoSource;
  width: number | null;
  height: number | null;
  /** Wikidata id for subject photos and logos (identity verified). */
  qid: string | null;
  /** The SUBJECTS name this photo was verified to show; null for scenes and article photos. */
  subject: string | null;
  /** Logo cards: the plate behind the logo, chosen from its luminance. */
  plate?: 'light' | 'dark';
  /** Face boxes from the face detector (0–1 of the photo), when it ran; framing uses them (Link 5). */
  faces?: FaceBox[];
};

/** Which source supplied a candidate (finer than PhotoSource: the StockSnap lane and Openverse are both `stock`). */
export type Lane = 'headshot' | 'second' | 'article' | 'official' | 'ceo' | 'hq' | 'logo' | 'stocksnap' | 'commons-search' | 'openverse';

/** One search result, before tags and the pick. */
export type Candidate = Photo & {
  lane: Lane;
  /** When the photo was taken or published (YYYY-MM-DD or YYYY); null when the source doesn't say. */
  date: string | null;
  /** The source's title or caption (the metadata pre-screen read it). */
  title: string;
  /** Verified by identity, logo or company-pool rules: the tag fit check never judges who or what it is. */
  verified: boolean;
};

/** Which step supplied the result. `icon`: the icon background; `type-led`: a quote slide without a speaker photo. */
export type ChainStep = Lane | 'icon' | 'type-led';

/** Identity check outcome for the run log. */
export type IdentityNote = { subject: string; ok: boolean; detail: string; scores: IdentityScores | null };

/** What happened for one slide, for the run log. */
export type PhotoTrace = {
  request: VisualRequest;
  photo: Photo | null;
  via: ChainStep;
  /** The icon drawn when there is no photo (the Writer's, else the default). */
  icon: string | null;
  identity: IdentityNote | null;
  steps: string[];
  /** Other photos for this slide that passed every check (the render review's next-best photo). */
  alternates: Photo[];
  /** The winner's tags from the contact sheet (Haiku), when it was tagged. */
  tags?: string[];
  /** Vision spend for this slide (official-image text check, close-up checks). */
  visionUsd?: number;
};

/** Stock and Commons share one size rule (reject thumbnails). */
export const STOCK_MIN_SHORT_SIDE = P18_MIN_SHORT_SIDE;

/** `minAspect`: only photos at least this wide for their height (spreads). `sources`: Openverse providers to search (the StockSnap lane). */
export type StockSearch = (query: string, opts: { minShortSide: number; minAspect?: number; sources?: string[] }) => Promise<OpenverseCandidate[]>;

/**
 * A spread photo fills two slides side by side (2160×1350, 1.6:1) with
 * object-fit: cover. 1.45:1 admits ordinary 3:2 camera photos (about 3% trimmed
 * top and bottom) and caps the trim at about 5% per edge (Tommy, 2026-10-07,
 * fifth round: spreads should actually happen; at 1.6 no camera photo
 * qualified).
 */
export const SPREAD_MIN_ASPECT = 1.45;

/** Where the photo is drawn: `split` (cover, story), `quote`, `backdrop` (stat). Kept for the hook budgets and the review. */
export type PhotoSlot = 'split' | 'backdrop' | 'quote';

/** Commons file search. Injected for tests. */
export type CommonsSearch = (query: string, opts: { minShortSide: number; limit: number }) => Promise<Candidate[]>;

export type PhotoDeps = {
  jev: JevAsk;
  /** Injected for tests; live runs pass fetch. */
  http?: typeof fetch;
  /** Openverse search (both lanes). Absent: the live API. */
  stock?: StockSearch;
  /** Commons file search. Absent: the live API. */
  commons?: CommonsSearch;
  /** The close-up vision check (vision.ts). Absent: no close-up check (offline runs). */
  vision?: VisionCheck;
  /** The face detector (faces.ts). Absent: second photos aren't used (they need a face count). */
  faces?: DetectFaces;
  /** Second photos of a person (second-photo.ts). Absent: none. */
  secondPhotos?: SecondPhotos;
  /** The contact-sheet tagging call (tag-sheet.ts). Absent: no tags, no fit check (offline runs). */
  tagSheet?: TagSheet;
};

/** Everything one post's searches share. */
export type SearchContext = {
  brief: Brief;
  pages: PageReadOk[];
  /** The code-built article photo list (article-list.ts). */
  photos: ListedPhoto[];
  /** Each subject's type (identity check, else the Reporter's mark). */
  kinds: Map<string, SubjectType | null>;
  /** URLs used in the last 7 days or earlier in this run. Never picked (logos and story-slide headshots aside). */
  recent: Set<string>;
  /** Identity results by subject name (p18.ts), shared with the Writer's availability flags. */
  identities: IdentityCache;
  /** Each organization's pool by QID (org-pool.ts), fetched once per post. */
  orgPools: Map<string, Promise<OrgPool>>;
  /** Official-image text checks, by URL (one vision call each per post). */
  officialChecked: Map<string, boolean>;
  /** The story's date (YYYY-MM-DD), for the date ranking. */
  storyDate: string | null;
  /** Vision spend so far (official-image text checks). */
  spend: { visionUsd: number };
};

export function newSearchContext(
  brief: Brief,
  pages: PageReadOk[],
  opts: { recent?: Set<string>; identities?: IdentityCache; photos?: ListedPhoto[]; kinds?: Map<string, SubjectType | null>; storyDate?: string | null } = {},
): SearchContext {
  return {
    brief,
    pages,
    photos: opts.photos ?? [],
    kinds: opts.kinds ?? new Map(brief.subjects.map((s) => [s.name, s.type ?? null])),
    recent: opts.recent ?? new Set(),
    identities: opts.identities ?? new Map(),
    orgPools: new Map(),
    officialChecked: new Map(),
    storyDate: opts.storyDate ?? null,
    spend: { visionUsd: 0 },
  };
}

/** What a source gets: the shared context, the deps, this request's log, and the slide's subject tags. */
export type SourceRun = { ctx: SearchContext; deps: PhotoDeps; steps: string[]; tags: string[]; identity: IdentityNote | null };

export type Source = (request: VisualRequest, run: SourceRun) => Promise<Candidate[]>;

/** Tier 2: the sources each kind searches, in order (photo spec §4). */
export const ROUTES: Record<VisualKind, Source[]> = {
  person: [personSource, articleSource('named')],
  company: [companySource, articleSource('official'), articleSource('named')],
  logo: [logoSource],
  product: [articleSource('official'), articleSource('named'), commonsSearchSource],
  event: [articleSource('named'), commonsSearchSource, openverseSource],
  thematic: [stocksnapSource, commonsSearchSource, openverseSource],
  setting: [stocksnapSource, commonsSearchSource, openverseSource],
};

/** Up to this many candidates per request (Tommy, 2026-10-07: "up to two … at least one"). */
export const MAX_CANDIDATES = 2;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Logos skip the 7-day rule; headshots too on story slides (a person has one main photo). A cover never repeats a headshot (photo spec §4). */
const SKIPS_SEVEN_DAYS = new Set<Lane>(['logo', 'headshot', 'ceo']);

/**
 * One request → at most 2 ranked candidates. Every source for the kind is
 * searched; a source error is logged and the others go on. Photos used in the
 * last 7 days are out (logos always allowed; headshots on story slides).
 */
export async function searchVisual(
  request: VisualRequest,
  ctx: SearchContext,
  deps: PhotoDeps,
  slide: { cover?: boolean; tags?: string[]; wide?: boolean } = {},
): Promise<{ candidates: Candidate[]; steps: string[]; identity: IdentityNote | null }> {
  const run: SourceRun = { ctx, deps, steps: [], tags: slide.tags ?? [], identity: null };
  if (!request.query.trim()) {
    run.steps.push(`${request.kind}: no request (dropped by the Writer check)`);
    return { candidates: [], steps: run.steps, identity: null };
  }
  const found: Candidate[] = [];
  for (const source of ROUTES[request.kind]) {
    try {
      found.push(...(await source(request, run)));
    } catch (err) {
      run.steps.push(`${source.name || 'source'} error: ${errText(err)}`);
    }
  }
  const seen = new Set<string>();
  const usable = found.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    if (slide.wide && !(c.width && c.height && c.width / c.height >= SPREAD_MIN_ASPECT)) return false;
    const exempt = c.lane === 'logo' || (SKIPS_SEVEN_DAYS.has(c.lane) && !slide.cover);
    if (!exempt && ctx.recent.has(c.url)) {
      run.steps.push(`${c.lane} ${c.title.slice(0, 40)}: used in the last 7 days or earlier in this run`);
      return false;
    }
    return true;
  });
  const ranked = rankCandidates(usable, request.kind, ctx.storyDate, Boolean(slide.cover)).slice(0, MAX_CANDIDATES);
  run.steps.push(`${request.kind}: "${request.query}" → ${found.length} found, ${ranked.length} kept${ranked.length ? ` (${ranked.map((c) => `${c.lane}${c.date ? ` ${c.date}` : ''} ${c.width ?? '?'}×${c.height ?? '?'}`).join('; ')})` : ''}`);
  return { candidates: ranked, steps: run.steps, identity: run.identity };
}
