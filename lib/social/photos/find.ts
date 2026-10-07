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
 *   stock:   <scene> → Openverse: the request, then its first two words; each
 *            search's results go through the Jev metadata pre-screen (fits the
 *            scene, no person likely visible, no recognizable landmark, and
 *            in v3 no outside company or brand; spec §5A #6)
 *   then     cover: the offline starter set (starter-set.ts), which can't come
 *            up empty. Story slides: text-only (the starter set is cover-only,
 *            Tommy 2026-10-06)
 *   none:    no photo; the slide renders without one (no fallback; spec §5.1)
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
import * as PrescreenV2 from '@/lib/social/jev/questions/stock-prescreen.v2';
import * as PrescreenV3 from '@/lib/social/jev/questions/stock-prescreen.v3';
import type { Brief } from '@/lib/social/reporter/brief';
import type { ArticlePhoto, PageReadOk } from '@/lib/social/reporter/read-page';
import type { ImageRequest } from '@/lib/social/writer/draft';

import { classifyCredit } from './credit';
import { checkIdentity, type IdentityResult, type SubjectType } from './identity';
import { bankPhoto, pickFromBank, type BankEntry, type BankNeed } from './bank';
import { pickStarter, pickStarterLeastRecent } from './starter-set';

/** Logged when the 7-day rule has to give way (spec §5D; counted in each run's report). */
export const STARTER_POOL_EXHAUSTED = 'starter-pool-exhausted';
/** Logged when no starter tag matched the slide or the story and the AI-compute default was used. */
export const NO_TOPIC_MATCH = 'no-topic-match';

export type PhotoSource = 'article' | 'commons' | 'stock' | 'bank' | 'starter';

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

/** `none`: the Writer asked for no photo. `text-only`: a story slide asked for one and none was usable. */
export type ChainStep = 'article' | 'subject' | 'stock' | 'bank' | 'starter' | 'none' | 'text-only';

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
  /** Stock pre-screen version: v3 (default, Tommy 2026-10-06) or v2 (kept for the bench's before/after). */
  prescreen?: 'v2' | 'v3';
};

export type PhotoContext = {
  brief: Brief;
  pages: PageReadOk[];
  /** URLs already used in this post. Updated by findPhoto. */
  used: Set<string>;
  /** URLs used in the last 7 days, any source (used-photos.ts). Never picked. */
  recent: Set<string>;
  /** The photo bank (bank.ts) and when each URL was last used, for least-recently-used picks. */
  bank: BankEntry[];
  lastUsed: Map<string, string>;
  /** Identity results by subject name, so one subject costs one check per post. */
  identities: Map<string, Promise<IdentityResult>>;
};

export function newPhotoContext(
  brief: Brief,
  pages: PageReadOk[],
  opts: { recent?: Set<string>; bank?: BankEntry[]; lastUsed?: Map<string, string> } = {},
): PhotoContext {
  return { brief, pages, used: new Set(), identities: new Map(), recent: opts.recent ?? new Set(), bank: opts.bank ?? [], lastUsed: opts.lastUsed ?? new Map() };
}

/** Used in this post or in the last 7 days (spec §5D). */
const taken = (ctx: PhotoContext, url: string) => ctx.used.has(url) || ctx.recent.has(url);
const avoidSet = (ctx: PhotoContext) => new Set([...ctx.used, ...ctx.recent]);

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
  if (taken(ctx, url)) {
    steps.push('already used in this post or in the last 7 days');
    return null;
  }
  return { url, credit: (found.photo.credit ?? found.photo.caption ?? '').trim(), source: 'article', width: null, height: null, qid: null, subject: null };
}

async function subjectPhoto(name: string, ctx: PhotoContext, deps: PhotoDeps, steps: string[]): Promise<{ photo: Photo | null; type: SubjectType | null; identity: IdentityNote; qid?: string }> {
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
  if (!pick || taken(ctx, pick.url)) {
    steps.push(!p18 ? 'no Wikidata main image (P18)' : !pick ? 'main image (P18) not usable (licence, size or type)' : 'main image (P18) already used in this post or in the last 7 days');
    return { photo: null, type: id.type, identity, qid: id.qid };
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

/**
 * Jev metadata pre-screen (spec §5A #6): the first result whose title and
 * tags fit the scene and suggest no person, no landmark and (v3) no
 * company or brand outside the story's SUBJECTS. Scores are logged.
 */
async function prescreen(scene: string, cands: OpenverseCandidate[], ctx: PhotoContext, deps: PhotoDeps, steps: string[]): Promise<OpenverseCandidate | null> {
  const v3 = (deps.prescreen ?? 'v3') === 'v3';
  const P = v3 ? PrescreenV3 : PrescreenV2;
  const shown = cands.slice(0, P.MAX_CANDIDATES);
  const meta = shown.map((c) => ({ title: c.title ?? '', tags: c.tags ?? [], source: c.source }));
  const res = await deps.jev(
    { state: v3 ? PrescreenV3.buildState(scene, meta, ctx.brief.subjects.map((x) => x.name)) : PrescreenV2.buildState(scene, meta), questions: P.buildQuestions(shown.length) },
    { version: P.VERSION, subjectId: scene },
  );
  const { FIT_MIN, PEOPLE_MAX, LANDMARK_MAX } = P.THRESHOLDS;
  const scored = shown.map((c, k) => ({
    c,
    fit: res.answers[P.fitId(k)]!.noul,
    people: res.answers[P.peopleId(k)]!.noul,
    landmark: res.answers[P.landmarkId(k)]!.noul,
    brand: v3 ? res.answers[PrescreenV3.brandId(k)]!.noul : 0,
  }));
  const brandMax = v3 ? PrescreenV3.THRESHOLDS.BRAND_MAX : 1;
  const pick = scored.find((x) => x.fit >= FIT_MIN && x.people < PEOPLE_MAX && x.landmark < LANDMARK_MAX && x.brand < brandMax) ?? null;
  steps.push(`pre-screen ${P.VERSION} "${scene}": ${scored.map((x) => `"${(x.c.title ?? '').slice(0, 40)}" fit ${x.fit.toFixed(2)} people ${x.people.toFixed(2)} landmark ${x.landmark.toFixed(2)}${v3 ? ` brand ${x.brand.toFixed(2)}` : ''}${x === pick ? ' ✓' : ''}`).join('; ')}`);
  return pick?.c ?? null;
}

async function stockPhoto(request: string, slot: PhotoSlot, ctx: PhotoContext, deps: PhotoDeps, steps: string[]): Promise<Photo | null> {
  const search: StockSearch = deps.stock ?? ((q, o) => searchOpenverse(q, { http: deps.http, minShortSide: o.minShortSide }));
  for (const query of stockQueries(request)) {
    const cands = (await search(query, { minShortSide: STOCK_MIN_SHORT_SIDE })).filter((c) => !taken(ctx, c.url));
    if (!cands.length) {
      steps.push(`stock "${query}" (${slot}): no unused results`);
      continue;
    }
    const pick = await prescreen(request, cands, ctx, deps, steps);
    if (!pick) {
      steps.push(`stock "${query}" (${slot}): no result passed the pre-screen`);
      continue;
    }
    steps.push(`stock "${query}" (${slot}): ${pick.source} ${pick.width}×${pick.height}${pick.title ? ` "${pick.title}"` : ''}`);
    return { url: pick.url, credit: buildStockCredit(pick), source: 'stock', width: pick.width, height: pick.height, qid: null, subject: null };
  }
  return null;
}

/** The slide's words, for finding its subject when the IMAGE line names none, and where its photo goes. */
/** `cover`: the starter set is for the cover only (Tommy, 2026-10-06); story slides with no usable photo render text-only. */
export type SlideText = { text: string[]; speaker: string | null; slot: PhotoSlot; cover?: boolean };

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
  // IMAGE none (Tommy, 2026-10-06): no photo fits; the slide renders without one. No fallback.
  if (request.kind === 'none') return { request, photo: null, via: 'none', identity: null, steps: ['IMAGE none: no photo requested'] };
  const empty = !request.value.trim();
  const fromBank = (need: BankNeed): Photo | null => {
    const e = pickFromBank(ctx.bank, need, avoidSet(ctx), ctx.lastUsed);
    steps.push(e ? `bank: ${e.id} (${e.kind})` : `bank: no match for ${JSON.stringify(need)}`);
    return e ? bankPhoto(e) : null;
  };

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
      let qid: string | undefined;
      const r = await attempt('subject', async () => {
        const out = await subjectPhoto(subject, ctx, deps, steps);
        identity = out.identity;
        qid = out.qid;
        return out.photo;
      });
      if (r) return done(r, 'subject');
      // The bank, by the verified Wikidata id only (never by name).
      const b = qid ? fromBank({ qid }) : null;
      if (b) return done(b, 'bank');
    }
  } else if (request.kind === 'stock' && !empty) {
    const p = await attempt('stock', () => stockPhoto(request.value, slot, ctx, deps, steps));
    if (p) return done(p, 'stock');
    const b = fromBank({ scene: request.value });
    if (b) return done(b, 'bank');
  }

  // Story slides: nothing usable → text-only (Tommy, 2026-10-06). The starter set is for the cover only.
  if (!slide.cover) {
    steps.push('no usable photo: story slide renders text-only (the starter set is cover-only)');
    return { request, photo: null, via: 'text-only', identity, steps };
  }
  // The offline starter set (cover only).
  // Topic-matched per slide: the IMAGE request, then the brief's main topic, then the AI-compute default.
  const slideTopic = { request: request.value, brief: ctx.brief };
  const starter = pickStarter(avoidSet(ctx), slideTopic);
  if (starter) {
    steps.push(`${starter.match === 'no-topic-match' ? `${NO_TOPIC_MATCH}: ` : ''}starter set (${starter.match}): ${starter.photo.url}`);
    return done(starter.photo, 'starter');
  }
  // Every matching starter photo was used in the last 7 days (Tommy, 2026-10-06):
  // reuse the least recently used one and say so. Never returns no photo.
  const lru = pickStarterLeastRecent(ctx.used, ctx.lastUsed, slideTopic);
  steps.push(`${STARTER_POOL_EXHAUSTED}${lru.match === 'no-topic-match' ? ` + ${NO_TOPIC_MATCH}` : ''}: every matching starter photo used in the last 7 days; least recently used: ${lru.photo.url}`);
  return done(lru.photo, 'starter');
}
