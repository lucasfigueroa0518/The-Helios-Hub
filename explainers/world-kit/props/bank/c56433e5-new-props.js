// The ER triage scene's own new drawings (EX3-114): every object drawn new for this reel, each about
// its own base center like the bank's assets, each with full tags so it can join the bank.

import { el, g, T, shadow, TONES, box, face, shape, mark, shade, accentFill } from '../../props/kit.js';
import { handwrite } from '../../draw.js';

const rect = (x, y, w, h, fill, sw = 3.5, rx = 4) => el('rect', { x, y, width: w, height: h, rx, fill, stroke: T.ink, 'stroke-width': sw });

export const NEW_PROPS = {
  'small steel tweezers': {
    tags: {
      is: 'a pair of small steel tweezers: two thin springy prongs joined at one end and pinched to a pointed tip at the other',
      setting: ['hospital', 'first-aid room', 'medical tray', 'bathroom cabinet'],
      material: 'polished steel',
      parts: ['two thin prongs', 'joined spring end', 'pinched pointed tip', 'grip ridges near the base'],
      not: ['scissors', 'pliers', 'chopsticks', 'forceps with finger rings', 'kitchen tongs', 'scalpel'],
    },
    size: [40, 130],
    states: ['default'],
    // Held with its base at the hand, pointing up; the accent is the grip band.
    draw: ({ focal }) => {
      const left = 'M 0 6 Q -15 -8 -14 -46 Q -13 -92 -2 -124 L 1.5 -124 Q -6 -92 -7 -46 Q -7 -12 0 -2 Z';
      const right = 'M 0 6 Q 15 -8 14 -46 Q 13 -92 2 -124 L -1.5 -124 Q 6 -92 7 -46 Q 7 -12 0 -2 Z';
      return [
        shape(left, T['paper-shade'], 2.5),
        shape(right, T['paper-lit'], 2.5),
        shade(right, { from: 0, to: 0.3 }),
        el('rect', { x: -14, y: -26, width: 28, height: 9, rx: 3, fill: accentFill(focal, T.ink), stroke: T.ink, 'stroke-width': 2 }),
        mark('M -13 -34 L -8 -34 M -13 -41 L -8 -41 M 13 -34 L 8 -34 M 13 -41 L 8 -41', 2, 0.7),
        mark('M -3 -100 L -1 -114', 1.8, 0.5),
      ];
    },
  },

  'wooden splinter': {
    tags: {
      is: 'a thin pale sliver of wood with one needle-sharp point and one jagged, broken end',
      setting: ['first aid', 'carpentry', 'playground', 'hospital'],
      material: 'raw pale wood',
      parts: ['long thin sliver', 'sharp pointed tip', 'jagged broken end', 'faint grain lines'],
      not: ['toothpick', 'matchstick', 'nail', 'pencil', 'needle', 'twig'],
    },
    size: [30, 110],
    states: ['default'],
    // Lying along its own axis: jagged end at the base, the point straight up.
    draw: () => {
      const d = 'M -8 0 L -5 7 L -2 -1 L 2 8 L 5 0 L 8 6 L 5 -62 L 0 -104 L -5 -60 Z';
      return [
        shape(d, T['paper-shade'], 3),
        shade(d, { from: 0, to: 0.35 }),
        mark('M -2 -8 L -1 -58 M 2 -14 L 2 -50', 2, 0.45),
      ];
    },
  },

  'chest-pain speech bubble': {
    tags: {
      is: 'a speech bubble with a downward tail holding an ink heart flanked by short zigzag pain marks; in its crossed state a red status cross lies over it',
      setting: ['hospital', 'cartoon dialogue', 'medical explainer'],
      material: 'flat paper, ink print',
      parts: ['rounded bubble', 'downward tail', 'ink heart', 'four zigzag pain marks', 'red cross when crossed'],
      not: ['thought bubble', 'cloud', 'love heart sticker', 'chat message', 'warning sign', 'text bubble with words'],
    },
    size: [170, 150],
    states: ['default', 'crossed'],
    // Origin: the tip of the tail, which points at the speaker's head.
    draw: ({ state }) => {
      const heart = 'M 0 -76 C -34 -98 -30 -126 -14 -126 C -6 -126 0 -120 0 -113 C 0 -120 6 -126 14 -126 C 30 -126 34 -98 0 -76 Z';
      const parts = [
        el('path', { d: 'M -18 -52 L 0 -6 L 20 -52 Z', fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3.5, 'stroke-linejoin': 'round' }),
        rect(-76, -152, 152, 102, T['paper-lit'], 3.5, 28),
        el('rect', { x: -14, y: -54, width: 32, height: 8, fill: T['paper-lit'] }),
        el('path', { d: heart, fill: T.ink }),
        mark('M -60 -122 L -50 -112 L -60 -104 L -50 -94', 3.5),
        mark('M -48 -134 L -40 -126 L -48 -120', 3),
        mark('M 60 -122 L 50 -112 L 60 -104 L 50 -94', 3.5),
        mark('M 48 -134 L 40 -126 L 48 -120', 3),
      ];
      if (state === 'crossed') {
        const x = 'M -34 -128 L 34 -72 M 34 -128 L -34 -72';
        parts.push(el('path', { d: x, fill: 'none', stroke: T.ink, 'stroke-width': 20, 'stroke-linecap': 'round' }));
        parts.push(el('path', { d: x, fill: 'none', stroke: T['status-error'], 'stroke-width': 13, 'stroke-linecap': 'round' }));
      }
      return parts;
    },
  },

  'hospital emergency-room double door': {
    tags: {
      is: 'a pair of hospital emergency-room swing doors in a dark frame, each leaf with a round porthole window and a push plate, under a small "ER" plaque',
      setting: ['hospital emergency department', 'hospital corridor'],
      material: 'painted wood leaves in a dark frame',
      parts: ['two door leaves', 'round porthole windows', 'push plates', 'kick plates', 'dark frame', 'ER plaque on top'],
      not: ['front door of a house', 'elevator door', 'saloon door', 'fridge', 'garage door', 'single office door'],
    },
    size: [324, 295],
    states: ['default'],
    draw: () => {
      const W = 200;
      const D = 16;
      const H = 190;
      const leaf = (u) => [
        rect(u, 0, 96, H, T['paper-lit']),
        el('circle', { cx: u + 48, cy: 52, r: 22, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 4 }),
        mark(`M ${u + 36} 48 Q ${u + 40} 38 ${u + 50} 36`, 2.5, 0.45),
        rect(u + 32, 104, 32, 18, T['paper-shade'], 3, 5),
        rect(u, H - 36, 96, 36, T['paper-shade'], 3, 3),
      ];
      return [
        shadow(0, 8, 132, 36),
        box(-W / 2 - 10, -D / 2, 0, W + 20, D, H + 10, TONES.ink),
        face('front', -W / 2, D / 2, H, [...leaf(2), ...leaf(102), mark(`M ${W / 2} 0 L ${W / 2} ${H}`, 3.5)]),
        box(-44, -6, H + 10, 88, 12, 40, TONES.paper),
        face('front', -44, 6, H + 50, [handwrite('ER', 44, 29, 24, 1, { align: 'center', weight: 1.5 })]),
      ];
    },
  },

  'cardiologist consulting-room door': {
    tags: {
      is: 'a single wooden consulting-room door in a dark frame with two raised panels, a lever handle, three hinges and a small nameplate bearing an ink heart',
      setting: ['hospital corridor', 'doctor\'s clinic', 'hospital department'],
      material: 'painted wood in a dark frame',
      parts: ['one door leaf', 'two raised panels', 'lever handle', 'three hinges', 'heart nameplate'],
      not: ['emergency-room double door', 'front door of a house', 'wardrobe', 'elevator door', 'cell door'],
    },
    size: [110, 230],
    states: ['default'],
    draw: () => {
      const W = 86;
      const D = 14;
      const H = 190;
      const heart = 'M 42 58 C 28 49 32 39 38 39 C 41 39 42 42 42 43 C 42 42 43 39 46 39 C 52 39 56 49 42 58 Z';
      return [
        shadow(0, 8, 76, 26),
        box(-W / 2 - 9, -D / 2, 0, W + 18, D, H + 9, TONES.ink),
        face('front', -W / 2, D / 2, H, [
          rect(0, 0, W, H, T['paper-lit']),
          rect(10, 74, 66, 40, 'none', 2.5, 3),
          rect(10, 126, 66, 54, 'none', 2.5, 3),
          rect(22, 14, 42, 38, T['paper-shade'], 3, 4),
          el('path', { d: heart, fill: T.ink, transform: 'translate(0 -2)' }),
          el('circle', { cx: 72, cy: 110, r: 6, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 2.5 }),
          mark('M 72 110 L 52 110', 5),
          rect(-2, 28, 7, 20, T.ink, 2, 2),
          rect(-2, 96, 7, 20, T.ink, 2, 2),
          rect(-2, 154, 7, 20, T.ink, 2, 2),
        ]),
      ];
    },
  },
};
