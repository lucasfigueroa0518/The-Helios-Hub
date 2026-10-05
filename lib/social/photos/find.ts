/**
 * Basic photos (plan M5; spec §5.1): every slide gets a photo. All code;
 * the only model call is Jev's identity check.
 *
 * Fallback chain per slide (Tommy, 2026-10-05), first step that yields a
 * photo wins, each step logged:
 *   1. article: <photo URL> → the page reader's photo, if its credit allows it
 *   2. subject  → the slide's subject: its `subject:` request, else a SUBJECTS
 *                 name in the slide's text; identity check, then Commons (P18 / P180)
 *   3. stock    → the slide's `stock:` scene, via Openverse
 *   4. neutral  → neutral scenes (places and objects, never people), tried in
 *                 order; first the one that fits the subject type
 *   5. starter  → the offline Helios starter set (starter-set.ts): no network,
 *                 so this step can't come up empty
 * Fallbacks are scenes, never people (spec §5.1): step 2 only ever shows
 * the identity-verified subject itself.
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
import { pickStarter } from './starter-set';

export type PhotoSource = 'article' | 'commons' | 'stock' | 'starter';

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

export type ChainStep = 'article' | 'subject' | 'stock' | 'neutral' | 'starter';

/** Identity check outcome for the run log. */
export type IdentityNote = { subject: string; ok: boolean; detail: string };

/** What happened for one slide, for the run log. */
export type PhotoTrace = {
  request: ImageRequest;
  photo: Photo | null;
  /** The chain step that supplied the photo; null only if every step failed. */
  via: ChainStep | null;
  identity: IdentityNote | null;
  steps: string[];
};

/**
 * Neutral scene for a subject whose photo can't be used, by subject type:
 * places and objects only, so no one is mistaken for the subject.
 * Provisional; the photo bank replaces this in M8.
 */
export const FALLBACK_SCENES: Record<SubjectType | 'unknown', string> = {
  person: 'empty conference stage',
  organization: 'office building exterior',
  unknown: 'server room',
};

/** The last step's scenes, tried in order after the type-fitting one. No people. */
export const NEUTRAL_SCENES = ['server room', 'office building exterior', 'circuit board', 'city skyline at night', 'computer keyboard', 'data center'];

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

async function subjectPhoto(name: string, ctx: PhotoContext, deps: PhotoDeps, steps: string[]): Promise<{ photo: Photo | null; type: SubjectType | null; identity: IdentityNote }> {
  const subject = ctx.brief.subjects.find((s) => s.name === name) ?? { name, role: null };
  let pending = ctx.identities.get(name);
  if (!pending) {
    pending = checkIdentity(subject, ctx.brief, { jev: deps.jev, http: deps.http });
    ctx.identities.set(name, pending);
  }
  const id = await pending;
  if (!id.ok) {
    steps.push(`identity failed: ${id.reason}`);
    return { photo: null, type: id.type, identity: { subject: name, ok: false, detail: id.reason } };
  }
  steps.push(`identity ok: ${id.qid} "${id.label}" (${id.type}, ${id.via})`);
  const identity: IdentityNote = { subject: name, ok: true, detail: `${id.qid} "${id.label}" — ${id.description} (${id.type}, ${id.via})` };
  const cands = await findCandidates(id.qid, { http: deps.http });
  const pick = cands.find((c) => !ctx.used.has(c.url));
  if (!pick) {
    steps.push(cands.length ? 'every Commons photo already used in this post' : 'no usable Commons photo');
    return { photo: null, type: id.type, identity };
  }
  steps.push(`commons ${pick.source}: ${pick.file}`);
  return {
    photo: { url: pick.url, credit: `${buildCredit(pick)} · Wikimedia Commons`, source: 'commons', width: pick.width, height: pick.height, qid: id.qid },
    type: id.type,
    identity,
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

/** The slide's words, for finding its subject when the IMAGE line names none. */
export type SlideText = { text: string[]; speaker: string | null };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where a subject is named in the text: the full name, or the last word of a multi-word name ("Clayton"). -1 if not. */
function namedAt(name: string, text: string): number {
  const words = name.split(/\s+/);
  const forms = [name, ...(words.length > 1 && words.at(-1)!.length >= 4 ? [words.at(-1)!] : [])];
  const at = forms.map((f) => new RegExp(`\\b${escapeRe(f)}\\b`, 'i').exec(text)?.index ?? -1).filter((i) => i >= 0);
  return at.length ? Math.min(...at) : -1;
}

/** A SUBJECTS name the slide is about: the quote's speaker, else the first named in its text. */
export function subjectInText(slide: SlideText, brief: Brief): string | null {
  const names = brief.subjects.map((s) => s.name);
  if (slide.speaker && names.includes(slide.speaker)) return slide.speaker;
  const text = slide.text.join(' ');
  const hits = names
    .map((n) => ({ n, at: namedAt(n, text) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  return hits[0]?.n ?? null;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One photo for one slide, down the fallback chain. A source error is logged and the chain moves on. */
export async function findPhoto(request: ImageRequest, ctx: PhotoContext, deps: PhotoDeps, slide: SlideText = { text: [], speaker: null }): Promise<PhotoTrace> {
  const steps: string[] = [];
  let identity: IdentityNote | null = null;
  let type: SubjectType | null = null;
  const done = (photo: Photo, via: ChainStep): PhotoTrace => {
    ctx.used.add(photo.url);
    return { request, photo, via, identity, steps };
  };
  const attempt = async (label: string, fn: () => Promise<Photo | null>): Promise<Photo | null> => {
    try {
      return await fn();
    } catch (err) {
      steps.push(`${label} error: ${errText(err)}`);
      return null;
    }
  };

  // 1. The article's own photo.
  if (request.kind === 'article') {
    const p = await attempt('article', () => articlePhoto(request.value, ctx, steps));
    if (p) return done(p, 'article');
  }

  // 2. The slide's subject.
  const subject = request.kind === 'subject' ? request.value : subjectInText(slide, ctx.brief);
  if (subject) {
    if (request.kind !== 'subject') steps.push(`subject from slide text: ${subject}`);
    const r = await attempt('subject', async () => {
      const out = await subjectPhoto(subject, ctx, deps, steps);
      identity = out.identity;
      type = out.type;
      return out.photo;
    });
    if (r) return done(r, 'subject');
  }

  // 3. The slide's stock scene.
  if (request.kind === 'stock') {
    const p = await attempt('stock', () => stockPhoto(request.value, ctx, deps, steps));
    if (p) return done(p, 'stock');
  }

  // 4. Neutral scenes, the type-fitting one first.
  const scenes = [...new Set([FALLBACK_SCENES[type ?? 'unknown'], ...NEUTRAL_SCENES])];
  for (const scene of scenes) {
    steps.push(`neutral scene "${scene}"`);
    const p = await attempt('neutral', () => stockPhoto(scene, ctx, deps, steps));
    if (p) return done(p, 'neutral');
  }
  // 5. The offline starter set.
  const starter = pickStarter(ctx.used);
  if (starter) {
    steps.push(`starter set: ${starter.url}`);
    return done(starter, 'starter');
  }
  steps.push('no photo: every step failed, starter set used up');
  return { request, photo: null, via: null, identity, steps };
}
