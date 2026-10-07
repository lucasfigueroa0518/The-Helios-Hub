/**
 * The photo finder: spec §5.1 "Photo chain v1" (Tommy, 2026-10-07), the
 * only description of the chain. Fully automatic; only sources with no
 * rights questions. When nothing is found the slide is a designed slide; no
 * further source is tried.
 *
 *   Cover:        article photo (credit check) → the subject person's P18
 *                 (identity check) → logo card (identity-verified
 *                 organization, Commons licence check) → stock → starter set
 *                 (AI-compute photos; replaced by the branded cover card once
 *                 Tommy approves it).
 *   Story slides  article photo (credit check) or the subject's P18, or
 *   (text, landing, stock, as the Writer's IMAGE request says → text-only.
 *   image):
 *   Quote slides: the verified speaker's P18 → text-only. (A stock request is
 *                 a darkened background.)
 *   Stat slides:  a Helios-designed background from the bank
 *                 (`stat-background`), by the 7-day rule, even when IMAGE is
 *                 none; plain dark until the set is approved.
 *
 * Stock: Openverse (the request, then its first two words) → Jev metadata
 * pre-screen v4 (fit, people) → the vision check on the top VISION_TOP
 * candidates (vision.ts); none passing means no stock photo.
 *
 * AI calls: Jev (identity check, stock pre-screen) and the vision check
 * (Haiku, stock only). Everything else is code.
 *
 * No repeats: never twice in a post or within 7 days, every source (the
 * post's used set + `recent`, the used-photo log and earlier posts in the run).
 * Exception: a logo card may repeat across posts; never twice in one post.
 */
import { buildCredit } from '@/lib/social/editorial/v2/image-step/commons';
import { buildStockCredit, searchOpenverse, type OpenverseCandidate } from '@/lib/social/editorial/v2/image-step/openverse';
import type { JevAsk } from '@/lib/social/jev/client';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v4';
import type { Brief } from '@/lib/social/reporter/brief';
import type { ArticlePhoto, PageReadOk } from '@/lib/social/reporter/read-page';
import type { ImageRequest } from '@/lib/social/writer/draft';

import { bankPhoto, pickFromBank, type BankEntry } from './bank';
import { classifyCredit } from './credit';
import { DESIGNED_GRAPHICS } from './designed';
import type { IdentityScores } from './identity';
import { fetchLogo } from './logo';
import { P18_MIN_SHORT_SIDE, identityOf, subjectP18, type IdentityCache } from './p18';
import { pickCoverStarter } from './starter-set';
import { VISION_TOP, describeVerdict, type VisionCheck } from './vision';

/** Logged when the 7-day rule has to give way (spec §5D; counted in each run's report). */
export const STARTER_POOL_EXHAUSTED = 'starter-pool-exhausted';

/** `designed`: a Helios-designed graphic (stat backgrounds); `logo`: a logo cover card. */
export type PhotoSource = 'article' | 'commons' | 'stock' | 'starter' | 'logo' | 'designed';

export type Photo = {
  url: string;
  /** Short on-slide credit line ('' for Helios-designed graphics: no credit pill). */
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
};

/**
 * `none`: the Writer asked for no photo. `text-only`: a story slide asked for
 * one and none was usable. `plain`: a stat slide without a designed
 * background. `cover-card`: the branded cover card (once approved).
 */
export type ChainStep = 'article' | 'subject' | 'logo' | 'stock' | 'stat-background' | 'starter' | 'cover-card' | 'none' | 'text-only' | 'plain';

/** Identity check outcome for the run log. */
export type IdentityNote = { subject: string; ok: boolean; detail: string; scores: IdentityScores | null };

/** What happened for one slide, for the run log. */
export type PhotoTrace = {
  request: ImageRequest;
  photo: Photo | null;
  /** The chain step that supplied the result; null only if every step failed. */
  via: ChainStep | null;
  identity: IdentityNote | null;
  steps: string[];
  /** Vision check spend for this request. */
  visionUsd?: number;
};

/** Stock and Commons share one size rule (reject thumbnails). */
export const STOCK_MIN_SHORT_SIDE = P18_MIN_SHORT_SIDE;

export type StockSearch = (query: string, opts: { minShortSide: number }) => Promise<OpenverseCandidate[]>;

/** Where the photo is drawn: `split` (cover, text, landing, image), `quote`, `backdrop` (stat). */
export type PhotoSlot = 'split' | 'backdrop' | 'quote';

export type PhotoDeps = {
  jev: JevAsk;
  /** Injected for tests; live runs pass fetch. */
  http?: typeof fetch;
  stock?: StockSearch;
  /** The vision check on the top stock candidates (vision.ts). Absent: the first pre-screened result is used. */
  vision?: VisionCheck;
  /** Designed graphics in use (Tommy's one-time approval); defaults to DESIGNED_GRAPHICS. Sample renders pass their own. */
  designed?: { statBackgrounds: boolean; coverCard: boolean };
};

export type PhotoContext = {
  brief: Brief;
  pages: PageReadOk[];
  /** URLs already used in this post. Updated by findPhoto. */
  used: Set<string>;
  /** URLs used in the last 7 days or earlier in this run, any source. Never picked. */
  recent: Set<string>;
  /** The bank (designed stat backgrounds) and when each URL was last used, for least-recently-used picks. */
  bank: BankEntry[];
  lastUsed: Map<string, string>;
  /** Identity results by subject name (p18.ts), shared with the Writer's photo_available for the same story. */
  identities: IdentityCache;
};

export function newPhotoContext(
  brief: Brief,
  pages: PageReadOk[],
  opts: { recent?: Set<string>; bank?: BankEntry[]; lastUsed?: Map<string, string>; identities?: IdentityCache } = {},
): PhotoContext {
  return { brief, pages, used: new Set(), identities: opts.identities ?? new Map(), recent: opts.recent ?? new Set(), bank: opts.bank ?? [], lastUsed: opts.lastUsed ?? new Map() };
}

/** Used in this post, in the last 7 days, or earlier in this run (spec §5D). */
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

/** The subject's P18 (p18.ts: the same check as the Writer's photo_available), if free to use here. */
async function subjectPhoto(name: string, ctx: PhotoContext, deps: PhotoDeps, steps: string[], opts: { personOnly: boolean }): Promise<{ photo: Photo | null; identity: IdentityNote }> {
  const r = await subjectP18(name, ctx.brief, deps, ctx.identities);
  const id = r.identity;
  if (!id.ok) {
    steps.push(`identity failed: ${id.reason}`);
    return { photo: null, identity: { subject: name, ok: false, detail: id.reason, scores: id.scores } };
  }
  steps.push(`identity ok: ${id.qid} "${id.label}" (${id.type}, ${id.via})`);
  const identity: IdentityNote = { subject: name, ok: true, detail: `${id.qid} "${id.label}" — ${id.description} (${id.type}, ${id.via})`, scores: id.scores };
  if (opts.personOnly && id.type !== 'person') {
    steps.push(`cover: ${name} is an organization (its P18 is not used on a cover; logo card next)`);
    return { photo: null, identity };
  }
  if (!r.pick) {
    steps.push(r.why ?? 'no usable P18');
    return { photo: null, identity };
  }
  if (taken(ctx, r.pick.url)) {
    steps.push('main image (P18) already used in this post or in the last 7 days');
    return { photo: null, identity };
  }
  steps.push(`commons P18: ${r.pick.file}`);
  return { photo: { url: r.pick.url, credit: `${buildCredit(r.pick)} · Wikimedia Commons`, source: 'commons', width: r.pick.width, height: r.pick.height, qid: id.qid, subject: name }, identity };
}

/** A logo cover card for an identity-verified organization whose Commons logo passes the licence check. */
async function logoCard(name: string, ctx: PhotoContext, deps: PhotoDeps, steps: string[]): Promise<Photo | null> {
  const id = await identityOf(name, ctx.brief, deps, ctx.identities);
  if (!id.ok) {
    steps.push(`logo card: identity failed for ${name} (${id.reason})`);
    return null;
  }
  if (id.type !== 'organization') {
    steps.push(`logo card: ${name} is a ${id.type}, not an organization`);
    return null;
  }
  const r = await fetchLogo(id.qid, id.label, { http: deps.http });
  if (!r.photo) {
    steps.push(`logo card: ${r.reason}`);
    return null;
  }
  // Logos are exempt from the 7-day rule across posts (Tommy, 2026-10-07); never the same logo twice in one post.
  if (ctx.used.has(r.photo.url)) {
    steps.push('logo card: this logo is already used in this post');
    return null;
  }
  steps.push(`logo card: ${id.qid} File:${r.file} (${r.photo.plate} plate)`);
  return r.photo;
}

/** Search terms for a stock request: the request, then its first two words (Tommy, 2026-10-06). */
export function stockQueries(request: string): string[] {
  const words = request.trim().split(/\s+/);
  return [...new Set([words.join(' '), words.slice(0, 2).join(' ')])].filter(Boolean);
}

/** Jev metadata pre-screen v4 (spec §5A #6): the results whose title and tags fit the scene and suggest no person, in order. */
async function prescreen(scene: string, cands: OpenverseCandidate[], deps: PhotoDeps, steps: string[]): Promise<OpenverseCandidate[]> {
  const shown = cands.slice(0, Prescreen.MAX_CANDIDATES);
  const meta = shown.map((c) => ({ title: c.title ?? '', tags: c.tags ?? [], source: c.source }));
  const res = await deps.jev({ state: Prescreen.buildState(scene, meta), questions: Prescreen.buildQuestions(shown.length) }, { version: Prescreen.VERSION, subjectId: scene });
  const n = (id: string) => res.answers[id]?.noul ?? 0;
  const scored = shown.map((c, k) => ({ c, fit: n(Prescreen.fitId(k)), people: n(Prescreen.peopleId(k)) }));
  const passing = scored.filter((x) => x.fit >= Prescreen.THRESHOLDS.FIT_MIN && x.people < Prescreen.THRESHOLDS.PEOPLE_MAX);
  steps.push(`pre-screen ${Prescreen.VERSION} "${scene}": ${scored.map((x) => `"${(x.c.title ?? '').slice(0, 40)}" fit ${x.fit.toFixed(2)} people ${x.people.toFixed(2)}${passing.includes(x) ? ' ✓' : ''}`).join('; ')}`);
  return passing.map((x) => x.c);
}

async function stockPhoto(request: string, slot: PhotoSlot, ctx: PhotoContext, deps: PhotoDeps, steps: string[], spend: { visionUsd: number }): Promise<Photo | null> {
  const search: StockSearch = deps.stock ?? ((q, o) => searchOpenverse(q, { http: deps.http, minShortSide: o.minShortSide }));
  const toPhoto = (pick: OpenverseCandidate): Photo => ({ url: pick.url, credit: buildStockCredit(pick), source: 'stock', width: pick.width, height: pick.height, qid: null, subject: null });
  for (const query of stockQueries(request)) {
    const cands = (await search(query, { minShortSide: STOCK_MIN_SHORT_SIDE })).filter((c) => !taken(ctx, c.url));
    if (!cands.length) {
      steps.push(`stock "${query}" (${slot}): no unused results`);
      continue;
    }
    const passing = await prescreen(request, cands, deps, steps);
    if (!passing.length) {
      steps.push(`stock "${query}" (${slot}): no result passed the pre-screen`);
      continue;
    }
    if (!deps.vision) {
      const pick = passing[0]!;
      steps.push(`stock "${query}" (${slot}): ${pick.source} ${pick.width}×${pick.height}${pick.title ? ` "${pick.title}"` : ''}`);
      return toPhoto(pick);
    }
    // The vision check: the top candidates, in order; the first that passes wins; none passing means none.
    const subjects = ctx.brief.subjects.map((x) => x.name);
    for (const c of passing.slice(0, VISION_TOP)) {
      const v = await deps.vision({ url: c.url, scene: request, subjects, title: c.title ?? undefined });
      spend.visionUsd += v.costUsd;
      const label = `"${(c.title ?? '').slice(0, 50)}"`;
      if (!v.ok) {
        steps.push(`vision ${label}: error (${v.error}) → skipped`);
        continue;
      }
      steps.push(`vision ${label}: ${describeVerdict(v.verdict)} → ${v.pass ? 'PASS' : 'fail'} ($${v.costUsd.toFixed(4)})`);
      if (v.pass) {
        steps.push(`stock "${query}" (${slot}): ${c.source} ${c.width}×${c.height}${c.title ? ` "${c.title}"` : ''}`);
        return toPhoto(c);
      }
    }
    steps.push(`stock "${query}" (${slot}): no candidate passed the vision check → no stock photo`);
    return null;
  }
  return null;
}

/** The slide's words (the cover's text names its organizations), where its photo goes, and the quote's speaker. */
export type SlideText = { text: string[]; speaker: string | null; slot: PhotoSlot; cover?: boolean };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where a subject is named in the text: the full name, or the last word of a multi-word name ("Clayton"). -1 if not. */
function namedAt(name: string, text: string): number {
  const words = name.split(/\s+/);
  const forms = [name, ...(words.length > 1 && words.at(-1)!.length >= 4 ? [words.at(-1)!] : [])];
  const at = forms.map((f) => new RegExp(`\\b${escapeRe(f)}\\b`, 'i').exec(text)?.index ?? -1).filter((i) => i >= 0);
  return at.length ? Math.min(...at) : -1;
}

/** SUBJECTS named in the cover text, in order of appearance (logo card candidates when the cover names an organization). */
function subjectsNamedIn(text: string, brief: Brief): string[] {
  return brief.subjects
    .map((s) => ({ n: s.name, at: namedAt(s.name, text) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((h) => h.n);
}

/** Logo card candidates per cover: the cover's own subject, then up to this many SUBJECTS named in the cover. */
const COVER_NAMED_MAX = 2;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One result for one slide, down Photo chain v1. A source error is logged and the chain moves on. */
export async function findPhoto(request: ImageRequest, ctx: PhotoContext, deps: PhotoDeps, slide: SlideText = { text: [], speaker: null, slot: 'split' }): Promise<PhotoTrace> {
  const steps: string[] = [];
  const spend = { visionUsd: 0 };
  const { slot } = slide;
  const designed = deps.designed ?? DESIGNED_GRAPHICS;
  let identity: IdentityNote | null = null;
  const extra = () => (spend.visionUsd ? { visionUsd: spend.visionUsd } : {});
  const done = (photo: Photo, via: ChainStep): PhotoTrace => {
    ctx.used.add(photo.url);
    return { request, photo, via, identity, steps, ...extra() };
  };
  const nothing = (via: ChainStep, why: string): PhotoTrace => {
    steps.push(why);
    return { request, photo: null, via, identity, steps, ...extra() };
  };
  const attempt = async (label: string, fn: () => Promise<Photo | null>): Promise<Photo | null> => {
    try {
      return await fn();
    } catch (err) {
      steps.push(`${label} error: ${errText(err)}`);
      return null;
    }
  };
  const value = request.value.trim();

  // ── Stat slides: a designed background, whatever the request ──
  if (slot === 'backdrop') {
    if (!designed.statBackgrounds) return nothing('plain', 'stat slide: plain dark background (designed stat backgrounds not approved yet)');
    const e = pickFromBank(ctx.bank, { statBackground: true }, avoidSet(ctx), ctx.lastUsed);
    if (!e) return nothing('plain', 'stat slide: no designed background free under the 7-day rule → plain dark');
    steps.push(`stat background: ${e.id}`);
    return done(bankPhoto(e), 'stat-background');
  }

  // ── Quote slides: the verified speaker's P18; a stock request is a darkened background ──
  if (slot === 'quote') {
    if (request.kind === 'subject' && value) {
      if (value !== slide.speaker) return nothing('text-only', `quote slide: ${value} isn't the speaker, and the round spot implies the speaker → text-only`);
      const r = await subjectPhoto(value, ctx, deps, steps, { personOnly: false }).catch((err) => (steps.push(`subject error: ${errText(err)}`), null));
      if (r) identity = r.identity;
      if (r?.photo) return done(r.photo, 'subject');
      return nothing('text-only', 'quote slide: no usable photo of the speaker → text-only');
    }
    if (request.kind === 'stock' && value) {
      const p = await attempt('stock', () => stockPhoto(value, slot, ctx, deps, steps, spend));
      if (p) return done(p, 'stock');
      return nothing('text-only', 'quote slide: no stock background → text-only');
    }
    if (request.kind === 'none') return nothing('none', 'IMAGE none: no photo requested');
    return nothing('text-only', `quote slide: a ${request.kind} request isn't shown on a quote slide → text-only`);
  }

  // ── Split slides (cover, text, landing, image) ──
  if (request.kind === 'none' && !slide.cover) return nothing('none', 'IMAGE none: no photo requested');
  if (request.kind === 'none') steps.push('cover IMAGE none (request dropped by the Writer check)');

  if (request.kind === 'article' && value) {
    const p = await attempt('article', () => articlePhoto(value, ctx, steps));
    if (p) return done(p, 'article');
  } else if (request.kind === 'subject' && value) {
    // Covers use a person's P18; an organization's cover is its logo card. Story slides use any subject's P18.
    const r = await subjectPhoto(value, ctx, deps, steps, { personOnly: Boolean(slide.cover) }).catch((err) => (steps.push(`subject error: ${errText(err)}`), null));
    if (r) identity = r.identity;
    if (r?.photo) return done(r.photo, 'subject');
  } else if (request.kind === 'stock' && value && !slide.cover) {
    const p = await attempt('stock', () => stockPhoto(value, slot, ctx, deps, steps, spend));
    if (p) return done(p, 'stock');
  }

  if (!slide.cover) return nothing('text-only', 'no usable photo: story slide renders text-only');

  // Cover: a logo card for a verified organization: the cover's own subject, then SUBJECTS named in the cover.
  const named = subjectsNamedIn(slide.text.join(' '), ctx.brief).slice(0, COVER_NAMED_MAX);
  const orgs = [...new Set([request.kind === 'subject' && value ? value : null, ...named].filter((x): x is string => !!x))];
  for (const org of orgs) {
    const p = await attempt('logo', () => logoCard(org, ctx, deps, steps));
    if (p) return done(p, 'logo');
  }

  // Cover: stock, then the starter set (or the branded cover card once approved).
  if (request.kind === 'stock' && value) {
    const p = await attempt('stock', () => stockPhoto(value, slot, ctx, deps, steps, spend));
    if (p) return done(p, 'stock');
  }
  if (designed.coverCard) return nothing('cover-card', 'cover: the branded cover card (no photo, headshot or logo)');
  const starter = pickCoverStarter(avoidSet(ctx), ctx.used, ctx.lastUsed);
  steps.push(starter.exhausted
    ? `${STARTER_POOL_EXHAUSTED}: every AI-compute starter photo used in the last 7 days; least recently used: ${starter.photo.url}`
    : `starter set (AI compute, cover fallback): ${starter.photo.url}`);
  return done(starter.photo, 'starter');
}
