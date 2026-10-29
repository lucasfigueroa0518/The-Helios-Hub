// Seeded tools (MD-59): a few code-built stages where cutouts can be staged, generic marker expression
// marks to draw over a face, and collage layers. They are INSPIRATION, used only when one is an exact
// match for the moment; otherwise the director requests a `make` that fits the moment precisely.
// Everything here is drawn and reads as illustration (MD-14), never as a photo of a real event.
//
// Pure functions of their arguments (Node and browser): make.ts writes a seed's SVG as an asset file,
// and the kit's tableau()/expressionMarks()/collage() build the same seed in a frame.
//
// Coordinates are frame pixels (1080×1920). A setting is drawn in layers (`layers[0]` is the back);
// each seat says which layer the figure sits under (`under`), so a table or a dais covers the figure's
// cut edge. Seat: { id, x (centre), y (baseline: where the figure's bottom edge sits), h (figure
// height), facing ('left' | 'right' | 'front'), under (layer index drawn over the figure), clip? }.
// The upper band (y < 580) stays dark in every setting so the captions read on it.

const W = 1080;
const H = 1920;

const svg = (body, w = W, h = H) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** A soft dark band over the caption zone, shared by every setting. */
const CAPTION_DARK = '<rect width="1080" height="640" fill="url(#capdark)"/>';
const DEFS = `<defs>
<linearGradient id="capdark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0b0a" stop-opacity=".92"/><stop offset=".8" stop-color="#0d0b0a" stop-opacity=".55"/><stop offset="1" stop-color="#0d0b0a" stop-opacity="0"/></linearGradient>
<radialGradient id="lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd9a0" stop-opacity=".55"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient>
<radialGradient id="spot" cx=".5" cy=".2" r=".8"><stop offset="0" stop-color="#fff1d6" stop-opacity=".38"/><stop offset="1" stop-color="#fff1d6" stop-opacity="0"/></radialGradient>
<pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0 V14" stroke="#000" stroke-opacity=".12" stroke-width="3"/></pattern>
</defs>`;

const INK = 'stroke="#15110e" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"';

// ── Settings ────────────────────────────────────────────────────────────────

const dinnerTable = {
  id: 'dinner-table',
  kind: 'setting',
  fits: 'a reported meal among two to four people around one table',
  seats: [
    { id: 'back-left', x: 420, y: 1250, h: 560, facing: 'right', under: 1 },
    { id: 'back-right', x: 660, y: 1250, h: 560, facing: 'left', under: 1 },
    { id: 'left', x: 190, y: 1290, h: 660, facing: 'right', under: 1 },
    { id: 'right', x: 890, y: 1290, h: 660, facing: 'left', under: 1 },
  ],
  screens: [],
  layers: [
    // Back: a warm panelled room under a pendant lamp.
    `<rect width="1080" height="1920" fill="#2a211b"/>
     <rect y="980" width="1080" height="400" fill="#3a2b20"/>
     <path d="M0 980 H1080" ${INK} stroke-opacity=".5"/>
     ${[60, 300, 540, 780, 1020].map((x) => `<path d="M${x} 1000 V1360" stroke="#15110e" stroke-opacity=".35" stroke-width="4"/>`).join('')}
     <rect x="96" y="700" width="200" height="240" fill="#1d1713" ${INK} stroke-opacity=".6"/>
     <rect x="784" y="680" width="200" height="260" fill="#1d1713" ${INK} stroke-opacity=".6"/>
     <circle cx="540" cy="700" r="560" fill="url(#lamp)"/>
     <path d="M540 0 V520" stroke="#15110e" stroke-width="4"/>
     <path d="M470 600 L500 520 H580 L610 600 Z" fill="#c8823a" ${INK}/>
     ${CAPTION_DARK}`,
    // Front: the table and its cloth, plates and glasses.
    `<path d="M60 1230 H1020 L1080 1390 H0 Z" fill="#d9cdb8" ${INK}/>
     <rect y="1390" width="1080" height="530" fill="#b9ab94"/>
     <rect y="1390" width="1080" height="530" fill="url(#hatch)"/>
     <path d="M0 1390 H1080" ${INK}/>
     ${[150, 400, 680, 930].map((x) => `<path d="M${x} 1400 Q${x + 12} 1650 ${x - 6} 1920" stroke="#15110e" stroke-opacity=".25" stroke-width="4" fill="none"/>`).join('')}
     ${[250, 540, 830].map((x) => `<ellipse cx="${x}" cy="1310" rx="92" ry="26" fill="#f3ede2" ${INK}/><ellipse cx="${x}" cy="1310" rx="56" ry="15" fill="none" stroke="#15110e" stroke-opacity=".4" stroke-width="3"/>`).join('')}
     ${[380, 700].map((x) => `<path d="M${x - 22} 1210 Q${x} 1260 ${x + 22} 1210 Z M${x} 1250 V1300 M${x - 20} 1302 H${x + 20}" fill="#9a2f2a" fill-opacity=".55" ${INK}/>`).join('')}`,
  ],
};

const boardroom = {
  id: 'boardroom',
  kind: 'setting',
  fits: 'a board meeting, a vote or a negotiation around a long table',
  seats: [
    { id: 'head', x: 540, y: 1080, h: 380, facing: 'front', under: 1 },
    { id: 'left-far', x: 300, y: 1170, h: 460, facing: 'right', under: 1 },
    { id: 'right-far', x: 780, y: 1170, h: 460, facing: 'left', under: 1 },
    { id: 'left-near', x: 150, y: 1390, h: 640, facing: 'right', under: 1 },
    { id: 'right-near', x: 930, y: 1390, h: 640, facing: 'left', under: 1 },
  ],
  screens: [{ id: 'wall', x: 70, y: 660, w: 280, h: 180 }],
  layers: [
    `<rect width="1080" height="1920" fill="#1c2026"/>
     <rect x="380" y="620" width="640" height="420" fill="#26303b" ${INK} stroke-opacity=".7"/>
     ${[540, 700, 860].map((x) => `<path d="M${x} 620 V1040" stroke="#15110e" stroke-width="5" stroke-opacity=".7"/>`).join('')}
     <path d="M380 830 H1020" stroke="#15110e" stroke-width="5" stroke-opacity=".7"/>
     ${[[420, 900], [470, 960], [610, 920], [760, 980], [900, 890], [960, 970], [650, 700], [820, 760]].map(([x, y]) => `<rect x="${x}" y="${y}" width="14" height="22" fill="#ffd27a" fill-opacity=".6"/>`).join('')}
     <rect x="70" y="660" width="280" height="180" fill="#101317" ${INK}/>
     <rect y="1040" width="1080" height="880" fill="#22272e"/>
     ${CAPTION_DARK}`,
    `<path d="M400 1060 H680 L1080 1720 V1920 H0 V1720 Z" fill="#4a3324" ${INK}/>
     <path d="M430 1080 H650 L960 1700 H120 Z" fill="#5b3f2c"/>
     <path d="M520 1100 L470 1680 M560 1100 L610 1680" stroke="#fff" stroke-opacity=".08" stroke-width="18"/>
     ${[[330, 1240], [750, 1240], [200, 1480], [880, 1480]].map(([x, y]) => `<rect x="${x - 40}" y="${y}" width="80" height="56" fill="#f1ebe0" transform="rotate(${x < 540 ? -8 : 8} ${x} ${y})" ${INK} stroke-width="3"/>`).join('')}`,
  ],
};

const stage = {
  id: 'stage',
  kind: 'setting',
  fits: 'a keynote, a launch event, a conference talk or an award on a stage',
  seats: [
    { id: 'podium', x: 540, y: 1300, h: 700, facing: 'front', under: 1 },
    { id: 'stage-left', x: 220, y: 1560, h: 960, facing: 'right', under: 1 },
    { id: 'stage-right', x: 860, y: 1560, h: 960, facing: 'left', under: 1 },
  ],
  screens: [{ id: 'main', x: 140, y: 640, w: 800, h: 450 }],
  layers: [
    `<rect width="1080" height="1920" fill="#0f0d0d"/>
     <rect x="140" y="640" width="800" height="450" fill="#1a1d24" ${INK} stroke="#2e3440"/>
     <path d="M340 0 L740 0 L1000 1520 H80 Z" fill="url(#spot)"/>
     <path d="M0 1380 H1080 V1920 H0 Z" fill="#3b2a1e"/>
     ${[1430, 1500, 1590, 1700, 1840].map((y) => `<path d="M0 ${y} H1080" stroke="#15110e" stroke-opacity=".5" stroke-width="4"/>`).join('')}
     <ellipse cx="540" cy="1390" rx="420" ry="60" fill="#fff1d6" fill-opacity=".12"/>
     ${CAPTION_DARK}`,
    `<path d="M450 1250 H630 L660 1640 H420 Z" fill="#2a2a2e" ${INK} stroke="#0a0a0a"/>
     <path d="M470 1280 H610" stroke="#FF5E1A" stroke-width="6"/>
     <path d="M540 1250 Q560 1190 600 1170" stroke="#0a0a0a" stroke-width="6" fill="none"/>
     <path d="M0 1600 ${Array.from({ length: 12 }, (_, i) => `Q${i * 90 + 45} ${1470 + (i % 3) * 18} ${(i + 1) * 90} 1600`).join(' ')} V1920 H0 Z" fill="#070606"/>`,
  ],
};

const phoneCall = {
  id: 'phone-call',
  kind: 'setting',
  fits: 'a phone or video call between two people in different places',
  seats: [
    { id: 'left', x: 270, y: 1340, h: 640, facing: 'right', under: 1, clip: { x: 24, y: 600, w: 500, h: 880 } },
    { id: 'right', x: 810, y: 1340, h: 640, facing: 'left', under: 1, clip: { x: 556, y: 600, w: 500, h: 880 } },
  ],
  screens: [],
  layers: [
    `<rect width="1080" height="1920" fill="#0d0b0a"/>
     <rect x="24" y="600" width="500" height="880" fill="#29343f" ${INK}/>
     <rect x="556" y="600" width="500" height="880" fill="#3e2c22" ${INK}/>
     <rect x="70" y="680" width="170" height="220" fill="#1c252e" ${INK} stroke-opacity=".6"/>
     <rect x="840" y="660" width="170" height="250" fill="#2a1d16" ${INK} stroke-opacity=".6"/>
     <path d="M540 580 L548 760 L532 940 L550 1120 L530 1300 L544 1500" stroke="#FF5E1A" stroke-width="6" fill="none"/>
     ${CAPTION_DARK}`,
    `<rect x="24" y="1300" width="500" height="180" fill="#4a3a2c" ${INK}/>
     <rect x="556" y="1300" width="500" height="180" fill="#5a3f2c" ${INK}/>
     <path d="M420 1290 h70 v-26 h-70 z M800 1290 h70 v-26 h-70 z" fill="#15110e"/>
     <path d="M455 1300 C 470 1560, 640 1560, 835 1300" stroke="#15110e" stroke-width="5" fill="none" stroke-dasharray="10 9"/>`,
  ],
};

const hearingRoom = {
  id: 'hearing-room',
  kind: 'setting',
  fits: 'a hearing, testimony, a trial or a deposition before a panel',
  seats: [
    { id: 'panel-left', x: 280, y: 960, h: 330, facing: 'front', under: 1 },
    { id: 'panel-centre', x: 540, y: 950, h: 340, facing: 'front', under: 1 },
    { id: 'panel-right', x: 800, y: 960, h: 330, facing: 'front', under: 1 },
    { id: 'witness', x: 540, y: 1520, h: 780, facing: 'front', under: 2 },
  ],
  screens: [],
  layers: [
    `<rect width="1080" height="1920" fill="#2b1f17"/>
     ${[90, 270, 450, 630, 810, 990].map((x) => `<rect x="${x - 70}" y="600" width="140" height="330" fill="#35271d" ${INK} stroke-opacity=".4"/>`).join('')}
     <circle cx="540" cy="700" r="84" fill="#3f2f22" ${INK} stroke="#c8a052"/>
     <circle cx="540" cy="700" r="58" fill="none" stroke="#c8a052" stroke-width="4"/>
     ${CAPTION_DARK}`,
    `<path d="M40 900 H1040 V1110 H40 Z" fill="#4b3424" ${INK}/>
     <path d="M40 930 H1040" stroke="#15110e" stroke-width="4" stroke-opacity=".6"/>
     ${[280, 540, 800].map((x) => `<rect x="${x - 70}" y="945" width="140" height="40" fill="#e9dfc9" ${INK} stroke-width="3"/><path d="M${x + 60} 945 Q${x + 80} 900 ${x + 50} 870" stroke="#15110e" stroke-width="5" fill="none"/>`).join('')}
     <rect y="1110" width="1080" height="810" fill="#24190f"/>`,
    `<path d="M150 1440 H930 L990 1600 H90 Z" fill="#5a3e2a" ${INK}/>
     <rect x="90" y="1600" width="900" height="320" fill="#45301f" ${INK}/>
     <path d="M600 1440 Q630 1360 590 1320" stroke="#15110e" stroke-width="7" fill="none"/>
     <path d="M400 1395 h44 v52 h-44 z" fill="#cfe3ea" fill-opacity=".5" ${INK} stroke-width="3"/>`,
  ],
};

export const SETTINGS = Object.fromEntries([dinnerTable, boardroom, stage, phoneCall, hearingRoom].map((s) => [s.id, s]));

/** One setting's SVG: every layer (`layer: 'full'`) or one of them by index. */
export function settingSvg(id, { layer = 'full' } = {}) {
  const s = SETTINGS[id];
  if (!s) throw new Error(`settings: no seeded setting "${id}"`);
  const body = layer === 'full' ? s.layers.join('') : s.layers[layer] ?? '';
  return svg(DEFS + body);
}

// ── Expression marks (drawn in marker around a face) ───────────────────────

/**
 * Generic marker marks that show an inner state around a face (research 06 §1: a drawn layer over the
 * photo layer). `face` is the face box in frame pixels; returns [{ d, width }] paths in frame pixels.
 */
export const EXPRESSIONS = {
  worry: (f) => [0, 1, 2].map((i) => ({ d: wave(f.x + f.w * 0.1, f.y - 40 - i * 34, f.w * 0.8, 10), width: 7 }))
    .concat([{ d: drop(f.x + f.w + 26, f.y + f.h * 0.28, 26), width: 6 }]),
  anger: (f) => [{ d: zigzag(f.x - 10, f.y - 60, f.w + 20, 7), width: 8 }, { d: vein(f.x + f.w * 0.9, f.y - 6, 30), width: 8 }],
  shock: (f) => spokes(f.x + f.w / 2, f.y + f.h / 2, Math.max(f.w, f.h) * 0.75, 10).map((d) => ({ d, width: 7 })),
  thought: (f) => thought(f.x + f.w, f.y - 20, f.w).map((d) => ({ d, width: 6 })),
  question: (f) => [{ d: questionMark(f.x + f.w / 2, f.y - 70, Math.max(70, f.w * 0.45)), width: 10 }],
  idea: (f) => bulb(f.x + f.w / 2, f.y - 110, Math.max(60, f.w * 0.35)).map((d) => ({ d, width: 7 })),
  argue: (f) => [{ d: burst(f.x + f.w * 1.25, f.y + f.h * 0.75, f.w * 0.55), width: 7 }],
};

const n1 = (v) => v.toFixed(1);
function wave(x, y, w, amp) {
  let d = `M${n1(x)} ${n1(y)}`;
  const steps = 4;
  for (let i = 0; i < steps; i++) d += ` q${n1(w / steps / 2)} ${i % 2 ? amp : -amp} ${n1(w / steps)} 0`;
  return d;
}
function drop(x, y, s) {
  return `M${n1(x)} ${n1(y - s)} C${n1(x + s * 0.8)} ${n1(y)}, ${n1(x + s * 0.5)} ${n1(y + s * 0.8)}, ${n1(x)} ${n1(y + s * 0.8)} C${n1(x - s * 0.5)} ${n1(y + s * 0.8)}, ${n1(x - s * 0.8)} ${n1(y)}, ${n1(x)} ${n1(y - s)}`;
}
function zigzag(x, y, w, n) {
  let d = `M${n1(x)} ${n1(y)}`;
  for (let i = 1; i <= n; i++) d += ` L${n1(x + (w * i) / n)} ${n1(y + (i % 2 ? -28 : 0))}`;
  return d;
}
function vein(x, y, s) {
  return `M${n1(x - s)} ${n1(y - s * 0.3)} Q${n1(x)} ${n1(y)} ${n1(x - s * 0.3)} ${n1(y - s)} M${n1(x + s)} ${n1(y - s * 0.3)} Q${n1(x)} ${n1(y)} ${n1(x + s * 0.3)} ${n1(y - s)} M${n1(x - s)} ${n1(y + s * 0.3)} Q${n1(x)} ${n1(y)} ${n1(x - s * 0.3)} ${n1(y + s)} M${n1(x + s)} ${n1(y + s * 0.3)} Q${n1(x)} ${n1(y)} ${n1(x + s * 0.3)} ${n1(y + s)}`;
}
function spokes(cx, cy, r, n) {
  return Array.from({ length: n }, (_, i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return `M${n1(cx + Math.cos(a) * r)} ${n1(cy + Math.sin(a) * r)} L${n1(cx + Math.cos(a) * r * 1.3)} ${n1(cy + Math.sin(a) * r * 1.3)}`;
  });
}
function thought(x, y, s) {
  const c = (cx, cy, r) => `M${n1(cx + r)} ${n1(cy)} A${n1(r)} ${n1(r)} 0 1 0 ${n1(cx - r)} ${n1(cy)} A${n1(r)} ${n1(r)} 0 1 0 ${n1(cx + r)} ${n1(cy)}`;
  const bx = x + s * 0.55;
  const by = y - s * 0.75;
  return [c(x + 10, y - 10, 10), c(x + s * 0.2, y - s * 0.25, 16),
    `M${n1(bx - s * 0.5)} ${n1(by)} q${n1(-s * 0.1)} ${n1(-s * 0.35)} ${n1(s * 0.22)} ${n1(-s * 0.36)} q${n1(s * 0.2)} ${n1(-s * 0.25)} ${n1(s * 0.5)} ${n1(-s * 0.05)} q${n1(s * 0.4)} ${n1(-s * 0.05)} ${n1(s * 0.32)} ${n1(s * 0.35)} q${n1(s * 0.2)} ${n1(s * 0.3)} ${n1(-s * 0.2)} ${n1(s * 0.42)} q${n1(-s * 0.3)} ${n1(s * 0.2)} ${n1(-s * 0.55)} ${n1(s * 0.02)} q${n1(-s * 0.35)} ${n1(s * 0.05)} ${n1(-s * 0.29)} ${n1(-s * 0.38)}`];
}
function questionMark(x, y, s) {
  return `M${n1(x - s * 0.4)} ${n1(y - s * 0.55)} C${n1(x - s * 0.4)} ${n1(y - s * 1.05)}, ${n1(x + s * 0.5)} ${n1(y - s * 1.05)}, ${n1(x + s * 0.45)} ${n1(y - s * 0.5)} C${n1(x + s * 0.42)} ${n1(y - s * 0.15)}, ${n1(x)} ${n1(y - s * 0.12)}, ${n1(x)} ${n1(y + s * 0.2)} M${n1(x)} ${n1(y + s * 0.45)} l0 4`;
}
function bulb(x, y, s) {
  return [`M${n1(x - s * 0.25)} ${n1(y + s * 0.55)} C${n1(x - s * 0.7)} ${n1(y + s * 0.1)}, ${n1(x - s * 0.55)} ${n1(y - s * 0.7)}, ${n1(x)} ${n1(y - s * 0.7)} C${n1(x + s * 0.55)} ${n1(y - s * 0.7)}, ${n1(x + s * 0.7)} ${n1(y + s * 0.1)}, ${n1(x + s * 0.25)} ${n1(y + s * 0.55)} Z`,
    `M${n1(x - s * 0.22)} ${n1(y + s * 0.72)} H${n1(x + s * 0.22)} M${n1(x - s * 0.16)} ${n1(y + s * 0.88)} H${n1(x + s * 0.16)}`,
    ...spokes(x, y - s * 0.1, s * 0.95, 7).slice(0, 7)];
}
function burst(cx, cy, r) {
  let d = '';
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI * 2 * i) / n;
    const rr = i % 2 ? r * 0.62 : r;
    d += `${i ? ' L' : 'M'}${n1(cx + Math.cos(a) * rr)} ${n1(cy + Math.sin(a) * rr * 0.7)}`;
  }
  return d;
}

/** A preview SVG of an expression seed around a default face box (the frame draws it on the real face). */
export function expressionSvg(id, { face = { x: 390, y: 760, w: 300, h: 380 }, color = '#15110e' } = {}) {
  const fn = EXPRESSIONS[id];
  if (!fn) throw new Error(`settings: no expression seed "${id}"`);
  const paths = fn(face).map((p) => `<path d="${p.d}" fill="none" stroke="${color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return svg(`<rect x="${face.x}" y="${face.y}" width="${face.w}" height="${face.h}" rx="${face.w / 2}" fill="none" stroke="#999" stroke-dasharray="12 10" stroke-width="3"/>${paths}`);
}

// ── Collage layers ──────────────────────────────────────────────────────────

/** Paper and marker layers a collage is built from (the frame tears, tapes and stacks them). */
export const COLLAGE_LAYERS = {
  'torn-paper': { w: 900, h: 300, body: (c = '#efe6d4') => `<path d="${torn(900, 300, 7)}" fill="${c}"/>` },
  tape: { w: 260, h: 70, body: () => '<path d="M6 8 L254 0 L250 62 L2 70 Z" fill="#f4e7b5" fill-opacity=".72"/>' },
  'scribble-ring': { w: 420, h: 300, body: (c = '#FF5E1A') => `<path d="M60 170 C40 60, 330 20, 380 120 C420 220, 150 300, 70 220 C30 180, 120 70, 260 60" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>` },
  halftone: { w: 1080, h: 1920, body: () => '<defs><pattern id="ht" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="3.2" fill="#000" fill-opacity=".45"/></pattern></defs><rect width="1080" height="1920" fill="url(#ht)"/>' },
  'kraft-ground': { w: 1080, h: 1920, body: () => `<rect width="1080" height="1920" fill="#3b2e22"/>${Array.from({ length: 40 }, (_, i) => `<path d="M0 ${i * 48 + 12} H1080" stroke="#000" stroke-opacity=".06" stroke-width="2"/>`).join('')}` },
};

function torn(w, h, seed) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const top = [];
  const bottom = [];
  for (let x = 0; x <= w; x += 18 + r() * 18) top.push(`${n1(x)} ${n1(r() * 14)}`);
  for (let x = w; x >= 0; x -= 18 + r() * 18) bottom.push(`${n1(x)} ${n1(h - r() * 14)}`);
  return `M${top.join(' L')} L${n1(w)} ${n1(h / 2)} L${bottom.join(' L')} Z`;
}

export function collageSvg(id, { color } = {}) {
  const l = COLLAGE_LAYERS[id];
  if (!l) throw new Error(`settings: no collage layer "${id}"`);
  return svg(l.body(color), l.w, l.h);
}

// ── The catalogue ───────────────────────────────────────────────────────────

/** Which make kind a seed id serves: 'setting' | 'expression' | 'collage', or null when it is not a seed. */
export function seedKind(id) {
  if (SETTINGS[id]) return 'setting';
  if (EXPRESSIONS[id]) return 'expression';
  if (COLLAGE_LAYERS[id]) return 'collage';
  return null;
}

/** A seed's SVG and size (what make.ts writes as the asset file). */
export function seedSvg(id) {
  const kind = seedKind(id);
  if (kind === 'setting') return { svg: settingSvg(id), width: W, height: H, kind };
  if (kind === 'expression') return { svg: expressionSvg(id), width: W, height: H, kind };
  if (kind === 'collage') return { svg: collageSvg(id), width: COLLAGE_LAYERS[id].w, height: COLLAGE_LAYERS[id].h, kind };
  throw new Error(`settings: no seed "${id}"`);
}

/** Every seed with what it fits, for the kit guide. */
export const SEED_CATALOG = [
  ...Object.values(SETTINGS).map((s) => ({ id: s.id, kind: 'setting', fits: s.fits, seats: s.seats.map((x) => x.id), screens: s.screens.map((x) => x.id) })),
  ...Object.keys(EXPRESSIONS).map((id) => ({ id, kind: 'expression' })),
  ...Object.keys(COLLAGE_LAYERS).map((id) => ({ id, kind: 'collage' })),
];
