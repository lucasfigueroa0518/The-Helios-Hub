// A piggy bank (moulded ceramic, so drawn). Rigid: no joints. Side view, snout to the right: a plump
// egg body on four stubby legs, a turned-up snout with its flat face showing, two floppy ears, a
// curly tail and the coin slot along the back. No eye (an object never gets a face). Units: 140
// tall (feet at 0), 16 cm real.
import { loop, ribbon } from './path.js';

const BODY = loop([[-88, -70], [-80, -98], [-56, -118], [-18, -126], [24, -122], [58, -108], [80, -86], [88, -62], [80, -38], [58, -22], [16, -16], [-30, -18], [-64, -28], [-84, -46]]);
const LEG = loop([[-12, -36], [12, -36], [13, -14], [12, -3, 'c'], [6, 0], [-6, 0], [-12, -3, 'c'], [-13, -14]]);
const legAt = (dx) => LEG.replace(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g, (_, x, y) => `${Math.round((+x + dx) * 10) / 10},${y}`);
const SNOUT = loop([[74, -82], [92, -84], [104, -78], [106, -62], [104, -46], [92, -40], [74, -42]]);
const SNOUT_FACE = loop([[98, -80], [104, -76], [107, -62], [104, -46], [98, -43], [94, -52], [93, -62], [94, -72]]);
const NOSTRILS = loop([[99, -70], [102, -68], [102, -63], [99, -62], [97, -66]]) + ' ' + loop([[99, -57], [102, -55], [102, -50], [99, -49], [97, -53]]);
const EAR = loop([[32, -112], [36, -134], [48, -148], [62, -150, 'c'], [66, -136], [62, -118], [54, -108]]);
const TAIL = ribbon([[-82, -80], [-96, -84], [-106, -94], [-104, -106], [-94, -108], [-90, -98], [-98, -93]], 6, 4);
const SLOT = loop([[-34, -112], [-14, -118], [8, -118], [10, -114], [-12, -113], [-33, -108]]);

export const PIGGY_BANK = {
  kind: 'piggy bank', cm: 16, units: 140,
  tones: { body: 'red-lit', face: 'red', nostril: 'red-dark', slot: 'ink-lit' },
  views: {
    side: {
      foot: [-64, 56],
      parts: {
        farEar: { z: -2, fill: 'body', far: true, pivot: [44, -114], d: EAR.replace(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g, (_, x, y) => `${Math.round((+x - 24) * 10) / 10},${Math.round((+y + 4) * 10) / 10}`) },
        farLegs: { z: -2, fill: 'body', far: true, pivot: [0, -30], d: `${legAt(-40)} ${legAt(50)}` },
        tail: { z: -1, fill: 'body', pivot: [-84, -80], d: TAIL.d },
        legs: { z: -1, fill: 'body', pivot: [0, -30], d: `${legAt(-52)} ${legAt(36)}` },
        body: {
          z: 0, fill: 'body', pivot: [0, -70], d: BODY,
          marks: [{ d: SLOT, fill: 'slot' }],
          shade: 'M-100,-48 C-60,-30 20,-28 100,-52 L100,10 L-100,10 Z',
        },
        snout: { z: 1, fill: 'body', pivot: [90, -62], d: SNOUT, marks: [{ d: SNOUT_FACE, fill: 'face' }, { d: NOSTRILS, fill: 'nostril' }], shade: 'M60,-50 C80,-46 96,-48 120,-56 L120,-30 L60,-30 Z' },
        ear: { z: 2, fill: 'body', pivot: [44, -114], d: EAR, shade: 'M50,-110 C58,-122 60,-136 60,-152 L80,-152 L80,-100 L50,-100 Z' },
      },
      poses: { rest: {} },
    },
  },
};
