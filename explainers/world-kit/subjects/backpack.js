// A backpack (sewn, so drawn). Rigid: no joints. Front view: a plump padded body with a domed top,
// a zip arching over the top, a lit front pocket with its own zip, a grab handle on top and a
// shoulder strap looping out at one side. Units: 200 tall (base at 0), 42 cm real.
import { loop, ribbon, smooth } from './path.js';

const BODY = loop([[-62, -2, 'c'], [-70, -40], [-72, -96], [-68, -136], [-50, -164], [0, -176], [50, -164], [68, -136], [72, -96], [70, -40], [62, -2, 'c'], [0, 1]]);
const POCKET = loop([[-48, -10, 'c'], [-52, -50], [-48, -82], [-30, -94], [30, -94], [48, -82], [52, -50], [48, -10, 'c'], [0, -6]]);
/** A zip: a thin dark band along a centre line. */
const zip = (pts) => ribbon(pts, 4, 4).d;
const ZIP = zip([[-58, -100], [-56, -136], [-38, -158], [0, -166], [38, -158], [56, -136], [58, -100]]);
const POCKET_ZIP = zip([[-40, -82], [-20, -86], [20, -86], [40, -82]]);
const pull = (x, y) => loop([[x - 3, y], [x + 3, y], [x + 4, y + 10], [x + 2, y + 14], [x - 2, y + 14], [x - 4, y + 10]]);
// the grab handle: an arch whose feet sink into the top
const HANDLE = smooth([[-20, -164], [-18, -186], [0, -194], [18, -186], [20, -164], [13, -164], [12, -180], [0, -186], [-12, -180], [-13, -164]], true);
// the shoulder strap behind the body, bulging out past its right side
const STRAP = ribbon([[50, -158], [80, -136], [90, -90], [82, -44], [60, -24]], 16, 14).d;

export const BACKPACK = {
  kind: 'backpack', cm: 42, units: 200,
  tones: { body: 'slate', pocket: 'slate-lit', trim: 'slate-dark', pull: 'mustard' },
  views: {
    front: {
      foot: [-60, 60],
      parts: {
        strap: { z: -1, fill: 'trim', pivot: [60, -150], d: STRAP },
        handle: { z: -1, fill: 'trim', pivot: [0, -170], d: HANDLE },
        body: {
          z: 0, fill: 'body', pivot: [0, -88], d: BODY,
          marks: [{ d: ZIP, fill: 'trim' }, { d: pull(-58, -102), fill: 'pull', over: true }],
          shade: 'M34,-190 C56,-140 60,-70 50,0 L90,0 L90,-190 Z',
        },
        pocket: {
          z: 1, fill: 'pocket', pivot: [0, -50], d: POCKET,
          marks: [{ d: POCKET_ZIP, fill: 'trim' }, { d: pull(-40, -84), fill: 'pull', over: true }],
          shade: 'M26,-100 C40,-70 42,-40 36,0 L60,0 L60,-100 Z',
        },
      },
      poses: { rest: {} },
    },
  },
};
