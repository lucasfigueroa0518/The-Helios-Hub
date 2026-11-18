// The scene's own new drawings (EX3-114), for flat and isometric frames: the dog biscuit treat and
// the blue sneaker, drawn the way world.js draws them through the lens. Base centre at (0, 0).
import { el, g, id, T } from '../../draw.js';

function biscuit() {
  const r = 56;
  const cy = -r - 6;
  const gid = id('np-treat');
  const bone = (k) => {
    const knobs = [[-27, -9], [-27, 9], [27, -9], [27, 9]];
    return knobs.map(([x, y]) => el('circle', { cx: x, cy: cy + y + k, r: 9.5 })).join('') + el('rect', { x: -27, y: cy - 5.6 + k, width: 54, height: 11.2 });
  };
  return [
    el('ellipse', { cx: 0, cy: -2, rx: 46, ry: 7, fill: T['shadow-warm'], opacity: 0.16 }),
    el('circle', { cx: -3, cy: cy + 3, r, fill: T['yellow-shade'] }),
    el('defs', {}, el('radialGradient', { id: gid, cx: 0.66, cy: 0.3, r: 0.85 }, [el('stop', { offset: 0, 'stop-color': T['yellow-lit'] }), el('stop', { offset: 0.55, 'stop-color': T.yellow }), el('stop', { offset: 1, 'stop-color': T['yellow-shade'] })].join(''))),
    el('circle', { cx: 0, cy, r, fill: `url(#${gid})` }),
    el('circle', { cx: 0, cy, r: r * 0.93, fill: 'none', stroke: T['yellow-shade'], 'stroke-width': 2.6, opacity: 0.7 }),
    g({ fill: T['yellow-lit'], opacity: 0.9 }, bone(2.2)),
    g({ fill: T['yellow-dark'], opacity: 0.55 }, bone(-1.2)),
    ...[[-24, -26], [24, -27], [-25, 24], [23, 25]].map(([x, y]) => el('circle', { cx: x, cy: cy + y, r: 2.6, fill: T['yellow-dark'], opacity: 0.6 })),
  ];
}

function sneaker(chewed) {
  const gid = id('np-shoe');
  const parts = [
    el('ellipse', { cx: 0, cy: -2, rx: 128, ry: 9, fill: T['shadow-warm'], opacity: 0.16 }),
    el('defs', {}, el('linearGradient', { id: gid, x1: 0.8, y1: 0, x2: 0.2, y2: 1 }, [el('stop', { offset: 0, 'stop-color': T['blue-lit'] }), el('stop', { offset: 0.5, 'stop-color': T.blue }), el('stop', { offset: 1, 'stop-color': T['blue-shade'] })].join(''))),
    el('path', { d: 'M -120 -30 C -122 -70 -112 -104 -84 -108 L -40 -108 C -20 -84 10 -70 60 -62 C 100 -56 122 -48 122 -30 Z', fill: `url(#${gid})` }),
    el('path', { d: 'M -100 -100 L -52 -100', stroke: T['ink-lit'], 'stroke-width': 9, 'stroke-linecap': 'round' }),
    el('rect', { x: -126, y: -34, width: 252, height: 30, rx: 12, fill: T['paper-lit'] }),
    el('rect', { x: -126, y: -14, width: 252, height: 10, rx: 5, fill: T['paper-shade'] }),
    el('path', { d: 'M -104 -50 Q 0 -60 108 -40', stroke: T['blue-lit'], 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round' }),
    ...[0, 1, 2, 3].map((i) => el('path', { d: `M ${-30 + i * 18} ${-94 + i * 7} l 12 10`, stroke: T.canvas, 'stroke-width': 5, 'stroke-linecap': 'round' })),
  ];
  if (chewed) {
    for (let i = 0; i < 4; i++) parts.push(el('path', { d: `M ${70 + i * 12} -60 l 5 14 l 5 -14 Z`, fill: T['blue-dark'] }));
    for (let i = 0; i < 3; i++) parts.push(el('path', { d: `M ${76 + i * 12} -44 l 4 -11 l 4 11 Z`, fill: T['blue-dark'], opacity: 0.8 }));
  }
  return parts;
}

export const NEW_PROPS = {
  'dog biscuit treat': {
    tags: {
      is: ['dog treat', 'biscuit', 'reward', 'snack'],
      setting: ['living room', 'dog training', 'home'],
      material: ['baked biscuit'],
      parts: ['round disc', 'pressed bone shape', 'docking holes'],
      not: ['coin', 'cookie with chips', 'medal'],
    },
    size: [260, 154],
    states: ['default'],
    draw: () => biscuit(),
  },
  'blue sneaker': {
    tags: {
      is: ['sneaker', 'shoe', 'trainer shoe'],
      setting: ['living room', 'home', 'floor'],
      material: ['fabric', 'rubber'],
      parts: ['blue upper', 'white sole', 'laces', 'heel collar'],
      not: ['boot', 'slipper', 'high heel'],
    },
    size: [260, 138],
    states: ['whole', 'chewed'],
    draw: ({ state }) => sneaker(state === 'chewed'),
  },
};
