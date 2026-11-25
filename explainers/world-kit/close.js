// The close (Explainers 3.3, EX3-95): the last frame, the same in every reel, built by code (no
// worker). A white screen; the Helios logo, on the brand's warm halo, animates in and "AI 101" writes itself beneath
// it in the kit's print handwriting, the two centred on the screen together. No voice, no
// captions. Its sounds are close-timing.js's CLOSE_EVENTS.
//
// A project's close module is one line, written by mount.mjs:
//   export { default } from '../kit/close.js';

import { T, el, g, scope, handwrite, handwriteWidth } from './draw.js';
import { seg, E } from './motion.js';
import { CLOSE } from './close-timing.js';

export const GROUND = 'white';
/** The words under the logo. */
export const WORDMARK = 'AI 101';
/** The wordmark's width on screen, and the gap between the logo and its cap line. */
const WORD_W = 640;
const GAP = 70;
/** The wordmark's cap height. */
export const WORD_SIZE = Math.min(84, WORD_W / Math.max(1, handwriteWidth(WORDMARK, 1)));
/** The logo, about 40% of the screen wide. The logo and the words together (top of the logo
 *  to the words' baseline: all capitals, nothing below it) are centred on the screen (Lucas,
 *  2026-10-13), so the logo sits above the centre. */
const LOGO_W = 440;
/** Helios-logo.png's transparent margin above the circle, as a share of its width (measured). */
const LOGO_PAD = 0.0205;
/** Half the pen line below the words' baseline (handwrite's stroke, weight 1.25). */
const INK_BELOW = (WORD_SIZE * 0.08 * 1.25) / 2;
/** What the eye sees: from the circle's top to the bottom of the ink. */
const BLOCK_H = LOGO_W * (1 - LOGO_PAD) + GAP + WORD_SIZE + INK_BELOW;
const BLOCK_TOP = 960 - BLOCK_H / 2;
export const LOGO = { cx: 540, cy: BLOCK_TOP - LOGO_W * LOGO_PAD + LOGO_W / 2, w: LOGO_W };
/** The words' baseline. */
export const WORD_BASELINE = BLOCK_TOP + BLOCK_H - INK_BELOW;

/** The halo's outer radius, as a multiple of the circle's. */
export const HALO_R = 1.32;
/**
 * The brand's halo (helios-design-system: "a halo around the whole mark is fine"): a warm sun glow
 * that starts at the circle's edge and fades out. The mark's white HELIOS runs to the circle's edge,
 * so on the white close its H and S read as cut (jobs 87/88, 2026-11-24); on the halo they read whole.
 * Drawn behind the mark, never over it.
 */
export function halo(cx, cy, w) {
  const r = (w / 2) * HALO_R;
  const edge = 1 / HALO_R; // where the circle ends, as a share of the halo's radius
  const stops = [[0, 0.5], [edge * 0.97, 0.5], [edge, 0.45], [edge + (1 - edge) * 0.45, 0.18], [1, 0]]
    .map(([o, op]) => el('stop', { offset: o.toFixed(3), 'stop-color': T.orange, 'stop-opacity': op })).join('');
  return el('defs', {}, el('radialGradient', { id: 'f08-halo', cx: '50%', cy: '50%', r: '50%' }, stops)) + el('circle', { 'data-role': 'halo', cx, cy, r: r.toFixed(1), fill: 'url(#f08-halo)' });
}

export default {
  ground: GROUND,
  shots: [],
  draw(t) {
    scope('f08-', GROUND);
    const [in0, in1] = CLOSE.logoIn;
    const u = seg(t, in0, in1, E.spring);
    const s = 0.55 + 0.45 * u; // spring overshoots past 1 and settles
    const a = seg(t, in0, in0 + 0.12, E.linear);
    const { cx, cy, w } = LOGO;
    const logo = g({ 'data-role': 'logo', opacity: a.toFixed(3), transform: `translate(${cx} ${cy}) scale(${s.toFixed(4)}) translate(${-cx} ${-cy})` }, [halo(cx, cy, w), el('image', { href: 'assets/Helios-logo.png', x: cx - w / 2, y: cy - w / 2, width: w, height: w })].join(''));
    const [w0, w1] = CLOSE.write;
    const words = handwrite(WORDMARK, cx, WORD_BASELINE, WORD_SIZE, seg(t, w0, w1, E.linear), { color: T.ink, align: 'center', weight: 1.25, role: 'wordmark' });
    return [logo, words].join('');
  },
};
