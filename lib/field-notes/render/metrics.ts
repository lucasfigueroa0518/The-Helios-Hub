/**
 * Advance widths (em) of printable ASCII (codes 32 to 126) measured once in Chromium at 100px,
 * so layout can size a text block offline without a browser. The render check measures the real
 * text afterwards; this table only has to be close and slightly generous.
 * Heading: Pragmatica Extended Bold. Body: Roboto Regular (400; the brand sets social body at 400).
 * Hand (Hershey Sans) widths come from the glyph data itself (handwrite.ts).
 */
export const HEADING_ADVANCE_EM: readonly number[] = [0.233, 0.407, 0.544, 0.755, 0.755, 1.096, 0.826, 0.294, 0.454, 0.454, 0.531, 0.641, 0.396, 0.569, 0.396, 0.532, 0.755, 0.755, 0.755, 0.755, 0.755, 0.755, 0.755, 0.755, 0.755, 0.755, 0.396, 0.402, 0.679, 0.629, 0.679, 0.701, 1.059, 0.79, 0.823, 0.846, 0.853, 0.748, 0.699, 0.894, 0.854, 0.338, 0.673, 0.81, 0.656, 1.075, 0.87, 0.919, 0.778, 0.919, 0.821, 0.767, 0.699, 0.832, 0.745, 1.097, 0.799, 0.755, 0.731, 0.467, 0.532, 0.467, 0.567, 0.559, 0.365, 0.708, 0.737, 0.69, 0.739, 0.721, 0.443, 0.724, 0.709, 0.302, 0.31, 0.652, 0.302, 1.071, 0.709, 0.74, 0.735, 0.737, 0.472, 0.625, 0.438, 0.706, 0.598, 0.893, 0.655, 0.599, 0.575, 0.431, 0.516, 0.431, 0.717];
export const BODY_ADVANCE_EM: readonly number[] = [0.248,0.258,0.32,0.616,0.562,0.732,0.622,0.175,0.342,0.348,0.431,0.567,0.197,0.276,0.264,0.413,0.562,0.562,0.562,0.562,0.562,0.562,0.562,0.562,0.562,0.562,0.242,0.211,0.508,0.549,0.523,0.473,0.898,0.652,0.623,0.651,0.656,0.568,0.553,0.681,0.713,0.272,0.552,0.627,0.539,0.873,0.713,0.688,0.631,0.688,0.616,0.594,0.597,0.648,0.637,0.887,0.627,0.601,0.599,0.265,0.411,0.265,0.418,0.451,0.309,0.544,0.562,0.523,0.564,0.53,0.348,0.562,0.551,0.243,0.239,0.507,0.243,0.877,0.552,0.57,0.562,0.568,0.339,0.516,0.327,0.551,0.484,0.751,0.496,0.473,0.496,0.338,0.244,0.338,0.68];
const HEADING_FALLBACK_EM = 0.8;
const BODY_FALLBACK_EM = 0.6;

/** heading: Pragmatica Extended Bold. body: Roboto 400. hand: Hershey Sans pen strokes (never wrapped). */
export type Family = 'heading' | 'body' | 'hand';
export type TextFamily = Exclude<Family, 'hand'>;

/**
 * Advance of one monospace glyph (em) for backticked code in body text, drawn at CODE_SCALE of the body size.
 * The common system monospace faces (Menlo, DejaVu Sans Mono, Consolas) are all about 0.6em; slightly generous.
 */
export const MONO_ADVANCE_EM = 0.62;
/** Code in body text is set a little smaller than the body so its x-height sits with Roboto's. */
export const CODE_SCALE = 0.9;

/**
 * Width in px of one line of text, kerning ignored, plus letter spacing (em). In body text a backtick toggles
 * code (monospace at CODE_SCALE) and is not drawn; `startInCode` says a code span opened on an earlier line.
 */
export function textWidthPx(text: string, fontPx: number, family: TextFamily, trackingEm = 0, startInCode = false): number {
  const table = family === 'heading' ? HEADING_ADVANCE_EM : BODY_ADVANCE_EM;
  const fallback = family === 'heading' ? HEADING_FALLBACK_EM : BODY_FALLBACK_EM;
  let em = 0;
  let code = startInCode;
  for (const ch of text) {
    if (family === 'body' && ch === '`') { code = !code; continue; }
    if (code) { em += MONO_ADVANCE_EM * CODE_SCALE; continue; }
    const cp = ch.codePointAt(0)!;
    em += cp >= 32 && cp <= 126 ? table[cp - 32]! : fallback;
    em += trackingEm;
  }
  return em * fontPx;
}

const backticks = (s: string): number => (s.match(/`/g) ?? []).length;

/** Greedy word wrap with a small safety margin (browser wrapping may differ by a few pixels). */
export function wrapLines(text: string, fontPx: number, family: TextFamily, maxWidthPx: number, trackingEm = 0): string[] {
  const limit = maxWidthPx * 0.97;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let inCode = false;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidthPx(next, fontPx, family, trackingEm, inCode) > limit) {
      lines.push(line);
      if (family === 'body' && backticks(line) % 2 === 1) inCode = !inCode;
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
