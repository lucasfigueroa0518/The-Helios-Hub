// A bird (a pigeon), drawn. Units: 215 tall standing (toes at 0, crown at about -206), 24 cm
// real. Faces right in 'side'.
// The wing is jointed at the shoulder. A folded wing and a raised wing are different drawings,
// so raising it is a STATE ('up') that swaps the drawing, plus a pose that turns it (flap).
import { loop, arc, line, taper } from './path.js';

const band = (c, w) => loop(taper(c, w, { tip: 0.5 }));
const BODY = [[46, -150], [14, -131], [-36, -121], [-86, -107], [-128, -91], [-162, -80, 'c'], [-166, -62, 'c'], [-124, -56], [-84, -42], [-40, -30], [0, -29], [38, -45], [62, -77], [67, -110], [58, -138]];
const HEAD = [[30, -118], [34, -150], [47, -176], [60, -194], [78, -205], [94, -201], [104, -191], [112, -187], [121, -182, 'c'], [106, -178], [98, -172], [86, -164], [78, -146], [73, -122], [56, -108]];
const WING = [[44, -122], [10, -128], [-40, -120], [-94, -104], [-152, -84, 'c'], [-112, -72], [-64, -62], [-14, -58], [26, -66], [47, -86], [52, -107]];
const WING_UP = [[46, -120], [52, -158], [46, -198], [32, -230], [14, -256], [2, -268], [-8, -254, 'c'], [-18, -264], [-28, -248, 'c'], [-40, -254], [-48, -236, 'c'], [-62, -238], [-66, -220, 'c'], [-80, -218], [-80, -202, 'c'], [-94, -194], [-90, -180, 'c'], [-102, -168], [-90, -150], [-60, -132], [-20, -119]];
const LEG = [[-6, -38], [5, -38], [6, -14], [16, -7], [29, -3], [31, 1], [12, 1], [-2, 1], [-15, 1], [-17, -3], [-7, -7], [-7, -16]];

export const PIGEON = {
  kind: 'pigeon', cm: 24, units: 215,
  tones: { plume: 'slate-lit', hood: 'slate', bar: 'slate-dark', sheen: 'teal', sheen2: 'green-lit', foot: 'red-lit', beak: 'ink-lit', cere: 'paper-lit', eye: 'ink' },
  views: {
    side: {
      foot: [-30, 40],
      parts: {
        legF: { copy: 'leg', shift: [-16, -2], z: -3, far: true },
        wingUpF: { copy: 'wingUp', shift: [-26, -12], z: -2, far: true, parent: 'body' },
        body: {
          z: 0, fill: 'plume', pivot: [0, -34], d: loop(BODY),
          marks: [
            { d: loop([[-136, -90], [-166, -80, 'c'], [-170, -60, 'c'], [-140, -58], [-144, -74]]), fill: 'bar' }, // dark tail band
            { d: loop([[62, -112], [66, -84], [52, -58], [36, -72], [44, -100]]), fill: 'sheen2', opacity: 0.55 }, // breast sheen
          ],
          shade: 'M-150,-62 C-100,-50 -40,-36 0,-34 C30,-36 52,-50 66,-70 L80,-20 L-170,-20 Z',
          lines: ['M-120,-62 l-10,-4 M-100,-54 l-10,-4', 'M40,-50 c-4,6 -10,8 -16,8 M20,-40 c-4,5 -10,6 -15,6'],
        },
        leg: {
          z: 1, fill: 'foot', pivot: [0, -32], d: loop(LEG), ink: arc(LEG, 1, 11),
          lines: ['M14,-3 l3,-3 M-12,-1 l-2,-3', 'M-1,-26 l5,0 M-1,-20 l6,0'],
        },
        head: {
          z: 4, parent: 'body', fill: 'hood', pivot: [44, -124], d: loop(HEAD), ink: arc(HEAD, 1, 13),
          marks: [
            { d: loop([[38, -150], [60, -144], [76, -130], [72, -112], [50, -110], [34, -124]]), fill: 'sheen' },
            { d: loop([[40, -170], [60, -162], [78, -148], [68, -141], [48, -149], [36, -158]]), fill: 'sheen2', opacity: 0.85 },
            { d: loop([[103, -192], [112, -187], [121, -182, 'c'], [106, -178], [100, -183]]), fill: 'beak' },
            { d: loop([[100, -194], [107, -194], [110, -189], [104, -187], [99, -189]]), fill: 'cere', over: true },
            { d: 'M84,-192 C84,-196 90,-197 91,-192 C91,-188 85,-187 84,-192 Z', fill: 'eye', over: true },
          ],
          shade: 'M30,-130 C46,-118 60,-112 74,-114 L80,-100 L30,-100 Z',
          lines: ['M104,-183 l12,0', 'M52,-170 c4,4 10,4 14,2'],
        },
        wing: {
          z: 2, parent: 'body', fill: 'plume', pivot: [30, -110], d: loop(WING), ink: arc(WING, 1, 10),
          marks: [
            { d: loop([[-78, -108], [-152, -84, 'c'], [-112, -72], [-74, -68], [-88, -88]]), fill: 'hood' }, // primaries
            { d: band([[-20, -118], [-27, -92], [-36, -63]], [4, 6, 4]), fill: 'bar' },
            { d: band([[-46, -114], [-54, -90], [-62, -64]], [4, 6, 4]), fill: 'bar' },
          ],
          shade: 'M-150,-80 C-100,-70 -40,-60 30,-66 L40,-40 L-160,-40 Z',
          lines: ['M-90,-98 C-104,-92 -120,-86 -136,-82', 'M-96,-86 C-108,-82 -118,-78 -128,-76', 'M8,-112 c4,6 12,7 18,2 M-6,-100 c4,6 12,7 18,2 M12,-92 c4,6 12,7 18,2'],
        },
        wingUp: {
          z: 2, parent: 'body', fill: 'plume', pivot: [36, -118], hide: true, d: loop(WING_UP), ink: arc(WING_UP, 0, 19),
          marks: [
            { d: loop([[40, -196], [30, -230], [14, -256], [2, -268], [-18, -264], [-40, -254], [-62, -238], [-80, -218], [-50, -214], [-10, -208]]), fill: 'hood' }, // primaries
            { d: band([[44, -170], [0, -168], [-50, -180], [-86, -196]], [3, 5, 5, 2]), fill: 'bar', opacity: 0.8 },
            { d: band([[44, -146], [0, -142], [-50, -152], [-90, -170]], [3, 5, 5, 2]), fill: 'bar', opacity: 0.8 },
          ],
          shade: 'M-110,-160 C-70,-136 -20,-124 50,-122 L50,-100 L-110,-100 Z',
          lines: ['M20,-236 C10,-244 4,-254 0,-262 M2,-224 C-10,-236 -18,-246 -24,-254 M-16,-218 C-30,-228 -38,-238 -44,-246 M-34,-214 C-48,-220 -58,-226 -66,-232', 'M-56,-198 C-66,-198 -76,-198 -86,-198 M-62,-182 C-74,-180 -84,-178 -96,-176 M-56,-162 C-70,-160 -82,-158 -94,-158'],
        },
      },
      states: { up: { wing: { hide: true }, wingUp: { hide: false }, wingUpF: { hide: false } } },
      poses: {
        rest: {},
        stand: { head: -4 },
        peck: { body: 26, head: 62, wing: -2, leg: -6, legF: -6 },
        flap: { body: -14, head: -8, wingUp: -6, wingUpF: -10, _root: { dy: -10 } },
        flapCycle: (t) => ({ body: -14, head: -8, wingUp: -6 + 34 * Math.sin(t * Math.PI * 2), wingUpF: -10 + 34 * Math.sin(t * Math.PI * 2 - 0.3), _root: { dy: -10 } }),
      },
    },
  },
};
