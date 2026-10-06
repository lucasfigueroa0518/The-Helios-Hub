/**
 * Basic photos (plan M5; spec §5.1): every slide gets a photo. All code;
 * the only model call is Jev's identity check.
 *
 * Chain per slide (Tommy, 2026-10-06, after the checkpoint's wrong-person
 * photos): the Writer's IMAGE request decides; nothing is inferred from
 * the slide's text unless the request is empty.
 *   article: <photo URL> → the page reader's photo, if its credit allows it
 *   subject: <SUBJECTS name> → identity check, then that entry's Wikidata
 *            main image (P18) only. Never P180 "depicts" photos: they show
 *            other people (stage shots, delegations).
 *   stock:   <scene> → Openverse: the request, then its first two words
 *   then     the offline starter set (starter-set.ts), which can't come up empty
 *
 * Where the photo is drawn (its slot) limits what may go there:
 *   split    (text, landing, image, cover): any of the above
 *   backdrop (stat, split stat): a darkened background, scene only, so
 *            only a stock request is searched
 *   quote    the round spot only for the verified speaker (a subject request
 *            naming the speaker); a stock request is a darkened background
 *
 * Never twice in one post: every pick is checked against, and added to,
 * the post's used set. Nothing is written to the durable used-photo log
 * here; that happens when a post ships (M8/M10), not on a preview.
 */
import { buildCredit, fetchEntityP18, fetchImageInfo, toCandidate } from '@/lib/social/editorial/v2/image-step/commons';
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
  /** The SUBJECTS name this photo was verified to show; null for scenes and article photos. */
  subject: string | null;
};

export type ChainStep = 'article' | 'subject' | 'stock' | 'starter';

/** Identity check outcome for the run log. */
export type IdentityNote = { subject: string; ok: boolean; detail: string; scores: import('./identity').IdentityScores | null };

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
 * The only stock size rule (Tommy, 2026-10-06): reject thumbnails. The
 * inherited 1080px floor threw away every Openverse result.
 */
export const STOCK_MIN_SHORT_SIDE = 600;

export type StockSearch = (query: string, opts: { minShortSide: number }) => Promise<OpenverseCandidate[]>;

/** Where the photo is drawn; decides the chain and the size floor. */
export type PhotoSlot = 'split' | 'backdrop' | 'quote';

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
  return { url, credit: (found.photo.credit ?? found.photo.caption ?? '').trim(), source: 'article', width: null, height: null, qid: null, subject: null };
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
    return { photo: null, type: id.type, identity: { subject: name, ok: false, detail: id.reason, scores: id.scores } };
  }
  steps.push(`identity ok: ${id.qid} "${id.label}" (${id.type}, ${id.via})`);
  const identity: IdentityNote = { subject: name, ok: true, detail: `${id.qid} "${id.label}" — ${id.description} (${id.type}, ${id.via})`, scores: id.scores };
  // Main image (P18) only, for people and organizations alike (Tommy, 2026-10-06).
  const p18 = await fetchEntityP18(id.qid, { http: deps.http });
  const file = p18 ? `File:${p18}` : null;
  const info = file ? (await fetchImageInfo([file], { http: deps.http }))[file] : undefined;
  const pick = file && info ? toCandidate(file, info, 'P18', { minShortSide: STOCK_MIN_SHORT_SIDE }) : null;
  if (!pick || ctx.used.has(pick.url)) {
    steps.push(!p18 ? 'no Wikidata main image (P18)' : !pick ? 'main image (P18) not usable (licence, size or type)' : 'main image (P18) already used in this post');
    return { photo: null, type: id.type, identity };
  }
  steps.push(`commons P18: ${pick.file}`);
  return {
    photo: { url: pick.url, credit: `${buildCredit(pick)} · Wikimedia Commons`, source: 'commons', width: pick.width, height: pick.height, qid: id.qid, subject: name },
    type: id.type,
    identity,
  };
}

/** Search terms for a stock request: the request, then its first two words (Tommy, 2026-10-06). */
export function stockQueries(request: string): string[] {
  const words = request.trim().split(/\s+/);
  return [...new Set([words.join(' '), words.slice(0, 2).join(' ')])].filter(Boolean);
}

async function stockPhoto(request: string, slot: PhotoSlot, ctx: PhotoContext, deps: PhotoDeps, steps: string[]): Promise<Photo | null> {
  const search: StockSearch = deps.stock ?? ((q, o) => searchOpenverse(q, { http: deps.http, minShortSide: o.minShortSide }));
  for (const query of stockQueries(request)) {
    const cands = await search(query, { minShortSide: STOCK_MIN_SHORT_SIDE });
    const pick = cands.find((c) => !ctx.used.has(c.url));
    if (!pick) {
      steps.push(`stock "${query}" (${slot}): ${cands.length ? 'every result already used' : 'no results'}`);
      continue;
    }
    steps.push(`stock "${query}" (${slot}): ${pick.source} ${pick.width}×${pick.height}${pick.title ? ` "${pick.title}"` : ''}`);
    return { url: pick.url, credit: buildStockCredit(pick), source: 'stock', width: pick.width, height: pick.height, qid: null, subject: null };
  }
  return null;
}

/** The slide's words, for finding its subject when the IMAGE line names none, and where its photo goes. */
export type SlideText = { text: string[]; speaker: string | null; slot: PhotoSlot };

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

/** One photo for one slide, down the chain. A source error is logged and the chain moves on. */
export async function findPhoto(request: ImageRequest, ctx: PhotoContext, deps: PhotoDeps, slide: SlideText = { text: [], speaker: null, slot: 'split' }): Promise<PhotoTrace> {
  const steps: string[] = [];
  const { slot } = slide;
  let identity: IdentityNote | null = null;
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
  const empty = !request.value.trim();

  // A subject: the request's, or (only when the request is empty) one named in the slide text.
  const subject = request.kind === 'subject' && !empty ? request.value : empty && slot === 'split' ? subjectInText(slide, ctx.brief) : null;
  if (empty && subject) steps.push(`empty request; subject from slide text: ${subject}`);

  if (request.kind === 'article' && !empty) {
    if (slot === 'split') {
      const p = await attempt('article', () => articlePhoto(request.value, ctx, steps));
      if (p) return done(p, 'article');
    } else {
      steps.push(`article photo skipped: a ${slot} slide shows only ${slot === 'quote' ? 'the speaker or a scene' : 'a scene'}`);
    }
  } else if (subject) {
    if (slot === 'backdrop') steps.push('subject photo skipped: the stat background is a scene');
    else if (slot === 'quote' && subject !== slide.speaker) steps.push(`subject photo skipped: ${subject} isn't the speaker, and the round spot implies the speaker`);
    else {
      const r = await attempt('subject', async () => {
        const out = await subjectPhoto(subject, ctx, deps, steps);
        identity = out.identity;
        return out.photo;
      });
      if (r) return done(r, 'subject');
    }
  } else if (request.kind === 'stock' && !empty) {
    const p = await attempt('stock', () => stockPhoto(request.value, slot, ctx, deps, steps));
    if (p) return done(p, 'stock');
  }

  // The offline starter set.
  const starter = pickStarter(ctx.used);
  if (starter) {
    steps.push(`starter set: ${starter.url}`);
    return done(starter, 'starter');
  }
  steps.push('no photo: every step failed, starter set used up');
  return { request, photo: null, via: null, identity, steps };
}
