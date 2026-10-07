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
 */
import type { VisualRequest } from '@/lib/social/writer/draft';

import type { Candidate, ChainStep, PhotoDeps } from './find';
import { flagged, type TileTag } from './tag-sheet';
import { describeVerdict, type VisionCheck } from './vision';

/** What a slide is: where its photo would go and, on a quote slide, its speaker. */
export type PickSlot = { kind: 'cover' | 'story' | 'stat' | 'quote'; speaker: string | null };

/** One request's candidates, with their tags and fit (null: not tagged or not asked). */
export type Scored = { cand: Candidate; tags: TileTag | null; fit: number | null };

export type PickInput = { slot: PickSlot; requests: Array<{ request: VisualRequest; scored: Scored[] }> };

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
  /** Close-up verdicts by URL and request: one vision call per photo per request per post. */
  closeUps: Map<string, boolean>;
};

export const newPickState = (): PickState => ({ prev: null, usedStock: new Set(), closeUps: new Map() });

/** The close-up check (vision.ts, frozen stock prompt). No vision dep (offline): passes. */
async function closeUp(c: Candidate, request: VisualRequest, vision: VisionCheck | undefined, subjects: string[], state: PickState, steps: string[]): Promise<{ ok: boolean; usd: number }> {
  if (!vision) return { ok: true, usd: 0 };
  const key = `${c.url}|${request.query}`;
  const seen = state.closeUps.get(key);
  if (seen !== undefined) {
    steps.push(`close-up "${c.title.slice(0, 40)}": ${seen ? 'PASS' : 'fail'} (checked earlier in this post)`);
    return { ok: seen, usd: 0 };
  }
  const v = await vision({ url: c.url, scene: request.query, subjects, title: c.title || undefined });
  const ok = v.ok && v.pass;
  steps.push(v.ok ? `close-up "${c.title.slice(0, 40)}": ${describeVerdict(v.verdict)} → ${ok ? 'PASS' : 'fail'} ($${v.costUsd.toFixed(4)})` : `close-up "${c.title.slice(0, 40)}": error (${v.error}) → not used`);
  if (v.ok) state.closeUps.set(key, ok);
  return { ok, usd: v.costUsd };
}

export async function pickForSlide(input: PickInput, state: PickState, deps: Pick<PhotoDeps, 'vision'>, subjects: string[], fitMin: number): Promise<PickOutcome> {
  const steps: string[] = [];
  let visionUsd = 0;
  const passing: Candidate[] = [];
  let winner: { s: Scored; request: VisualRequest } | null = null;
  // A quote slide tries the speaker's verified photo first: it goes in the round speaker spot (the designed look).
  const speakerFirst = (list: Scored[]) => (input.slot.kind === 'quote' && input.slot.speaker ? [...list].sort((x, y) => Number(isSpeaker(y.cand, input.slot)) - Number(isSpeaker(x.cand, input.slot))) : list);
  for (const { request, scored } of input.requests) {
    for (const s of speakerFirst(scored)) {
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
      if (!c.verified && state.usedStock.has(c.url)) {
        steps.push(`${label}: already used in this post`);
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
      // An unverified winner (and any flagged tile) gets the close-up check.
      if (!c.verified || (s.tags && flagged(s.tags))) {
        const r = await closeUp(c, request, deps.vision, subjects, state, steps);
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
  steps.push(`picked ${c.lane}${winner.request === input.requests[0]!.request ? '' : ' (the fallback request)'}: ${c.title.slice(0, 60) || c.url}`);
  return { winner: winner.s, request, via: c.lane, steps, alternates: passing.slice(0, 3), visionUsd };
}
