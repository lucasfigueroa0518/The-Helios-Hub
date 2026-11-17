// New drawings for flat frames (EX3-114): the tan bone treat (the reward) as frames 5 and 7 draw it,
// the same tan and shape as the world's LENS.treat. Soft 3D: no outline, one key light top right.
import { softShape, shadow, el } from '../../draw.js';
import { TOKENS as T, mixHex } from '../../core.js';

const TAN = mixHex(T['yellow-shade'], T['red-shade'], 0.25);

// A bone outline about (0, 0): four round lobes (r 20 at x ±60, y ±16) and a shaft 18 tall.
const BONE_D = [
  'M -41.3 -9 L 41.3 -9',
  'A 20 20 0 1 1 72 0',
  'A 20 20 0 1 1 41.3 9',
  'L -41.3 9',
  'A 20 20 0 1 1 -72 0',
  'A 20 20 0 1 1 -41.3 -9 Z',
].join(' ');

export const NEW_PROPS = {
  'tan bone-shaped dog treat': {
    tags: {
      is: 'a small dog biscuit shaped like a bone: a short shaft with two round lobes at each end, baked warm tan, lying flat',
      setting: ['dog training', 'living room', 'reward', 'pet shop'],
      material: 'baked biscuit, soft matte',
      parts: ['four round end lobes', 'short straight shaft', 'two baked dimples'],
      not: ['real bone', 'skeleton', 'dumbbell', 'cookie', 'chew toy'],
    },
    size: [220, 107],
    states: ['default'],
    // Origin: the base centre; it lies y −74 … 0, x −92 … 92.
    draw: () => [
      shadow(6, 0, 88, 10, 0.16),
      `<g transform="translate(0 -38)">`,
      softShape(BONE_D, TAN),
      el('circle', { cx: -14, cy: -1, r: 2.6, fill: mixHex(TAN, T['shadow-warm'], 0.35), opacity: 0.6 }),
      el('circle', { cx: 16, cy: 2, r: 2.6, fill: mixHex(TAN, T['shadow-warm'], 0.35), opacity: 0.6 }),
      `</g>`,
    ],
  },
};
