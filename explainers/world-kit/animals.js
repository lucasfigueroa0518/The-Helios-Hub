// Animals (4.2, approved by Lucas from the proof in .explainers-local/4.2-plan/proof/animals): real
// animals in the house look, their own category: never a critter, never an object, never a character.
// animal(kind, x, y, { view: 'side'|'front', s, flip, t, action }) → SVG string, feet at (x, y).
// Built only from draw.js softShape volumes, palette tokens and bead eyes; sized on the critter ruler.
// Another species is composed the same way with ANIMAL_PARTS and animalFrom() (house-style.md § Animals).
import * as D from './draw.js';
import * as C from './core.js';
const T = C.TOKENS;
const mx = C.mixHex;
const r1 = (v) => Math.round(v * 10) / 10;

// ── geometry (L = ±1 mirrors x, so the key light stays top right on a flipped animal) ──────
let L = 1;
const P = ([x, y]) => [x * L, y];
function smooth(pts) {
  const p = pts.map(P);
  const n = p.length;
  let d = `M ${r1(p[0][0])} ${r1(p[0][1])}`;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n], e = p[(i + 2) % n];
    d += ` C ${r1(b[0] + (c[0] - a[0]) / 6)} ${r1(b[1] + (c[1] - a[1]) / 6)} ${r1(c[0] - (e[0] - b[0]) / 6)} ${r1(c[1] - (e[1] - b[1]) / 6)} ${r1(c[0])} ${r1(c[1])}`;
  }
  return d + ' Z';
}
const ell = (cx, cy, rx, ry, rot = 0, n = 14) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2, r = (rot * Math.PI) / 180;
  const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
  return [cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)];
});
/** A tapered limb through joints [[x,y,radius],…], rounded at both ends. */
function limb(j) {
  const L1 = [], R1 = [];
  j.forEach(([x, y, r], i) => {
    const a = j[Math.max(0, i - 1)], b = j[Math.min(j.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
    L1.push([x - dy * r, y + dx * r]); R1.push([x + dy * r, y - dx * r]);
  });
  const end = (k, s) => { const [x, y, r] = j[k], o = j[k + s]; const dx = x - o[0], dy = y - o[1], m = Math.hypot(dx, dy) || 1; return [x + (dx / m) * r * 0.9, y + (dy / m) * r * 0.9]; };
  return [...L1, end(j.length - 1, -1), ...R1.reverse(), end(0, 1)];
}
const rot = (pts, [ox, oy], deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return pts.map(([x, y]) => [ox + (x - ox) * c - (y - oy) * s, oy + (x - ox) * s + (y - oy) * c]); };

const vol = (pts, fill, o) => D.softShape(smooth(pts), fill, o);
const far = (c) => mx(c, T['shadow-warm'], 0.28);
/** The bead eye every animal has: one dark glossy sphere, a key catchlight top right and a small fill. No white, no lids, no brows. */
function bead(cx, cy, r) {
  const [x, y] = P([cx, cy]);
  return [
    D.el('circle', { cx: r1(x), cy: r1(y + r * 0.15), r: r1(r * 1.25), fill: T['shadow-warm'], opacity: 0.22 }),
    D.el('circle', { cx: r1(x), cy: r1(y), r: r1(r), fill: T['ink'] }),
    D.el('circle', { cx: r1(x - r * 0.15), cy: r1(y + r * 0.2), r: r1(r * 0.7), fill: T['ink-lit'], opacity: 0.6 }),
    D.el('ellipse', { cx: r1(x + r * 0.32), cy: r1(y - r * 0.36), rx: r1(r * 0.34), ry: r1(r * 0.26), fill: T.canvas }),
    D.el('circle', { cx: r1(x - r * 0.35), cy: r1(y + r * 0.38), r: r1(r * 0.12), fill: T.canvas, opacity: 0.85 }),
  ].join('');
}
const gg = (inner, tf) => D.g(tf ? { transform: tf } : {}, inner);
const rotAt = (deg, [ox, oy]) => `rotate(${r1(deg * L)} ${r1(ox * L)} ${r1(oy)})`;

// Real heights (cm, feet to top of head) and the drawing's height in units. A songbird is cheated
// to 30 cm (the 3× cap of core CHEAT): at 12 cm it would not read next to a critter.
export const ANIMALS = {
  puppy: { cm: 38, units: 262, coat: T.yellow, view: ['side', 'front'] },
  songbird: { cm: 30, units: 170, coat: T.blue, view: ['side', 'front'] },
  horse: { cm: 205, units: 420, coat: T['orange-dark'], view: ['side', 'front'] },
};

// ── puppy: golden coat (yellow ramp), paper-lit blaze and muzzle, ink nose ───────────────────
function puppy(view, t, act) {
  const coat = T.yellow, cream = T['paper-lit'], ear = T['yellow-shade'];
  const br = 1 + 0.018 * Math.sin(t * Math.PI * 2 * 0.9);
  const wag = act ? 26 * Math.sin(t * Math.PI * 2 * 3.2) * Math.min(1, t * 2) : 8;
  const tilt = act ? 14 * Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 1.6) / 1.2)))) : 0;
  if (view === 'front') {
    const head = [
      vol(ell(-56, -200, 20, 42, 14), ear), vol(ell(56, -200, 20, 42, -14), ear),
      vol(ell(0, -212, 60, 56), coat),
      vol(ell(0, -186, 34, 25), cream),
      vol(ell(0, -198, 13, 9.5), T['ink-lit'], { gloss: true }),
      bead(-24, -224, 8.5), bead(24, -224, 8.5),
    ];
    return [
      D.shadow(0, 0, 92, 12),
      vol(ell(-58, -18, 22, 16), far(coat)), vol(ell(58, -18, 22, 16), far(coat)),
      gg(vol(ell(0, -110, 68, 74), coat) + vol(ell(0, -118, 36, 50), cream), `translate(0 ${r1(-110 * (1 - br))}) scale(1 ${r1(br * 1000) / 1000}) translate(0 0)`),
      vol(limb([[-28, -95, 17], [-30, -8, 14]]), coat), vol(limb([[28, -95, 17], [30, -8, 14]]), coat),
      vol(ell(-30, -8, 18, 9), cream), vol(ell(30, -8, 18, 9), cream),
      gg(head.join(''), rotAt(tilt, [0, -160])),
    ].join('');
  }
  const tail = rot([...limb([[-88, -148, 11], [-112, -178, 9], [-120, -214, 6]])], [-88, -148], -wag);
  const head = [
    vol(ell(92, -200, 56, 54), coat),
    vol(ell(146, -176, 32, 23, 8), cream),
    vol(ell(176, -186, 12, 9.5), T['ink-lit'], { gloss: true }),
    bead(116, -212, 8.5),
    vol([[64, -238], [86, -244], [92, -214], [84, -170], [70, -160], [58, -186]], ear),
  ];
  return [
    D.shadow(0, 0, 130, 13),
    vol(limb([[-48, -108, 15], [-54, -58, 12], [-50, -8, 11]]), far(coat)),
    vol(limb([[48, -96, 13], [52, -8, 11]]), far(coat)),
    vol(tail, coat),
    gg(vol(ell(0, -126, 96, 56 * br), coat) + vol(ell(58, -126, 32, 44), cream), ''),
    vol(ell(-62, -118, 40, 46), coat),
    vol(limb([[-66, -100, 16], [-76, -52, 12], [-66, -8, 11]]), coat),
    vol(limb([[66, -100, 15], [70, -8, 12]]), coat),
    vol(ell(-60, -7, 17, 8), cream), vol(ell(76, -7, 17, 8), cream),
    gg(head.join(''), rotAt(-tilt, [72, -160])),
  ].join('');
}

// ── songbird, blue back, orange-lit breast, ink-lit beak and legs ──────────────────
function songbird(view, t, act) {
  const back = T.blue, wing = T['blue-shade'], breast = T['orange-lit'], beak = T['ink-lit'];
  const br = 1 + 0.025 * Math.sin(t * Math.PI * 2 * 1.6);
  // hop 0.7–1.15 s, wing flick 1.7–2.1 s, head turn twitches
  const hp = act ? Math.min(1, Math.max(0, (t - 0.7) / 0.45)) : 0;
  const hop = hp > 0 && hp < 1 ? -70 * 4 * hp * (1 - hp) : 0;
  const fp = act ? Math.min(1, Math.max(0, (t - 1.7) / 0.4)) : 0;
  const flick = fp > 0 && fp < 1 ? Math.sin(fp * Math.PI * 3) * 26 * (1 - fp) : 0;
  const peck = act ? (t > 2.3 && t < 2.6 ? 10 * Math.sin(((t - 2.3) / 0.3) * Math.PI) : 0) : 0;
  const tuck = hp > 0 && hp < 1 ? 6 : 0;
  if (view === 'front') {
    return [
      D.shadow(0, 0, 50, 8),
      vol(limb([[-14, -30, 3.5], [-15, -4, 3]]), beak), vol(limb([[14, -30, 3.5], [15, -4, 3]]), beak),
      vol(ell(0, -84, 54 * br, 60 * br), back),
      vol(ell(0, -74, 38, 46), breast),
      vol(ell(-50, -86, 15, 40, 10), wing), vol(ell(50, -86, 15, 40, -10), wing),
      vol(ell(0, -138, 38, 35), back),
      vol([[-9, -134], [9, -134], [0, -116]], beak, { gloss: true }),
      bead(-19, -142, 6), bead(19, -142, 6),
    ].join('');
  }
  const body = [
    vol(rot([[-40, -66], [-120, -38], [-126, -28], [-112, -26], [-40, -50]], [-40, -58], flick * 0.3), wing),
    vol(ell(0, -76, 66, 46 * br, -14), back),
    vol(ell(22, -62, 40, 30, -20), breast),
    vol(rot([[48, -106], [10, -112], [-40, -96], [-78, -62], [-40, -60], [16, -72], [44, -86]], [40, -100], -flick), wing),
    gg(vol(ell(52, -118, 36, 33), back) + vol([[80, -126], [108, -118], [80, -110]], beak, { gloss: true }) + bead(64, -126, 6.5), rotAt(peck, [40, -100])),
  ];
  return [
    D.shadow(0, 0, 60 * (1 + hop / 300), 8),
    gg([
      vol(limb([[2, -40 + tuck, 3.5], [-6, -4, 3]]), far(beak)),
      vol(limb([[14, -40 + tuck, 3.5], [10, -4, 3]]), beak),
      vol(limb([[-6, -4, 2.5], [14, -2, 2.5]]), beak),
      ...body,
    ].join(''), `translate(0 ${r1(hop)})`),
  ].join('');
}

// ── horse: chestnut (orange-dark), ink mane/tail/hooves, paper-lit blaze ─────────────────────
function horse(view, t, act) {
  const coat = T['orange-dark'], mane = T['ink-lit'], hoof = T.ink, blaze = T['paper-lit'];
  const br = 1 + 0.012 * Math.sin(t * Math.PI * 2 * 0.6);
  const tp = act ? Math.min(1, Math.max(0, (t - 0.5) / 1.0)) : 0;
  const toss = tp > 0 && tp < 1 ? -24 * Math.sin(tp * Math.PI) * (tp < 0.5 ? 1 : 1 - 0.25 * Math.sin((tp - 0.5) * Math.PI * 4)) : 0;
  const sp = act ? Math.min(1, Math.max(0, (t - 1.7) / 0.8)) : 0;
  const lift = Math.sin(sp * Math.PI);
  const swish = act ? 8 * Math.sin(t * Math.PI * 2 * 0.8) : 0;
  if (view === 'front') {
    return [
      D.shadow(0, 0, 120, 14),
      vol(limb([[-30, -210, 24], [-32, -100, 17], [-32, -20, 15]]), coat), vol(limb([[30, -210, 24], [32, -100, 17], [32, -20, 15]]), coat),
      vol(ell(-36, -10, 16, 11), hoof, { gloss: true }), vol(ell(36, -10, 16, 11), hoof, { gloss: true }),
      vol(ell(0, -230, 64 * br, 58 * br), coat),
      vol(limb([[0, -250, 46], [0, -340, 36]]), coat), vol(ell(0, -238, 40, 34), mx(coat, T['orange'], 0.12)),
      gg([
        vol([[-26, -400], [-12, -424], [-4, -392]], coat), vol([[26, -400], [12, -424], [4, -392]], coat),
        vol([[-38, -384], [0, -396], [38, -384], [34, -330], [26, -270], [0, -258], [-26, -270], [-34, -330]], coat),
        vol([[-8, -388], [8, -388], [6, -300], [0, -280], [-6, -300]], blaze),
        vol(ell(0, -270, 26, 16), mx(coat, T['shadow-warm'], 0.1)),
        vol(ell(-11, -270, 5, 6), T['ink']), vol(ell(11, -270, 5, 6), T['ink']),
        vol([[-18, -392], [0, -404], [18, -392], [6, -376], [-6, -376]], mane),
        bead(-36, -356, 6.5), bead(36, -356, 6.5),
      ].join(''), `translate(0 ${r1(toss * 0.6)})`),
    ].join('');
  }
  const pivot = [96, -270];
  const neckHead = [
    vol([[70, -300], [100, -350], [138, -388], [164, -384], [172, -350], [150, -300], [140, -240], [92, -220]], coat),
    vol([[138, -392], [158, -400], [212, -320], [226, -292], [220, -276], [196, -272], [152, -322], [136, -360]], coat),
    vol([[184, -340], [198, -334], [222, -292], [216, -282]], blaze),
    vol(ell(214, -284, 16, 12, 50), mx(coat, T['shadow-warm'], 0.35)), vol(ell(220, -292, 4, 3), T.ink),
    vol([[148, -392], [146, -424], [160, -396]], coat),
    bead(176, -352, 6.5),
    vol([[66, -296], [106, -360], [140, -398], [156, -400], [136, -376], [110, -330], [94, -270], [70, -252]], mane),
  ];
  const stepLeg = rot([[100, -190, 26], [104, -112, 17], [102, -24, 15]], [100, -190], -18 * lift).map((p, i) => [p[0], p[1] - (i === 2 ? 10 * lift : 0), [26, 17, 15][i]]);
  return [
    D.shadow(0, 0, 190, 16),
    vol(limb([[-88, -190, 30], [-70, -100, 16], [-82, -22, 15]]), far(coat)),
    vol(limb([[80, -190, 24], [84, -110, 16], [84, -22, 15]]), far(coat)),
    vol(ell(-82, -10, 16, 10), mx(hoof, T['shadow-warm'], 0.2)), vol(ell(86, -10, 16, 10), mx(hoof, T['shadow-warm'], 0.2)),
    vol(rot([[-124, -248], [-140, -200], [-150, -130], [-136, -110], [-124, -150], [-112, -230]], [-120, -240], swish), mane),
    vol(ell(-10, -224, 128, 60 * br, -2), coat),
    vol(ell(-92, -222, 50, 56), coat),
    gg(neckHead.join(''), rotAt(toss, pivot)),
    vol(limb([[-100, -200, 34], [-82, -112, 17], [-98, -24, 15]]), coat),
    vol(limb(stepLeg), coat),
    vol(ell(-98, -10, 17, 10), hoof, { gloss: true }),
    vol(ell(stepLeg[2][0], stepLeg[2][1] + 14, 17, 10), hoof, { gloss: true }),
  ].join('');
}

const DRAW = { puppy, songbird, horse };
/** The building blocks every animal is drawn from, for composing another species the same way (house-style.md § Animals). */
export const ANIMAL_PARTS = {
  /** A soft volume: a closed outline [[x, y], …] smoothed, in `fill` (draw.js softShape; `{ gloss: true }` for eyes, noses, hooves only). */
  vol,
  /** An ellipse outline at (cx, cy), radii rx × ry, turned `rot` degrees. */
  ell,
  /** A tapered limb through joints [[x, y, radius], …], rounded at both ends. */
  limb,
  /** Points turned `deg` degrees about a pivot [x, y]. */
  rot,
  /** The bead eye: one dark glossy sphere with a key catchlight top right. The only face an animal has. */
  bead,
  /** A far-side limb's colour: the coat one step darker. */
  far,
  /** A group with an optional transform; rotAt(deg, [x, y]) is a mirrored-safe rotation for it. */
  gg,
  rotAt,
  /** The soft warm contact shadow every animal stands on: shadow(0, 0, rx, ry). */
  shadow: D.shadow,
};

/** Any animal drawn with ANIMAL_PARTS: `draw(t)` returns its volumes in units, feet at (0, 0); `cm` is its real height (a small one is cheated up by core CHEAT) and `units` the drawing's height. Feet at (x, y). */
export function animalFrom(draw, x, y, { kind = 'animal', cm, units, view = 'side', s = 1, flip = false, t = 0 } = {}) {
  if (!(cm > 0) || !(units > 0)) throw new Error('animalFrom: cm and units must be positive');
  L = flip ? -1 : 1;
  try {
    // a small animal is cheated up toward CHEAT.readCm, at most CHEAT.max times its real height
    const drawn = cm < C.CHEAT.readCm ? Math.min(C.CHEAT.readCm, cm * C.CHEAT.max) : cm;
    const k = (drawn * C.PX_PER_CM * s) / units;
    // data-animal-cm: its drawn height, so lens.js paintOrder gives it a box, not a point
    return D.g({ transform: `translate(${r1(x)} ${r1(y)}) scale(${k.toFixed(4)})`, 'data-animal': kind, 'data-animal-cm': r1(drawn), 'data-view': view }, draw(t));
  } finally {
    L = 1;
  }
}

/** A real animal from the kit (ANIMALS: puppy, songbird, horse), feet at (x, y). `s` is the critter scale (s 1 = a 142 px critter); `view` 'side' (primary) or 'front'; `flip` mirrors it (the light stays top right); `action` plays its one natural action over `t`. */
export function animal(kind, x, y, { view = 'side', s = 1, flip = false, t = 0, action = false } = {}) {
  const A = ANIMALS[kind];
  if (!A) throw new Error(`animal: unknown kind "${kind}" (${Object.keys(ANIMALS).join(', ')}; compose another with animalFrom)`);
  if (!A.view.includes(view)) throw new Error(`animal: view must be ${A.view.join(' or ')}`);
  L = flip ? -1 : 1;
  try {
    const k = (A.cm * C.PX_PER_CM * s) / A.units;
    return D.g({ transform: `translate(${r1(x)} ${r1(y)}) scale(${k.toFixed(4)})`, 'data-animal': kind, 'data-animal-cm': r1(A.cm), 'data-view': view }, DRAW[kind](view, t, action));
  } finally {
    L = 1;
  }
}
