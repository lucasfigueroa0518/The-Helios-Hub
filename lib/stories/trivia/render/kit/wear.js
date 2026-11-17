// The Explainers world kit, wear (hx-5, visual system 5): what a critter wears for its role. The
// critter has no mouth, no neck and no torso, so a role lives on the HEAD and in the HANDS; the one
// body piece is the bow tie. Every piece comes from this one small kit (house-style owns the
// standards R1–R7; this file draws them and checks the closed lists).
//
//   HEADS                  the head pieces: toque, hardhat, nursecap, cap, beanie, gradcap, beret,
//                          fedora, sunhat, headphones, glasses
//   HANDS                  the hand props: cup, briefcase, book, palette, tray, football, docbag,
//                          magnifier, envelope, wateringcan, flask, camera
//   ROLES                  role name → { head?, hand?, bowtie?, headTone? } (the 17 approved roles)
//   wear(o)                a critter's resolved wear from { role?, head?, hand?, bowtie?, headTone? }
//   wearProblems(w, beats) the static rules, as strings (at most two signifiers; a hand prop needs a
//                          put-down beat before the first beat that uses the hands; closed lists)
//   headSvg, bowtieSvg, handPropSvg   the drawings, in the critter's 200-unit tile (cast.js places them)
//
// A hand prop is held only while the hands are free. It must read, so it is drawn bigger than its
// true size (GRIP: a scale and an offset so the mitten grips it). FRONT props sit in front of the
// mitten, which peeks out behind them; the rest are gripped by a handle or an edge, and the whole
// mitten is drawn over them.

import { TOKENS, mixHex } from './core.js';
import { f, ARM_POSES, INK, WHITE } from './cast.js';

const tk = (n) => TOKENS[n];
/** The piece colour: ink, or white on an ink body (a piece never matches its body). */
const pc = (body) => (body === 'ink' ? WHITE : INK);
// glass (a lens, a flask, a tumbler), and the light and dark greys of a piece on an ink body
const GLASS = mixHex(TOKENS['paper-lit'], TOKENS.window, 0.52);
const GREY_LIGHT = mixHex(TOKENS.white, TOKENS.ink, 0.495);
const GREY_DARK = mixHex(TOKENS.ink, TOKENS.white, 0.034);

/** The head pieces (closed list). */
export const HEADS = ['toque', 'hardhat', 'nursecap', 'cap', 'beanie', 'gradcap', 'beret', 'fedora', 'sunhat', 'headphones', 'glasses'];
/** The hand props (closed list). */
export const HANDS = ['cup', 'briefcase', 'book', 'palette', 'tray', 'football', 'docbag', 'magnifier', 'envelope', 'wateringcan', 'flask', 'camera'];
/** The job colours a head piece may take when the colour IS the signal. */
export const HEAD_TONES = ['slate', 'mustard', 'teal', 'red'];

/** Role name → its wear: one idea on the head and/or one in the hand (the 17 approved roles). */
export const ROLES = {
  chef: { head: 'toque' },
  builder: { head: 'hardhat' },
  nurse: { head: 'nursecap' },
  doctor: { hand: 'docbag' },
  waiter: { hand: 'tray', bowtie: true },
  'office worker': { hand: 'briefcase' },
  developer: { head: 'headphones' },
  librarian: { head: 'glasses', hand: 'book' },
  barista: { hand: 'cup' },
  coach: { head: 'cap', hand: 'football' },
  student: { head: 'gradcap' },
  artist: { head: 'beret', hand: 'palette' },
  detective: { head: 'fedora', hand: 'magnifier' },
  'mail carrier': { head: 'cap', hand: 'envelope', headTone: 'slate' },
  gardener: { head: 'sunhat', hand: 'wateringcan' },
  scientist: { head: 'glasses', hand: 'flask' },
  photographer: { hand: 'camera' },
};

/** The right arm's pose while it holds each hand prop (an ARM_POSES name). */
export const HAND_POSE = { football: 'fist', docbag: 'fist', cup: 'fist', briefcase: 'fist', book: 'fist', palette: 'fist', tray: 'shrug', magnifier: 'point', envelope: 'fist', wateringcan: 'fist', flask: 'fist', camera: 'fist' };
/** A held prop must read: [scale, dx, dy] about the hand, so the mitten grips its edge. */
export const GRIP = { football: [1.3, 26, 6], docbag: [1.2, 2, -4], cup: [1.55, 19, 8], briefcase: [1.25, 2, -4], book: [1.45, 20, 12], palette: [1.35, 10, 4], tray: [1.35, 4, 6], magnifier: [1.3, 0, 0], envelope: [1.45, 10, 6], wateringcan: [1.25, 2, -4], flask: [1.5, 22, 8], camera: [1.45, 26, 12] };
/** The props drawn in front of the mitten (it peeks out behind them); the rest are gripped. */
export const FRONT = ['cup', 'book', 'flask', 'football', 'camera'];
/** Each hand prop's extent about the hand point, unscaled, in tile units: [x0, y0, x1, y1]. */
export const PROP_BOX = {
  cup: [-17, -58, 17, 8], briefcase: [-26, -12, 26, 42], book: [-24, -46, 18, 6], palette: [-32, -56, 40, 6], tray: [-26, -52, 30, -4],
  football: [-32, -46, 32, 14], docbag: [-28, -12, 28, 44], magnifier: [-4, -58, 40, 4], envelope: [-24, -40, 26, 0], wateringcan: [-20, -12, 48, 40],
  flask: [-22, -46, 22, 8], camera: [-26, -40, 24, -2],
};

// ── head pieces (they sit on the tile's flat top, x 72–128, y 40) ─────────────────────────
/** A head piece in the 200-unit tile. `tone` (HEAD_TONES) colours it when the colour is the signal. */
export function headSvg(kind, body, tone = null) {
  const c = tone ? tk(tone) : pc(body);
  switch (kind) {
    case 'cap': return `<g transform="rotate(-6 100 40)"><path d="M78 43 C78 26 88 19 100 19 C112 19 122 26 122 43 Z" fill="${c}"/><path d="M118 39 Q134 37 144 42 Q136 47 118 44 Z" fill="${c}"/></g>`;
    case 'beanie': return `<g transform="rotate(18 128 44)"><path d="M108 46 C108 30 116 23 126 23 C136 23 144 30 144 46 Z" fill="${c}"/><rect x="105" y="41" width="42" height="8" rx="4" fill="${c}"/><circle cx="126" cy="19" r="6" fill="${c}"/></g>`;
    case 'toque': return `<path d="M84 44 V32 C74 30 74 16 84 15 C86 6 98 4 102 10 C108 4 120 8 118 16 C128 18 126 30 116 32 V44 Z" fill="${WHITE}" stroke="${INK}" stroke-width="2.5"/>`;
    case 'hardhat': return `<path d="M80 41 C80 25 89 18 100 18 C111 18 120 25 120 41 Z" fill="${tk('mustard')}"/><rect x="74" y="38" width="52" height="6" rx="3" fill="${tk('mustard')}"/>`;
    // the classic folded nurse's cap with a red cross: white, ink edge
    case 'nursecap': return `<path d="M78 44 L82 26 Q100 20 118 26 L122 44 Z" fill="${WHITE}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M97 28 h6 v5 h5 v6 h-5 v5 h-6 v-5 h-5 v-6 h5 Z" fill="${tk('red')}"/>`;
    case 'gradcap': return `<path d="M100 18 L132 28 L100 38 L68 28 Z" fill="${c}"/><rect x="86" y="30" width="28" height="12" rx="3" fill="${c}"/><path d="M128 29 V42" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`;
    case 'beret': return `<g transform="rotate(-10 100 36)"><ellipse cx="98" cy="36" rx="28" ry="8" fill="${tk('teal')}"/><path d="M98 28 V23" stroke="${tk('teal')}" stroke-width="3" stroke-linecap="round"/></g>`;
    // pinched crown, a band, a short brim
    case 'fedora': return `<g transform="rotate(-5 100 40)"><path d="M82 40 L85 22 Q92 18 100 24 Q108 18 115 22 L118 40 Z" fill="${c}"/><rect x="66" y="37" width="68" height="7" rx="3.5" fill="${c}"/><rect x="83" y="32" width="34" height="5" fill="${body !== 'ink' ? tk('wood-shade') : GREY_LIGHT}"/></g>`;
    // a wide straw brim and a band
    case 'sunhat': return `<path d="M84 40 C84 26 92 20 100 20 C108 20 116 26 116 40 Z" fill="${tk('mustard-lit')}"/><ellipse cx="100" cy="41" rx="34" ry="6" fill="${tk('mustard')}"/><rect x="85" y="33" width="30" height="5" fill="${tk('teal')}"/>`;
    case 'headphones': {
      const h = pc(body);
      return `<path d="M34 92 Q36 18 100 16 Q164 18 166 92" fill="none" stroke="${h}" stroke-width="8" stroke-linecap="round"></path><rect x="20" y="80" width="22" height="40" rx="10" fill="${h}"></rect><rect x="158" y="80" width="22" height="40" rx="10" fill="${h}"></rect>`;
    }
    case 'glasses': {
      const h = pc(body);
      return `<g fill="none" stroke="${h}" stroke-width="5"><circle cx="74" cy="96" r="27"></circle><circle cx="126" cy="96" r="27"></circle><path d="M101 94 Q100 90 99 94"></path></g>`;
    }
    default: throw new Error(`HX: head piece "${kind}" must be one of ${HEADS.join(', ')}`);
  }
}

/** The bow tie: the one body piece, low and centred. */
export const bowtieSvg = (body) => {
  const c = pc(body);
  return `<path d="M100 142 L86 135 L86 149 Z M100 142 L114 135 L114 149 Z" fill="${c}"/><circle cx="100" cy="142" r="4" fill="${c}"/>`;
};

// ── hand props, drawn about the hand point (x, y) in tile units ───────────────────────────
// R7: the silhouette alone names it; real proportions, plump; one defining detail; 2–3 flat tones,
// no outline except white-on-paper edges; held right (R3: FRONT or gripped).
const PROPS = {
  // a takeaway cup: white cup, wood sleeve, ink lid, steam
  cup: (x, y) => `<path d="M${f(x - 14)} ${f(y - 30)} L${f(x + 14)} ${f(y - 30)} L${f(x + 10)} ${f(y + 8)} L${f(x - 10)} ${f(y + 8)} Z" fill="${WHITE}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`
    + `<path d="M${f(x - 12.5)} ${f(y - 18)} L${f(x + 12.5)} ${f(y - 18)} L${f(x + 11.2)} ${f(y - 4)} L${f(x - 11.2)} ${f(y - 4)} Z" fill="${tk('wood')}"/>`
    + `<rect x="${f(x - 17)}" y="${f(y - 37)}" width="34" height="8" rx="3" fill="${INK}"/>`
    + `<path d="M${f(x - 5)} ${f(y - 44)} q-5 -7 0 -14 M${f(x + 5)} ${f(y - 44)} q5 -7 0 -14" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.55"/>`,
  // hangs from the hand: a handle loop, a wood case, a clasp
  briefcase: (x, y) => `<path d="M${f(x - 9)} ${f(y + 8)} V${f(y - 4)} Q${f(x)} ${f(y - 12)} ${f(x + 9)} ${f(y - 4)} V${f(y + 8)}" stroke="${tk('wood-shade')}" stroke-width="5" fill="none"/>`
    + `<rect x="${f(x - 26)}" y="${f(y + 6)}" width="52" height="36" rx="6" fill="${tk('wood')}"/><rect x="${f(x - 26)}" y="${f(y + 6)}" width="52" height="10" rx="5" fill="${tk('wood-shade')}"/>`
    + `<rect x="${f(x - 5)}" y="${f(y + 13)}" width="10" height="8" rx="2" fill="${tk('mustard')}"/>`,
  book: (x, y) => `<g transform="rotate(-12 ${f(x)} ${f(y)})"><rect x="${f(x - 16)}" y="${f(y - 42)}" width="34" height="46" rx="3" fill="${tk('slate')}"/>`
    + `<rect x="${f(x + 12)}" y="${f(y - 40)}" width="5" height="42" fill="${WHITE}"/><rect x="${f(x - 12)}" y="${f(y - 32)}" width="16" height="4" rx="2" fill="${tk('slate-shade')}"/></g>`,
  // a kidney-shaped palette, a thumb hole, three paints, a brush
  palette: (x, y) => `<path d="M${f(x - 30)} ${f(y - 14)} C${f(x - 32)} ${f(y - 40)} ${f(x + 16)} ${f(y - 46)} ${f(x + 26)} ${f(y - 24)} C${f(x + 32)} ${f(y - 10)} ${f(x + 16)} ${f(y)} ${f(x + 4)} ${f(y - 6)} C${f(x - 6)} ${f(y - 10)} ${f(x - 12)} ${f(y + 6)} ${f(x - 22)} ${f(y + 2)} C${f(x - 28)} ${f(y)} ${f(x - 30)} ${f(y - 6)} ${f(x - 30)} ${f(y - 14)} Z" fill="${tk('mustard-lit')}"/>`
    + `<circle cx="${f(x - 14)}" cy="${f(y - 30)}" r="5" fill="${tk('teal')}"/><circle cx="${f(x)}" cy="${f(y - 34)}" r="5" fill="${tk('red')}"/><circle cx="${f(x + 14)}" cy="${f(y - 28)}" r="5" fill="${tk('slate')}"/>`
    + `<path d="M${f(x + 8)} ${f(y - 6)} L${f(x + 34)} ${f(y - 50)}" stroke="${tk('wood-shade')}" stroke-width="4" stroke-linecap="round"/><path d="M${f(x + 32)} ${f(y - 46)} l6 -10" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
  // held up at the shoulder, a glass on it
  tray: (x, y, b) => `<path d="M${f(x - 10)} ${f(y - 30)} L${f(x - 6)} ${f(y - 52)} L${f(x + 12)} ${f(y - 52)} L${f(x + 14)} ${f(y - 30)} Z" fill="${GLASS}" stroke="${INK}" stroke-width="2.5"/>`
    + `<rect x="${f(x - 26)}" y="${f(y - 32)}" width="56" height="7" rx="3.5" fill="${b !== 'ink' ? pc(b) : WHITE}"/><path d="M${f(x)} ${f(y - 25)} V${f(y - 4)}" stroke="${INK}" stroke-width="4"/>`,
  // a plump American football: a full oval with soft points, a lit upper half, laces, end stripes
  football: (x, y) => {
    const cx = x;
    const cy = y - 16;
    const body = `M${f(cx - 30)} ${f(cy)} C${f(cx - 28)} ${f(cy - 20)} ${f(cx - 12)} ${f(cy - 25)} ${f(cx)} ${f(cy - 25)} C${f(cx + 12)} ${f(cy - 25)} ${f(cx + 28)} ${f(cy - 20)} ${f(cx + 30)} ${f(cy)} `
      + `C${f(cx + 28)} ${f(cy + 20)} ${f(cx + 12)} ${f(cy + 25)} ${f(cx)} ${f(cy + 25)} C${f(cx - 12)} ${f(cy + 25)} ${f(cx - 28)} ${f(cy + 20)} ${f(cx - 30)} ${f(cy)} Z`;
    const lit = `M${f(cx - 26)} ${f(cy - 4)} C${f(cx - 22)} ${f(cy - 19)} ${f(cx - 10)} ${f(cy - 22)} ${f(cx)} ${f(cy - 22)} C${f(cx + 10)} ${f(cy - 22)} ${f(cx + 22)} ${f(cy - 19)} ${f(cx + 26)} ${f(cy - 4)} `
      + `C${f(cx + 12)} ${f(cy - 9)} ${f(cx - 12)} ${f(cy - 9)} ${f(cx - 26)} ${f(cy - 4)} Z`;
    let laces = '';
    for (let i = 0; i < 4; i++) laces += `<path d="M${f(cx - 6 + i * 4)} ${f(cy - 12)} V${f(cy - 4)}" stroke="${WHITE}" stroke-width="2.4" stroke-linecap="round"/>`;
    return `<g transform="rotate(-24 ${f(cx)} ${f(cy)})"><path d="${body}" fill="${tk('wood')}"/><path d="${lit}" fill="${tk('wood-lit')}"/>`
      + `<path d="M${f(cx - 19)} ${f(cy - 17)} Q${f(cx - 15)} ${f(cy)} ${f(cx - 19)} ${f(cy + 17)} M${f(cx + 19)} ${f(cy - 17)} Q${f(cx + 15)} ${f(cy)} ${f(cx + 19)} ${f(cy + 17)}" stroke="${WHITE}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
      + `<path d="M${f(cx - 9)} ${f(cy - 8)} H${f(cx + 9)}" stroke="${WHITE}" stroke-width="3" stroke-linecap="round"/>${laces}</g>`;
  },
  // the doctor's bag: a rounded frame bag, the handle in the hand, a white panel with a cross
  docbag: (x, y, b) => {
    const c = b === 'ink' ? GREY_DARK : INK;
    return `<path d="M${f(x - 9)} ${f(y + 8)} V${f(y - 4)} Q${f(x)} ${f(y - 12)} ${f(x + 9)} ${f(y - 4)} V${f(y + 8)}" stroke="${c}" stroke-width="5" fill="none"/>`
      + `<path d="M${f(x - 26)} ${f(y + 14)} Q${f(x - 24)} ${f(y + 6)} ${f(x - 14)} ${f(y + 6)} H${f(x + 14)} Q${f(x + 24)} ${f(y + 6)} ${f(x + 26)} ${f(y + 14)} L${f(x + 28)} ${f(y + 40)} Q${f(x + 28)} ${f(y + 44)} ${f(x + 24)} ${f(y + 44)} H${f(x - 24)} Q${f(x - 28)} ${f(y + 44)} ${f(x - 28)} ${f(y + 40)} Z" fill="${c}"/>`
      + `<rect x="${f(x - 26)}" y="${f(y + 10)}" width="52" height="5" fill="${tk('mustard')}"/>`
      + `<rect x="${f(x - 9)}" y="${f(y + 19)}" width="18" height="18" rx="3" fill="${WHITE}"/><path d="M${f(x - 2)} ${f(y + 22)} h4 v4 h4 v4 h-4 v4 h-4 v-4 h-4 v-4 h4 Z" fill="${tk('red')}"/>`;
  },
  // raised: the lens up and out, the handle in the hand
  magnifier: (x, y) => `<path d="M${f(x)} ${f(y)} L${f(x + 12)} ${f(y - 22)}" stroke="${tk('wood-shade')}" stroke-width="7" stroke-linecap="round"/>`
    + `<circle cx="${f(x + 20)}" cy="${f(y - 38)}" r="17" fill="${GLASS}" stroke="${INK}" stroke-width="5"/>`
    + `<path d="M${f(x + 12)} ${f(y - 44)} q4 -6 10 -6" stroke="${WHITE}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  envelope: (x, y) => `<g transform="rotate(-10 ${f(x)} ${f(y)})"><rect x="${f(x - 22)}" y="${f(y - 34)}" width="46" height="30" rx="3" fill="${WHITE}" stroke="${INK}" stroke-width="2.5"/>`
    + `<path d="M${f(x - 21)} ${f(y - 33)} L${f(x + 1)} ${f(y - 17)} L${f(x + 23)} ${f(y - 33)}" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linejoin="round"/>`
    + `<rect x="${f(x + 12)}" y="${f(y - 30)}" width="8" height="8" fill="${tk('red')}"/></g>`,
  // hangs from the hand by its top handle; the spout up and out
  wateringcan: (x, y) => `<path d="M${f(x - 10)} ${f(y + 10)} Q${f(x)} ${f(y - 12)} ${f(x + 10)} ${f(y + 10)}" stroke="${tk('teal')}" stroke-width="6" fill="none"/>`
    + `<path d="M${f(x - 20)} ${f(y + 8)} H${f(x + 18)} L${f(x + 16)} ${f(y + 40)} H${f(x - 18)} Z" fill="${tk('teal-lit')}"/>`
    + `<path d="M${f(x + 16)} ${f(y + 26)} L${f(x + 40)} ${f(y + 2)}" stroke="${tk('teal')}" stroke-width="7" stroke-linecap="round"/><rect x="${f(x + 36)}" y="${f(y - 4)}" width="12" height="9" rx="3" fill="${tk('teal')}" transform="rotate(-45 ${f(x + 42)} ${f(y)})"/>`,
  // an Erlenmeyer flask: glass, a liquid, a bubble
  flask: (x, y) => `<path d="M${f(x - 6)} ${f(y - 46)} H${f(x + 6)} V${f(y - 30)} L${f(x + 20)} ${f(y + 2)} Q${f(x + 22)} ${f(y + 8)} ${f(x + 14)} ${f(y + 8)} H${f(x - 14)} Q${f(x - 22)} ${f(y + 8)} ${f(x - 20)} ${f(y + 2)} L${f(x - 6)} ${f(y - 30)} Z" fill="${GLASS}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`
    + `<path d="M${f(x - 13)} ${f(y - 12)} H${f(x + 13)} L${f(x + 19)} ${f(y + 2)} Q${f(x + 20)} ${f(y + 6)} ${f(x + 14)} ${f(y + 6)} H${f(x - 14)} Q${f(x - 20)} ${f(y + 6)} ${f(x - 19)} ${f(y + 2)} Z" fill="${tk('teal')}"/>`
    + `<circle cx="${f(x + 4)}" cy="${f(y - 20)}" r="3" fill="${tk('teal-lit')}"/><circle cx="${f(x - 2)}" cy="${f(y - 28)}" r="2" fill="${tk('teal-lit')}"/>`,
  // held up: a dark body, a white lens ring, a flash
  camera: (x, y, b) => {
    const c = b !== 'ink' ? INK : GREY_DARK;
    return `<rect x="${f(x - 26)}" y="${f(y - 34)}" width="50" height="32" rx="6" fill="${c}"/><rect x="${f(x - 20)}" y="${f(y - 40)}" width="14" height="8" rx="2" fill="${c}"/>`
      + `<circle cx="${f(x)}" cy="${f(y - 18)}" r="10" fill="${WHITE}"/><circle cx="${f(x)}" cy="${f(y - 18)}" r="5.5" fill="${tk('slate')}"/><rect x="${f(x + 12)}" y="${f(y - 30)}" width="8" height="5" rx="1.5" fill="${tk('mustard')}"/>`;
  },
};

/** A hand prop drawn about the hand point (x, y), unscaled, in tile units. */
export function handPropSvg(kind, x, y, body = 'orange') {
  const draw = PROPS[kind];
  if (!draw) throw new Error(`HX: hand prop "${kind}" must be one of ${HANDS.join(', ')}`);
  return draw(x, y, body);
}

/** Where the right hand of a pose is, in tile units (the end of the critter's own arm). */
export function handPoint(pose, side = 1) {
  const P = ARM_POSES[pose];
  if (!P) throw new Error(`HX: arm pose "${pose}" must be one of ${Object.keys(ARM_POSES).join(', ')}`);
  let pts = P;
  if (side > 0) pts = pts.map(([x, y]) => [200 - x, y]);
  const [a0, b0] = pts[0];
  const [x, y] = pts[pts.length - 1];
  return [a0 + (x - a0) * 0.82, b0 + (y - b0) * 0.82];
}

/**
 * The held prop in the critter's right hand at pose `pose` (default its HAND_POSE): the prop scaled
 * and offset by GRIP, then, for a gripped prop, the whole mitten redrawn over it. Tile units.
 */
export function heldPropSvg(kind, body = 'orange', pose = HAND_POSE[kind]) {
  const [hx, hy] = handPoint(pose, 1);
  const [k, dx, dy] = GRIP[kind];
  const prop = `<g transform="translate(${f(hx + dx)} ${f(hy + dy)}) scale(${k}) translate(${f(-hx)} ${f(-hy)})">${handPropSvg(kind, hx, hy, body)}</g>`;
  return FRONT.includes(kind) ? prop : `${prop}<circle cx="${f(hx)}" cy="${f(hy)}" r="12" fill="${INK}"/>`;
}

/** A held prop's box in tile units [x0, y0, x1, y1] (GRIP applied), for framing and labels. */
export function heldPropBox(kind, pose = HAND_POSE[kind]) {
  const [hx, hy] = handPoint(pose, 1);
  const [k, dx, dy] = GRIP[kind];
  const [x0, y0, x1, y1] = PROP_BOX[kind];
  return [hx + dx + k * x0, hy + dy + k * y0, hx + dx + k * x1, hy + dy + k * y1];
}

/**
 * A critter's resolved wear: `role` (a ROLES name) gives its pieces, and an explicit head, hand,
 * bowtie or headTone overrides them (`hand: null` puts the prop down for that beat). Unknown names
 * throw with the lists. Returns { role, head, hand, bowtie, headTone } (null where there is none).
 */
export function wear({ role = null, head, hand, bowtie, headTone } = {}) {
  if (role && role !== 'bare' && !ROLES[role]) throw new Error(`HX: role "${role}" must be one of ${Object.keys(ROLES).join(', ')}, or 'bare'`);
  const R = (role && ROLES[role]) || {};
  const w = {
    role: role ?? null,
    head: head === undefined ? R.head ?? null : head || null,
    hand: hand === undefined ? R.hand ?? null : hand || null,
    bowtie: bowtie === undefined ? !!R.bowtie : !!bowtie,
    headTone: headTone === undefined ? R.headTone ?? null : headTone || null,
  };
  if (w.head && !HEADS.includes(w.head)) throw new Error(`HX: head piece "${w.head}" must be one of ${HEADS.join(', ')}`);
  if (w.hand && !HANDS.includes(w.hand)) throw new Error(`HX: hand prop "${w.hand}" must be one of ${HANDS.join(', ')}`);
  if (w.headTone && !HEAD_TONES.includes(w.headTone)) throw new Error(`HX: headTone "${w.headTone}" must be one of ${HEAD_TONES.join(', ')}`);
  return w;
}

/**
 * The static wear rules, as problem strings (empty = fine). `w` is { role?, head?, hand?, bowtie?,
 * headTone? } (a ROLES name fills in what is not given); `beats` is [{ frame, usesHands, putsDown? }]
 * in story order. Rules: every piece is from the closed lists; at most two signifiers; a head colour
 * needs a head piece; a hand prop is held only until the first beat that uses the hands, and a
 * put-down beat must come at or before it.
 * @param {{ role?: string, head?: string, hand?: string, bowtie?: boolean, headTone?: string }} w
 * @param {Array<{ frame: number, usesHands?: boolean, putsDown?: boolean }>} [beats]
 * @returns {string[]}
 */
export function wearProblems(w, beats = []) {
  const p = [];
  if (!w || typeof w !== 'object') return ['wear must be an object { role?, head?, hand?, bowtie?, headTone? }'];
  const R = (w.role && ROLES[w.role]) || {};
  const head = w.head === undefined ? R.head : w.head;
  const hand = w.hand === undefined ? R.hand : w.hand;
  const bowtie = w.bowtie === undefined ? R.bowtie : w.bowtie;
  const headTone = w.headTone === undefined ? R.headTone : w.headTone;
  if (head && !HEADS.includes(head)) p.push(`head piece "${head}" is not one of ${HEADS.join(', ')}`);
  if (hand && !HANDS.includes(hand)) p.push(`hand prop "${hand}" is not one of ${HANDS.join(', ')}`);
  if (headTone && !HEAD_TONES.includes(headTone)) p.push(`headTone "${headTone}" is not one of ${HEAD_TONES.join(', ')}`);
  if ([head, hand, bowtie ? 'bowtie' : null].filter(Boolean).length > 2) p.push('more than two signifiers (R1)');
  if (headTone && !head) p.push('a head colour with no head piece');
  if (hand) {
    const list = Array.isArray(beats) ? beats : [];
    const first = list.find((b) => b && b.usesHands);
    if (first && !list.some((b) => b && b.putsDown && b.frame <= first.frame)) p.push(`frame ${first.frame} uses the hands while the critter still holds the ${hand}: add a put-down beat first`);
  }
  return p;
}
