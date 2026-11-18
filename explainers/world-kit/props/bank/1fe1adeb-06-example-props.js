// Frame 6's own drawings (EX3-114): the weather app's phone, the saved-forecast card-file box, the weather
// server tower, one forecast card and a request slip. Each is drawn about its own base center.
// `draw({ state, focal, pose })`: pose carries what moves (the screen filling in, the card dropping).

import { T, el, g, line, shadow, TONES, P0, box, face, top, accentFill, accent } from '../../props/kit.js';

const ink = (d, sw = 3, opacity = 1) => el('path', { d, fill: 'none', stroke: T.ink, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity });
const cloud = (ox, oy, k = 1) =>
  el('path', {
    d: `M ${ox + 14 * k} ${oy + 24 * k} A ${10 * k} ${10 * k} 0 0 1 ${ox + 16 * k} ${oy + 5 * k} A ${14 * k} ${14 * k} 0 0 1 ${ox + 42 * k} ${oy} A ${12 * k} ${12 * k} 0 0 1 ${ox + 60 * k} ${oy + 12 * k} A ${8 * k} ${8 * k} 0 0 1 ${ox + 58 * k} ${oy + 24 * k} Z`,
    fill: T['paper-lit'],
    stroke: T.ink,
    'stroke-width': 3,
    'stroke-linejoin': 'round',
  });
const sun = (cx, cy, r, fill) => {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    rays.push(`M ${(cx + Math.cos(a) * (r + 5)).toFixed(1)} ${(cy + Math.sin(a) * (r + 5)).toFixed(1)} L ${(cx + Math.cos(a) * (r + 12)).toFixed(1)} ${(cy + Math.sin(a) * (r + 12)).toFixed(1)}`);
  }
  return [ink(rays.join(' '), 3), el('circle', { cx, cy, r, fill, stroke: T.ink, 'stroke-width': 3 })];
};
const pop = (v, cx, cy, inner) => (v <= 0 ? '' : g({ opacity: Math.min(1, v * 3).toFixed(3), transform: `translate(${cx} ${cy}) scale(${(0.55 + 0.45 * v).toFixed(3)}) translate(${-cx} ${-cy})` }, inner));

// ── The forecast card: a stiff paper card with a sun and a cloud ─────────────────────────
function cardFace(focal) {
  return [
    ...sun(26, 34, 13, accentFill(focal, T['paper-shade'])),
    cloud(8, 52, 1),
    ink('M 12 94 L 60 94', 3, 0.5),
    ink('M 12 104 L 44 104', 3, 0.5),
  ];
}
function cardParts(x, y, z, focal) {
  return [box(x - 36, y - 3, z, 72, 6, 112, TONES.paper, { sw: 3 }), face('front', x - 36, y + 3, z + 112, cardFace(focal))];
}

// ── The phone ────────────────────────────────────────────────────────────────────────────
// Upright slab, dark bezel, a light screen on its lower-left face. Screen: orange header strip when focal,
// then dashed placeholders (blank) or a sun, a cloud and three small day chips (showing).
function phoneParts({ state, focal, pose }) {
  const [vs, vc, vr] = pose?.show ?? (state === 'showing' ? [1, 1, 1] : [0, 0, 0]);
  const screen = [
    el('rect', { x: 8, y: 14, width: 84, height: 122, rx: 6, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 }),
    el('rect', { x: 8, y: 14, width: 84, height: 22, rx: 6, fill: accentFill(focal, T['paper-shade']), stroke: T.ink, 'stroke-width': 3 }),
    el('circle', { cx: 22, cy: 25, r: 5, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 2.5 }),
    ink('M 36 25 L 70 25', 3, 0.6),
    el('rect', { x: 38, y: 5, width: 24, height: 5, rx: 2.5, fill: T['paper-lit'] }),
    ink('M 38 144 L 62 144', 3, 0.4),
  ];
  if (vs < 1) {
    screen.push(el('circle', { cx: 50, cy: 70, r: 20, fill: 'none', stroke: T.ink, 'stroke-width': 3, 'stroke-dasharray': '6 6', opacity: 0.4 * (1 - vs) }));
    screen.push(ink('M 20 108 L 80 108 M 20 122 L 62 122', 3, 0.3 * (1 - vr)));
  }
  screen.push(pop(vs, 50, 66, sun(50, 66, 16, accentFill(focal, T['paper-shade']))));
  screen.push(pop(vc, 56, 80, cloud(24, 70, 0.9)));
  const chips = [0, 1, 2].map((i) => pop(vr, 22 + i * 28, 118, [el('circle', { cx: 22 + i * 28, cy: 112, r: 7, fill: T['paper-shade'], stroke: T.ink, 'stroke-width': 2.5 }), ink(`M ${14 + i * 28} 126 L ${30 + i * 28} 126`, 3, 0.55)]));
  return [shadow(0, 10, 80, 28), box(-50, -7, 0, 100, 14, 150, TONES.ink), face('front', -50, 7, 150, [...screen, ...chips])];
}

// ── The saved-forecast box: a small open card-file box ─────────────────────────────────────
function binParts({ state, focal, pose }) {
  const hasCard = state === 'saved' || !!pose?.card;
  const cz = pose?.cardZ ?? 0;
  const parts = [shadow(0, 10, 120, 40), box(-60, -40, 0, 120, 80, 8, TONES.paper), box(-60, -40, 8, 120, 8, 52, TONES.paper), box(-60, -32, 8, 8, 64, 52, TONES.paper)];
  if (!hasCard) parts.push(top(-36, -4, 8, el('rect', { x: 0, y: 0, width: 72, height: 8, fill: 'none', stroke: T.ink, 'stroke-width': 2.5, 'stroke-dasharray': '8 6', opacity: 0.55 })));
  else parts.push(...cardParts(0, 0, 8 + cz, focal));
  parts.push(box(52, -32, 8, 8, 64, 52, TONES.paper), box(-60, 32, 8, 120, 8, 52, TONES.paper));
  parts.push(
    face('front', -60, 40, 60, [
      el('rect', { x: 34, y: 16, width: 52, height: 28, rx: 3, fill: accentFill(focal, T['paper-lit']), stroke: T.ink, 'stroke-width': 3 }),
      ...sun(52, 30, 5, T['paper-lit']).slice(1),
      ink('M 60 36 L 78 36', 2.5, 0.6),
    ]),
  );
  return parts;
}

// ── The weather server: a tower with a cloud plate on top and three units with lights ──────
function serverParts({ state, focal }) {
  const busy = state === 'busy';
  const units = [50, 90, 130].map((y, i) => [
    el('rect', { x: 4, y, width: 72, height: 32, rx: 3, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 3 }),
    ink(`M 12 ${y + 10} L 44 ${y + 10} M 12 ${y + 21} L 44 ${y + 21}`, 2.5, 0.5),
    el('circle', { cx: 62, cy: y + 16, r: 5, fill: busy && i < 2 ? T['status-success'] : T['paper-shade'], stroke: T.ink, 'stroke-width': 2.5 }),
  ]);
  return [
    shadow(0, 12, 96, 34),
    box(-40, -30, 0, 80, 60, 170, TONES.paper),
    top(-40, -30, 170, el('rect', { x: 14, y: 26, width: 52, height: 8, fill: T.ink })),
    face('front', -40, 30, 170, [el('rect', { x: 4, y: 4, width: 72, height: 38, rx: 4, fill: accentFill(focal, T['paper-shade']), stroke: T.ink, 'stroke-width': 3 }), cloud(8, 12, 1), ...units.flat()]),
  ];
}

// ── The request slip: a small paper note with a question mark ──────────────────────────────
function slipParts() {
  return [box(-18, -2, 0, 36, 4, 46, TONES.paper, { sw: 2.5 }), face('front', -18, 2, 46, [ink('M 11 14 Q 11 6 18 6 Q 26 6 26 14 Q 26 20 18 23 L 18 29 M 18 38 L 18 39', 3.5)])];
}

export const NEW_PROPS = {
  'phone showing a weather app': {
    tags: {
      is: 'an upright smartphone whose screen is a weather app: an orange header strip, then a sun, a cloud and three small day chips once a forecast shows',
      setting: ['everyday life', 'a person using an app', 'a weather app'],
      material: 'dark glass and metal, paper-toned screen',
      parts: ['dark bezel', 'notch', 'app header strip', 'sun and cloud', 'three day chips', 'home bar'],
      not: ['tablet', 'remote control', 'calculator', 'walkie-talkie'],
    },
    size: [218, 320],
    states: ['blank', 'showing'],
    draw: phoneParts,
  },
  'open card-file box for saved forecast cards': {
    tags: {
      is: 'a small open-top card-file box that keeps forecast cards, with a label holder on its front showing a sun',
      setting: ['a cache', 'storage', 'a desk'],
      material: 'stiff card stock, paper tones',
      parts: ['open top', 'four low walls', 'label holder with a sun', 'upright forecast card when saved'],
      not: ['shoe box', 'tray', 'drawer', 'mailbox', 'safe', 'fridge'],
    },
    size: [284, 169],
    states: ['empty', 'saved'],
    draw: binParts,
  },
  'weather server tower with a cloud plate': {
    tags: {
      is: 'a tall server tower with a cloud plate at its head, three rack units with slots and status lights, and a card slot on top',
      setting: ['data center', 'the internet', 'a network'],
      material: 'painted metal, paper tones',
      parts: ['cloud plate', 'three rack units', 'status lights', 'card slot on top'],
      not: ['fridge', 'locker', 'wardrobe', 'filing cabinet', 'vending machine'],
    },
    size: [140, 280],
    states: ['idle', 'busy'],
    draw: serverParts,
  },
  'forecast card with a sun and a cloud': {
    tags: {
      is: 'a stiff paper card printed with a sun, a cloud and two grey text lines: one weather forecast',
      setting: ['a weather app', 'data being sent or saved'],
      material: 'card stock',
      parts: ['sun with rays', 'cloud', 'two text lines'],
      not: ['playing card', 'photo', 'business card', 'ticket'],
    },
    size: [100, 130],
    states: ['default'],
    draw: ({ focal }) => cardParts(0, 0, 0, focal),
  },
  'request slip with a question mark': {
    tags: {
      is: 'a small paper note with a question mark: one request asking for something',
      setting: ['a network', 'an app asking a server'],
      material: 'paper',
      parts: ['paper note', 'question mark'],
      not: ['envelope', 'sticky note', 'ticket', 'letter'],
    },
    size: [60, 60],
    states: ['default'],
    draw: () => slipParts(),
  },
};
