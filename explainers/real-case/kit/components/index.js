// The AI News Explained news kit (N4c-1). Frames import from here:
//   import * as nk from '../kit/components/index.js';
export { installKit, h, place, marked, markOf, filler, esc } from './dom.js';
export { board, whiteboard, newspaper, filmGrain, WHITEBOARD_FRAMING } from './scenes.js';
export {
  clipping, article, pullQuote, printout, notice, indexCard, evidenceTag, polaroid, cutout, logoPrint, silhouette,
  dictionaryClipping, tape, stamp, caseFolder,
} from './evidence.js';
export { pushPin, cord, magnet } from './fasteners.js';
export { inkLayer, boxIn, markerCircle, markerUnderline, markerArrow, markerCross, markerNote, markerDrawing, highlight, done } from './marks.js';
export { cameraRig, rackFocus } from './camera.js';
export { COLORS } from './style.js';
export * as geo from '../geometry.js';

import { arrive, pinPress, magnetSlap, tagSwing } from '../geometry.js';

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
