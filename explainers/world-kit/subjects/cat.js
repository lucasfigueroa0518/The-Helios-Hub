// A tabby cat, drawn and jointed like the dog. Units: 250 tall standing (feet at 0, ear tips at
// about -266), 30 cm real. Faces right in 'side'; 'front' sits facing the lens.
import { loop, arc, line, taper, mirror, moved } from './path.js';

const stripe = (c, w) => loop(taper(c, w, { tip: 0.6 }));
// ── side
const K = 1.14, HX = 114, HY = -192; // the head is drawn a touch large, like a real cat's reads
const hs = (pts) => pts.map(([x, y, ...r]) => [HX + (x - HX) * K, HY + (y - HY) * K, ...r]);
const BODY = [[112, -198], [70, -188], [16, -183], [-40, -186], [-100, -195], [-140, -188], [-158, -162], [-155, -128], [-134, -106], [-90, -99], [-40, -93], [14, -97], [68, -107], [108, -122], [128, -150], [128, -182]];
const THIGH = moved([[-150, -184], [-186, -160], [-194, -126], [-176, -92], [-148, -76], [-122, -80], [-112, -102], [-118, -136], [-130, -168]], 28, 0);
const SHIN = [[-112, -104], [-86, -98], [-88, -76], [-102, -60], [-114, -44], [-124, -30], [-140, -32], [-142, -46], [-134, -62], [-124, -80], [-124, -96]];
const FOOT = [[-142, -54], [-116, -52], [-113, -32], [-113, -14], [-103, -9], [-90, -5], [-89, 1], [-122, 1], [-135, -6], [-140, -22], [-143, -40]];
const ARM = [[70, -172], [102, -166], [110, -134], [100, -104], [86, -88], [66, -90], [56, -112], [58, -146]];
const FORE = [[62, -110], [92, -112], [96, -80], [94, -44], [95, -18], [106, -11], [113, -4], [107, 1], [72, 1], [64, -8], [66, -32], [64, -62], [60, -92]];
const HEAD = hs([[106, -204], [114, -226], [132, -239], [156, -237], [174, -227], [184, -217], [193, -207], [192, -198], [180, -190], [166, -182], [146, -177], [124, -181], [108, -190]]);
const EAR = hs([[129, -229], [133, -247], [143, -268, 'c'], [155, -251], [164, -233], [148, -226]]);
const EAR_IN = hs([[137, -233], [140, -248], [144, -260, 'c'], [151, -248], [156, -234]]);
const TAIL = taper([[-140, -178], [-172, -167], [-208, -161], [-236, -170], [-253, -194], [-253, -221], [-241, -238]], [12, 11, 10, 9.5, 9, 8, 7]);
const TABBY = [[46, -190, 44], [16, -190, 52], [-12, -192, 40], [-40, -194, 54], [-66, -198, 46], [-92, -200, 50], [-116, -198, 36]];

// ── front (sitting, facing camera)
const F_BODY = [[0, -162], [30, -156], [47, -128], [58, -82], [70, -36], [66, -6], [40, 2], [0, 3], [-41, 2], [-68, -8], [-71, -38], [-60, -84], [-48, -129], [-31, -157]];
const F_HAUNCH = [[30, -84], [62, -94], [82, -62], [84, -24], [72, -1], [42, 2], [28, -26], [24, -58]];
const F_LEG = [[6, -116], [24, -118], [27, -70], [26, -26], [33, -10], [31, 2], [4, 2], [2, -10], [6, -42], [4, -82]];
const F_HEAD = [[0, -215], [26, -212], [47, -198], [58, -177], [53, -157], [37, -143], [17, -135], [0, -133], [-16, -135], [-36, -144], [-52, -158], [-57, -178], [-46, -199], [-25, -212]];
const F_EAR = [[18, -205], [30, -226], [46, -248, 'c'], [55, -225], [56, -194], [38, -198]];
const F_TAIL = taper([[62, -26], [64, -8], [44, 0], [6, -2], [-30, -4], [-52, -12]], [9, 10, 10, 9, 8, 7]);

export const CAT = {
  kind: 'cat', cm: 30, units: 250,
  tones: { coat: 'wood-lit', stripe: 'wood-shade', cream: 'paper-lit', pink: 'red-lit', eye: 'ink' },
  views: {
    side: {
      foot: [-140, 110],
      parts: {
        body: {
          z: 0, fill: 'coat', pivot: [-122, -150], d: loop(BODY),
          marks: [
            ...TABBY.map(([x, y, l], i) => ({ d: stripe([[x, y], [x - 6, y + l * 0.45], [x - 2 - (i % 3) * 3, y + l]], [8 - (i % 2) * 2, 6, 1.2]), fill: 'stripe', opacity: 0.85 })),
            { d: stripe([[-20, -150], [-30, -140], [-36, -128]], [3, 3, 1]), fill: 'stripe', opacity: 0.85 },
            { d: stripe([[-76, -150], [-84, -138], [-86, -126]], [3, 3, 1]), fill: 'stripe', opacity: 0.85 },
            { d: loop([[128, -182], [108, -150], [96, -120], [110, -118], [130, -146]]), fill: 'cream' }, // chest bib
          ],
          shade: 'M-170,-132 C-146,-106 -110,-98 -72,-96 C-30,-90 30,-96 100,-116 L140,-128 L140,-70 L-170,-70 Z',
          lines: ['M118,-152 l9,-3 M114,-138 l9,-1 M110,-126 l8,1', 'M-30,-94 l-3,7 M-4,-96 l-2,7 M20,-98 l-2,7', 'M58,-178 C70,-166 78,-152 82,-138'],
        },
        tail: {
          z: -1, parent: 'body', fill: 'coat', pivot: [-144, -176], d: loop(TAIL), ink: arc(TAIL, 0, TAIL.length - 1),
          marks: [
            ...[[-184, -175], [-218, -170], [-244, -186]].map(([x, y]) => ({ d: stripe([[x, y - 14], [x + 2, y], [x - 2, y + 14]], [3, 4.5, 3]), fill: 'stripe', opacity: 0.85 })),
            { d: loop([[-264, -222], [-254, -244], [-234, -244], [-236, -228], [-248, -214]]), fill: 'stripe', opacity: 0.85 },
          ],
        },
        thighF: { copy: 'thigh', shift: [-14, -2], z: -3, far: true },
        shinF: { copy: 'shin', shift: [-14, -2], parent: 'thighF', z: -3.1, far: true },
        footF: { copy: 'foot', shift: [-14, -2], parent: 'shinF', z: -3.2, far: true },
        armF: { copy: 'arm', shift: [-20, -2], z: -3, far: true },
        forearmF: { copy: 'forearm', shift: [-20, -2], parent: 'armF', z: -3.1, far: true },
        thigh: {
          z: 2, parent: 'body', fill: 'coat', pivot: [-122, -150], d: loop(THIGH), ink: arc(THIGH, 1, 7),
          marks: [{ d: stripe([[-162, -132], [-142, -128], [-122, -126]], [4, 5, 2]), fill: 'stripe', opacity: 0.85 }, { d: stripe([[-160, -110], [-138, -104], [-118, -100]], [4, 5, 2]), fill: 'stripe', opacity: 0.85 }],
          shade: 'M-172,-120 C-160,-96 -138,-80 -112,-76 L-92,-60 L-182,-60 Z',
          lines: ['M-132,-150 C-122,-136 -112,-118 -104,-104'],
        },
        shin: {
          z: 1.9, parent: 'thigh', fill: 'coat', pivot: [-102, -88], d: loop(SHIN), ink: arc(SHIN, 1, 5) + ' ' + arc(SHIN, 6, 10),
          marks: [{ d: stripe([[-132, -66], [-118, -62], [-104, -60]], [3, 4, 2]), fill: 'stripe', opacity: 0.85 }],
        },
        foot: {
          z: 1.8, parent: 'shin', fill: 'coat', pivot: [-130, -42], d: loop(FOOT), ink: arc(FOOT, 1, 0),
          marks: [{ d: loop([[-142, -12], [-112, -14], [-92, -10], [-86, 4], [-142, 4]]), fill: 'cream' }],
          lines: ['M-100,1 l1,-6 M-108,1 l1,-6'],
        },
        arm: {
          z: 3, parent: 'body', fill: 'coat', pivot: [86, -150], d: loop(ARM), ink: arc(ARM, 2, 7),
          shade: 'M48,-124 C54,-104 62,-92 76,-86 L50,-80 Z',
        },
        forearm: {
          z: 3.1, parent: 'arm', fill: 'coat', pivot: [76, -98], d: loop(FORE), ink: arc(FORE, 2, 12),
          marks: [
            { d: loop([[60, -16], [98, -16], [114, -8], [112, 4], [60, 4]]), fill: 'cream' },
            { d: stripe([[62, -66], [78, -64], [96, -66]], [3, 4, 2]), fill: 'stripe', opacity: 0.85 },
            { d: stripe([[62, -44], [78, -42], [95, -44]], [3, 4, 2]), fill: 'stripe', opacity: 0.85 },
          ],
          lines: ['M100,1 l1,-6 M92,1 l1,-6'],
        },
        earF: { copy: 'ear', shift: [-22, 5], z: 4.5, far: true },
        head: {
          z: 5, parent: 'body', fill: 'coat', pivot: [114, -192], d: loop(HEAD), ink: arc(HEAD, 1, 11),
          marks: [
            { d: loop(hs([[168, -206], [186, -211], [196, -200], [186, -188], [166, -181], [152, -186], [158, -198]])), fill: 'cream' }, // muzzle + chin
            { d: loop(hs([[186, -213], [193, -214], [196, -208], [192, -204], [187, -207]])), fill: 'pink', over: true }, // nose
            { d: loop(hs([[151, -213], [157, -218], [165, -219], [170, -215], [164, -211], [156, -210]])), fill: 'eye', over: true },
            { d: stripe(hs([[140, -236], [143, -226], [146, -218]]), [3, 2.5, 1]), fill: 'stripe', opacity: 0.85 },
            { d: stripe(hs([[152, -238], [153, -228], [155, -220]]), [3, 2.5, 1]), fill: 'stripe', opacity: 0.85 },
            { d: stripe(hs([[164, -210], [148, -204], [130, -203]]), [1.5, 2.5, 1.2]), fill: 'stripe', opacity: 0.85 }, // cheek line
          ],
          shade: 'M100,-196 C118,-178 144,-170 176,-176 L180,-160 L96,-160 Z',
          lines: [line(hs([[192, -203], [189, -196], [180, -192]])), { d: [line(hs([[178, -199], [196, -203], [216, -213]])), line(hs([[178, -196], [198, -196], [218, -192]])), line(hs([[177, -193], [192, -189], [208, -180]]))].join(' '), w: 0.55 }, 'M118,-186 l-5,7 M132,-180 l-3,7'],
        },
        ear: {
          z: 6, parent: 'head', fill: 'coat', pivot: [146, -236], d: loop(EAR), ink: arc(EAR, 0, 4),
          marks: [{ d: loop(EAR_IN), fill: 'pink' }],
          lines: [line(hs([[144, -246], [142, -236]])), line(hs([[149, -244], [150, -235]]))],
        },
      },
      poses: {
        rest: {},
        // sitting: the body swings up about the hip until the rump is on the floor, the hind leg
        // folds flat (thigh forward, shin back, foot forward), the front legs stand straight
        sit: { _root: { dy: 119 }, body: -40, thigh: -30, shin: 117, foot: -142, thighF: -30, shinF: 117, footF: -142, arm: 40, forearm: { sy: 1.1 }, armF: 40, forearmF: { sy: 1.1 }, head: 30, tail: 30 },
        stretch: { body: 14, arm: -62, forearm: -24, armF: -56, forearmF: -26, head: -18, thigh: -16, shin: 2, foot: 2, thighF: -14, shinF: 2, footF: 2, tail: -18 },
        walk: { arm: -14, forearm: 18, armF: 16, forearmF: -6, thigh: 16, shin: -8, foot: -6, thighF: -18, shinF: 10, footF: 8, tail: -6, head: 4 },
      },
    },
    // facing camera, sitting: the view for a cat that looks at us
    front: {
      foot: [-84, 84],
      parts: {
        tail: {
          z: 3, fill: 'coat', pivot: [60, -20], d: loop(F_TAIL), ink: arc(F_TAIL, 0, F_TAIL.length - 1),
          marks: [...[[30, -2], [-6, -2], [-38, -8]].map(([x, y]) => ({ d: stripe([[x, y - 12], [x - 1, y], [x + 1, y + 12]], [3, 4.5, 3]), fill: 'stripe', opacity: 0.85 }))],
        },
        body: {
          z: 0, fill: 'coat', pivot: [0, -40], d: loop(F_BODY),
          marks: [
            { d: loop([[0, -158], [20, -148], [24, -112], [12, -84], [0, -76], [-12, -86], [-24, -114], [-19, -148]]), fill: 'cream' },
            ...[[-50, -120], [-58, -90], [46, -120], [54, -92]].map(([x, y]) => ({ d: stripe([[x + (x < 0 ? -10 : 10), y - 4], [x, y], [x + (x < 0 ? 8 : -8), y + 6]], [4, 4, 1.5]), fill: 'stripe', opacity: 0.85 })),
          ],
          shade: 'M-80,-120 C-66,-80 -60,-40 -50,0 L-90,10 L-90,-120 Z M-40,-10 C0,-2 40,-4 70,-14 L80,10 L-80,10 Z',
          lines: ['M-8,-104 l-3,8 M8,-104 l3,8 M0,-94 l0,8'],
        },
        haunch: {
          z: 1, fill: 'coat', pivot: [50, -50], d: loop(F_HAUNCH), ink: arc(F_HAUNCH, 1, 7),
          marks: [{ d: stripe([[78, -70], [64, -66], [50, -62]], [4, 4, 1.5]), fill: 'stripe', opacity: 0.85 }, { d: stripe([[82, -48], [68, -44], [52, -40]], [4, 4, 1.5]), fill: 'stripe', opacity: 0.85 }, { d: loop([[44, -12], [70, -14], [80, -4], [74, 4], [44, 4]]), fill: 'cream' }],
          shade: 'M60,-20 C70,-10 80,-4 90,-2 L90,10 L30,10 Z',
        },
        haunchL: {
          z: 1, fill: 'coat', pivot: [-50, -50], d: loop(mirror(F_HAUNCH, 1.5)), ink: arc(mirror(F_HAUNCH, 1.5), 0, 6),
          marks: [{ d: stripe([[-80, -70], [-64, -66], [-50, -62]], [4, 4, 1.5]), fill: 'stripe', opacity: 0.85 }, { d: loop(mirror([[44, -12], [70, -14], [80, -4], [74, 4], [44, 4]])), fill: 'cream' }],
          shade: 'M-90,-80 C-80,-40 -70,-10 -40,0 L-40,10 L-90,10 Z',
        },
        leg: {
          z: 2, fill: 'coat', pivot: [15, -112], d: loop(F_LEG), ink: arc(F_LEG, 1, 9),
          marks: [{ d: loop([[0, -18], [30, -18], [36, -6], [32, 4], [0, 4]]), fill: 'cream' }, { d: stripe([[4, -70], [15, -68], [27, -70]], [2.5, 3.5, 1.5]), fill: 'stripe', opacity: 0.85 }],
          lines: ['M12,2 l0,-6 M21,2 l0,-6'],
        },
        legL: {
          z: 2, fill: 'coat', pivot: [-15, -112], d: loop(mirror(F_LEG, 1)), ink: arc(mirror(F_LEG, 1), 0, 8),
          marks: [{ d: loop(mirror([[0, -18], [30, -18], [36, -6], [32, 4], [0, 4]])), fill: 'cream' }, { d: stripe([[-4, -70], [-15, -68], [-27, -70]], [2.5, 3.5, 1.5]), fill: 'stripe', opacity: 0.85 }],
          lines: ['M-12,2 l0,-6 M-21,2 l0,-6'],
          shade: 'M-40,-120 C-30,-80 -30,-40 -34,0 L-40,10 Z',
        },
        ear: {
          z: 4, parent: 'head', fill: 'coat', pivot: [36, -205], d: loop(F_EAR), ink: arc(F_EAR, 0, 4),
          marks: [{ d: loop([[28, -210], [36, -226], [45, -240, 'c'], [49, -222], [48, -204]]), fill: 'pink' }],
        },
        earL: {
          z: 4, parent: 'head', fill: 'coat', pivot: [-36, -205], d: loop(mirror(F_EAR, 1)), ink: arc(mirror(F_EAR, 1), 1, 5),
          marks: [{ d: loop(mirror([[28, -210], [36, -226], [45, -240, 'c'], [49, -222], [48, -204]])), fill: 'pink' }],
        },
        head: {
          z: 5, fill: 'coat', pivot: [0, -150], d: loop(F_HEAD),
          marks: [
            { d: loop([[0, -166], [15, -162], [24, -150], [12, -138], [0, -135], [-12, -138], [-24, -150], [-15, -162]]), fill: 'cream' },
            { d: loop([[-7, -167], [7, -167], [3, -160], [0, -158, 'c'], [-3, -160]]), fill: 'pink', over: true },
            { d: loop([[12, -181], [17, -187], [24, -188], [29, -185], [24, -180], [17, -179]]), fill: 'eye', over: true },
            { d: loop([[-12, -181], [-17, -187], [-24, -188], [-29, -185], [-24, -180], [-17, -179]]), fill: 'eye', over: true },
            ...[[-8, -212], [0, -213], [8, -212]].map(([x, y]) => ({ d: stripe([[x, y], [x * 1.2, y + 10], [x * 1.3, y + 18]], [3, 2.5, 1]), fill: 'stripe', opacity: 0.85 })),
          ],
          shade: 'M-60,-170 C-50,-150 -30,-138 0,-134 C20,-134 40,-142 56,-160 L60,-120 L-60,-120 Z',
          lines: ['M0,-158 L0,-152 C-3,-147 -9,-147 -12,-151 M0,-152 C3,-147 9,-147 12,-151', { d: 'M16,-154 C30,-158 44,-160 58,-160 M16,-151 C30,-150 44,-148 56,-144 M-16,-154 C-30,-158 -44,-160 -58,-160 M-16,-151 C-30,-150 -44,-148 -56,-144', w: 0.55 }, 'M50,-166 l7,2 M-50,-166 l-7,2'],
        },
      },
      poses: {
        rest: {},
        tilt: { head: -14, ear: -8 },
        paw: { leg: { r: -14, dy: -42 }, head: 8 },
      },
    },
  },
};
