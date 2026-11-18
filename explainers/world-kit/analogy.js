// The Explainers world kit, the analogy frame's own small pieces (VISUAL_SYSTEM_6 §5): the room
// palette (core.js TOKENS when they carry the new names, else the contract's values), the two
// room moods (day, and the dusk dark beat: slate walls, lamps lit, windows dark) and the Helios
// label pill (white names, ink contrast, green status). Flat: no gradient, filter or glow.

import { TOKENS, mixHex } from './core.js';

/** VISUAL_SYSTEM_6 §2 values for the names the analogy uses (base, lit, shade, dark). */
const RAMP = {
  ink: ['#171717', '#2B2926', '#101010', '#0A0A0A'],
  paper: ['#F3F0EA', '#FBFAF6', '#E2DACB', '#CFC5B3'],
  slate: ['#6684B0', '#86A1C8', '#4F6B94', '#34496A'],
  mustard: ['#E0AB3E', '#F3C65E', '#C38F29', '#8F6418'],
  teal: ['#46978F', '#5DB5AE', '#357A74', '#24534F'],
  red: ['#B4473A', '#D27665', '#91372D', '#5F231C'],
  wood: ['#9A7250', '#B48A62', '#7E5B3E', '#5E432D'],
  leaf: ['#5F8F48', '#7FAE62', '#4A7438', '#355428'],
};
const FLAT = { wall: '#F1E9DA', wainscot: '#E4D8C3', trim: '#CDBFA6', floor: '#E2DACB', board: '#D3C9B6', window: '#BFD3EC', white: '#FFFFFF' };
const FALLBACK = { ...FLAT };
for (const [n, [b, l, s, d]] of Object.entries(RAMP)) Object.assign(FALLBACK, { [n]: b, [`${n}-lit`]: l, [`${n}-shade`]: s, [`${n}-dark`]: d });

/** A token's hex: core.js TOKENS for the new names (wall, slate, wood, leaf…) once they exist,
 *  else the contract's value; any other main token from TOKENS. Hexes pass through. */
export function tok(name) {
  if (typeof name !== 'string') return name;
  if (name.startsWith('#') || name === 'none') return name;
  const hex = TOKENS[name] ?? FALLBACK[name];
  if (hex === undefined) {
    const known = [...new Set([...Object.keys(TOKENS ?? {}), ...Object.keys(FALLBACK)])].sort();
    throw new Error(`analogy.js tok: unknown token "${name}"; known tokens: ${known.join(', ')}`);
  }
  return hex;
}
const mix = (a, b, k) => mixHex(tok(a), tok(b), k);

/** The room tones per analogy mood (wall, wainscot, trim, floor, board, window as hexes; lamps;
 *  windows 'glass' | 'dark'; textOn). `dusk` is the analogy's dark beat. */
export function roomMood(name = 'day') {
  if (name && typeof name === 'object') return name;
  if (name === 'dusk') {
    return {
      name, lamps: true, windows: 'dark', textOn: 'paper',
      wall: tok('slate-dark'), wainscot: mix('slate-dark', 'ink', 0.25), trim: tok('slate-shade'),
      floor: mix('slate', 'paper-dark', 0.35), board: mix('slate', 'paper-dark', 0.18), window: mix('slate-dark', 'ink', 0.45),
    };
  }
  if (name !== 'day') throw new Error(`HX: room mood must be day or dusk (got "${name}")`);
  return { name, lamps: false, windows: 'glass', textOn: 'ink', wall: tok('wall'), wainscot: tok('wainscot'), trim: tok('trim'), floor: tok('floor'), board: tok('board'), window: tok('window') };
}

/** A Helios pill: `kind` 'white' (a name: white fill, ink text), 'ink' (ink
 *  fill, white text) or 'green' (a status: green fill, white text). Centred at (x, y). Flat. */
export function pillSvg(text, x, y, { kind = 'white', size = 30, who = text } = {}) {
  const fills = { white: [tok('white'), tok('ink')], ink: [tok('ink'), tok('white')], green: [TOKENS.green, tok('white')] };
  const [bg, fg] = fills[kind] ?? fills.white;
  const w = Math.round(String(text).length * size * 0.62 + size * 1.4);
  const h = Math.round(size * 1.7);
  const r = (v) => Math.round(v * 10) / 10;
  return `<g data-who="${String(who).replace(/"/g, '')}" data-label="1"><rect x="${r(x - w / 2)}" y="${r(y - h / 2)}" width="${w}" height="${h}" rx="${r(h / 2)}" fill="${bg}"></rect><text x="${r(x)}" y="${r(y + size * 0.36)}" text-anchor="middle" font-family="'Pragmatica Extended', Roboto, sans-serif" font-weight="700" font-size="${size}" fill="${fg}">${String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></g>`;
}
