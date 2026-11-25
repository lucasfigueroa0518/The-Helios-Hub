// The cache reel's own drawings (EX3-114): everything the anchor scene draws new. Each is drawn about
// its own base center like the bank's assets, in the paper-and-ink style: three flat tones, ink
// outlines, riso grain, no gradients, colors only from T.

import { T, el, g, line, TONES, shadow, isoDisc, box, top, face, shape, mark, accent, accentFill, stippleShade } from '../../props/kit.js';

/** Wood, as paper tones: lit top, mid left face, dark right face. */
const WOOD = [T['paper-shade'], T['paper-dark'], T['text-tertiary']];

const dots = (list, r = 2.2, opacity = 0.55) => list.map(([x, y]) => el('circle', { cx: x, cy: y, r, fill: T.ink, opacity }));

/** One salt crystal: a tiny cube in ink outline, white, with its three edges marked. */
function crystal(x, y, k = 1, fill = T.canvas) {
  const a = 6 * k;
  const b = 3 * k;
  const pts = [[x, y - a], [x + a, y - b], [x + a, y + b], [x, y + a], [x - a, y + b], [x - a, y - b]].map((p) => p.join(',')).join(' ');
  return [
    el('polygon', { points: pts, fill, stroke: T.ink, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    el('path', { d: `M ${x - a} ${y - b} L ${x} ${y} L ${x + a} ${y - b} M ${x} ${y} L ${x} ${y + a}`, fill: 'none', stroke: T.ink, 'stroke-width': 1.4, opacity: 0.6, 'stroke-linejoin': 'round' }),
  ].join('');
}

// ── The salt jar ──────────────────────────────────────────────────────────────────────────
function jarDraw({ state, focal }) {
  const rx = 74;
  const ry = rx * 0.577;
  const nx = 58;
  const ny = nx * 0.577;
  const hn = 170;
  const ys = -112;
  const glass = `M ${-rx} ${ys} L ${-rx} 0 A ${rx} ${ry} 0 0 0 ${rx} 0 L ${rx} ${ys} Q ${rx} ${-hn + 10} ${nx} ${-hn} A ${nx} ${ny} 0 0 1 ${-nx} ${-hn} Q ${-rx} ${-hn + 10} ${-rx} ${ys} Z`;
  const parts = [shadow(0, 8, rx + 22, ry + 8)];
  // the cork, off and standing on the counter in front of the jar
  parts.push(shadow(98, 54, 34, 12));
  parts.push(isoDisc(98, 36, 26, 20, accent(focal, TONES.paper), { rings: 0, sw: 3 }));
  parts.push(...dots([[88, 33], [100, 38], [108, 31], [94, 42], [112, 40]], 1.8, 0.6));
  // the inside back of the open mouth
  parts.push(el('ellipse', { cx: 0, cy: -hn, rx: nx, ry: ny, fill: T['paper-shade'], stroke: line(), 'stroke-width': 3 }));
  if (state === 'empty') {
    parts.push(...dots([[-34, -6], [-12, -2], [18, -8], [42, -4], [-2, 8], [28, 10]], 2.6, 0.5));
  } else {
    // a level of white salt, seen through the glass, with its flat top
    const sr = rx - 5;
    const lvl = -96;
    const body = `M ${-sr} ${lvl} L ${-sr} 0 A ${sr} ${sr * 0.577} 0 0 0 ${sr} 0 L ${sr} ${lvl} Z`;
    parts.push(el('path', { d: body, fill: T.canvas }));
    parts.push(stippleShade('path', { d: body }, T.ink, { x1: 1, y1: 0, x2: 0, y2: 1, from: 0.02, to: 0.28, fine: true }));
    parts.push(...dots([[-52, -34], [-24, -56], [14, -28], [46, -62], [-38, -78], [30, -84], [-8, -14], [52, -20], [-58, -8], [22, 6]], 2.2, 0.55));
    parts.push(el('ellipse', { cx: 0, cy: lvl, rx: sr, ry: sr * 0.577, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5 }));
    parts.push(...dots([[-30, lvl + 2], [-4, lvl - 6], [26, lvl + 4], [8, lvl + 8], [44, lvl - 2], [-48, lvl - 4]], 2, 0.5));
  }
  // the glass: a pale tint, the ink outline, two highlights
  parts.push(el('path', { d: glass, fill: T['paper-lit'], opacity: state === 'empty' ? 0.55 : 0.3 }));
  parts.push(el('path', { d: glass, fill: 'none', stroke: line(), 'stroke-width': 3.5, 'stroke-linejoin': 'round' }));
  parts.push(el('path', { d: `M ${-rx + 14} ${ys + 6} L ${-rx + 14} -14`, fill: 'none', stroke: T.canvas, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.85 }));
  parts.push(el('path', { d: `M ${-rx + 30} ${ys - 6} L ${-rx + 30} ${ys + 36}`, fill: 'none', stroke: T.canvas, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.75 }));
  // the tag tied round the neck by a cord
  parts.push(mark(`M ${-nx + 2} ${-hn + ny + 4} Q 0 ${-hn + ny * 2 + 12} ${nx - 2} ${-hn + ny + 4}`, 3));
  parts.push(
    g({ transform: `translate(-34 ${-hn + ny * 2 + 4}) rotate(-9)` }, [
      mark('M 0 4 L 2 -8', 2.5),
      shape('M -16 4 L 16 4 L 24 14 L 24 62 L -24 62 L -24 14 Z', accentFill(focal, T['paper-lit']), 3),
      el('circle', { cx: 0, cy: 15, r: 3.5, fill: 'none', stroke: T.ink, 'stroke-width': 2.2 }),
      mark('M -14 34 L 14 34', 3),
      mark('M -14 46 L 8 46', 3),
    ]),
  );
  return parts;
}

// ── The pantry door ───────────────────────────────────────────────────────────────────────
const DW = 140;
const DH = 420;

/** A burlap sack of salt standing on a shelf, drawn on the door's front plane. */
function sack(u, z, coarse) {
  const vb = DH - (z + 9);
  const d = `M ${u - 26} ${vb} Q ${u - 34} ${vb - 36} ${u - 20} ${vb - 58} L ${u - 15} ${vb - 64} Q ${u - 24} ${vb - 74} ${u - 9} ${vb - 76} L ${u + 9} ${vb - 76} Q ${u + 24} ${vb - 74} ${u + 15} ${vb - 64} L ${u + 20} ${vb - 58} Q ${u + 34} ${vb - 36} ${u + 26} ${vb} Z`;
  const marks = coarse
    ? [crystal(u - 9, vb - 34, 1.1), crystal(u + 9, vb - 24, 1.1), crystal(u - 3, vb - 12, 1.1)]
    : dots([[u - 10, vb - 36], [u + 4, vb - 30], [u - 3, vb - 20], [u + 11, vb - 14], [u - 12, vb - 12]], 1.6, 0.7);
  return [
    el('path', { d, fill: T.canvas, stroke: T.ink, 'stroke-width': 3, 'stroke-linejoin': 'round' }),
    el('path', { d: `M ${u - 17} ${vb - 62} L ${u + 17} ${vb - 62}`, fill: 'none', stroke: T.ink, 'stroke-width': 3, 'stroke-linecap': 'round' }),
    ...marks,
  ];
}

function doorDraw({ state, focal }) {
  const open = state !== 'closed';
  const coarse = state === 'newgrade';
  const parts = [shadow(0, 14, 120, 30)];
  if (open) {
    // the dark cupboard inside: a back wall, a side wall, three shelves of sacks
    parts.push(face('front', -70, -32, DH, el('rect', { x: 0, y: 0, width: DW, height: DH, fill: T['ink-lit'] })));
    parts.push(face('side', -70, 0, DH, el('rect', { x: 0, y: 0, width: 32, height: DH, fill: T.ink })));
    for (const z of [90, 200, 310]) parts.push(box(-70, -32, z, DW, 30, 9, WOOD, { sw: 3 }));
    const rows = [[90, [34, 102]], [200, [68]], [310, [34, 102]]];
    for (const [z, us] of rows) for (const u of us) parts.push(face('front', -70, -18, DH, sack(u, z, coarse)));
  }
  // the casing: two posts and a lintel
  parts.push(box(-94, -34, 0, 24, 34, DH + 26, WOOD, { sw: 3.5 }));
  parts.push(box(70, -34, 0, 24, 34, DH + 26, WOOD, { sw: 3.5 }));
  parts.push(box(-94, -34, DH, 188, 34, 26, WOOD, { sw: 3.5 }));
  const hinge = (u, v) => [
    el('rect', { x: u, y: v, width: 14, height: 44, rx: 4, fill: T['ink-lit'], stroke: T.ink, 'stroke-width': 3 }),
    el('circle', { cx: u + 7, cy: v + 22, r: 2.6, fill: T['paper-lit'] }),
  ];
  const grain = (u0, w) => [0.18, 0.4, 0.62, 0.8].map((k, i) => mark(`M ${u0 + w * k} ${14 + i * 9} L ${u0 + w * k} ${DH - 20 - i * 30}`, 2, 0.22));
  if (!open) {
    parts.push(box(-70, -14, 0, DW, 14, DH, WOOD, { sw: 3.5 }));
    parts.push(
      face('front', -70, 0, DH, [
        ...grain(0, DW),
        el('rect', { x: 20, y: 26, width: 84, height: 150, rx: 4, fill: accentFill(focal, T['paper-shade']), stroke: T.ink, 'stroke-width': 3 }),
        el('rect', { x: 20, y: 202, width: 84, height: 190, rx: 4, fill: accentFill(focal, T['paper-shade']), stroke: T.ink, 'stroke-width': 3 }),
        ...hinge(0, 48),
        ...hinge(0, 318),
        el('rect', { x: 110, y: 196, width: 26, height: 56, rx: 9, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 }),
        el('circle', { cx: 123, cy: 216, r: 11, fill: accentFill(focal, T['paper-lit']), stroke: T.ink, 'stroke-width': 3.5 }),
        el('circle', { cx: 120, cy: 212, r: 3, fill: T.canvas }),
        el('circle', { cx: 123, cy: 238, r: 3, fill: T.ink }),
      ]),
    );
  } else {
    // the leaf swung toward us on its left hinges
    parts.push(box(-70, 0, 0, 14, 138, DH, WOOD, { sw: 3.5 }));
    parts.push(
      face('side', -56, 138, DH, [
        ...grain(0, 138),
        el('rect', { x: 36, y: 26, width: 84, height: 150, rx: 4, fill: accentFill(focal, T['paper-shade']), stroke: T.ink, 'stroke-width': 3 }),
        el('rect', { x: 36, y: 202, width: 84, height: 190, rx: 4, fill: accentFill(focal, T['paper-shade']), stroke: T.ink, 'stroke-width': 3 }),
        ...hinge(124, 48),
        ...hinge(124, 318),
        el('rect', { x: 4, y: 196, width: 26, height: 56, rx: 9, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 }),
        el('circle', { cx: 17, cy: 216, r: 11, fill: accentFill(focal, T['paper-lit']), stroke: T.ink, 'stroke-width': 3.5 }),
        el('circle', { cx: 14, cy: 212, r: 3, fill: T.canvas }),
      ]),
    );
  }
  return parts;
}

// ── The hallway runner ────────────────────────────────────────────────────────────────────
function hallDraw({ state }) {
  const L = 540;
  const parts = [box(-100, 0, 0, 200, L, 10, TONES.paper, { sw: 3.5 })];
  const inner = [
    el('path', { d: `M 16 6 L 16 ${L - 6} M 184 6 L 184 ${L - 6}`, fill: 'none', stroke: T.ink, 'stroke-width': 2.5, opacity: 0.35, 'stroke-linecap': 'round' }),
  ];
  if (state === 'trail') {
    // five pairs of footprints, toes toward the pantry door
    const print = (u, v) => g({ transform: `translate(${u} ${v})`, fill: T.ink, opacity: 0.5 }, [el('ellipse', { cx: 0, cy: -8, rx: 11, ry: 16 }), el('ellipse', { cx: 0, cy: 16, rx: 8, ry: 8 })]);
    for (let k = 0; k < 5; k++) {
      inner.push(print(66, 70 + k * 100));
      inner.push(print(134, 120 + k * 100));
    }
  }
  parts.push(top(-100, 0, 10, inner));
  return parts;
}

// ── The frying pan ────────────────────────────────────────────────────────────────────────
function panDraw({ state }) {
  const parts = [];
  parts.push(shape('M -54 -24 L -146 -36 Q -160 -35 -160 -25 Q -160 -15 -146 -14 L -54 -4 Z', T['text-secondary'], 3.5));
  parts.push(el('circle', { cx: -148, cy: -25, r: 4, fill: T.paper, stroke: T.ink, 'stroke-width': 2 }));
  parts.push(isoDisc(0, -16, 60, 18, [T['text-secondary'], T['ink-lit'], T.ink], { rings: 0, sw: 3.5 }));
  parts.push(el('ellipse', { cx: 0, cy: -16, rx: 49, ry: 28, fill: T['ink-lit'], stroke: T.canvas, 'stroke-width': 2, opacity: 0.95 }));
  // the food, going dark
  parts.push(el('ellipse', { cx: -14, cy: -16, rx: 18, ry: 9, fill: T.ink, stroke: T.canvas, 'stroke-width': 1.6 }));
  parts.push(el('ellipse', { cx: 18, cy: -12, rx: 13, ry: 7, fill: T.ink, stroke: T.canvas, 'stroke-width': 1.6 }));
  if (state === 'smoking') {
    parts.push(mark('M -22 -46 Q -4 -64 -22 -82 Q -40 -100 -22 -120', 5, 0.5));
    parts.push(mark('M 6 -50 Q 26 -70 6 -90 Q -12 -110 8 -132', 5, 0.5));
    parts.push(mark('M 32 -42 Q 46 -58 32 -74 Q 20 -88 34 -104', 4.5, 0.45));
    parts.push(...dots([[-34, -42], [40, -36], [14, -58]], 2.4, 0.5));
  }
  return parts;
}

// ── The salt spoon ────────────────────────────────────────────────────────────────────────
function saltDraw({ state, focal }) {
  const fill = accentFill(focal, T.canvas);
  const spoon = [
    shape('M -24 -4 L -114 -12 Q -124 -11 -124 -4 Q -124 3 -114 4 L -24 6 Z', T['paper-shade'], 3),
    el('ellipse', { cx: 0, cy: 0, rx: 30, ry: 17, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3.2 }),
    el('ellipse', { cx: 0, cy: 1, rx: 22, ry: 11, fill: T['paper-shade'], opacity: 0.8 }),
  ];
  if (state === 'pour') {
    // tipped: the heap slides off the lip and falls
    const slid = [[10, -6], [20, -4], [14, -14]].map(([x, y]) => crystal(x, y, 1, fill));
    const fall = [[28, 34, 1], [32, 54, 0.9], [28, 74, 0.85], [33, 94, 0.8], [29, 114, 0.7]].map(([x, y, k]) => crystal(x, y, k, fill));
    return [g({ transform: 'rotate(32)' }, [...spoon, ...slid]), ...fall];
  }
  const heap = [[-18, -8], [-6, -8], [6, -8], [18, -8], [-12, -18], [0, -18], [12, -18], [-6, -28], [6, -28], [0, -37]].map(([x, y]) => crystal(x, y, 1, fill));
  return [...spoon, ...heap];
}

export const NEW_PROPS = {
  'a small glass salt jar with its cork lid off': {
    tags: {
      is: 'a small squat glass salt jar with a short neck, open at the top, its cork lid off and standing beside it, a level of white salt showing through the glass and a paper tag tied on the neck',
      setting: ['kitchen counter', 'home kitchen', 'restaurant kitchen'],
      material: 'clear glass, white salt, a cork lid, a paper tag on a cord',
      parts: ['squat glass body', 'short open neck', 'level of white salt with grain dots', 'glass highlights', 'tag on a cord', 'loose cork lid'],
      not: ['candy jar', 'sweets jar', 'screw-top jar', 'pepper shaker', 'salt shaker', 'sugar bowl', 'vase', 'flask'],
    },
    size: [250, 230],
    states: ['empty', 'filled', 'old'],
    draw: ({ state, focal }) => jarDraw({ state: state === 'empty' ? 'empty' : 'filled', focal }),
  },
  'a tall wooden pantry door with a round knob and hinges': {
    tags: {
      is: 'a tall wooden kitchen pantry door in a plain casing, two inset panels, a round knob and two hinges; open, it swings out to show a dark cupboard with three shelves of white salt sacks',
      setting: ['home kitchen', 'restaurant kitchen', 'hallway end'],
      material: 'painted wood, burlap sacks',
      parts: ['door casing and lintel', 'two inset panels', 'round knob on a plate', 'two hinges', 'three shelves of sacks when open', 'sacks marked with salt grains'],
      not: ['front door', 'wardrobe', 'refrigerator', 'office door', 'bank vault', 'barn door', 'closet with clothes'],
    },
    size: [380, 470],
    states: ['closed', 'open', 'newgrade'],
    draw: doorDraw,
  },
  'a long hallway floor runner with a trail of footprints': {
    tags: {
      is: 'a long narrow hallway floor runner seen from above at an angle, edge lines running its length and, in its trail state, five pairs of footprints heading to the far end',
      setting: ['home hallway', 'kitchen to pantry corridor'],
      material: 'paper-flat floor slab, ink footprints',
      parts: ['long flat slab', 'two edge lines', 'five pairs of ink footprints'],
      not: ['road', 'river', 'conveyor belt', 'carpet roll', 'bridge', 'runway', 'stairs'],
    },
    size: [440, 400],
    states: ['trail', 'bare'],
    draw: hallDraw,
  },
  'a frying pan with a long handle': {
    tags: {
      is: 'a dark cast iron frying pan with one long handle with a hanging hole, holding dark burning food, with wisps of smoke rising when smoking',
      setting: ['kitchen', 'stove top', 'cook in hand'],
      material: 'cast iron, burnt food, smoke',
      parts: ['round shallow pan', 'long flat handle with a hole', 'dark food lumps', 'three smoke wisps'],
      not: ['saucepan', 'cooking pot', 'wok', 'ladle', 'tennis racket', 'mirror', 'tray'],
    },
    size: [230, 140],
    states: ['default', 'smoking'],
    draw: panDraw,
  },
  'a spoon heaped with white salt crystals': {
    tags: {
      is: 'a small metal spoon with a long handle, heaped with a pinch of white cube-shaped salt crystals; tipped, the crystals slide off and fall in a short stream',
      setting: ['kitchen', 'cook in hand', 'pantry'],
      material: 'steel spoon, white salt crystals',
      parts: ['round spoon bowl', 'long thin handle', 'heap of white crystal cubes', 'falling crystals when tipped'],
      not: ['sugar', 'flour', 'sand', 'ladle', 'fork', 'snow', 'pills', 'seeds'],
    },
    size: [200, 190],
    states: ['spoon', 'pour'],
    draw: saltDraw,
  },
};
