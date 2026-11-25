// The AI 101 lesson card (Explainers hx-6, Lucas 2026-11-16): what every bank opener lands on.
// There is no teaser scene any more: frame 1 is the opener's own animation, then "AI 101" with an
// educational icon beside it, held to the cut into frame 2 (the definition). Code writes it as
// assets/frames/01-hook.js (frames.mjs writeOpener), so the openers keep their `ctx.hook` contract:
// the "hook" they reveal is this card, and its hero (when the opener needs a critter) is the house
// scholar: the orange critter in a graduate cap and big round glasses, holding a book.
//
//   lessonScene(key)    frame 1's card for opener `key`: { ground, shots, hero, lesson, draw(t, o) }
//   lessonIcon(kind)    one icon, drawn in a box [0, 0, w, h]: { svg, w, h }
//   SCHOLAR             the scholar's look ({ body, head, hand }), for critter() and the hand-off card
//   AI_101              the wordmark text ("AI 101")

import { T, g, el, handwrite, handwriteWidth, softShape } from '../draw.js';
import { critter } from '../cast.js';

export const AI_101 = 'AI 101';
/** The house scholar (wear.js HOUSE_HEADS): the one orange critter frame 1 and the hand-off use. */
export const SCHOLAR = { body: 'orange', head: 'scholar', hand: 'book' };

const f = (v) => (+v).toFixed(1);
const rr = (x, y, w, h, r) => `M${f(x + r)} ${f(y)} H${f(x + w - r)} Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)} V${f(y + h - r)} Q${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} H${f(x + r)} Q${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - r)} V${f(y + r)} Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)} Z`;

/** One closed book seen from about 45° above (Lucas, 2026-11-16): its cover foreshortened on top, and
 *  below it the front edge, the cover's lips around the cream page block, a coloured spine end. */
function topBook(x, y, w, depth, thick, color, shade) {
  const top = depth * 0.7;
  const side = thick * 0.7;
  return [
    el('rect', { x: f(x), y: f(y + top - 6), width: f(w), height: f(side + 6), rx: 6, fill: shade }),
    el('rect', { x: f(x + 26), y: f(y + top + 4), width: f(w - 34), height: f(side - 12), rx: 3, fill: T['paper-lit'] }),
    ...[0.35, 0.65].map((k) => el('path', { d: `M${f(x + 30)} ${f(y + top + 4 + (side - 12) * k)} H${f(x + w - 12)}`, stroke: T['paper-dark'], 'stroke-width': 2, opacity: 0.6 })),
    el('rect', { x: f(x), y: f(y), width: f(w), height: f(top), rx: 10, fill: color }),
    el('rect', { x: f(x + 10), y: f(y + 8), width: f(w * 0.55), height: f(top * 0.28), rx: 8, fill: '#fff', opacity: 0.18 }),
    el('rect', { x: f(x + 22), y: f(y), width: 12, height: f(top), fill: shade, opacity: 0.6 }),
  ].join('');
}

/** A stack of three books (red, blue, green, bottom to top), seen from 45° above. */
function bookStack() {
  const books = [
    { x: 0, w: 250, depth: 150, thick: 52, c: T.red, s: T['red-shade'] },
    { x: 18, w: 216, depth: 132, thick: 48, c: T.blue, s: T['blue-shade'] },
    { x: 8, w: 204, depth: 124, thick: 46, c: T.green, s: T['green-shade'] },
  ];
  const H = (b) => b.depth * 0.7 + b.thick * 0.7;
  let bottom = 0;
  const ys = [];
  books.forEach((b, i) => {
    // each book rests on the one below, its front edge a little behind the lower book's front edge
    const y = i === 0 ? 0 : ys[i - 1] + books[i - 1].depth * 0.7 * 0.55 - H(b);
    ys.push(y);
  });
  const minY = Math.min(...ys);
  bottom = H(books[0]) - minY;
  const svg = books.map((b, i) => topBook(b.x, ys[i] - minY, b.w, b.depth, b.thick, b.c, b.s)).join('');
  return { svg, w: 250, h: bottom };
}

/** A graduate cap (mortarboard): ink board, ink skull cap, a mustard tassel. */
function gradCap(w) {
  const s = w / 240;
  return g({ transform: `scale(${s.toFixed(4)})` }, [
    softShape('M50 112 Q50 150 120 154 Q190 150 190 112 L190 92 L50 92 Z', T['ink-lit']),
    softShape('M120 20 L236 70 L120 120 L4 70 Z', T.ink),
    el('circle', { cx: 120, cy: 70, r: 7, fill: T.mustard }),
    el('path', { d: 'M120 70 Q190 78 206 92 L206 148', stroke: T.mustard, 'stroke-width': 7, fill: 'none', 'stroke-linecap': 'round' }),
    softShape('M196 146 h20 l4 34 h-28 Z', T.mustard),
  ].join(''));
}

/** A chalkboard: wood frame, dark green board, chalk letters, a ledge with a chalk stick. */
function chalkboard(w) {
  const h = w * 0.78;
  return [
    softShape(rr(0, 0, w, h, 14), T.wood),
    softShape(rr(14, 14, w - 28, h - 40, 6), T['green-dark']),
    handwrite('A B C', w / 2, h * 0.42, w * 0.17, 1, { color: T['paper-lit'], align: 'center', weight: 1.1 }),
    el('path', { d: `M${f(w * 0.24)} ${f(h * 0.62)} q${f(w * 0.26)} -14 ${f(w * 0.52)} 0`, stroke: T['paper-lit'], 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round', opacity: 0.8 }),
    softShape(rr(-8, h - 30, w + 16, 22, 8), T['wood-shade']),
    el('rect', { x: f(w * 0.62), y: f(h - 40), width: f(w * 0.16), height: 11, rx: 5, fill: T['paper-lit'] }),
  ].join('');
}

/** The icons (each in its own box [0, 0, w, h]). */
const ICONS = {
  // red, blue, green, stacked: Lucas's AI 101 icon (2026-11-16)
  books: () => bookStack(),
  pencil: () => {
    const svg = g({ transform: 'rotate(-38 130 120)' }, [
      softShape('M20 100 H200 V140 H20 Z', T.mustard),
      el('rect', { x: 20, y: 100, width: 180, height: 13, fill: T['mustard-lit'] }),
      softShape('M200 100 L250 120 L200 140 Z', T['wood-lit']),
      softShape('M236 114 L252 120 L236 126 Z', T.ink),
      softShape('M-8 100 H22 V140 H-8 Z', T['slate-lit']),
      softShape(rr(-40, 100, 36, 40, 12), T['red-lit']),
    ].join(''));
    return { svg, w: 260, h: 240 };
  },
  apple: () => {
    const svg = [
      softShape('M110 60 C60 30 6 70 14 130 C22 190 70 222 110 200 C150 222 198 190 206 130 C214 70 160 30 110 60 Z', T.red),
      el('path', { d: 'M54 92 Q44 116 50 140', stroke: T['red-lit'], 'stroke-width': 12, fill: 'none', 'stroke-linecap': 'round', opacity: 0.8 }),
      el('path', { d: 'M110 62 Q112 34 124 16', stroke: T['wood-shade'], 'stroke-width': 9, fill: 'none', 'stroke-linecap': 'round' }),
      softShape('M122 30 C140 6 176 8 186 22 C168 42 140 44 122 30 Z', T.leaf),
    ].join('');
    return { svg, w: 220, h: 220 };
  },
  gradcap: () => ({ svg: gradCap(250), w: 250, h: 190 }),
  chalkboard: () => ({ svg: chalkboard(250), w: 250, h: 196 }),
  worksheet: () => {
    const lines = [0, 1, 2, 3, 4].map((i) => el('path', { d: `M34 ${f(70 + i * 34)} H${i === 4 ? 120 : 176}`, stroke: T['blue-lit'], 'stroke-width': 4, 'stroke-linecap': 'round' })).join('');
    const star = (cx, cy, R) => {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? R * 0.45 : R;
        pts.push(`${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`);
      }
      return softShape(`M${pts.join(' L')} Z`, T.yellow);
    };
    const svg = g({ transform: 'rotate(-6 110 130)' }, [softShape(rr(0, 0, 210, 260, 10), T['paper-lit']), el('rect', { x: 0, y: 0, width: 210, height: 260, rx: 10, fill: 'none', stroke: T['paper-dark'], 'stroke-width': 3 }), lines, star(176, 214, 42)].join(''));
    return { svg, w: 230, h: 270 };
  },
  // the scissors' cut-out: a graduate cap on a white cut-out with its dashed cut line
  'gradcap-cutout': () => {
    const svg = [
      softShape('M-6 60 Q120 -14 252 60 Q264 176 120 210 Q-18 176 -6 60 Z', T['paper-lit']),
      el('path', { d: 'M-6 60 Q120 -14 252 60 Q264 176 120 210 Q-18 176 -6 60 Z', fill: 'none', stroke: T.ink, 'stroke-width': 4, 'stroke-dasharray': '14 10', opacity: 0.55 }),
      g({ transform: 'translate(10 28)' }, gradCap(230)),
    ].join('');
    return { svg, w: 250, h: 210 };
  },
};

/** One icon by kind: { svg, w, h }. */
export function lessonIcon(kind) {
  const make = ICONS[kind];
  if (!make) throw new Error(`HX: no AI 101 icon "${kind}" (${Object.keys(ICONS).join(', ')})`);
  return make();
}

/** Each opener's education icon (Lucas approved the table, 2026-11-16); 'scholar' is the critter. */
export const OPENER_ICON = {
  typewriter: 'books',
  'paper-rip': 'pencil',
  'block-drop': 'apple',
  'balloon-pop': 'gradcap',
  'big-bang': 'chalkboard',
  unboxing: 'books',
  'paper-plane': 'worksheet',
  'knock-knock': 'books',
  'eye-zoom': 'scholar',
  scissors: 'gradcap-cutout',
};

/** The scholar's size on the card, and the card's layout. */
const SCHOLAR_S = 1.25;
const TITLE_SIZE = 170;
const GAP = 56;
/** The row's widest (title, gap and icon), inside the 1080 frame's safe margins. */
const ROW_W = 860;
const CY = 900;

/**
 * Where the card puts things for opener `key`: the title's left edge and size, the icon's box (or
 * the scholar's feet and scale), all centred as one row on CY.
 */
export function lessonLayout(key) {
  const kind = OPENER_ICON[key] ?? 'books';
  const iconW = kind === 'scholar' ? 200 * SCHOLAR_S : lessonIcon(kind).w;
  // the row fits the safe width: the title shrinks before anything crowds the edges
  const size = Math.min(TITLE_SIZE, (ROW_W - GAP - iconW) / Math.max(1e-6, handwriteWidth(AI_101, 1)));
  const titleW = handwriteWidth(AI_101, size);
  const x0 = 540 - (titleW + GAP + iconW) / 2;
  const ix = x0 + titleW + GAP;
  return {
    kind,
    title: { x: x0, y: CY, size, w: titleW },
    icon: kind === 'scholar' ? null : { x: ix, w: iconW, ...(({ h }) => ({ h, y: CY - h / 2 - 20 }))(lessonIcon(kind)) },
    scholar: kind === 'scholar' ? { at: [ix + iconW / 2, CY + 120], s: SCHOLAR_S } : null,
  };
}

/** The title alone ("AI 101", hand-lettered), `progress` 0..1. */
export function lessonTitle(key, progress = 1, { color = T.ink } = {}) {
  const L = lessonLayout(key);
  return handwrite(AI_101, L.title.x, L.title.y + L.title.size * 0.36, L.title.size, progress, { color, weight: 1.5 });
}

/** The icon alone, at its place on the card. */
export function lessonIconAt(key) {
  const L = lessonLayout(key);
  if (!L.icon) return '';
  return g({ transform: `translate(${f(L.icon.x)} ${f(L.icon.y)})`, 'data-role': 'lesson-icon' }, lessonIcon(L.kind).svg);
}

/**
 * Frame 1's card for opener `key`, as a scene module the openers reveal (ctx.hook): paper, "AI 101"
 * and its icon, or the scholar when the opener needs a critter (its `hero`). `draw(t, { hideHero,
 * heroPose })` follows the hook contract (hideHero hides the scholar, or the icon on a card with no
 * scholar, so an opener can fly its own copy in; hideTitle hides "AI 101" while an opener's own lettering
 * is on screen; bare draws the paper alone, for an opener whose card is behind it from the start); the
 * card is still (no shots).
 */
export function lessonScene(key) {
  const L = lessonLayout(key);
  const hero = L.scholar ? { who: 'scholar', critter: { ...SCHOLAR }, at: L.scholar.at, s: L.scholar.s, box: [L.scholar.at[0] - 90 * L.scholar.s, L.scholar.at[1] - 200 * L.scholar.s, L.scholar.at[0] + 90 * L.scholar.s, L.scholar.at[1] + 6 * L.scholar.s] } : null;
  return {
    ground: 'paper',
    shots: [],
    lesson: true,
    hero,
    draw(t, { hideHero = false, heroPose = {}, hideTitle = false, bare = false } = {}) {
      const paper = el('rect', { x: -50, y: -50, width: 1180, height: 2020, fill: T.paper });
      if (bare) return g({ 'data-role': 'lesson' }, paper);
      const parts = [paper, hideTitle ? '' : lessonTitle(key), hideHero && !L.scholar ? '' : lessonIconAt(key)];
      if (L.scholar && !hideHero) parts.push(critter(L.scholar.at[0], L.scholar.at[1], { ...SCHOLAR, s: L.scholar.s, mood: 'happy', look: [-0.4, 0.2], who: 'scholar', ...heroPose }));
      return g({ 'data-role': 'lesson' }, parts);
    },
  };
}
