/**
 * Caption emoji (Tommy, 2026-10-19, after the per-format comps): at most two
 * per caption, one leading the hook and one after the question or call to
 * action, never in the Helios line, credits, Source line or hashtags. Slides
 * and on-screen copy keep their own no-emoji rules.
 */
export const CAPTION_EMOJI_MAX = 2;

/** One emoji: a pictograph, its variation selector or skin tone, and any joined pictographs. */
const EMOJI_RUN = /\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic}️?)*/gu;

export function countEmoji(text: string): number {
  return text.match(EMOJI_RUN)?.length ?? 0;
}
