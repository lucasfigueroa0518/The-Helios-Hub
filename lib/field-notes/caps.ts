/**
 * The ONE caps adapter. The writing owner's `write/caps.ts` is the single source for every length;
 * the render owner's `render/caps.ts` is interim and its layout still flags `cap_exceeded` against
 * it. Everything in this folder that needs a length reads it from here, and the render's interim
 * cap problems are dropped (`isSupersededRenderCap`): what the layout can really not fit is
 * reported as `too_long` (text that does not fit its region at the minimum type size), which stays.
 *
 * To retire the interim file: render/layout.ts `capProblems` should call `capFor` from this
 * adapter or be removed (listed in EXPORTS.md).
 */
import type { FitProblem } from './render/problems';
import { CAPTION_CAP, OVERRUN_HARD_RATIO, TIP_SLIDE_CAPS } from './write/caps';

export const FIELD_NOTES_CAPS = { tipSlide: TIP_SLIDE_CAPS, caption: CAPTION_CAP, overrunHardRatio: OVERRUN_HARD_RATIO } as const;

/** The layout's own interim length check: superseded by the writing caps and the fit check. */
export function isSupersededRenderCap(problem: Pick<FitProblem, 'kind'>): boolean {
  return problem.kind === 'cap_exceeded';
}
