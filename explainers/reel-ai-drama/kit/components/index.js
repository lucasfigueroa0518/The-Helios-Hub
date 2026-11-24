// The Reel AI Drama kit (forked from the AI News Explained news kit). Frames import from here:
//   import * as nk from '../kit/components/index.js';
// The full-screen treatments (photo, cutout_lift, …) are in treatments.js, stat.js and lift.js; anchored
// marks, measured pictures and keep-outs in anchor.js; the news kit's scenes and
// evidence stay for the board, whiteboard and newspaper tools (MD-03); the moves are in moves.js. FRAME.md
// documents all of it.
export { installKit, h, place, marked, markOf, filler, esc, settleImages, plate, canonicalDom } from './dom.js';
export { board, playersBoard, playersLayout, whiteboard, newspaper, frontPage, filmGrain, WHITEBOARD_FRAMING, setting, tableau, collage, drawn, expressionMarks, inkFor, CHALK_FILTER } from './scenes.js';
export { SETTINGS, EXPRESSIONS, COLLAGE_LAYERS, SEED_CATALOG } from '../settings/index.js';
export {
  clipping, article, pullQuote, printout, notice, indexCard, evidenceTag, polaroid, cutout, logoPrint, silhouette,
  dictionaryClipping, tape, stamp, caseFolder,
} from './evidence.js';
export { pushPin, cord, magnet } from './fasteners.js';
export { inkLayer, boxIn, markerCircle, markerUnderline, markerArrow, markerCross, markerNote, markerDrawing, highlight, done, markTarget, linkInk } from './marks.js';
export { cameraRig, rackFocus } from './camera.js';
export { COLORS, HELIOS } from './style.js';
export { matchTone, isMono, isPage, BACKDROP } from './style.js';
export {
  photo, cutoutLift, collision, page, documentSheet, post, map, headline, lowerThird, number, label, lineLabel, dateSize, scene, grain, credit,
  publicCredit, GRADES, SHADES, OVERLAY_DEFAULTS, evidenceKeys, KEEP_MARGIN,
} from './treatments.js';
export { stat, statCues, statBox, statLayout, statFocus, STAT_KINDS, WORLD_BLEED } from './stat.js';
export { flashReveal, phoneShot, clickReveal, burst, speech, cuts, cueAt, drawnLogo, tour } from './moves.js';
export { lift } from './lift.js';
export { stage, stageSpec, placementAt } from './stage.js';
export { compiledFrame, compiledOptions, plainOptions, wordsAt } from './compiled.js';
export { solveStage, solveTimeline, keepOf, pieceKind, isCut, toneIn } from '../stage-layout.js';
export {
  mark, picture, pictureOf, keepClear, regionsOf, findFace, findPhrase, mainPhoto, parseTarget, clearSpot, inkBounds,
  CAPTION_KEEPOUT, OVERLAY, SUBJECT, MARK_TAIL,
} from './anchor.js';
export * as tg from '../treatment-geometry.js';
export * as geo from '../geometry.js';

import { arrive, pinPress, magnetSlap, tagSwing } from '../geometry.js';
import { TREATMENT_BUILDERS as BASE_BUILDERS } from './treatments.js';
import { tableau as tableauBuilder, collage as collageBuilder } from './scenes.js';
import { stat as statBuilder } from './stat.js';
import { lift as liftBuilder } from './lift.js';

/** The treatment builders by storyboard name (FRAME.md), the composed shots included. */
export const TREATMENT_BUILDERS = { ...BASE_BUILDERS, tableau: tableauBuilder, collage: collageBuilder, stat: statBuilder, lift: liftBuilder };

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
