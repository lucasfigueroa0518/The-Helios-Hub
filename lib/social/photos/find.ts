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
 *            scene, no person likely visible; v4, Tommy 2026-10-06), then the
 *            vision check on the pixels (landmarks, logos, people; vision.ts)
 *   then     cover: the offline starter set's AI-compute photos only, never a
 *            topic match (starter-set.ts; can't come up empty). Story slides:
 *            text-only (the starter set is cover-only, Tommy 2026-10-06)
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
import * as PrescreenV4 from '@/lib/social/jev/questions/stock-prescreen.v4';
import type { Brief } from '@/lib/social/reporter/brief';
import type { ArticlePhoto, PageReadOk } from '@/lib/social/reporter/read-page';
import type { ImageRequest } from '@/lib/social/writer/draft';

import { classifyCredit } from './credit';
import { checkIdentity, type IdentityResult, type SubjectType } from './identity';
import { bankPhoto, pickFromBank, type BankEntry, type BankNeed } from './bank';
import { pickCoverStarter } from './starter-set';
import { VISION_TOP, describeVerdict, type VisionCheck } from './vision';

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
  /** Vision check spend for this request (Tommy, 2026-10-06: recorded per request). */
  visionUsd?: number;
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
  /** Stock pre-screen version: v4 (default, Tommy 2026-10-06: fit and people only) or v2/v3 (kept for the bench's before/after). */
  prescreen?: 'v2' | 'v3' | 'v4';
  /** The photo vision check on the top stock candidates (vision.ts). Absent: metadata pre-screen only. */
  vision?: VisionCheck;
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
 * Jev metadata pre-screen (spec §5A #6): the results whose title and tags
 * fit the scene and suggest no person (v4), in order. Scores are logged.
 */
async function prescreen(scene: string, cands: OpenverseCandidate[], ctx: PhotoContext, deps: PhotoDeps, steps: string[]): Promise<OpenverseCandidate[]> {
  const version = deps.prescreen ?? 'v4';
  const P = version === 'v4' ? PrescreenV4 : version === 'v3' ? PrescreenV3 : PrescreenV2;
  const shown = cands.slice(0, P.MAX_CANDIDATES);
  const meta = shown.map((c) => ({ title: c.title ?? '', tags: c.tags ?? [], source: c.source }));
  const state = version === 'v3' ? PrescreenV3.buildState(scene, meta, ctx.brief.subjects.map((x) => x.name)) : PrescreenV4.buildState(scene, meta);
  const res = await deps.jev({ state, questions: P.buildQuestions(shown.length) }, { version: P.VERSION, subjectId: scene });
  const n = (id: string) => res.answers[id]?.noul ?? 0;
  const scored = shown.map((c, k) => ({
    c,
    fit: n(P.fitId(k)),
    people: n(P.peopleId(k)),
    // v2/v3 only (v4 leaves landmarks and brands to the vision check).
    landmark: version === 'v4' ? null : n(PrescreenV3.landmarkId(k)),
    brand: version === 'v3' ? n(PrescreenV3.brandId(k)) : null,
  }));
  const ok = (x: (typeof scored)[number]) =>
    x.fit >= P.THRESHOLDS.FIT_MIN && x.people < P.THRESHOLDS.PEOPLE_MAX
    && (x.landmark === null || x.landmark < PrescreenV3.THRESHOLDS.LANDMARK_MAX)
    && (x.brand === null || x.brand < PrescreenV3.THRESHOLDS.BRAND_MAX);
  const passing = scored.filter(ok);
  steps.push(`pre-screen ${P.VERSION} "${scene}": ${scored.map((x) => `"${(x.c.title ?? '').slice(0, 40)}" fit ${x.fit.toFixed(2)} people ${x.people.toFixed(2)}${x.landmark === null ? '' : ` landmark ${x.landmark.toFixed(2)}`}${x.brand === null ? '' : ` brand ${x.brand.toFixed(2)}`}${passing.includes(x) ? ' ✓' : ''}`).join('; ')}`);
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
    const passing = await prescreen(request, cands, ctx, deps, steps);
    if (!passing.length) {
      steps.push(`stock "${query}" (${slot}): no result passed the pre-screen`);
      continue;
    }
    if (!deps.vision) {
      const pick = passing[0]!;
      steps.push(`stock "${query}" (${slot}): ${pick.source} ${pick.width}×${pick.height}${pick.title ? ` "${pick.title}"` : ''}`);
      return toPhoto(pick);
    }
    // Vision check (Tommy, 2026-10-06): the top candidates, in order; the first passing all four wins; none passing means none.
    const subjects = ctx.brief.subjects.map((x) => x.name);
    for (const c of passing.slice(0, VISION_TOP)) {
      const v = await deps.vision({ url: c.url, scene: request, subjects });
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
  const spend = { visionUsd: 0 };
  const { slot } = slide;
  let identity: IdentityNote | null = null;
  const done = (photo: Photo, via: ChainStep): PhotoTrace => {
    ctx.used.add(photo.url);
    return { request, photo, via, identity, steps, ...(spend.visionUsd ? { visionUsd: spend.visionUsd } : {}) };
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
    const p = await attempt('stock', () => stockPhoto(request.value, slot, ctx, deps, steps, spend));
    if (p) return done(p, 'stock');
    const b = fromBank({ scene: request.value });
    if (b) return done(b, 'bank');
  }

  // Story slides: nothing usable → text-only (Tommy, 2026-10-06). The starter set is for the cover only.
  if (!slide.cover) {
    steps.push('no usable photo: story slide renders text-only (the starter set is cover-only)');
    return { request, photo: null, via: 'text-only', identity, steps, ...(spend.visionUsd ? { visionUsd: spend.visionUsd } : {}) };
  }
  // The offline starter set (cover only), from the AI-compute set only, never a topic match (Tommy, 2026-10-06).
  const starter = pickCoverStarter(avoidSet(ctx), ctx.used, ctx.lastUsed);
  steps.push(starter.exhausted
    ? `${STARTER_POOL_EXHAUSTED}: every AI-compute starter photo used in the last 7 days; least recently used: ${starter.photo.url}`
    : `starter set (AI compute, cover fallback): ${starter.photo.url}`);
  return done(starter.photo, 'starter');
}
