// A potted plant: drawn leaves (grown) in a built pot (split at the material line). Each leaf is a
// real leaf silhouette, pointed and asymmetric, with a lit half and a darker half; the pot is a flat
// straight-edged tub with a lit rim and a darker right side. Units: 180 tall (the pot's foot at 0),
// 60 cm real. Every leaf turns about the soil, so 'sway' (t) rocks them out of step.
const r1 = (v) => Math.round(v * 10) / 10;
const pt = ([x, y]) => `${r1(x)},${r1(y)}`;
const SOIL = -70;
// [angle from up in degrees (+ = right), length]
const LEAVES = [[-62, 70], [-30, 96], [8, 104], [40, 88], [70, 66], [-12, 60]];

function leaf(ang, L) {
  const a = (ang * Math.PI) / 180;
  const ux = Math.sin(a);
  const uy = -Math.cos(a);
  const nx = -uy;
  const ny = ux;
  const W = L * 0.34;
  const base = [0, SOIL];
  const at = (u, w) => [base[0] + ux * L * u + nx * W * w, base[1] + uy * L * u + ny * W * w];
  const tip = at(1, 0);
  const c1 = at(0.35, 1);
  const c2 = at(0.8, 0.7);
  const c3 = at(0.8, -0.75);
  const c4 = at(0.35, -1.05);
  return {
    d: `M${pt(base)} C${pt(c1)} ${pt(c2)} ${pt(tip)} C${pt(c3)} ${pt(c4)} ${pt(base)} Z`,
    lit: `M${pt(base)} C${pt(c1)} ${pt(c2)} ${pt(tip)} Z`,
  };
}

const parts = {};
LEAVES.forEach(([ang, len], i) => {
  const L = leaf(ang, len);
  parts[`leaf${i}`] = { z: -1 + i * 0.01, fill: 'leaf', pivot: [0, SOIL], d: L.d, marks: [{ d: L.lit, fill: 'leaf-lit' }] };
});
parts.pot = {
  z: 1, fill: 'pot', pivot: [0, -36],
  d: 'M-34,-72 L34,-72 L26,0 L-26,0 Z',
  shade: 'M4,-80 L40,-80 L40,4 L4,4 Z',
};
parts.rim = { z: 2, fill: 'rim', pivot: [0, -76], d: 'M-38,-82 L38,-82 L38,-68 L-38,-68 Z' };

export const PLANT = {
  kind: 'plant', cm: 60, units: 180,
  tones: { pot: 'paper-dark', rim: 'paper-shade' },
  views: {
    front: {
      foot: [-30, 30],
      parts,
      poses: {
        rest: {},
        sway: (t) => Object.fromEntries(LEAVES.map((_, i) => [`leaf${i}`, 3 * Math.sin(2 * Math.PI * t + i * 0.9)])),
        droop: Object.fromEntries(LEAVES.map(([ang], i) => [`leaf${i}`, Math.sign(ang || 1) * 10])),
      },
    },
  },
};
