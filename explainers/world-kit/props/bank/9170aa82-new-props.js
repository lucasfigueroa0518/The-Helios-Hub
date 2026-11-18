// New drawings for this reel (EX3-114): the student's stapled book report (the hero) and the teal
// novel (the real source). The page art is shared: world.js lays the same art on the lens solids, so
// the report reads as one thing in the world, in a flat frame and in a blend.

import { el, g, handwrite, handwriteWidth, softShape, T } from '../../draw.js';

/** Art units per cm (the art is drawn big and scaled down, so the pen line stays fine). */
export const ART_PER_CM = 20;

/** The report's page, cheated 1.5× (a real page is 21 × 30 cm). */
export const REPORT_CM = [31.5, 45];
/** The novel lying flat, cheated 1.4× (a real one is 15 × 23 × 4 cm): [w, d, thickness]. */
export const NOVEL_CM = [21, 32, 5.6];

export const REPORT_TITLE = 'The Last Lighthouse';
export const REPORT_LINES = ['Mara keeps the light on', 'Gull Rock all winter.', 'When a storm wrecks a', 'ship, she rows out alone.', 'Her courage saves them.'];
export const REPORT_QUOTE = '"The sea forgets no one."';
export const QUOTE_TAG = 'p. 212';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const fit = (text, want, width) => Math.min(want, width / Math.max(1, handwriteWidth(text, 1)));

/**
 * The report's page art in art units (630 × 900, origin top-left): a title and five summary lines
 * in tidy pencil handwriting, then the made-up quote with its small lilac p. 212 tag.
 * lines 0..1 writes the title and the summary in order; quote 0..1 writes the quote, its tag
 * landing last; focus 0..1 lays the orange mark on the quote line (what to look at now); red 0..1
 * rings the tag in the error red (it was checked and could not exist). Returns { svg, quoteBox, tagBox }.
 */
export function reportPageArt({ lines = 1, quote = 1, focus = 0, red = 0 } = {}) {
  const W = REPORT_CM[0] * ART_PER_CM;
  const ink = T['ink-lit'];
  const m = 64;
  const out = [];
  // the staple, top left
  out.push(el('rect', { x: 34, y: 30, width: 58, height: 9, rx: 4.5, fill: T['ink-lit'], opacity: 0.7, transform: 'rotate(-35 63 34)' }));
  const items = [{ text: REPORT_TITLE, y: 132, size: fit(REPORT_TITLE, 46, W - 2 * m), weight: 1.5 }, ...REPORT_LINES.map((text, i) => ({ text, y: 250 + i * 94, size: fit(text, 34, W - 2 * m), weight: 1.1 }))];
  const n = clamp01(lines) * items.length;
  items.forEach((it, i) => {
    const p = clamp01(n - i);
    if (p > 0) out.push(handwrite(it.text, m, it.y, it.size, p, { color: ink, weight: it.weight }));
  });
  // a rule under the title
  if (n > 1) out.push(el('path', { d: `M ${m} 162 H ${m + Math.min(1, n - 1) * (W - 2 * m) * 0.62}`, stroke: ink, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.55 }));
  // the made-up quote, as neat as the rest, and its tag
  const qy = 250 + REPORT_LINES.length * 94 + 34;
  const qs = fit(REPORT_QUOTE, 32, 372);
  const qw = handwriteWidth(REPORT_QUOTE, qs);
  const tag = { x: m + qw + 20, y: qy - 48, w: 150, h: 62 };
  const quoteBox = { x: m - 22, y: qy - 58, w: tag.x + tag.w - m + 40, h: 82 };
  if (focus > 0) out.push(el('rect', { x: quoteBox.x, y: quoteBox.y, width: quoteBox.w, height: quoteBox.h, rx: 26, fill: T.orange, opacity: (0.36 * clamp01(focus)).toFixed(3) }));
  if (quote > 0) out.push(handwrite(REPORT_QUOTE, m, qy, qs, clamp01(quote / 0.8), { color: ink, weight: 1.1 }));
  const tagIn = clamp01((quote - 0.8) / 0.2);
  if (tagIn > 0) {
    out.push(g({ opacity: tagIn.toFixed(3) }, el('rect', { x: tag.x, y: tag.y, width: tag.w, height: tag.h, rx: 18, fill: T.lilac }) + el('rect', { x: tag.x + 4, y: tag.y + 4, width: tag.w - 8, height: tag.h * 0.42, rx: 14, fill: T['lilac-lit'], opacity: 0.55 }) + handwrite(QUOTE_TAG, tag.x + tag.w / 2, tag.y + 46, 30, 1, { color: T.canvas, weight: 1.4, align: 'center' })));
  }
  if (red > 0) {
    const k = clamp01(red);
    const cx = tag.x + tag.w / 2;
    const cy = tag.y + tag.h / 2;
    const rx = tag.w / 2 + 22;
    const ry = tag.h / 2 + 20;
    const len = Math.PI * (rx + ry) * 1.05;
    out.push(el('ellipse', { cx, cy, rx, ry, fill: 'none', stroke: T['status-error'], 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-dasharray': `${(len * k).toFixed(1)} ${len.toFixed(1)}`, transform: `rotate(-8 ${cx} ${cy})` }));
  }
  return { svg: out.join(''), quoteBox, tagBox: tag };
}

/** The novel's cover art (420 × 640 art units): a lighter teal band and a title block, no words. */
export function novelCoverArt() {
  return el('rect', { x: 40, y: 150, width: 340, height: 120, rx: 10, fill: T['teal-lit'], opacity: 0.85 })
    + el('rect', { x: 90, y: 188, width: 240, height: 18, rx: 9, fill: T['teal-dark'], opacity: 0.55 })
    + el('rect', { x: 130, y: 222, width: 160, height: 14, rx: 7, fill: T['teal-dark'], opacity: 0.4 })
    + el('rect', { x: 40, y: 520, width: 340, height: 8, rx: 4, fill: T['teal-lit'], opacity: 0.6 });
}

/** A printed page of the novel (420 × 640 art units): grey text rows and its page number, big. */
export function novelPageArt(page = 180, { short = false } = {}) {
  const rows = [];
  const n = short ? 6 : 11;
  for (let i = 0; i < n; i++) {
    const w = i === n - 1 ? 180 : 320 - ((i * 37) % 50);
    rows.push(el('rect', { x: 50, y: 70 + i * 40, width: w, height: 12, rx: 6, fill: T['text-tertiary'], opacity: 0.45 }));
  }
  if (short) rows.push(handwrite('THE END', 210, 400, 30, 1, { color: T['text-secondary'], weight: 1.2, align: 'center' }));
  rows.push(handwrite(String(page), 210, 600, 52, 1, { color: T.ink, weight: 1.6, align: 'center' }));
  return rows.join('');
}

// ── Flat drawings (propFrom: base centre at the origin, up is −y) ─────────────────────────────

const REPORT_STATES = { blank: { lines: 0, quote: 0 }, hook: { lines: 0.67, quote: 0 }, full: { lines: 1, quote: 1 }, flagged: { lines: 1, quote: 1, red: 1 } };

function flatReport({ state, focal }) {
  const s = 320 / (REPORT_CM[0] * ART_PER_CM);
  const w = 320;
  const h = REPORT_CM[1] * ART_PER_CM * s;
  const page = (dx, dy) => `M ${-w / 2 + dx + 14} ${-h + dy} H ${w / 2 + dx - 14} Q ${w / 2 + dx} ${-h + dy} ${w / 2 + dx} ${-h + dy + 14} V ${dy - 14} Q ${w / 2 + dx} ${dy} ${w / 2 + dx - 14} ${dy} H ${-w / 2 + dx + 14} Q ${-w / 2 + dx} ${dy} ${-w / 2 + dx} ${dy - 14} V ${-h + dy + 14} Q ${-w / 2 + dx} ${-h + dy} ${-w / 2 + dx + 14} ${-h + dy} Z`;
  const art = reportPageArt({ ...REPORT_STATES[state], focus: focal ? 1 : 0 });
  return [
    softShape(page(8, -2), T['paper-shade']),
    softShape(page(0, -10), T['paper-lit']),
    g({ transform: `translate(${-w / 2} ${-h - 10}) scale(${s.toFixed(4)})` }, art.svg),
  ];
}

function flatNovel({ state }) {
  const s = 0.5;
  if (state === 'open-180') {
    const pw = 420 * s;
    const ph = 640 * s;
    return [
      softShape(`M ${-pw - 10} 0 V ${-ph - 6} H ${pw + 10} V 0 Z`, T.teal),
      softShape(`M ${-pw} -8 V ${-ph} Q ${-pw / 2} ${-ph - 12} 0 ${-ph} V -8 Q ${-pw / 2} -18 ${-pw} -8 Z`, T['paper-lit']),
      softShape(`M 0 -8 V ${-ph} Q ${pw / 2} ${-ph - 12} ${pw} ${-ph} V -8 Q ${pw / 2} -18 0 -8 Z`, T['paper-lit']),
      g({ transform: `translate(${-pw} ${-ph}) scale(${s})` }, novelPageArt(179)),
      g({ transform: `translate(0 ${-ph}) scale(${s})` }, novelPageArt(180, { short: true })),
    ];
  }
  const w = 420 * 0.55;
  const h = 640 * 0.55;
  return [
    softShape(`M ${-w / 2 + 6} -4 H ${w / 2 + 6} V ${-h + 8} H ${-w / 2 + 6} Z`, T['paper-lit']),
    softShape(`M ${-w / 2} 0 V ${-h} Q ${-w / 2} ${-h - 4} ${-w / 2 + 10} ${-h - 4} H ${w / 2 - 6} V -6 H ${-w / 2 + 10} Q ${-w / 2} -6 ${-w / 2} 0 Z`, T.teal),
    g({ transform: `translate(${-w / 2} ${-h - 4}) scale(0.55)` }, novelCoverArt()),
    softShape(`M ${-w / 2 + 50} ${-h - 4} h 16 v -34 l -8 -8 l -8 8 Z`, T.yellow),
  ];
}

export const NEW_PROPS = {
  'stapled book report with a p. 212 quote tag': {
    tags: {
      is: 'a stapled two-page school book report in tidy pencil handwriting: a title, five summary lines and a quote with a small lilac p. 212 tag',
      setting: ['bedroom desk', 'classroom', 'teacher desk', 'school'],
      material: 'paper',
      parts: ['page', 'second page', 'staple', 'title', 'handwritten lines', 'quote line', 'lilac page tag', 'red check ring'],
      not: ['a printed document', 'a letter', 'a form', 'an envelope'],
    },
    size: [320, 467],
    states: Object.keys(REPORT_STATES),
    draw: flatReport,
  },
  'teal hardcover novel with a bookmark': {
    tags: {
      is: 'a thick teal hardcover novel, shut with a yellow bookmark at the front, or lying open at its last page, 180',
      setting: ['bedroom desk', 'classroom', 'teacher desk', 'library', 'home'],
      material: 'paper and cloth board',
      parts: ['front cover', 'page block', 'spine', 'bookmark', 'last page', 'page number 180'],
      not: ['a notebook', 'a report', 'a magazine', 'a tablet'],
    },
    size: [446, 431],
    states: ['shut', 'open-180'],
    draw: flatNovel,
  },
};
