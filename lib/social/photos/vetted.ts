/**
 * Vetted photos (photo bank, DECISIONS_LOG D49): what a finder run learned
 * about each candidate, as pure data, for the photo bank to keep. Nothing
 * here changes what the finder picks.
 *
 *   picked     the slide's winner
 *   passed     a runner-up that passed every check (pick.ts alternates), or
 *              a candidate whose tags fit and whose close-up check passed
 *              but that another slide had already taken
 *   verified   an identity-verified headshot, second photo, CEO,
 *              headquarters or logo, picked or not
 *   rejected   failed the tag fit (photo-fit@1) or the close-up check
 *              (negative knowledge: recorded, never stored)
 *
 * Raw search hits that no check looked at are not vetted and not returned.
 *
 * The vision recorder wraps the vision check so the close-up verdicts
 * (pick.ts) and the official-image text check (sources/article.ts) are seen
 * without editing either file: same input, same result, kept by
 * `url|scene`.
 */
import type { VisualRequest } from '@/lib/social/writer/draft';

import type { Candidate, Lane } from './find';
import type { TileTag } from './tag-sheet';
import type { VisionCheck, VisionVerdict } from './vision';

export type VettedOutcome = 'picked' | 'passed' | 'verified' | 'rejected';

/** A recorded vision answer: `pass` is the close-up rule (passesVision); `scene` what it was asked about. */
export type RecordedVision = { scene: string; pass: boolean; verdict: VisionVerdict | null; error?: string };

export type VettedPhoto = {
  /** Render position: 1 = the cover, k + 1 = story slide k (the numbering social.used_photos uses). */
  slide: number;
  request: VisualRequest;
  outcome: VettedOutcome;
  /** A copy of the candidate as the finder saw it (URL, credit, lane, identity, size, faces, plate). */
  candidate: Candidate;
  /** Contact-sheet tags (Haiku), when the tile was tagged. */
  tileTags: string[] | null;
  /** The tag fit score for this request (Jev photo-fit@1), when asked. */
  fit: number | null;
  /** The close-up verdict for this request, else any recorded verdict for the URL (e.g. the official-image check). */
  vision: RecordedVision | null;
  /** Why a rejected candidate was rejected. */
  reason?: string;
};

/** Lanes whose candidates are identity-verified: kept even when not picked. */
export const IDENTITY_LANES = new Set<Lane>(['headshot', 'second', 'ceo', 'hq', 'logo']);

export type VisionRecorder = {
  /** The wrapped check; undefined when there is no vision check (offline runs keep their behavior). */
  vision: VisionCheck | undefined;
  /** Verdicts by `url|scene`. */
  verdicts: Map<string, RecordedVision>;
};

export function recordVision(vision: VisionCheck | undefined): VisionRecorder {
  const verdicts = new Map<string, RecordedVision>();
  if (!vision) return { vision: undefined, verdicts };
  const wrapped: VisionCheck = async (input) => {
    const r = await vision(input);
    try {
      verdicts.set(`${input.url}|${input.scene}`, r.ok ? { scene: input.scene, pass: r.pass, verdict: r.verdict } : { scene: input.scene, pass: false, verdict: null, error: r.error });
    } catch {
      // Recording never changes the check's result.
    }
    return r;
  };
  return { vision: wrapped, verdicts };
}

const copy = (c: Candidate): Candidate => ({ ...c, ...(c.faces ? { faces: c.faces.map((f) => ({ ...f })) } : {}) });

/** Any recorded verdict for a URL (the first one), when none was asked for this request. */
function anyVerdict(url: string, verdicts: Map<string, RecordedVision>): RecordedVision | null {
  for (const [key, v] of verdicts) if (key.startsWith(`${url}|`)) return v;
  return null;
}

/**
 * One slide's vetted candidates. `requests` are the slide's searches in
 * order (the visual, then its fallback), with the very Candidate objects the
 * pick saw, so the winner and the alternates are matched by identity (the
 * same URL under both requests is two sightings).
 */
export function vettedForSlide(input: {
  slide: number;
  requests: Array<{ request: VisualRequest; candidates: Candidate[] }>;
  winner: Candidate | null;
  alternates: Candidate[];
  tagsByUrl: Map<string, TileTag>;
  fitByKey: Map<string, number>;
  verdicts: Map<string, RecordedVision>;
  fitMin: number;
}): VettedPhoto[] {
  const out: VettedPhoto[] = [];
  for (const { request, candidates } of input.requests) {
    for (const c of candidates) {
      const key = `${c.url}|${request.query}`;
      const fit = input.fitByKey.get(key) ?? null;
      const closeUp = input.verdicts.get(key) ?? null;
      let outcome: VettedOutcome | null = null;
      let reason: string | undefined;
      if (c === input.winner) outcome = 'picked';
      else if (input.alternates.includes(c)) outcome = 'passed';
      else if (c.verified && IDENTITY_LANES.has(c.lane)) outcome = 'verified';
      else if (!c.verified && fit !== null && fit < input.fitMin) {
        outcome = 'rejected';
        reason = `tags don't fit "${request.query}" (${fit.toFixed(2)})`;
      } else if (closeUp && !closeUp.pass) {
        outcome = 'rejected';
        reason = closeUp.error ? `close-up check error: ${closeUp.error}` : 'failed the close-up check';
      } else if (closeUp?.pass) outcome = 'passed';
      if (!outcome) continue;
      out.push({
        slide: input.slide,
        request: { ...request },
        outcome,
        candidate: copy(c),
        tileTags: input.tagsByUrl.get(c.url)?.tags.slice() ?? null,
        fit,
        vision: closeUp ?? anyVerdict(c.url, input.verdicts),
        ...(reason ? { reason } : {}),
      });
    }
  }
  return out;
}
