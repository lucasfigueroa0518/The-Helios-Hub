// A tree (grown, so drawn). Front view: a plump round canopy of soft scallops in the leaf ramp (a lit
// upper left, a darker lower right) on a short wooden trunk that flares at the roots and the crown. The canopy
// turns about the top of the trunk, so 'sway' (t) rocks it. Units: 320 tall (roots at 0), 5 m real.
import { loop, smooth } from './path.js';

const r1 = (v) => Math.round(v * 10) / 10;
/** A scalloped round: n bumps around (cx, cy), radii rx, ry, the lower half flattened a little. */
function crown(cx, cy, rx, ry, n, phase = 0) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + phase + (i * Math.PI) / n;
    const k = i % 2 ? 0.9 : 1;
    const sy = Math.sin(a) > 0 ? 0.88 : 1;
    pts.push([r1(cx + Math.cos(a) * rx * k), r1(cy + Math.sin(a) * ry * k * sy)]);
  }
  return smooth(pts, true);
}

const CY = -206;
const CANOPY = crown(0, CY, 128, 110, 8);
const LIT = crown(-30, CY - 28, 80, 66, 6, 0.3);
// the shade: the canopy's lower right, outside an oval nudged up and left (opposite windings cut it)
const SHADE = `M-140,-340 L140,-340 L140,-80 L-140,-80 Z M-134,${CY - 18} A114,104 0 1 0 98,${CY - 18} A114,104 0 1 0 -134,${CY - 18} Z`;
const TRUNK = loop([[-34, 0, 'c'], [-20, -12], [-16, -44], [-16, -100], [-30, -140], [-10, -150], [10, -150], [30, -140], [16, -100], [16, -44], [20, -12], [34, 0, 'c'], [0, 3]]);

export const TREE = {
  kind: 'tree', cm: 500, units: 320,
  tones: { canopy: 'leaf', lit: 'leaf-lit', bark: 'wood' },
  views: {
    front: {
      foot: [-56, 56],
      parts: {
        trunk: { z: 0, fill: 'bark', pivot: [0, 0], d: TRUNK, shade: 'M4,-170 C10,-110 8,-40 18,4 L44,4 L44,-170 Z' },
        canopy: { z: 1, fill: 'canopy', pivot: [0, -140], d: CANOPY, marks: [{ d: LIT, fill: 'lit' }], shade: SHADE },
      },
      poses: {
        rest: {},
        sway: (t) => ({ canopy: 2.5 * Math.sin(2 * Math.PI * t) }),
      },
    },
  },
};
