/**
 * Apple emoji in rendered frames (Tommy, 2026-10-19). Frames render in
 * headless Chromium, and on the Linux worker the only emoji font is Noto,
 * which draws the Android look. So each emoji in a frame's text becomes an
 * image of Apple's own glyph instead.
 *
 * The images are the 160px strike of Apple Color Emoji, extracted on a Mac
 * into `assets/emoji-<code points>.png`. An emoji with no image here stays as
 * text and the font draws it; the copy test fails when a copy emoji has none.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ASSETS = path.join(process.cwd(), 'lib/stories/render/assets');

/** One emoji: a pictograph, its variation selector, and any joined pictographs. */
export const EMOJI_RUN = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*/gu;

/** File key: lower-case hex code points joined by '-', variation selectors dropped. */
export const emojiKey = (emoji: string) =>
  [...emoji]
    .map((c) => c.codePointAt(0)!)
    .filter((cp) => cp !== 0xfe0f)
    .map((cp) => cp.toString(16))
    .join('-');

export const emojiFile = (key: string) => path.join(ASSETS, `emoji-${key}.png`);

const bundled = (): Set<string> =>
  new Set((existsSync(ASSETS) ? readdirSync(ASSETS) : []).map((f) => /^emoji-(.+)\.png$/.exec(f)?.[1]).filter((k): k is string => Boolean(k)));

let keys: Set<string> | null = null;

/** Swap each emoji in the markup's text (never inside a tag) for its Apple image, served from `origin`. */
export function appleEmoji(html: string, origin: string): string {
  keys ??= bundled();
  const have = keys;
  return html.replace(/>([^<]+)</g, (_, text: string) => {
    const swapped = text.replace(EMOJI_RUN, (e) => {
      const key = emojiKey(e);
      return have.has(key) ? `<img class="hm-emoji" src="${origin}/__assets/emoji-${key}.png" alt=""/>` : e;
    });
    return `>${swapped}<`;
  });
}
