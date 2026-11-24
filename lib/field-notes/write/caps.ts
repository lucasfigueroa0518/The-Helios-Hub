/**
 * Field Notes copy caps: the single source for every length the Writer is told,
 * the Editor cuts to, and the gates check. The render owner reads this file; do
 * not copy the numbers anywhere else.
 *
 * Lengths are characters (spaces included) per field, plus word caps on the two
 * fields the slide shows. A field over its cap by up to OVERRUN_HARD_RATIO is a
 * note on the review screen; over by more than that is a hard gate (the render
 * cannot fit it without breaking the layout).
 *
 * One tip per slide (PLAN 2026-11-06, "copy shape for the general public"): the slide
 * shows `headline` (the value the reader gets) and `body` (what it is, in plain words);
 * `name` and `tryIt` go to the caption's how-to-try lines. The cover and the Follow
 * slide are written by code.
 */

export const TIP_SLIDE_CAPS = {
  /** Headline characters: the value line. The Writer aims for about TIP_HEADLINE_TARGET_CHARS; this is the cap. */
  headline: 70,
  /** Headline words: "about 8 words at most". */
  headlineWords: 8,
  /** Body characters (about TIP_BODY_TARGET_WORDS words): what the thing is, in plain words, naming it once. */
  body: 210,
  /** Body words; the Writer aims for about TIP_BODY_TARGET_WORDS. */
  bodyWords: 40,
  /** The thing's real name, as the source gives it (caption only). */
  name: 40,
  /** How to try it, verbatim from the source, or empty (caption only, so it may run longer). */
  tryIt: 240,
} as const;

/** The Writer is asked to keep the headline to about this many characters (the cap above is the ceiling). */
export const TIP_HEADLINE_TARGET_CHARS = 60;

/** The Writer is asked to aim for about this many words in the body. */
export const TIP_BODY_TARGET_WORDS = 30;

/** Characters in the Writer's own caption text (before code adds the how-to-try lines, the follow line and hashtags). */
export const WRITER_CAPTION_CAP = 300;

/** Characters in the assembled caption: Instagram's limit. Over it after the hashtags are dropped is a hard gate. */
export const CAPTION_CAP = 2200;

/** Over a cap by more than this share (0.5 = 50 percent) is a hard gate. */
export const OVERRUN_HARD_RATIO = 0.5;

/** The cover's fixed, code-written headline; the model never writes it. */
export const coverHeadline = (n: number): string => `${n} AI tips to try`;

/**
 * The cover's rotating hooks (Tommy, 2026-11-08: "we don't want the '5 AI tips to try' to be the same line every
 * time"; picked from a list of options). `{n}` is the post's tip count. A hook is never repeated within
 * COVER_HOOK_GAP posts (Tommy: "a hook can't be repeated unless it's 4 posts apart").
 */
export const COVER_HOOKS = [
  '{n} AI hacks we\'ve seen this week',
  '{n} AI tricks worth stealing',
  '{n} AI finds worth saving',
  '{n} AI moves to make today',
  '{n} AI finds from this week\'s feed',
] as const;
export const COVER_HOOK_GAP = 4;

/** The hook template a cover headline was made from, or null (an older cover such as `N AI tips to try`). */
export function coverHookOf(headline: string): string | null {
  const t = headline.trim().replace(/^\d+/, '{n}');
  return COVER_HOOKS.find((h) => h === t) ?? null;
}

/**
 * The next cover headline: the first hook in bank order (starting after the most recent one used) that was not
 * used on any of the last COVER_HOOK_GAP - 1 posts. `recentCovers` are cover headlines, newest first.
 */
export function pickCoverHeadline(n: number, recentCovers: readonly string[]): string {
  const recent = recentCovers.slice(0, COVER_HOOK_GAP - 1).map(coverHookOf);
  const last = recent.find((h): h is string => !!h);
  const start = last ? (COVER_HOOKS.indexOf(last as (typeof COVER_HOOKS)[number]) + 1) % COVER_HOOKS.length : 0;
  for (let i = 0; i < COVER_HOOKS.length; i++) {
    const hook = COVER_HOOKS[(start + i) % COVER_HOOKS.length]!;
    if (!recent.includes(hook)) return hook.replace('{n}', String(n));
  }
  return COVER_HOOKS[start]!.replace('{n}', String(n));
}

/** Largest scraped-text excerpt sent to the model per tip, in characters. */
export const UNTRUSTED_EXCERPT_CAP = 6000;
