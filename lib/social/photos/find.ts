/**
 * The photo finder (photo spec §4; Link 5): one slide at a time, down its
 * chain, left to right. The last step always succeeds: the slide's icon
 * background (the Writer's icon, render/icons.ts).
 *
 *   Cover        the Writer's request → an article photo or official image
 *                → the person's headshot (person story) → the company's logo
 *                card (company story) → cover icon
 *   Story slide  the Writer's request → an article photo or official image
 *                → the tagged subject: a person's headshot; a company's logo
 *                (at most one story slide; never its main photo) → icon
 *                (the Writer's none goes straight to the icon)
 *   Quote slide  the speaker's headshot → a second photo of them (§3) → an
 *                article photo whose caption names them → type-led slide
 *                (icon). An organization or unlisted speaker: type-led.
 *   Stat slide   icon, always
 *
 * Every photo is one the Writer could have asked for: subjects by the slide's
 * tags, article photos and official images from the same code-built list
 * (article-list.ts), subject photos from the same availability rules
 * (p18.ts, logo.ts). Stock is the frozen stock link (pre-screen v4 + the
 * vision check), unchanged.
 *
 * AI calls: Jev (identity, stock pre-screen), the stock vision check, and
 * the official-image text check (the same vision call, its "mostly text or
 * banner" answer; photo spec §3 rule 4). Faces: the code face detector.
 *
 * No repeats: never twice in a post or within 7 days, every source, except
 * a logo: the cover and one story slide, exempt from the 7-day rule.
 */
import { buildCredit } from '@/lib/social/editorial/v2/image-step/commons';
import { buildStockCredit, searchOpenverse, type OpenverseCandidate } from '@/lib/social/editorial/v2/image-step/openverse';
import type { JevAsk } from '@/lib/social/jev/client';
import * as Prescreen from '@/lib/social/jev/questions/stock-prescreen.v4';
import type { FaceBox } from '@/lib/social/render/fit-check';
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import type { ImageRequest } from '@/lib/social/writer/draft';

import { photoUrlKey, type ListedPhoto } from './article-list';
import type { DetectFaces } from './faces';
import type { IdentityScores, SubjectType } from './identity';
import { fetchLogo } from './logo';
import { P18_MIN_SHORT_SIDE, identityOf, subjectP18, type IdentityCache } from './p18';
import type { SecondPhotos } from './second-photo';
import { VISION_TOP, describeVerdict, type VisionCheck } from './vision';

/**
 * `article`: an article photo (caption names the subject); `official`: an image
 * from a company's own news page; `commons`: a person's main photo (headshot);
 * `second`: a second photo of a person; `logo`: a logo card (a company's only
 * photo: never its main photo; Tommy, 2026-10-07); `stock`: the stock link.
 */
export type PhotoSource = 'article' | 'official' | 'commons' | 'second' | 'logo' | 'stock';

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

/** Which step supplied the result. `icon`: the icon background; `type-led`: a quote slide without a speaker photo. */
export type ChainStep = 'article' | 'official' | 'subject' | 'second' | 'logo' | 'stock' | 'icon' | 'type-led';

/** Identity check outcome for the run log. */
export type IdentityNote = { subject: string; ok: boolean; detail: string; scores: IdentityScores | null };

/** What happened for one slide, for the run log. */
export type PhotoTrace = {
  request: ImageRequest;
  photo: Photo | null;
  via: ChainStep;
  /** The icon drawn when there is no photo (the Writer's, else the default). */
  icon: string | null;
  identity: IdentityNote | null;
  steps: string[];
  /** Other photos for this slide that passed every check (the render review's next-best photo). */
  alternates: Photo[];
  /** Vision check spend for this slide (stock and official images). */
  visionUsd?: number;
};

/** Stock and Commons share one size rule (reject thumbnails). */
export const STOCK_MIN_SHORT_SIDE = P18_MIN_SHORT_SIDE;

export type StockSearch = (query: string, opts: { minShortSide: number }) => Promise<OpenverseCandidate[]>;

/** Where the photo is drawn: `split` (cover, text, landing, image), `quote`, `backdrop` (stat: icon only). */
export type PhotoSlot = 'split' | 'backdrop' | 'quote';

export type PhotoDeps = {
  jev: JevAsk;
  /** Injected for tests; live runs pass fetch. */
  http?: typeof fetch;
  stock?: StockSearch;
  /** The vision check on the top stock candidates (vision.ts). Absent: the first pre-screened result is used. */
  vision?: VisionCheck;
  /** The face detector (faces.ts). Absent: second photos aren't used (they need a face count). */
  faces?: DetectFaces;
  /** Second photos of a person (second-photo.ts). Absent: none. */
  secondPhotos?: SecondPhotos;
};

export type PhotoContext = {
  brief: Brief;
  pages: PageReadOk[];
  /** ARTICLE PHOTOS: the same code-built list the Writer saw (article-list.ts). */
  photos: ListedPhoto[];
  /** Each subject's type (identity check, else the Reporter's mark). */
  kinds: Map<string, SubjectType | null>;
  /** URLs already used in this post. Updated by findPhoto. */
  used: Set<string>;
  /** URLs used in the last 7 days or earlier in this run, any source. Never picked (logos aside). */
  recent: Set<string>;
  /** When each URL was last used. */
  lastUsed: Map<string, string>;
  /** Identity results by subject name (p18.ts), shared with the Writer's availability flags. */
  identities: IdentityCache;
  /** Organizations whose logo already sits on a story slide in this post. */
  logoOnStorySlide: Set<string>;
  /** Official-image text checks, by URL (one vision call each per post). */
  officialChecked: Map<string, boolean>;
};

export function newPhotoContext(
  brief: Brief,
  pages: PageReadOk[],
  opts: { recent?: Set<string>; lastUsed?: Map<string, string>; identities?: IdentityCache; photos?: ListedPhoto[]; kinds?: Map<string, SubjectType | null> } = {},
): PhotoContext {
  return {
    brief,
    pages,
    photos: opts.photos ?? [],
    kinds: opts.kinds ?? new Map(brief.subjects.map((s) => [s.name, s.type ?? null])),
    used: new Set(),
    recent: opts.recent ?? new Set(),
    lastUsed: opts.lastUsed ?? new Map(),
    identities: opts.identities ?? new Map(),
    logoOnStorySlide: new Set(),
    officialChecked: new Map(),
  };
}

/** Used in this post, in the last 7 days, or earlier in this run. */
const taken = (ctx: PhotoContext, url: string) => ctx.used.has(url) || ctx.recent.has(url);

/** The slide's words, where its photo goes, its subject tags, its icon, and the quote's speaker. */
export type SlideText = {
  text: string[];
  /** The quote's speaker (its SUBJECTS name), on quote slides. */
  speaker: string | null;
  slot: PhotoSlot;
  cover?: boolean;
  /** The SUBJECTS IDs the slide is tagged with (photo spec §3 rule 3). */
  tags?: string[];
  /** The Writer's icon for this slide. */
  icon?: string | null;
};

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Run = {
  ctx: PhotoContext;
  deps: PhotoDeps;
  steps: string[];
  spend: { visionUsd: number };
  identity: IdentityNote | null;
};

async function attempt(run: Run, label: string, fn: () => Promise<Photo | null>): Promise<Photo | null> {
  try {
    return await fn();
  } catch (err) {
    run.steps.push(`${label} error: ${errText(err)}`);
    return null;
  }
}

const subjectByName = (ctx: PhotoContext, name: string) => ctx.brief.subjects.find((s) => s.name === name) ?? null;
const subjectById = (ctx: PhotoContext, id: string) => ctx.brief.subjects.find((s) => s.id === id) ?? null;

/** Faces for one photo, when the detector is there; null when it isn't or the photo didn't load. */
async function facesOf(run: Run, url: string): Promise<FaceBox[] | null> {
  if (!run.deps.faces) return null;
  return (await run.deps.faces([url])).get(url) ?? null;
}

// ── Article photos and official images ───────────────────────────────

function articleCredit(run: Run, p: ListedPhoto): string {
  if (p.official_of) return `Image: ${subjectById(run.ctx, p.official_of)?.name ?? 'the company'}`;
  return (p.credit ?? p.caption ?? '').trim();
}

/** The official-image text check: the vision call's "mostly text or banner" answer (photo spec §3 rule 4). */
async function officialImageOk(run: Run, p: ListedPhoto): Promise<boolean> {
  const cached = run.ctx.officialChecked.get(p.url);
  if (cached !== undefined) return cached;
  if (!run.deps.vision) {
    run.steps.push('official image: no vision check available → not used');
    run.ctx.officialChecked.set(p.url, false);
    return false;
  }
  const company = subjectById(run.ctx, p.official_of!)?.name ?? '';
  const v = await run.deps.vision({ url: p.url, scene: `an image from ${company}'s announcement`, subjects: run.ctx.brief.subjects.map((s) => s.name), title: p.caption ?? undefined });
  run.spend.visionUsd += v.costUsd;
  const ok = v.ok && !v.verdict.mostly_text_banner;
  run.steps.push(v.ok ? `official image text check: ${v.verdict.mostly_text_banner ? 'mostly text or a banner → rejected' : 'a picture → ok'} ($${v.costUsd.toFixed(4)})` : `official image text check error (${v.error}) → not used`);
  run.ctx.officialChecked.set(p.url, ok);
  return ok;
}

/** May this listed photo go on this slide? Its caption's subjects meet the tags; an official image goes on the cover or its company's slide. */
function fitsSlide(p: ListedPhoto, tags: string[], cover: boolean): boolean {
  if (p.official_of) return cover || tags.includes(p.official_of);
  return p.subject_ids.some((id) => tags.includes(id));
}

async function listedPhoto(run: Run, p: ListedPhoto): Promise<Photo | null> {
  if (taken(run.ctx, p.url)) {
    run.steps.push(`article photo ${photoUrlKey(p.url).slice(-40)}: already used in this post or in the last 7 days`);
    return null;
  }
  if (p.official_of && !(await officialImageOk(run, p))) return null;
  const faces = await facesOf(run, p.url);
  run.steps.push(`${p.official_of ? 'official image' : 'article photo'}: ${photoUrlKey(p.url).slice(-50)}${p.caption ? ` "${p.caption.slice(0, 60)}"` : ''}`);
  return { url: p.url, credit: articleCredit(run, p), source: p.official_of ? 'official' : 'article', width: null, height: null, qid: null, subject: null, ...(faces ? { faces } : {}) };
}

/** The Writer's article request, if it is on the list and fits the slide. */
async function requestedArticle(run: Run, url: string, tags: string[], cover: boolean): Promise<Photo | null> {
  const p = run.ctx.photos.find((x) => photoUrlKey(x.url) === photoUrlKey(url));
  if (!p) {
    run.steps.push('article request: not in ARTICLE PHOTOS');
    return null;
  }
  if (!fitsSlide(p, tags, cover)) {
    run.steps.push("article request: its caption's subjects aren't tagged on this slide");
    return null;
  }
  return listedPhoto(run, p);
}

/** The first listed photo that fits the slide and passes its checks. */
async function anyArticle(run: Run, tags: string[], cover: boolean, only?: (p: ListedPhoto) => boolean): Promise<Photo | null> {
  for (const p of run.ctx.photos) {
    if (!fitsSlide(p, tags, cover) || (only && !only(p))) continue;
    const photo = await listedPhoto(run, p);
    if (photo) return photo;
  }
  return null;
}

// ── Subjects: headshots, second photos, logos ────────────────────────

async function verified(run: Run, name: string) {
  const id = await identityOf(name, run.ctx.brief, run.deps, run.ctx.identities);
  run.identity = id.ok
    ? { subject: name, ok: true, detail: `${id.qid} "${id.label}" — ${id.description} (${id.type}, ${id.via})`, scores: id.scores }
    : { subject: name, ok: false, detail: id.reason, scores: id.scores };
  run.steps.push(id.ok ? `identity ok: ${id.qid} "${id.label}" (${id.type}, ${id.via})` : `identity failed for ${name}: ${id.reason}`);
  return id;
}

/** A person's main photo (P18), the same check as the Writer's headshot_available. */
async function headshot(run: Run, name: string): Promise<Photo | null> {
  const id = await verified(run, name);
  if (!id.ok || id.type !== 'person') return null;
  const r = await subjectP18(name, run.ctx.brief, run.deps, run.ctx.identities);
  if (!r.pick) {
    run.steps.push(`headshot: ${r.why ?? 'no usable main photo'}`);
    return null;
  }
  if (taken(run.ctx, r.pick.url)) {
    run.steps.push('headshot: already used in this post or in the last 7 days');
    return null;
  }
  const faces = await facesOf(run, r.pick.url);
  run.steps.push(`headshot (P18): ${r.pick.file}`);
  return { url: r.pick.url, credit: `${buildCredit(r.pick)} · Wikimedia Commons`, source: 'commons', width: r.pick.width, height: r.pick.height, qid: id.qid, subject: name, ...(faces ? { faces } : {}) };
}

/** A second photo of a verified person: tagged as depicting them by QID, their name in the title, exactly one face (photo spec §3). */
async function secondPhoto(run: Run, name: string): Promise<Photo | null> {
  if (!run.deps.secondPhotos || !run.deps.faces) {
    run.steps.push('second photo: not available in this run (no search or face detector)');
    return null;
  }
  const id = await verified(run, name);
  if (!id.ok || id.type !== 'person') return null;
  const cands = (await run.deps.secondPhotos(id.qid, name)).filter((c) => !taken(run.ctx, c.url));
  if (!cands.length) {
    run.steps.push('second photo: no Commons file tagged with this person and titled with their name');
    return null;
  }
  const faces = await run.deps.faces(cands.map((c) => c.url));
  for (const c of cands) {
    const f = faces.get(c.url);
    if (!f || f.length !== 1) {
      run.steps.push(`second photo ${c.file}: ${f ? `${f.length} faces` : 'did not load'} → not used`);
      continue;
    }
    run.steps.push(`second photo: ${c.file} (one face)`);
    return { url: c.url, credit: `${buildCredit(c)} · Wikimedia Commons`, source: 'second', width: c.width, height: c.height, qid: id.qid, subject: name, faces: f };
  }
  return null;
}

/** A logo card: the cover, and at most one story slide per organization (exempt from the 7-day rule). */
async function logoCard(run: Run, name: string, cover: boolean): Promise<Photo | null> {
  if (!cover && run.ctx.logoOnStorySlide.has(name)) {
    run.steps.push(`logo: ${name}'s logo is already on a story slide`);
    return null;
  }
  const id = await verified(run, name);
  if (!id.ok || id.type !== 'organization') return null;
  const r = await fetchLogo(id.qid, id.label, { http: run.deps.http });
  if (!r.photo) {
    run.steps.push(`logo: ${r.reason}`);
    return null;
  }
  // A story slide may repeat the cover's logo; never two story slides (logoOnStorySlide).
  if (cover && run.ctx.used.has(r.photo.url)) {
    run.steps.push('logo: already used in this post');
    return null;
  }
  if (!cover) run.ctx.logoOnStorySlide.add(name);
  run.steps.push(`logo: ${id.qid} File:${r.file} (${r.photo.plate} plate)`);
  return r.photo;
}

// ── Stock: the frozen stock link, unchanged ──────────────────────────

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

// ── The chains ───────────────────────────────────────────────────────

/** A tagged subject's photo on a story slide: a person's headshot; a company's logo (never its main photo; Tommy, 2026-10-07). */
async function taggedSubject(run: Run, name: string): Promise<{ photo: Photo; via: ChainStep } | null> {
  const kind = run.ctx.kinds.get(name) ?? null;
  if (kind === 'organization') {
    const l = await attempt(run, 'logo', () => logoCard(run, name, false));
    return l ? { photo: l, via: 'logo' } : null;
  }
  const h = await attempt(run, 'headshot', () => headshot(run, name));
  return h ? { photo: h, via: 'subject' } : null;
}

/** One result for one slide. A source error is logged and the chain moves on. */
export async function findPhoto(request: ImageRequest, ctx: PhotoContext, deps: PhotoDeps, slide: SlideText = { text: [], speaker: null, slot: 'split' }): Promise<PhotoTrace> {
  const run: Run = { ctx, deps, steps: [], spend: { visionUsd: 0 }, identity: null };
  const icon = slide.icon ?? null;
  const tags = slide.tags ?? [];
  const cover = Boolean(slide.cover);
  const extra = () => (run.spend.visionUsd ? { visionUsd: run.spend.visionUsd } : {});
  const alternatesFor = (chosen: Photo | null): Photo[] =>
    ctx.photos
      .filter((p) => !p.official_of && fitsSlide(p, tags, cover) && !taken(ctx, p.url) && p.url !== chosen?.url)
      .slice(0, 3)
      .map((p) => ({ url: p.url, credit: (p.credit ?? p.caption ?? '').trim(), source: 'article' as const, width: null, height: null, qid: null, subject: null }));
  const done = (photo: Photo, via: ChainStep): PhotoTrace => {
    ctx.used.add(photo.url);
    return { request, photo, via, icon, identity: run.identity, steps: run.steps, alternates: alternatesFor(photo), ...extra() };
  };
  const none = (via: 'icon' | 'type-led', why: string): PhotoTrace => {
    run.steps.push(why);
    return { request, photo: null, via, icon, identity: run.identity, steps: run.steps, alternates: alternatesFor(null), ...extra() };
  };
  const value = request.value.trim();

  // ── Stat slides: the icon background, always ──
  if (slide.slot === 'backdrop') return none('icon', 'stat slide: icon background');

  // ── Quote slides: the speaker, else a type-led slide ──
  if (slide.slot === 'quote') {
    const speaker = slide.speaker;
    if (!speaker) return none('type-led', "quote slide: the speaker isn't in SUBJECTS → type-led");
    if ((ctx.kinds.get(speaker) ?? null) === 'organization') return none('type-led', `quote slide: ${speaker} is an organization (never a logo in the speaker's spot) → type-led`);
    const h = await attempt(run, 'headshot', () => headshot(run, speaker));
    if (h) return done(h, 'subject');
    const s2 = await attempt(run, 'second photo', () => secondPhoto(run, speaker));
    if (s2) return done(s2, 'second');
    const id = subjectByName(ctx, speaker)?.id;
    const a = id ? await attempt(run, 'article', () => anyArticle(run, [id], false, (p) => !p.official_of)) : null;
    if (a) return done({ ...a, subject: speaker }, 'article');
    return none('type-led', 'quote slide: no verified photo of the speaker → type-led');
  }

  // ── Cover and story slides ──
  if (request.kind === 'none' && !cover) return none('icon', 'IMAGE none → icon background');

  // The spec order, left to right; within each step the Writer's request is tried first.
  // 1. An article photo or official image that fits the slide.
  if (request.kind === 'article' && value) {
    const p = await attempt(run, 'article', () => requestedArticle(run, value, tags, cover));
    if (p) return done(p, p.source === 'official' ? 'official' : 'article');
  }
  const a = await attempt(run, 'article', () => anyArticle(run, tags, cover));
  if (a) return done(a, a.source === 'official' ? 'official' : 'article');

  // 2. The subject. Cover: a person's headshot (person story), then a company's logo card (company story).
  //    Story slide: a person's headshot; a company's logo.
  const tagged = tags.map((id) => subjectById(ctx, id)?.name).filter((n): n is string => Boolean(n));
  const requested = request.kind === 'subject' && value ? [value] : [];
  const names = [...new Set([...requested, ...tagged])];
  if (cover) {
    for (const n of names.filter((x) => (ctx.kinds.get(x) ?? null) === 'person')) {
      const h = await attempt(run, 'headshot', () => headshot(run, n));
      if (h) return done(h, 'subject');
    }
    for (const n of names.filter((x) => (ctx.kinds.get(x) ?? null) === 'organization')) {
      const l = await attempt(run, 'logo', () => logoCard(run, n, true));
      if (l) return done(l, 'logo');
    }
  } else {
    for (const n of names) {
      const r = await taggedSubject(run, n);
      if (r) return done(r.photo, r.via);
    }
  }

  // 3. Stock: the Writer's literal scene, through the frozen stock link.
  if (request.kind === 'stock' && value) {
    const p = await attempt(run, 'stock', () => stockPhoto(value, slide.slot, ctx, deps, run.steps, run.spend));
    if (p) return done(p, 'stock');
  }

  // 4. The icon background (the cover's own format).
  return none('icon', cover ? 'cover: nothing usable → cover icon background' : 'no usable photo → icon background');
}
