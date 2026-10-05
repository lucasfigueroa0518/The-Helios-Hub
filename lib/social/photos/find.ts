/**
 * Basic photos (plan M5; spec §5.1): one photo per IMAGE request, from the
 * three M5 sources. All code; the only model call is Jev's identity check.
 *
 *   article: <photo URL>  → the photo the page reader found, if its credit allows it
 *   subject: <SUBJECTS name> → identity check, then Wikimedia Commons (P18 / P180)
 *   stock:   <scene>       → Openverse
 *
 * A subject that fails the identity check, or has no usable Commons photo,
 * falls back to a neutral scene (spec §5.1: fallbacks are scenes, never
 * people). No photo at all is a normal outcome in M5 (dark canvas); the
 * full chain and the photo bank come in M8.
 *
 * Never twice in one post: every pick is checked against, and added to,
 * the post's used set. Nothing is written to the durable used-photo log
 * here; that happens when a post ships (M8/M10), not on a preview.
 */
import { buildCredit, findCandidates } from '@/lib/social/editorial/v2/image-step/commons';
import { buildStockCredit, searchOpenverse, type OpenverseCandidate } from '@/lib/social/editorial/v2/image-step/openverse';
import type { JevAsk } from '@/lib/social/jev/client';
import type { Brief } from '@/lib/social/reporter/brief';
import type { ArticlePhoto, PageReadOk } from '@/lib/social/reporter/read-page';
import type { ImageRequest } from '@/lib/social/writer/draft';

import { classifyCredit } from './credit';
import { checkIdentity, type IdentityResult, type SubjectType } from './identity';

export type PhotoSource = 'article' | 'commons' | 'stock';

export type Photo = {
  url: string;
  /** Short on-slide credit line. */
  credit: string;
  source: PhotoSource;
  width: number | null;
  height: number | null;
  /** Wikidata id for subject photos (identity verified). */
  qid: string | null;
};

/** What happened for one request, for the run log. */
export type PhotoTrace = { request: ImageRequest; photo: Photo | null; steps: string[] };

/**
 * Neutral scenes for a subject whose photo can't be used: places and
 * objects only, so no one is mistaken for the subject. Provisional; the
 * photo bank replaces this in M8.
 */
export const FALLBACK_SCENES: Record<SubjectType | 'unknown', string> = {
  person: 'empty conference stage',
  organization: 'office building exterior',
  unknown: 'server room',
};

export type StockSearch = (query: string) => Promise<OpenverseCandidate[]>;

export type PhotoDeps = {
  jev: JevAsk;
  /** Injected for tests; live runs pass fetch. */
  http?: typeof fetch;
  stock?: StockSearch;
};

export type PhotoContext = {
  brief: Brief;
  pages: PageReadOk[];
  /** URLs already used in this post. Updated by findPhoto. */
  used: Set<string>;
  /** Identity results by subject name, so one subject costs one check per post. */
  identities: Map<string, Promise<IdentityResult>>;
};

export function newPhotoContext(brief: Brief, pages: PageReadOk[]): PhotoContext {
  return { brief, pages, used: new Set(), identities: new Map() };
}

const urlKey = (u: string) => u.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');

/** The page reader's record of a photo URL (exact data), else the brief's copy. */
function lookupArticlePhoto(url: string, ctx: PhotoContext): { photo: Pick<ArticlePhoto, 'caption' | 'credit'>; page: string | null } | null {
  const key = urlKey(url);
  for (const page of ctx.pages) {
    const p = page.photos.find((x) => urlKey(x.src) === key);
    if (p) return { photo: p, page: page.resolvedUrl || page.url };
  }
  const b = ctx.brief.article_photos.find((x) => x.url && urlKey(x.url) === key);
  return b ? { photo: { caption: b.caption, credit: b.credit }, page: b.page } : null;
}

async function articlePhoto(url: string, ctx: PhotoContext, steps: string[]): Promise<Photo | null> {
  const found = lookupArticlePhoto(url, ctx);
  if (!found) {
    steps.push('article photo not found in the pages read');
    return null;
  }
  const organizations = ctx.brief.subjects.map((s) => s.name);
  const v = classifyCredit({ caption: found.photo.caption, credit: found.photo.credit, page: found.page, organizations });
  steps.push(`credit ${v.verdict}: ${v.reason}`);
  if (v.verdict !== 'allowed') return null;
  if (ctx.used.has(url)) {
    steps.push('already used in this post');
    return null;
  }
  return { url, credit: (found.photo.credit ?? found.photo.caption ?? '').trim(), source: 'article', width: null, height: null, qid: null };
}

async function subjectPhoto(name: string, ctx: PhotoContext, deps: PhotoDeps, steps: string[]): Promise<{ photo: Photo | null; type: SubjectType | null }> {
  const subject = ctx.brief.subjects.find((s) => s.name === name) ?? { name, role: null };
  let pending = ctx.identities.get(name);
  if (!pending) {
    pending = checkIdentity(subject, ctx.brief, { jev: deps.jev, http: deps.http });
    ctx.identities.set(name, pending);
  }
  const id = await pending;
  if (!id.ok) {
    steps.push(`identity failed: ${id.reason}`);
    return { photo: null, type: id.type };
  }
  steps.push(`identity ok: ${id.qid} "${id.label}" (${id.type}, ${id.via})`);
  const cands = await findCandidates(id.qid, { http: deps.http });
  const pick = cands.find((c) => !ctx.used.has(c.url));
  if (!pick) {
    steps.push(cands.length ? 'every Commons photo already used in this post' : 'no usable Commons photo');
    return { photo: null, type: id.type };
  }
  steps.push(`commons ${pick.source}: ${pick.file}`);
  return {
    photo: { url: pick.url, credit: `${buildCredit(pick)} · Wikimedia Commons`, source: 'commons', width: pick.width, height: pick.height, qid: id.qid },
    type: id.type,
  };
}

async function stockPhoto(query: string, ctx: PhotoContext, deps: PhotoDeps, steps: string[]): Promise<Photo | null> {
  const search: StockSearch = deps.stock ?? ((q) => searchOpenverse(q, { http: deps.http }));
  const cands = await search(query);
  const pick = cands.find((c) => !ctx.used.has(c.url));
  if (!pick) {
    steps.push(`stock "${query}": ${cands.length ? 'every result already used' : 'no results'}`);
    return null;
  }
  steps.push(`stock "${query}": ${pick.source}${pick.title ? ` "${pick.title}"` : ''}`);
  return { url: pick.url, credit: buildStockCredit(pick), source: 'stock', width: pick.width, height: pick.height, qid: null };
}

/** One photo for one IMAGE request, or null. A source error is logged and treated as no photo. */
export async function findPhoto(request: ImageRequest, ctx: PhotoContext, deps: PhotoDeps): Promise<PhotoTrace> {
  const steps: string[] = [];
  let photo: Photo | null = null;
  try {
    if (request.kind === 'article') {
      photo = await articlePhoto(request.value, ctx, steps);
    } else if (request.kind === 'stock') {
      photo = await stockPhoto(request.value, ctx, deps, steps);
    } else {
      const r = await subjectPhoto(request.value, ctx, deps, steps).catch((err: unknown) => {
        steps.push(`subject error: ${err instanceof Error ? err.message : String(err)}`);
        return { photo: null, type: null };
      });
      photo = r.photo;
      if (!photo) {
        const scene = FALLBACK_SCENES[r.type ?? 'unknown'];
        steps.push(`fallback scene "${scene}"`);
        photo = await stockPhoto(scene, ctx, deps, steps);
      }
    }
  } catch (err) {
    steps.push(`error: ${err instanceof Error ? err.message : String(err)}`);
    photo = null;
  }
  if (photo) ctx.used.add(photo.url);
  else steps.push('no photo');
  return { request, photo, steps };
}
