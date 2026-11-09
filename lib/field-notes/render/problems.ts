/** Typed fit problems. `fitProblemStrings` flattens them for `Post.fitProblems` (string[]). */
export const FIT_PROBLEM_KINDS = [
  'too_long', // text does not fit the slide at the minimum type size (never shrunk below it)
  'out_of_bounds', // an element sits outside the canvas or the safe margins
  'low_contrast', // rendered pixels behind a block fail the contrast rule
  'face_overlap', // cover text touches a face or its clear margin
  'logo_overlap', // anything in the logo's clear space, or the logo clear space is too small
  'no_calm_region', // the photo-swap reason (name kept for its readers): white text unreadable even at the darken cap, or no room off the cover's faces; placementFailed is set and the run swaps the photo
  'forbidden_text', // an exclamation mark or an emoji
  'cover_no_face', // the cover's photo has no detected face (a cover needs one): placementFailed is set so the photo-swap loop retries with a `people` photo
  'cap_exceeded', // retired: the planner no longer checks lengths (the writing gates own them); kept so lib/field-notes/caps.ts still type-checks
  'font_missing', // a brand font did not load, so any fit measured proves nothing
  'logo_missing', // Follow slide has no logo
] as const;
export type FitProblemKind = (typeof FIT_PROBLEM_KINDS)[number];

export type FitProblem = {
  kind: FitProblemKind;
  /** 1-based slide number; 0 until a post-level caller assigns it. */
  slide: number;
  /** Index into the slide's blocks, when the problem is about one block. */
  block?: number;
  message: string;
};

export function fitProblemStrings(problems: FitProblem[]): string[] {
  return problems.map((p) => `slide ${p.slide || '?'} ${p.kind}${p.block !== undefined ? ` (block ${p.block})` : ''}: ${p.message}`);
}
