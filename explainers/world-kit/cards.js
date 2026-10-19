// The Explainers world kit, cards (Explainers 3.2, EX3-80): every piece of on-screen text a reel has,
// as kit components, so no frame worker lays out text by hand (the 3.1 definition card guessed
// each word's width and spaced words unevenly).
//
//   textWidth(text, size, face)      the real width in px (measured advance widths, metrics.js)
//   typeset(words, { width, size })  greedy line breaks from real widths
//   dictionaryCard(t, o)             frame 3's card: headword, part of speech, rule, and the
//                                    definition filling in word by word on its voice times
//   titleCard(t, o)                  frame 1's top-band card: "today's brain break:" and the
//                                    term, handwritten in Hershey Sans while the opener line plays,
//                                    animating from the reel's first frame (EX3-93)
//   textBox(text, x, y, o)           text inside a shape (a speech or chat bubble, a note, a sign,
//                                    a screen) with the shape sized around the text, so the text
//                                    can never leave it (EX3-92; 3.2's "happy to help!" ran out of
//                                    its bubble and off the screen)
//
// Text is set as one <text> per line with a <tspan> per word, so the browser spaces the words
// with the font's own metrics; widths here only decide where lines break.

import { T, el, g, ref, line, isDark, handwrite, handwriteWidth } from './draw.js';
import { seg, E, clamp01 } from './motion.js';
import { METRICS } from './metrics.js';

const FAMILY = { 'roboto-400': 'Roboto', 'roboto-500': 'Roboto', 'roboto-700': 'Roboto', 'pragmatica-700': "'Pragmatica Extended'" };

/** Width of `text` in px at font size `size` in `face` (a METRICS key). */
export function textWidth(text, size, face = 'roboto-500') {
  const m = METRICS[face];
  if (!m) throw new Error(`HX: no metrics for face "${face}" (${Object.keys(METRICS).join(', ')}).`);
  return ([...String(text)].reduce((n, ch) => n + (m.w[ch] ?? m.w.n), 0) * size) / 1000;
}

/**
 * Greedy line breaks: words fill each line up to `width` px. Returns [{ words: [index…], width }].
 * @param {string[]} words
 * @param {{ width: number, size: number, face?: string }} o
 */
export function typeset(words, { width, size, face = 'roboto-500' }) {
  const space = textWidth(' ', size, face);
  const lines = [];
  let cur = [];
  let w = 0;
  words.forEach((word, i) => {
    const ww = textWidth(word, size, face);
    if (cur.length && w + space + ww > width) {
      lines.push({ words: cur, width: w });
      cur = [];
      w = 0;
    }
    w += (cur.length ? space : 0) + ww;
    cur.push(i);
  });
  if (cur.length) lines.push({ words: cur, width: w });
  return lines;
}

/** One line of words as <text> with a <tspan> per word, each at its own opacity. */
function textLine(words, x, y, size, face, fill, opacities, extra = {}) {
  const [, weight] = face.split('-');
  return el(
    'text',
    { 'data-k': 'text', x: x.toFixed(1), y: y.toFixed(1), 'font-size': size, 'font-family': FAMILY[face], 'font-weight': weight, fill, ...extra },
    words.map((w, k) => el('tspan', { opacity: opacities[k].toFixed(3) }, `${k ? ' ' : ''}${escapeXml(w)}`)).join(''),
  );
}

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Frame 3's dictionary card (EX3-69): a paper card in the top half that slides in, shows the
 * headword (the topic's term) and its part of speech, then fills in the definition word by word
 * on the voice's word times and stays. Captions are quiet for the frame (the card replaces
 * them). Returns the card group (data-role="definition") and its bottom edge, so the visual
 * below it can be placed.
 * @param {number} t   frame time
 * @param {{ headword: string, pos?: string, words: { text: string, start: number }[],
 *           inAt?: number, x?: number, y?: number, w?: number, size?: number, tilt?: number }} o
 * @returns {{ svg: string, bottom: number }}
 */
export function dictionaryCard(t, { headword, pos = 'noun', words, inAt = 0, x = 104, y = 270, w = 872, size = 42, tilt = -1.2 }) {
  const pad = 48;
  const headSize = Math.min(76, (w - pad * 2) / Math.max(1, textWidth(headword, 1, 'pragmatica-700')));
  const texts = words.map((wd) => String(wd.text).trim()).filter(Boolean);
  const times = words.filter((wd) => String(wd.text).trim()).map((wd) => wd.start);
  const lines = typeset(texts, { width: w - pad * 2, size, face: 'roboto-500' });
  const lineH = size * 1.36;
  const top = y + pad + headSize * 0.78; // the headword's baseline
  const rule = top + 70;
  const defTop = rule + 26 + size; // the definition's first baseline
  const h = defTop - y + (lines.length - 1) * lineH + pad;
  const slide = seg(t, inAt, inAt + 0.35, E.out);
  const dy = (1 - slide) * 90;
  const parts = [
    el('rect', { x: x + 10, y: y + 16, width: w, height: h, rx: 14, fill: T.ink, opacity: 0.13 }),
    g({ filter: ref('wobble') }, el('rect', { x, y, width: w, height: h, rx: 14, fill: T['paper-lit'], stroke: line(), 'stroke-width': 4 })),
    textLine([headword], x + pad, top, headSize, 'pragmatica-700', T.ink, [seg(t, inAt + 0.15, inAt + 0.3, E.linear)]),
    textLine([pos.toUpperCase()], x + pad, top + 44, 28, 'roboto-700', T.green, [seg(t, inAt + 0.25, inAt + 0.4, E.linear)], { 'letter-spacing': '0.18em' }),
    g({ filter: ref('wobble'), opacity: (seg(t, inAt + 0.25, inAt + 0.4, E.linear) * 0.6).toFixed(3) }, el('line', { x1: x + pad, y1: rule, x2: x + w - pad, y2: rule, stroke: line(), 'stroke-width': 2.5, 'stroke-linecap': 'round' })),
  ];
  lines.forEach((ln, li) => {
    const ws = ln.words.map((i) => texts[i]);
    const ops = ln.words.map((i) => seg(t, times[i] ?? 0, (times[i] ?? 0) + 0.12, E.linear));
    if (ops.some((o) => o > 0)) parts.push(textLine(ws, x + pad, defTop + li * lineH, size, 'roboto-500', T.ink, ops));
  });
  const rot = tilt + (1 - slide) * 1.0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return {
    svg: g({ 'data-role': 'definition', transform: `translate(0 ${dy.toFixed(2)}) rotate(${rot.toFixed(3)} ${cx.toFixed(1)} ${cy.toFixed(1)})`, opacity: clamp01(slide * 3).toFixed(3) }, parts),
    bottom: y + h,
  };
}

/** The title card lands this long after the reel starts, and starts writing (EX3-93). */
export const TITLE_LANDS = 0.25;

/** The title card's top band: above the safe area, where captions would be (quiet in frame 1). */
export const TITLE_BAND = { x: 150, y: 250, w: 780, h: 280 };

/**
 * Frame 1's title card (EX3-61, EX3-79, EX3-93): a paper note card in the top band that starts
 * sliding in on the reel's first frame, lands by TITLE_LANDS, and writes itself while the opener
 * line plays, "today's brain break:" in ink and the term in orange beneath it, finished by `to`
 * (the line's end). The hook keeps playing below, undimmed. Returns the group
 * (data-role="title"). `from` (when the writing starts) is at most TITLE_LANDS.
 * @param {number} t
 * @param {{ term: string, from?: number, to: number, band?: typeof TITLE_BAND, tilt?: number }} o
 */
export function titleCard(t, { term, from = TITLE_LANDS, to, band = TITLE_BAND, tilt = -1.6 }) {
  from = Math.min(Number.isFinite(from) ? from : TITLE_LANDS, TITLE_LANDS);
  const { x, y, w } = band;
  let { h } = band;
  const slide = seg(t, 0, Math.max(0.12, from), E.out);
  if (slide <= 0) return '';
  const kicker = "today's brain break:";
  const kSize = Math.min(54, ((w - 80) * 0.95 * 662) / Math.max(1, handwriteWidth(kicker, 662)));
  // The term on one line when it fits at a readable size, else on two lines split at a space.
  const fit = (str) => Math.min(104, ((w - 80) * 662) / Math.max(1, handwriteWidth(str, 662)));
  let termLines = [term];
  if (fit(term) < 60 && term.includes(' ')) {
    const words = term.split(' ');
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const size = Math.min(fit(pair[0]), fit(pair[1]), 78);
      if (!best || size > best.size) best = { pair, size };
    }
    termLines = best.pair;
  }
  const tSize = termLines.length === 1 ? fit(term) : Math.min(...termLines.map(fit), 78);
  h += (termLines.length - 1) * tSize * 1.25; // the card grows for a second line
  const mid = from + (to - from) * 0.38;
  const pk = seg(t, from, mid, E.linear);
  const dy = (1 - slide) * -120;
  const parts = [
    el('rect', { x: x + 10, y: y + 14, width: w, height: h, rx: 12, fill: T.ink, opacity: 0.14 }),
    g({ filter: ref('wobble') }, el('rect', { x, y, width: w, height: h, rx: 12, fill: T['paper-lit'], stroke: line(), 'stroke-width': 4 })),
    handwrite(kicker, x + w / 2, y + 40 + kSize, kSize, pk, { align: 'center', color: T.ink }),
  ];
  termLines.forEach((str, i) => {
    const span = (to - mid) / termLines.length;
    const ly = termLines.length === 1 ? y + h - 52 : y + h - 52 - (termLines.length - 1 - i) * tSize * 1.25;
    parts.push(handwrite(str, x + w / 2, ly, tSize, seg(t, mid + i * span, mid + (i + 1) * span, E.linear), { align: 'center', color: T.orange, weight: 1.2 }));
  });
  return g({ 'data-role': 'title', transform: `translate(0 ${dy.toFixed(2)}) rotate(${tilt} ${x + w / 2} ${y + h / 2})`, opacity: clamp01(slide * 2).toFixed(3) }, parts);
}

// ── Text inside a shape (EX3-92) ─────────────────────────────────────────────────────────

/** The shapes textBox draws. */
export const BOX_KINDS = ['speech', 'chat', 'note', 'sign', 'screen'];

/**
 * Text inside a shape, the shape sized around the text: a speech bubble (round, tail below), a
 * chat bubble (tail at a bottom corner), a note card, a sign board, or a screen (dark, light text).
 * The text is measured (Hershey Sans for handwriting, Roboto otherwise), wrapped onto at most
 * `lines` lines, and shrunk only if a word still cannot fit `maxW`; the box is that text plus
 * padding, centred on (x, y). Nothing about the text is placed by hand, so it cannot leave its
 * shape. `progress` writes the handwriting (or fades typed text); `scale` pops the whole box
 * about its centre. Returns { svg, box: { x, y, w, h } } (the box in scene coordinates at scale 1).
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {{ kind?: string, size?: number, maxW?: number, lines?: number, hand?: boolean,
 *           focal?: boolean, fill?: string, color?: string, tail?: 'left' | 'right' | 'none',
 *           progress?: number, scale?: number, tilt?: number }} [o]
 */
export function textBox(text, x, y, o = {}) {
  const { kind = 'speech', size: want = 34, maxW = 420, lines: maxLines = 2, hand = true, focal = false, tail = 'left', progress = 1, scale = 1, tilt = 0 } = o;
  if (!BOX_KINDS.includes(kind)) throw new Error(`HX: textBox kind "${kind}" must be one of ${BOX_KINDS.join(', ')}`);
  const str = String(text).trim();
  const padX = kind === 'screen' ? 30 : 28;
  const padY = kind === 'screen' ? 26 : 22;
  const measure = (s, size) => (hand ? handwriteWidth(s, size) : textWidth(s, size, 'roboto-500'));
  const inner = maxW - padX * 2;
  // Wrap at the wanted size; shrink only when the words still do not fit.
  let size = want;
  let rows = [str];
  for (; size >= 14; size -= 2) {
    rows = wrap(str.split(/\s+/), inner, (s) => measure(s, size));
    if (rows.length <= maxLines && rows.every((r) => measure(r, size) <= inner + 0.5)) break;
  }
  const lineH = size * (hand ? 1.55 : 1.3);
  const textW = Math.max(...rows.map((r) => measure(r, size)));
  const w = Math.max(textW + padX * 2, size * 2.4);
  const h = rows.length * lineH - (lineH - size) + padY * 2 + (hand ? size * 0.25 : size * 0.2);
  const bx = x - w / 2;
  const by = y - h / 2;
  const fill = o.fill ?? (kind === 'screen' ? T.ink : focal ? T.orange : T['paper-lit']);
  const color = o.color ?? (kind === 'screen' ? T['paper-lit'] : T.ink);
  const edge = kind === 'screen' ? T.ink : isDark() ? T.ink : line();
  const shape = [];
  shape.push(el('rect', { x: bx + 8, y: by + 10, width: w, height: h, rx: kind === 'note' || kind === 'sign' ? 8 : 22, fill: T.ink, opacity: 0.16 }));
  if ((kind === 'speech' || kind === 'chat') && tail !== 'none') {
    const left = tail === 'left';
    const tx = left ? bx + Math.min(56, w * 0.22) : bx + w - Math.min(56, w * 0.22);
    const tip = kind === 'speech' ? [tx + (left ? -18 : 18), by + h + 34] : [left ? bx - 6 : bx + w + 6, by + h + 12];
    shape.push(el('polygon', { points: `${(tx - 16).toFixed(1)},${(by + h - 6).toFixed(1)} ${(tx + 16).toFixed(1)},${(by + h - 6).toFixed(1)} ${tip[0].toFixed(1)},${tip[1].toFixed(1)}`, fill, stroke: edge, 'stroke-width': 4, 'stroke-linejoin': 'round' }));
  }
  shape.push(el('rect', { 'data-k': 'shape', x: bx.toFixed(1), y: by.toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: kind === 'note' || kind === 'sign' ? 8 : kind === 'chat' ? 20 : 30, fill, stroke: edge, 'stroke-width': 4 }));
  // Cover the tail's join so the bubble reads as one shape.
  if ((kind === 'speech' || kind === 'chat') && tail !== 'none') {
    const left = tail === 'left';
    const tx = left ? bx + Math.min(56, w * 0.22) : bx + w - Math.min(56, w * 0.22);
    shape.push(el('rect', { x: (tx - 13).toFixed(1), y: (by + h - 9).toFixed(1), width: 26, height: 7, fill }));
  }
  const top = by + padY + size; // first baseline
  const body = rows.map((r, i) => {
    const ly = top + i * lineH;
    if (hand) {
      // Each row writes in its share of the progress.
      const p = Math.max(0, Math.min(1, progress * rows.length - i));
      return handwrite(r, x, ly, size, p, { color, align: 'center', weight: 1.1 });
    }
    return el('text', { 'data-k': 'text', x: x.toFixed(1), y: ly.toFixed(1), 'text-anchor': 'middle', 'font-size': size, 'font-family': 'Roboto', 'font-weight': 500, fill: color, opacity: Math.max(0, Math.min(1, progress)).toFixed(3) }, escapeXml(r));
  });
  const transform = `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${tilt}) scale(${Math.max(0.001, scale).toFixed(3)}) translate(${(-x).toFixed(1)} ${(-y).toFixed(1)})`;
  return {
    svg: g({ 'data-k': 'textbox', transform }, [g({ filter: ref('wobble') }, shape), ...body]),
    box: { x: bx, y: by, w, h },
  };
}

/** Greedy word wrap with a width function. */
function wrap(words, width, widthOf) {
  const rows = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && widthOf(next) > width) {
      rows.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) rows.push(cur);
  return rows;
}
