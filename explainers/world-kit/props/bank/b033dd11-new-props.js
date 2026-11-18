// The reel's own new drawings (EX3-114): every object this world draws new, as the bank draws its
// assets (isometric soft volumes about the base centre, origin at world z = 0), each with full tags,
// for a flat or isometric frame (propFrom(NEW_PROPS, name, x, y, { s, state, focal })). The same
// objects stand in the world through the lens in world.js; their looks match (colours, parts).

import { el, T, TONES, shadow, box, cbox, cyl, face, accent } from '../../props/kit.js';

const lines = (rows, color = T['ink-lit'], w = 3) => rows.map(([x0, y, x1]) => el('path', { d: `M ${x0} ${y} L ${x1} ${y}`, stroke: color, 'stroke-width': w, 'stroke-linecap': 'round' }));

export const NEW_PROPS = {
  'restaurant swinging kitchen door with a round porthole window': {
    tags: {
      is: 'a dark charcoal restaurant swinging door leaf in a pale frame, a round porthole window high in its middle, a steel kick plate at the bottom and a steel push plate at hand height; shut, or swung open',
      setting: ['restaurant', 'between a dining room and a kitchen', 'cafe back of house'],
      material: 'painted wood leaf, steel plates, glass porthole',
      parts: ['tall leaf with no knob', 'round porthole window', 'steel kick plate', 'steel push plate', 'door frame'],
      not: ['house front door', 'panelled interior door with a knob', 'elevator door', 'ship hatch', 'vault door', 'fridge door', 'saloon half doors'],
    },
    size: [224, 300],
    states: ['shut'], // 'swung' dropped in the bank: its panel came apart (hand review 2026-11-16)
    draw: ({ state, focal }) => {
      const frame = [box(-54, -6, 0, 8, 12, 172, TONES.paper), box(46, -6, 0, 8, 12, 172, TONES.paper), box(-54, -6, 164, 108, 12, 10, TONES.paper)];
      if (state === 'swung') {
        return [shadow(0, 30, 70, 26), ...frame, box(-46, 6, 0, 6, 88, 160, accent(focal, TONES.ink)),
          face('side', -40, 6, 160, [el('circle', { cx: 44, cy: 54, r: 15, fill: T['teal-lit'], stroke: T['paper-shade'], 'stroke-width': 4 }), el('rect', { x: 6, y: 128, width: 76, height: 26, rx: 2, fill: T['paper-shade'] })])];
      }
      return [shadow(0, 8, 70, 18), ...frame, box(-46, -3, 0, 92, 6, 160, accent(focal, TONES.ink)),
        face('front', -46, 3, 160, [el('circle', { cx: 46, cy: 54, r: 15, fill: T['teal-lit'], stroke: T['paper-shade'], 'stroke-width': 4 }), el('rect', { x: 6, y: 128, width: 80, height: 26, rx: 2, fill: T['paper-shade'] }), el('rect', { x: 8, y: 70, width: 14, height: 22, rx: 2, fill: T['paper-shade'] })])];
    },
  },

  'plate of golden french fries': {
    tags: {
      is: 'a round white plate with a heap of golden french fry sticks on it (cooked), or the same heap pale and raw',
      setting: ['restaurant table', 'kitchen pass', 'diner', 'fast food'],
      material: 'white ceramic plate, fried potato sticks',
      parts: ['round white plate', 'heap of thin fry sticks'],
      not: ['pasta', 'hay', 'matches', 'pencils', 'chips in a bag', 'bowl of soup', 'pizza'],
    },
    size: [140, 90],
    states: ['cooked', 'raw'],
    draw: ({ state, focal }) => {
      const fry = state === 'raw' ? TONES.paper : accent(focal, TONES.yellow);
      const sticks = [[-22, -10, 30, 6], [-6, -18, 6, 30], [8, -8, 30, 6], [-14, 4, 6, 28], [2, 2, 28, 6], [-8, -6, 6, 26]];
      return [shadow(0, 6, 56, 20), cyl(0, 0, 0, 42, 4, TONES.paper), ...sticks.map(([x, y, w, d], i) => box(x, y, 4 + (i > 3 ? 6 : 0), w, d, 6, fry, { radius: 2 }))];
    },
  },

  'paper restaurant order ticket': {
    tags: {
      is: 'a small upright white paper order slip with four short handwritten lines, the kind a waiter clips to a kitchen ticket rail',
      setting: ['restaurant', 'kitchen ticket rail', "waiter's hand", 'diner order'],
      material: 'paper',
      parts: ['small rectangular slip', 'four short written lines'],
      not: ['receipt from a till', 'cinema ticket', 'envelope', 'sticky note', 'playing card', 'price tag', 'business card'],
    },
    size: [112, 110],
    states: ['default'],
    draw: ({ focal }) => [shadow(0, 4, 28, 10), box(-22, -2, 0, 44, 4, 64, accent(focal, TONES.paper), { radius: 2 }), face('front', -22, 2, 64, lines([[8, 14, 34], [8, 26, 28], [8, 38, 34], [8, 50, 22]]))],
  },

  'folded paper menu with a yellow cover': {
    tags: {
      is: 'a restaurant menu folded and standing upright, a yellow cover with a small paper label and a fold line down its middle',
      setting: ['restaurant table', 'diner', 'cafe'],
      material: 'card',
      parts: ['yellow cover', 'small paper label', 'centre fold'],
      not: ['book', 'notebook', 'brochure rack', 'tablet', 'greeting card', 'folder'],
    },
    size: [154, 132],
    states: ['default'],
    draw: ({ focal }) => [shadow(0, 6, 42, 14), box(-32, -4, 0, 64, 8, 84, accent(focal, TONES.yellow), { radius: 3 }), face('front', -32, 4, 84, [el('path', { d: 'M 32 0 L 32 84', stroke: T['yellow-dark'], 'stroke-width': 2 }), el('rect', { x: 40, y: 18, width: 18, height: 22, rx: 3, fill: T['paper-lit'] })])],
  },

  'blue walk-in fridge door with a big steel handle': {
    tags: {
      is: 'the door of a walk-in cold room set in a steel frame: a tall blue steel door with two ribs, a big vertical steel handle and latch, shut, or swung open on shelves of stored food',
      setting: ['restaurant kitchen', 'commercial kitchen', 'cold store'],
      material: 'blue painted steel, steel frame and handle',
      parts: ['tall blue door', 'steel frame', 'big vertical handle', 'latch block', 'two ribs', 'shelves of food when open'],
      not: ['home fridge with a freezer drawer', 'vending machine', 'locker', 'safe', 'wardrobe', 'elevator', 'server rack'],
    },
    size: [394, 300],
    states: ['shut', 'open'],
    draw: ({ state, focal }) => {
      const frame = [box(-58, -6, 0, 10, 12, 182, TONES.paper), box(48, -6, 0, 10, 12, 182, TONES.paper), box(-58, -6, 172, 116, 12, 10, TONES.paper)];
      if (state === 'open') {
        return [shadow(0, 30, 80, 30), box(-48, -40, 0, 96, 36, 172, TONES.blue, { radius: 2 }), ...[40, 86, 132].map((z) => box(-46, -38, z, 92, 32, 4, TONES.paper, { radius: 1 })),
          box(-40, -32, 44, 30, 22, 18, TONES.yellow), box(-2, -32, 44, 30, 22, 22, TONES.paper), box(-36, -32, 90, 22, 20, 20, TONES.teal), box(8, -32, 136, 30, 22, 16, TONES.paper),
          ...frame, box(-56, 6, 0, 8, 96, 170, accent(focal, TONES.blue))];
      }
      return [shadow(0, 8, 80, 20), ...frame, box(-48, -3, 0, 96, 8, 170, accent(focal, TONES.blue)),
        face('front', -48, 5, 170, [el('rect', { x: 8, y: 46, width: 80, height: 4, rx: 2, fill: T['blue-shade'] }), el('rect', { x: 8, y: 118, width: 80, height: 4, rx: 2, fill: T['blue-shade'] }), el('rect', { x: 76, y: 60, width: 8, height: 60, rx: 4, fill: T['paper-shade'] }), el('rect', { x: 72, y: 54, width: 14, height: 12, rx: 2, fill: T['paper-shade'] })])];
    },
  },

  'lilac kitchen rules board with two crossed-out pictograms': {
    tags: {
      is: 'a lilac wall board with two white panels: a pale raw chicken drumstick in a red no-sign, and a steak beside a gold coin with a red no-sign over the coin; pictograms only, no words',
      setting: ['restaurant kitchen wall', 'commercial kitchen'],
      material: 'painted board, printed pictograms',
      parts: ['lilac board', 'two white panels', 'raw drumstick pictogram', 'steak and coin pictogram', 'two red prohibition signs'],
      not: ['menu board', 'notice board with papers', 'warning triangle', 'road sign', 'poster with text', 'price list'],
    },
    size: [200, 140],
    states: ['default'],
    draw: ({ focal }) => [shadow(0, 6, 70, 12), box(-64, -3, 0, 128, 6, 80, accent(focal, TONES.lilac), { radius: 3 }),
      face('front', -64, 3, 80, [
        el('rect', { x: 8, y: 8, width: 52, height: 64, rx: 5, fill: T['paper-lit'] }), el('rect', { x: 68, y: 8, width: 52, height: 64, rx: 5, fill: T['paper-lit'] }),
        el('ellipse', { cx: 30, cy: 34, rx: 12, ry: 10, fill: T['red-lit'] }), el('path', { d: 'M 37 42 L 46 54', stroke: T['paper-shade'], 'stroke-width': 5, 'stroke-linecap': 'round' }),
        el('circle', { cx: 34, cy: 40, r: 20, fill: 'none', stroke: T.red, 'stroke-width': 4 }), el('path', { d: 'M 20 26 L 48 54', stroke: T.red, 'stroke-width': 4, 'stroke-linecap': 'round' }),
        el('ellipse', { cx: 88, cy: 44, rx: 14, ry: 10, fill: T['red-shade'] }), el('circle', { cx: 106, cy: 26, r: 8, fill: T.yellow }),
        el('circle', { cx: 106, cy: 26, r: 12, fill: 'none', stroke: T.red, 'stroke-width': 3 }), el('path', { d: 'M 98 18 L 114 34', stroke: T.red, 'stroke-width': 3, 'stroke-linecap': 'round' }),
      ])],
  },

  'steel fryer basket of golden fries': {
    tags: {
      is: 'a deep-fryer wire basket in steel with a long black handle, golden french fries poking out of its top',
      setting: ['restaurant kitchen', 'fryer station', 'fast food kitchen'],
      material: 'steel wire mesh, black plastic handle, fried potato',
      parts: ['rectangular wire basket', 'long black handle', 'fries poking out'],
      not: ['shopping basket', 'waste bin', 'birdcage', 'colander', 'lunch box', 'toaster'],
    },
    size: [160, 100],
    states: ['default'],
    draw: ({ focal }) => [shadow(0, 6, 50, 16), ...[[-18, -10], [-6, -14], [6, -8], [14, -14], [-12, 2]].map(([x, y]) => box(x, y, 16, 6, 6, 24, accent(focal, TONES.yellow), { radius: 2 })), cbox(0, 0, 0, 56, 40, 26, TONES.paper, { radius: 3 }), box(-4, 20, 18, 8, 50, 6, TONES.ink, { radius: 3 })],
  },

  'round dining table with a white tablecloth': {
    tags: {
      is: 'a round restaurant table covered to the floor by a white tablecloth',
      setting: ['restaurant dining room', 'cafe', 'banquet'],
      material: 'white cloth over a round table',
      parts: ['round white top', 'cloth falling to the floor'],
      not: ['desk', 'counter', 'drum', 'cake', 'pillar', 'operating table', 'coffee table with legs'],
    },
    size: [220, 120],
    states: ['default'],
    draw: () => [shadow(0, 10, 96, 34), cyl(0, 0, 0, 88, 40, TONES.paper)],
  },

  'yellow smartphone showing a restaurant menu': {
    tags: {
      is: 'a yellow smartphone standing upright, its screen showing a menu: a yellow header and three short lines',
      setting: ["a diner's hand", 'everyday app use', 'ordering food'],
      material: 'yellow plastic case, glass screen',
      parts: ['rounded yellow case', 'screen', 'yellow header bar', 'three menu lines'],
      not: ['tablet', 'calculator', 'remote control', 'landline phone', 'pager', 'menu card'],
    },
    size: [90, 150],
    states: ['default'],
    draw: ({ focal }) => [shadow(0, 4, 30, 10), box(-24, -4, 0, 48, 8, 96, accent(focal, TONES.yellow), { radius: 6, gloss: true }),
      face('front', -24, 4, 96, [el('rect', { x: 5, y: 6, width: 38, height: 84, rx: 5, fill: T['paper-lit'] }), el('rect', { x: 5, y: 6, width: 38, height: 16, rx: 5, fill: T['yellow-lit'] }), ...lines([[11, 36, 37], [11, 50, 31], [11, 64, 37]], T['ink-lit'], 3)])],
  },

  'kitchen broom with a straw head': {
    tags: {
      is: 'an upright kitchen broom: a long dark handle and a flared straw head on the floor',
      setting: ['kitchen', 'restaurant back of house', 'cleaning up'],
      material: 'dark wooden handle, straw bristles',
      parts: ['long handle', 'flared straw head', 'bristle lines'],
      not: ['mop', 'rake', 'paintbrush', 'witch broom flying', 'vacuum cleaner', 'feather duster'],
    },
    size: [80, 260],
    states: ['default'],
    draw: () => [shadow(0, 4, 34, 10), cbox(0, 0, 0, 44, 12, 34, TONES.yellow, { radius: 3 }), cbox(0, 0, 34, 6, 6, 150, TONES.ink, { radius: 3 })],
  },

  'wooden crate of potatoes': {
    tags: {
      is: 'a shallow wooden crate full of round golden-brown potatoes',
      setting: ['restaurant kitchen', 'walk-in fridge shelf', 'pantry', 'market stall'],
      material: 'wood slats, potatoes',
      parts: ['shallow crate', 'slats', 'pile of round potatoes'],
      not: ['egg carton', 'basket of bread', 'box of oranges', 'treasure chest', 'drawer'],
    },
    size: [150, 90],
    states: ['default'],
    draw: () => [shadow(0, 6, 60, 18), ...[[-20, -10], [0, -14], [18, -6], [-10, 6], [10, 8]].map(([x, y]) => cyl(x, y, 18, 10, 10, TONES.yellow)), cbox(0, 0, 0, 72, 48, 22, TONES.yellow, { radius: 3 })],
  },

  'kitchen pass with a heat lamp': {
    tags: {
      is: 'a low steel kitchen pass counter with a steel heat-lamp hood hanging on two rods above it, its underside glowing warm, and a short ticket rail on a post at one end',
      setting: ['restaurant kitchen', 'commercial kitchen line'],
      material: 'steel',
      parts: ['low steel counter', 'heat-lamp hood on two rods', 'warm glowing underside', 'ticket rail on a post'],
      not: ['bar counter', 'shop till counter', 'desk lamp', 'street light', 'hospital bed', 'office desk'],
    },
    size: [240, 220],
    states: ['default'],
    draw: ({ focal }) => [shadow(0, 10, 100, 30), cbox(0, 0, 0, 160, 56, 30, TONES.paper, { radius: 3 }), box(-70, 10, 30, 4, 4, 90, TONES.paper), box(66, 10, 30, 4, 4, 90, TONES.paper),
      box(-74, -12, 110, 148, 30, 8, accent(focal, TONES.paper), { radius: 3 }), box(70, 26, 30, 4, 4, 44, TONES.paper), box(46, 26, 72, 28, 4, 4, TONES.paper)],
  },
};
