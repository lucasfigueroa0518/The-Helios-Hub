// The hall's own drawings for flat frames (EX3-114): a numbered specialist door (17 and 42, the two
// the story opens) and the round wall clock, in the analogy's flat finish (top lit, front mid, side
// darker; no gloss). Base centre at (0, 0), drawn upward; 2 px per cm.
import { el, T } from '../../draw.js';
import { mixHex } from '../../core.js';

const r = (x, y, w, h, fill, extra = {}) => el('rect', { x, y, width: w, height: h, fill, ...extra });

/** A specialist door 152 × 224 px (76 × 112 cm) with its architrave, number plate and lamp. */
function door(num, state) {
  const W = 152;
  const H = 224;
  const x0 = -W / 2;
  const parts = [];
  parts.push(r(x0 - 12, -H - 12, W + 24, H + 12, T.trim));
  if (state === 'shut') {
    parts.push(r(x0, -H, W, H, T.wood));
    parts.push(r(x0 + 18, -H + 20, W - 36, H - 144, T['wood-lit']));
    parts.push(r(x0 + 18, -108, W - 36, 88, T['wood-lit']));
    parts.push(r(x0 + W - 26, -116, 12, 16, T['mustard-shade'], { rx: 3 }));
  } else {
    const lit = state === 'lit';
    parts.push(r(x0, -H, W, H, lit ? mixHex(T['paper-shade'], T['mustard-lit'], 0.35) : T['paper-shade']));
    parts.push(r(x0, -28, W, 28, T.floor));
    parts.push(r(x0, -H, W, 26, T['paper-dark']));
    // the leaf swung in on its left hinge, seen nearly edge-on
    parts.push(el('polygon', { points: `${x0},${-H} ${x0 + 30},${-H + 18} ${x0 + 30},${-8} ${x0},0`, fill: T['wood-shade'] }));
  }
  // the number plate and the lamp above it
  parts.push(r(-34, -H - 44, 68, 26, T.white, { rx: 4 }));
  parts.push(el('text', { x: 0, y: -H - 23, 'font-family': "'Pragmatica Extended', Roboto, sans-serif", 'font-weight': 700, 'font-size': 20, 'text-anchor': 'middle', fill: T.ink }, String(num)));
  const shade = state === 'lit' ? T['mustard-lit'] : T['paper-dark'];
  parts.push(r(-2, -H - 72, 4, 10, T.ink));
  parts.push(el('polygon', { points: `-10,${-H - 64} 10,${-H - 64} 20,${-H - 48} -20,${-H - 48}`, fill: shade }));
  if (state === 'lit') parts.push(el('polygon', { points: `-20,${-H - 48} 20,${-H - 48} ${W / 2 + 8},${-H + 80} ${-W / 2 - 8},${-H + 80}`, fill: T['mustard-lit'], opacity: 0.3 }));
  return parts;
}

/** The round wall clock, 120 px across, at 10:10. */
function clock() {
  const R = 60;
  const cy = -R;
  const parts = [el('circle', { cx: 0, cy, r: R, fill: T.wood }), el('circle', { cx: 0, cy, r: R * 0.84, fill: T['paper-lit'] })];
  let d = '';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r0 = R * (i % 3 === 0 ? 0.62 : 0.7);
    const r1 = R * 0.77;
    d += `M${(Math.sin(a) * r0).toFixed(1)},${(cy - Math.cos(a) * r0).toFixed(1)}L${(Math.sin(a) * r1).toFixed(1)},${(cy - Math.cos(a) * r1).toFixed(1)}`;
  }
  parts.push(el('path', { d, stroke: T.ink, 'stroke-width': 3, 'stroke-linecap': 'round', fill: 'none' }));
  const hand = (a, len, w) => el('path', { d: `M0,${cy}L${(Math.sin(a) * len).toFixed(1)},${(cy - Math.cos(a) * len).toFixed(1)}`, stroke: T.ink, 'stroke-width': w, 'stroke-linecap': 'round' });
  parts.push(hand(((10 + 10 / 60) / 12) * Math.PI * 2, R * 0.42, 5.5), hand((2 / 12) * Math.PI * 2, R * 0.64, 3.8));
  parts.push(el('circle', { cx: 0, cy, r: 4.5, fill: T.ink }));
  return parts;
}

const DOOR_TAGS = (num) => ({
  is: `a wooden hospital specialist door numbered ${num}, with a white number plate and a small lamp above it`,
  setting: ['hospital', 'entrance hall', 'specialist gallery'],
  material: ['wood', 'painted trim', 'enamel plate'],
  parts: ['architrave', 'door leaf', 'panels', 'knob', 'number plate', 'lamp'],
  not: ['a fridge', 'a wardrobe', 'an elevator', 'a window'],
});

export const NEW_PROPS = {
  'hospital specialist door 17': { tags: DOOR_TAGS(17), size: [176, 300], states: ['shut', 'open', 'lit'], draw: ({ state }) => door(17, state) },
  'hospital specialist door 42': { tags: DOOR_TAGS(42), size: [176, 300], states: ['shut', 'open', 'lit'], draw: ({ state }) => door(42, state) },
  'round hospital wall clock': {
    tags: {
      is: 'a big round wall clock with a wooden rim, a paper face, twelve ticks and two ink hands at ten past ten',
      setting: ['hospital', 'entrance hall', 'waiting room'],
      material: ['wood', 'paper face', 'ink hands'],
      parts: ['rim', 'face', 'ticks', 'hour hand', 'minute hand', 'pin'],
      not: ['a stopwatch', 'a timer', 'a plate', 'a compass'],
    },
    size: [120, 150],
    states: ['still'],
    draw: () => clock(),
  },
};
