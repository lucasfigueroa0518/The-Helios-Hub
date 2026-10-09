/**
 * The pick (photo spec §4 step 5): per slide, the best-ranked candidate that
 * passes, then the second, then the fallback request's, then the icon.
 *
 * A candidate passes when:
 *   - it is verified (people, logos, company photos, captioned article and
 *     official images: never judged by tags), or its tags fit the request
 *     (Jev photo-fit@1);
 *   - it isn't the previous slide's photo, and a searched scene (Openverse,
 *     the StockSnap lane, Commons search) isn't already used in the post;
 *   - the slide can show it: a stat slide never a person or a logo (the
 *     number would cover a face; a logo can't be a darkened backdrop); a quote
 *     slide never a person other than the speaker (they'd pass for the
 *     speaker), nor a logo;
 *   - an unverified winner passes the close-up vision check (the frozen stock
 *     prompt), once per photo and request per post.
 *
 * Uniqueness and slide fit (Lucas, 2026-10-08: the CEO portrait on both the
 * cover and a slide about research):
 *   - code: no photo appears twice in a post, and no person appears twice,
 *     verified photos included. The one exception is a quote slide's speaker
 *     in the round spot (the quote is theirs);
 *   - Jev (photo-slide@2), one call per slide over its shortlist: a photo that
 *     clearly doesn't belong under this slide (someone it isn't about, the
 *     wrong sense of a word, a contradicting scene) is out, and so is one that
 *     reads as a repeat of a photo already in the post (the same face, place,
 *     logo or kind of scene); the rest are tried best-suited first. Verified photos are
 *     asked too: verified means the photo is who it claims to be, never that
 *     it suits the slide. A Jev error leaves the slide ungated (logged).
 */
import type { JevAsk } from '@/lib/social/jev/client';
import * as PhotoSlide from '@/lib/social/jev/questions/photo-slide.v2';
import type { VisualRequest } from '@/lib/social/writer/draft';

import type { Candidate, ChainStep } from './find';
import type { TileTag } from './tag-sheet';
import { tuning } from './tuning';
import { describeVerdict, passesVision, type VisionCheck } from './vision';

/** What a slide is: where its photo would go and, on a quote slide, its speaker. */
export type PickSlot = { kind: 'cover' | 'story' | 'stat' | 'quote'; speaker: string | null };

/** One request's candidates, with their tags and fit (null: not tagged or not asked). */
export type Scored = { cand: Candidate; tags: TileTag | null; fit: number | null };

/** What the slide says, for Jev's slide-fit check. Absent (tests): no Jev check. */
export type PickWords = { position: number; headline: string; body: string };

export type PickInput = { slot: PickSlot; requests: Array<{ request: VisualRequest; scored: Scored[] }>; words?: PickWords };

/** What a picked photo shows, in words, for the repeat check. */
export const describeCandidate = (c: Candidate, tags: TileTag | null): string =>
  [c.lane, c.subject ? `of ${c.subject}` : '', c.title ? `"${c.title.slice(0, 80)}"` : '', tags?.tags.length ? `[${tags.tags.join(', ')}]` : ''].filter(Boolean).join(' ');

export type PickOutcome = { winner: Scored | null; request: VisualRequest; via: ChainStep; steps: string[]; alternates: Candidate[]; visionUsd: number };

const PERSON_LANES = new Set(['headshot', 'second', 'ceo']);

/** May this slot show this candidate? */
export function slotAllows(slot: PickSlot, c: Candidate): boolean {
  if (slot.kind === 'stat') return !PERSON_LANES.has(c.lane) && c.lane !== 'logo';
  if (slot.kind === 'quote') return c.lane !== 'logo' && (!PERSON_LANES.has(c.lane) || (!!slot.speaker && c.subject === slot.speaker));
  return true;
}

const isSpeaker = (c: Candidate, slot: PickSlot) => PERSON_LANES.has(c.lane) && !!slot.speaker && c.subject === slot.speaker;

export type PickState = {
  /** The previous slide's photo URL (the cover counts): never on two neighbouring slides. */
  prev: string | null;
  /** Searched scenes (unverified) already used in this post (never twice). */
  usedStock: Set<string>;
  /** Every photo URL used in this post (never twice; a quote slide's speaker aside). */
  usedUrls: Set<string>;
  /** People shown in this post (headshots, second photos, CEOs): never twice, a quote slide's speaker aside. */
  usedPeople: Set<string>;
  /** What each picked photo shows, in slide order, for Jev's repeat check. */
  picked: Array<{ slide: number; shows: string }>;
  /** Close-up verdicts by URL and request: one vision call per photo per request per post. */
  closeUps: Map<string, boolean>;
};

export const newPickState = (): PickState => ({ prev: null, usedStock: new Set(), usedUrls: new Set(), usedPeople: new Set(), picked: [], closeUps: new Map() });

/** The close-up check (vision.ts, frozen stock prompt). No vision dep (offline): passes. */
async function closeUp(c: Candidate, request: VisualRequest, vision: VisionCheck | undefined, subjects: string[], state: PickState, steps: string[], story?: string): Promise<{ ok: boolean; usd: number }> {
  if (!vision) return { ok: true, usd: 0 };
  const key = `${c.url}|${request.query}`;
  const seen = state.closeUps.get(key);
  if (seen !== undefined) {
    steps.push(`close-up "${c.title.slice(0, 40)}": ${seen ? 'PASS' : 'fail'} (checked earlier in this post)`);
    return { ok: seen, usd: 0 };
  }
  const v = await vision({ url: c.url, scene: request.query, subjects, title: c.title || undefined, ...(story ? { story } : {}) });
  const ok = v.ok && passesVision(v.verdict, tuning().vision);
  steps.push(v.ok ? `close-up "${c.title.slice(0, 40)}": ${describeVerdict(v.verdict)} → ${ok ? 'PASS' : 'fail'} ($${v.costUsd.toFixed(4)})` : `close-up "${c.title.slice(0, 40)}": error (${v.error}) → not used`);
  if (v.ok) state.closeUps.set(key, ok);
  return { ok, usd: v.costUsd };
}

/** `story`: the news in one line, so the close-up judges the request in the story's sense (homonyms). */
export async function pickForSlide(input: PickInput, state: PickState, deps: { vision?: VisionCheck; jev?: JevAsk }, subjects: string[], fitMin: number, story?: string): Promise<PickOutcome> {
  const steps: string[] = [];
  let visionUsd = 0;
  const repeatOf = (c: Candidate): string | null => {
    if (isSpeaker(c, input.slot)) return null;
    if (state.usedUrls.has(c.url)) return 'this photo is already in the post';
    if (PERSON_LANES.has(c.lane) && c.subject && state.usedPeople.has(c.subject)) return `${c.subject} is already shown in the post`;
    return null;
  };
  const judged = await slideCheck(input, state, deps.jev, story, steps, repeatOf);
  // Within each request, Jev's best-suited candidates go first (photo-slide@2 "best"); the rank order breaks ties.
  const byBest = (list: Scored[]) => (judged.size ? [...list].sort((x, y) => (judged.get(y.cand.url)?.best ?? 0) - (judged.get(x.cand.url)?.best ?? 0)) : list);
  const passing: Candidate[] = [];
  let winner: { s: Scored; request: VisualRequest } | null = null;
  // A quote slide tries the speaker's verified photo first: it goes in the round speaker spot (the designed look).
  const speakerFirst = (list: Scored[]) => (input.slot.kind === 'quote' && input.slot.speaker ? [...list].sort((x, y) => Number(isSpeaker(y.cand, input.slot)) - Number(isSpeaker(x.cand, input.slot))) : list);
  for (const { request, scored } of input.requests) {
    for (const s of speakerFirst(byBest(scored))) {
      const c = s.cand;
      const label = `${c.lane} "${c.title.slice(0, 40)}"`;
      if (!slotAllows(input.slot, c)) {
        steps.push(`${label}: not on a ${input.slot.kind} slide`);
        continue;
      }
      if (c.url === state.prev) {
        steps.push(`${label}: on the previous slide`);
        continue;
      }
      const repeat = repeatOf(c);
      if (repeat) {
        steps.push(`${label}: ${repeat}`);
        continue;
      }
      const j = judged.get(c.url);
      if (j && j.fit < tuning().slideFitMin) {
        steps.push(`${label}: doesn't belong under this slide (${PhotoSlide.VERSION} fit ${j.fit.toFixed(2)})`);
        continue;
      }
      if (j && j.repeat >= tuning().repeatMax) {
        steps.push(`${label}: reads as a repeat of a photo already in the post (${PhotoSlide.VERSION} repeat ${j.repeat.toFixed(2)})`);
        continue;
      }
      if (!c.verified && s.fit !== null && s.fit < fitMin) {
        steps.push(`${label}: tags [${s.tags?.tags.join(', ') ?? ''}] don't fit "${request.query}" (${s.fit.toFixed(2)})`);
        continue;
      }
      if (winner) {
        // Runner-ups (the render review's next photo) only when nothing more needs checking.
        if (c.verified || state.closeUps.get(`${c.url}|${request.query}`) === true) passing.push(c);
        continue;
      }
      // An unverified winner gets the close-up check. A verified photo (a headshot, CEO, HQ, logo, article or
      // official image) is the subject by design, so the stock close-up (which fails any person, landmark,
      // logo or named place) is never its test (2026-10-08: it was rejecting verified headshots). A verified
      // tile tagged with a text banner is still skipped.
      if (c.verified && s.tags?.text_banner) {
        steps.push(`${label}: verified, but tagged with a text banner`);
        continue;
      }
      if (!c.verified) {
        const r = await closeUp(c, request, deps.vision, subjects, state, steps, story);
        visionUsd += r.usd;
        if (!r.ok) continue;
      }
      winner = { s, request };
    }
  }
  const request = winner?.request ?? input.requests[0]!.request;
  if (!winner) {
    steps.push(input.slot.kind === 'quote' ? 'no photo → type-led quote' : 'no photo → icon background');
    return { winner: null, request, via: input.slot.kind === 'quote' ? 'type-led' : 'icon', steps, alternates: passing, visionUsd };
  }
  const c = winner.s.cand;
  state.prev = c.url;
  if (!c.verified) state.usedStock.add(c.url);
  state.usedUrls.add(c.url);
  if (PERSON_LANES.has(c.lane) && c.subject) state.usedPeople.add(c.subject);
  state.picked.push({ slide: input.words?.position ?? state.picked.length + 1, shows: describeCandidate(c, winner.s.tags) });
  steps.push(`picked ${c.lane}${winner.request === input.requests[0]!.request ? '' : ' (the fallback request)'}: ${c.title.slice(0, 60) || c.url}`);
  return { winner: winner.s, request, via: c.lane, steps, alternates: passing.slice(0, 3), visionUsd };
}

/**
 * Jev's slide check (photo-slide@2): one call over the slide's shortlist (the candidates the code
 * filters let through, both requests, at most MAX_CANDIDATES). Scores by URL; empty when there is no
 * Jev, no slide words, or nothing to ask.
 */
async function slideCheck(input: PickInput, state: PickState, jev: JevAsk | undefined, story: string | undefined, steps: string[], repeatOf: (c: Candidate) => string | null): Promise<Map<string, PhotoSlide.SlideScore>> {
  const out = new Map<string, PhotoSlide.SlideScore>();
  if (!jev || !input.words) return out;
  const seen = new Set<string>();
  const shortlist = input.requests.flatMap(({ request, scored }) => scored.map((s) => ({ s, request })))
    .filter(({ s }) => slotAllows(input.slot, s.cand) && s.cand.url !== state.prev && !repeatOf(s.cand) && !seen.has(s.cand.url) && (seen.add(s.cand.url), true))
    .slice(0, PhotoSlide.MAX_CANDIDATES);
  if (!shortlist.length) return out;
  const state_: PhotoSlide.SlideState = {
    story: story ?? '',
    slide: { position: input.words.position, kind: input.slot.kind, headline: input.words.headline, body: input.words.body, request: input.requests.map((r) => `${r.request.kind}: ${r.request.query}`).join(' / ') },
    photos_already_in_post: state.picked,
    candidates: shortlist.map(({ s }) => ({ source: s.cand.lane, subject: s.cand.subject, title: s.cand.title, tags: s.tags?.tags ?? [] })),
  };
  try {
    const scores = await PhotoSlide.photoSlideScores(jev, state_, `${input.words.headline.slice(0, 60)} #${input.words.position}`);
    shortlist.forEach(({ s }, k) => out.set(s.cand.url, scores[k]!));
    steps.push(`slide check ${PhotoSlide.VERSION}: ${shortlist.map(({ s }, k) => `${s.cand.lane} "${s.cand.title.slice(0, 30)}" fit ${scores[k]!.fit.toFixed(2)} repeat ${scores[k]!.repeat.toFixed(2)} best ${scores[k]!.best.toFixed(2)}`).join('; ')}`);
  } catch (err) {
    steps.push(`slide check ${PhotoSlide.VERSION}: error (${err instanceof Error ? err.message : String(err)}) → not gated`);
  }
  return out;
}
