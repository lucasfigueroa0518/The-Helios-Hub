// Objects drawn new for flat frames (propFrom(NEW_PROPS, name, x, y, { s, state })): base centre at
// (0, 0), y up is negative, px at s = 1. The same looks as the world's lens-drawn things.
import { T, el, g, softShape, shadow } from '../../draw.js';

const rr = (x, y, w, h, r) => `M ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + r} Q ${x} ${y + h} ${x} ${y + h - r} V ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;

/** The one USB plug with a lilac tip, lying flat, its tip pointing right. */
function usbPlug({ state }) {
  const lit = state === 'lit';
  return [
    shadow(0, -2, 110, 14, 0.14),
    softShape(rr(-110, -62, 150, 60, 16), T['paper-shade'], { gloss: true }),
    el('rect', { x: -40, y: -62, width: 14, height: 60, fill: T.lilac }),
    softShape(rr(40, -52, 70, 40, 6), lit ? T['lilac-lit'] : T.lilac, { gloss: true }),
    el('rect', { x: 60, y: -42, width: 12, height: 8, rx: 2, fill: T['lilac-dark'] }),
    el('rect', { x: 84, y: -42, width: 12, height: 8, rx: 2, fill: T['lilac-dark'] }),
  ];
}

/** The teal gadget camera: boxy body, big round lens, yellow shutter. */
function camera({ state }) {
  const on = state === 'on';
  return [
    shadow(0, -2, 130, 18, 0.16),
    softShape(rr(-40, -196, 70, 30, 10), T['teal-shade']),
    softShape(rr(-120, -176, 240, 172, 34), T.teal, { gloss: true }),
    softShape(rr(-92, -192, 40, 22, 8), T.yellow, { gloss: true }),
    el('circle', { cx: 0, cy: -88, r: 66, fill: T['teal-dark'] }),
    el('circle', { cx: 0, cy: -88, r: 56, fill: T['ink-lit'] }),
    el('circle', { cx: 0, cy: -88, r: 38, fill: T['blue-dark'] }),
    el('circle', { cx: 0, cy: -88, r: 18, fill: T['ink-dark'] }),
    el('ellipse', { cx: 18, cy: -106, rx: 12, ry: 8, fill: T['paper-lit'], opacity: 0.85 }),
    el('circle', { cx: 92, cy: -146, r: 8, fill: on ? T['yellow-lit'] : T['yellow-shade'] }),
  ];
}

/** A teal desk calendar page: rings, a header band, a grid of days; `socket` adds the lilac
 *  connector on its right side; `booked` also fills Friday 3:00 with a green meeting block. */
function calendar({ state }) {
  const socket = state === 'socket' || state === 'booked';
  const out = [
    shadow(0, -2, 220, 22, 0.16),
    softShape(rr(-200, -400, 400, 398, 36), T.teal, { gloss: false }),
    softShape(rr(-176, -330, 352, 306, 18), T['paper-lit']),
  ];
  for (let i = 0; i < 4; i++) out.push(softShape(rr(-138 + i * 84, -424, 24, 52, 12), T['ink-lit'], { gloss: true }));
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      out.push(el('rect', { x: -160 + c * 66, y: -312 + r * 70, width: 56, height: 58, rx: 8, fill: T['paper-sweep'] }));
    }
  }
  if (state === 'booked') out.push(softShape(rr(-160 + 4 * 66, -312 + 2 * 70, 56, 58, 8), T.green, { gloss: true }));
  if (socket) {
    out.push(softShape(rr(196, -232, 44, 96, 12), T['lilac-shade'], { gloss: true }));
    out.push(el('rect', { x: 210, y: -212, width: 16, height: 56, rx: 4, fill: T['lilac-dark'] }));
  }
  return [g({}, out.join(''))];
}

export const NEW_PROPS = {
  'usb plug with lilac tip': {
    tags: {
      is: 'the one standard rectangular plug, grey body and lilac metal tip, lying flat',
      setting: 'a desk, a glass studio',
      material: 'plastic and metal',
      parts: ['body', 'lilac stripe', 'lilac tip', 'contacts'],
      not: ['a round plug', 'a cable knot', 'orange'],
    },
    size: [220, 64],
    states: ['rest', 'lit'],
    draw: usbPlug,
  },
  'teal gadget camera': {
    tags: {
      is: 'a small boxy teal gadget camera with a round lens, seen from the front',
      setting: 'a desk',
      material: 'plastic and glass',
      parts: ['body', 'viewfinder hump', 'shutter', 'lens', 'status light'],
      not: ['a face', 'a phone', 'orange'],
    },
    size: [240, 196],
    states: ['off', 'on'],
    draw: camera,
  },
  'teal calendar page': {
    tags: {
      is: 'a teal desk calendar with a grid of days, optionally a lilac connector socket on its right side',
      setting: 'a glass studio',
      material: 'paper and plastic',
      parts: ['rings', 'teal back', 'page', 'day grid', 'lilac socket', 'meeting block'],
      not: ['a face', 'text', 'orange'],
    },
    size: [520, 457],
    states: ['plain', 'socket', 'booked'],
    draw: calendar,
  },
};
