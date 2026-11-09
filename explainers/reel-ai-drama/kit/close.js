// The brand close (MD-143): the last frame, the same in every reel, built by code. AI Brain Break's close
// with this series' wordmark: a white screen, the Helios logo scales in, "Reel AI Drama" writes itself
// beneath it in the print handwriting, the two centred on the screen together. The comment question is
// spoken and captioned over it, in ink: the block sits below the caption band (y 260–560). The project's
// close module is one line written by frames.mjs. Sounds and the crossfade in: close-timing.js.
import { CLOSE } from './close-timing.js';
import { HERSHEY_CAP, HERSHEY_SANS } from './hershey-sans.js';
import { clamp, seg } from './geometry.js';

export const TREATMENT = 'close';
export const GROUND = '#FFFFFF';
/** The words under the logo. */
export const WORDMARK = 'Reel AI Drama';
const INK = '#1F1915';
/** The wordmark's width on screen, and the gap between the logo and its cap line. */
const WORD_W = 640;
const GAP = 70;

/** Width of `text` in px at cap height `size`, in Hershey Sans. Pure. */
export function handwriteWidth(text, size) {
  const k = size / HERSHEY_CAP;
  return [...String(text)].reduce((w, ch) => w + (HERSHEY_SANS[ch] ?? HERSHEY_SANS[' ']).a * k, 0);
}

/**
 * The strokes that write `text` centred on x with its baseline at y, in writing order: { d, length }. `size`
 * is the cap height in px. Pure (world-kit draw.js's handwrite, as paths drawn by their length).
 */
export function handwriteStrokes(text, x, y, size) {
  const k = size / HERSHEY_CAP;
  let cursor = x - handwriteWidth(text, size) / 2;
  const out = [];
  for (const ch of String(text)) {
    const glyph = HERSHEY_SANS[ch] ?? HERSHEY_SANS[' '];
    for (const s of glyph.s) {
      const pts = s.map(([gx, gy]) => [cursor + gx * k, y - gy * k]);
      const length = pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
      out.push({ d: `M ${pts.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(' L ')}`, length });
    }
    cursor += glyph.a * k;
  }
  return out;
}

/** The wordmark's cap height: it fills WORD_W, up to world-kit's 84px. */
export const WORD_SIZE = Math.min(84, WORD_W / Math.max(1, handwriteWidth(WORDMARK, 1)));
/** The logo, about 40% of the screen wide. The logo and the words together are centred on the screen. */
const LOGO_W = 440;
/** Helios-logo.png's transparent margin above the circle, as a share of its width (measured). */
const LOGO_PAD = 0.0205;
const WEIGHT = 1.25;
const INK_BELOW = (WORD_SIZE * 0.08 * WEIGHT) / 2;
const BLOCK_H = LOGO_W * (1 - LOGO_PAD) + GAP + WORD_SIZE + INK_BELOW;
const BLOCK_TOP = 960 - BLOCK_H / 2;
export const LOGO = { cx: 540, cy: BLOCK_TOP - LOGO_W * LOGO_PAD + LOGO_W / 2, w: LOGO_W };
/** The words' baseline. */
export const WORD_BASELINE = BLOCK_TOP + BLOCK_H - INK_BELOW;
/** The top of what the eye sees: below the caption band. */
export const BLOCK = { x: 540 - WORD_W / 2, y: BLOCK_TOP };

/** Overshoots past 1 and settles once (the logo's scale). */
const backOut = (u) => { const x = clamp(u) - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; };

let draw = null;

export default {
  treatment: TREATMENT,
  build(root, ctx) {
    const { nk } = ctx;
    const doc = root.ownerDocument;
    const el = nk.h(doc, 'div', { class: 'rd rd-close', style: { background: GROUND } });
    const { cx, cy, w } = LOGO;
    const logo = nk.h(doc, 'img', { class: 'abs', src: `${ctx.assets}kit/Helios-logo.png`, alt: '', 'data-role': 'logo', style: { left: `${cx - w / 2}px`, top: `${cy - w / 2}px`, width: `${w}px`, height: `${w}px` } });
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('width', '1080');
    svg.setAttribute('height', '1920');
    svg.setAttribute('data-role', 'wordmark');
    svg.setAttribute('data-set', '');
    svg.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible');
    const strokes = handwriteStrokes(WORDMARK, cx, WORD_BASELINE, WORD_SIZE).map((s) => {
      const path = doc.createElementNS(NS, 'path');
      for (const [k, v] of Object.entries({ d: s.d, fill: 'none', stroke: INK, 'stroke-width': (WORD_SIZE * 0.08 * WEIGHT).toFixed(2), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(k, v);
      svg.append(path);
      return { path, length: s.length };
    });
    const total = strokes.reduce((n, s) => n + s.length, 0);
    el.append(logo, svg);
    root.append(el);
    draw = (t) => {
      const [a, b] = CLOSE.logoIn;
      const s = 0.55 + 0.45 * backOut(seg(t, a, b));
      logo.style.opacity = seg(t, a, a + 0.12).toFixed(3);
      logo.style.transform = `scale(${s.toFixed(4)})`;
      let budget = seg(t, CLOSE.write[0], CLOSE.write[1]) * total;
      for (const k of strokes) {
        // The stroke being written is cut where the pen is now; a dot of zero length shows once reached.
        const part = Math.min(budget, k.length);
        k.path.style.strokeDasharray = `${part.toFixed(2)} ${(k.length + 10).toFixed(2)}`;
        k.path.style.opacity = budget > 0 ? '1' : '0';
        budget -= k.length;
      }
    };
    draw(0);
  },
  render(t) {
    draw?.(t);
  },
};
