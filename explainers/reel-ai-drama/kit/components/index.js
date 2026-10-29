// The Reel AI Drama kit (forked from the AI News Explained news kit). Frames import from here:
//   import * as nk from '../kit/components/index.js';
// The full-screen treatments (photo, cutout_lift, …) are in treatments.js; the news kit's scenes and
// evidence stay for the board, whiteboard and newspaper tools (MD-03). FRAME.md documents all of it.
export { installKit, h, place, marked, markOf, filler, esc, settleImages, plate } from './dom.js';
export { board, whiteboard, newspaper, filmGrain, WHITEBOARD_FRAMING, setting, tableau, collage, drawn, expressionMarks } from './scenes.js';
export { SETTINGS, EXPRESSIONS, COLLAGE_LAYERS, SEED_CATALOG } from '../settings/index.js';
export {
  clipping, article, pullQuote, printout, notice, indexCard, evidenceTag, polaroid, cutout, logoPrint, silhouette,
  dictionaryClipping, tape, stamp, caseFolder,
} from './evidence.js';
export { pushPin, cord, magnet } from './fasteners.js';
export { inkLayer, boxIn, markerCircle, markerUnderline, markerArrow, markerCross, markerNote, markerDrawing, highlight, done } from './marks.js';
export { cameraRig, rackFocus } from './camera.js';
export { COLORS, HELIOS } from './style.js';
export {
  photo, cutoutLift, collision, page, documentSheet, post, map, headline, lowerThird, number, scene, grain, credit,
  GRADES, SHADES,
} from './treatments.js';
export * as tg from '../treatment-geometry.js';
export * as geo from '../geometry.js';

import { arrive, pinPress, magnetSlap, tagSwing } from '../geometry.js';
import { TREATMENT_BUILDERS as BASE_BUILDERS } from './treatments.js';
import { tableau as tableauBuilder, collage as collageBuilder } from './scenes.js';

/** The treatment builders by storyboard name (FRAME.md), the composed shots included. */
export const TREATMENT_BUILDERS = { ...BASE_BUILDERS, tableau: tableauBuilder, collage: collageBuilder };

const rest = (el) => Number(el.dataset.rot || 0);
/** Physical arrivals applied to an element on top of its resting rotation (render(t) helpers). */
export const motion = {
  /** Slapped/placed from an offset: lift before contact, 1–3px settle after. */
  arrive(el, u, opts) {
    const m = arrive(u, opts);
    el.style.visibility = m.visible ? '' : 'hidden';
    el.style.transform = `translate(${m.x.toFixed(2)}px, ${m.y.toFixed(2)}px) rotate(${(rest(el) + m.rot).toFixed(3)}deg) scale(${m.scale.toFixed(4)})`;
  },
  pin(el, u) {
    const m = pinPress(u);
    el.style.visibility = m.visible ? '' : 'hidden';
    el.style.transform = `scale(${m.scale.toFixed(4)})`;
  },
  magnet(el, u) {
    const m = magnetSlap(u);
    el.style.visibility = m.visible ? '' : 'hidden';
    el.style.transform = `rotate(${rest(el)}deg) scale(${m.scale.toFixed(4)})`;
  },
  swing(el, u) {
    el.style.transform = `rotate(${(rest(el) + tagSwing(u)).toFixed(3)}deg)`;
  },
};
