// A croissant (baked, so drawn). Rigid: one part, no joints, two states (whole, bitten). Units: 84
// tall (base at 0), 6 cm real; about 2.6x wider than tall. Side view: the long side faces camera; the rolled bands wrap round the body
// and the two thin horns curl down onto the plate, so the underside arches between them.
import { loop, line, taper } from './path.js';

// the outline, left horn tip round the top to the right horn tip, then the arched underside
const TOP_L = [[-106, 0, 'c'], [-112, -10], [-104, -22], [-90, -30], [-76, -32, 'c'], [-66, -46], [-50, -58], [-34, -60, 'c'], [-22, -74], [0, -82], [22, -76], [32, -61, 'c'], [48, -60], [64, -50], [74, -34, 'c'], [88, -32], [102, -24], [110, -12]];
const UNDER = [[106, 0, 'c'], [94, -6], [72, -10], [44, -2], [0, 5], [-44, -2], [-72, -10], [-94, -6]];
const WHOLE = [...TOP_L, ...UNDER];
// bitten: the right horn and half the next band are gone; the edge follows the teeth
const BITTEN = [...TOP_L.slice(0, 11), [32, -61, 'c'], [40, -60], [44, -54, 'c'], [42, -44], [50, -38, 'c'], [50, -28], [58, -22, 'c'], [56, -12], [62, -4, 'c'], [44, -2], [0, 5], [-44, -2], [-72, -10], [-94, -6]];
const CRUMB = [[32, -61], [40, -60], [44, -54, 'c'], [42, -44], [50, -38, 'c'], [50, -28], [58, -22, 'c'], [56, -12], [62, -4, 'c'], [46, -2], [38, -16], [34, -36], [28, -52]];
const crumbs = [
  [[78, -2, 'c'], [82, -7], [88, -6, 'c'], [90, -1], [86, 2, 'c'], [80, 2]],
  [[98, -1, 'c'], [101, -5], [105, -4, 'c'], [106, 0], [103, 2, 'c'], [99, 2]],
  [[70, -12, 'c'], [74, -16], [78, -14, 'c'], [78, -10], [75, -8, 'c'], [71, -9]],
];
// the band seams wrap round the body: from each notch on top they sweep down and in
const SEAM_PATHS = [
  line([[-76, -32], [-74, -18], [-66, -6]]),
  line([[-34, -60], [-34, -36], [-26, -14], [-16, 0]]),
  line([[32, -61], [32, -36], [24, -14], [14, 1]]),
  line([[74, -34], [72, -20], [64, -8]]),
];
// the seams carry the rolled bands, so they show in the flat style too (a darker crust line)
const SEAMS = SEAM_PATHS.map((d) => ({ d, w: 1.6, color: 'bake', flat: true }));
const LAYERS = { d: 'M-16,-70 C-6,-74 8,-74 18,-70 M-22,-56 C-8,-62 10,-62 22,-56 M-60,-46 C-54,-50 -46,-52 -40,-50 M-58,-34 C-52,-38 -46,-40 -40,-38 M46,-50 C52,-52 58,-50 64,-44 M-100,-18 c4,-4 8,-5 14,-6 M90,-24 c4,0 8,2 10,6', w: 0.8 };
const LAYERS_B = { d: 'M-16,-70 C-6,-74 8,-74 18,-70 M-22,-56 C-8,-62 10,-62 22,-56 M-60,-46 C-54,-50 -46,-52 -40,-50 M-58,-34 C-52,-38 -46,-40 -40,-38 M-100,-18 c4,-4 8,-5 14,-6', w: 0.8 };
const HORN_L = loop([[-114, -4], [-104, -24], [-86, -32], [-80, -16], [-88, -4], [-108, 4]]);
const HORN_R = loop([[114, -4], [104, -24], [86, -32], [80, -16], [88, -4], [108, 4]]);
const GLAZE = [
  loop([[-18, -74], [-2, -80], [18, -76], [12, -70], [-4, -72], [-14, -68]]),
  loop([[-60, -48], [-48, -56], [-40, -54], [-46, -48], [-56, -44]]),
  loop([[44, -56], [56, -56], [64, -48], [56, -46], [48, -48]]),
];

export const CROISSANT = {
  kind: 'croissant', cm: 6, units: 84,
  tones: { crust: 'mustard', bake: 'mustard-shade', glaze: 'mustard-lit', crumb: 'paper-lit' },
  views: {
    side: {
      foot: [-100, 100],
      parts: {
        crumbs: { z: 1, fill: 'bake', hide: true, pivot: [90, 0], d: crumbs.map((c) => loop(c)).join(' '), weight: 0.6 },
        bun: {
          z: 0, fill: 'crust', pivot: [0, -40], d: loop(WHOLE),
          marks: [{ d: HORN_L, fill: 'bake' }, { d: HORN_R, fill: 'bake' }, ...GLAZE.map((d) => ({ d, fill: 'glaze' }))],
          shade: 'M-120,-10 C-90,-4 -60,-10 -40,-6 C-10,-2 20,-4 40,-6 C70,-12 100,-4 120,-10 L120,12 L-120,12 Z',
          lines: [...SEAMS, LAYERS],
        },
      },
      states: {
        whole: {},
        bitten: {
          crumbs: { hide: false },
          bun: {
            d: loop(BITTEN),
            marks: [{ d: HORN_L, fill: 'bake' }, GLAZE.slice(0, 2).map((d) => ({ d, fill: 'glaze' })), { d: loop(CRUMB), fill: 'crumb' }].flat(),
            lines: [
              ...SEAMS.slice(0, 2), LAYERS_B,
              { d: 'M38,-50 C42,-40 44,-28 46,-14 M44,-44 C48,-34 52,-24 54,-12 M34,-40 C36,-30 38,-20 40,-8', w: 0.7, color: 'bake' }, // pulled layers
              { d: 'M40,-30 l1,0 M48,-22 l1,0 M44,-8 l1,0 M38,-46 l1,0', w: 1.6, color: 'bake' }, // air holes
            ],
          },
        },
      },
      poses: { rest: {} },
    },
  },
};
