// 8 · Split-Flap Board: an airport departures board, every letter spinning in a clatter; it lands
// on "AI BRAIN / BREAK / AGENT LOOP", chimes, and the tiles flip over one by one into the room.
import { T, g, el, defs, scope, E, seg, lerp, room, title, fill, VOICE } from './shared.js';

const VOICE_AT = 0.15;
const ROWS = [{ text: 'AI BRAIN', color: T['paper-lit'] }, { text: 'BREAK', color: T['paper-lit'] }, { text: 'AGENT LOOP', color: T.orange }];
const COLS = 10;
const TW = 94;
const TH = 140;
const GAPX = 8;
const GAPY = 18;
const X0 = 540 - (COLS * TW + (COLS - 1) * GAPX) / 2;
const Y0 = 960 - (ROWS.length * TH + (ROWS.length - 1) * GAPY) / 2;
const LAND0 = 0.18;
const LAND1 = 0.9;
const CHIME = 0.95;
const FLIP = [1.0, 1.55];
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: 0, clatter: [0, LAND1], chimeAt: CHIME, flip: FLIP };
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const rnd = (i) => { const x = Math.sin(i * 45.33 + 7.7) * 43758.5; return x - Math.floor(x); };

/** Each tile: its row, column, final letter, when it lands, when it flips away. */
const TILES = [];
ROWS.forEach((row, r) => {
  const pad = Math.floor((COLS - row.text.length) / 2);
  for (let c = 0; c < COLS; c++) {
    const ch = row.text[c - pad] ?? ' ';
    const land = lerp(LAND0, LAND1, (c + r * 3) / (COLS + 6) + rnd(r * 10 + c) * 0.08);
    const flip = lerp(FLIP[0], FLIP[1] - 0.18, (c + r * 2) / (COLS + 4));
    TILES.push({ r, c, ch, land, flip, color: row.color });
  }
});

function tile(T0, t) {
  const x = X0 + T0.c * (TW + GAPX);
  const y = Y0 + T0.r * (TH + GAPY);
  const f = seg(t, T0.flip, T0.flip + 0.18, E.inOut);
  if (f >= 1) return '';
  const k = Math.floor(t * 30);
  const ch = t >= T0.land ? T0.ch : ABC[Math.floor(rnd(k * 7 + T0.r * 31 + T0.c) * ABC.length)];
  const flapping = t < T0.land;
  const sy = Math.abs(Math.cos(Math.PI * f));
  return g({ transform: `translate(${(x + TW / 2).toFixed(1)} ${(y + TH / 2).toFixed(1)}) scale(1 ${sy.toFixed(3)})` }, [
    el('rect', { x: -TW / 2, y: -TH / 2, width: TW, height: TH, rx: 8, fill: '#232120', stroke: '#0c0c0c', 'stroke-width': 3 }),
    ch === ' ' ? '' : el('text', { x: 0, y: 40, 'text-anchor': 'middle', 'font-family': "'Pragmatica Extended'", 'font-weight': 700, 'font-size': 104, fill: T0.color, transform: flapping && k % 2 ? 'scale(1 0.86)' : undefined }, ch),
    el('line', { x1: -TW / 2, y1: 0, x2: TW / 2, y2: 0, stroke: '#0c0c0c', 'stroke-width': 4 }),
  ]);
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f08-', 'paper');
    const parts = [defs(), room(t, { local: t })];
    if (t < FLIP[1]) {
      // the board's backing panel slides away once the tiles start flipping
      const panel = 1 - seg(t, FLIP[0], FLIP[1], (x) => x);
      parts.push(fill(T.ink, panel));
      for (const T0 of TILES) parts.push(tile(T0, t));
    }
    parts.push(title(t, FLIP[1] - 0.1, VOICE_AT));
    return parts.join('');
  },
};
