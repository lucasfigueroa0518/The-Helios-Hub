// DOM plumbing for the news kit: install the stylesheet once, build elements, place them, and mark
// words inside text so marker marks can find and measure them (D3).
import { css, FONT_FILES, fontFaces } from './style.js';

/**
 * Install the kit's styles, fonts and filters into a document once.
 * `fonts` is a folder URL (job: '../fonts/') or a map of the FONT_FILES keys to URLs.
 */
export function installKit(doc, { fonts = 'assets/fonts/', textures = 'assets/kit/textures/' } = {}) {
  if (doc.getElementById('nk-style')) return;
  const map = typeof fonts === 'string'
    ? Object.fromEntries(Object.entries(FONT_FILES).map(([k, f]) => [k, fonts.replace(/\/?$/, '/') + f]))
    : { ...Object.fromEntries(Object.entries(FONT_FILES).map(([k, f]) => [k, f])), ...fonts };
  const style = doc.createElement('style');
  style.id = 'nk-style';
  style.textContent = fontFaces(map) + css(textures.replace(/\/?$/, '/'));
  doc.head.appendChild(style);
}

/** Create an element: h(doc, 'div', { class: 'x', style: {...} }, children | html). */
export function h(doc, tag, attrs = {}, kids) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  if (typeof kids === 'string') el.innerHTML = kids;
  else if (Array.isArray(kids)) for (const k of kids) if (k) el.append(k);
  return el;
}

export const svgEl = (doc, tag, attrs = {}) => {
  const el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  return el;
};

/** Position an element: x, y (px, top-left), w, h, rot (deg), z. Keeps its resting transform in data. */
export function place(el, { x, y, w, h: ht, rot = 0, z } = {}) {
  if (x != null) el.style.left = `${x}px`;
  if (y != null) el.style.top = `${y}px`;
  if (w != null) el.style.width = `${w}px`;
  if (ht != null) el.style.height = `${ht}px`;
  if (z != null) el.style.zIndex = String(z);
  el.dataset.rot = String(rot);
  el.style.transform = rot ? `rotate(${rot}deg)` : '';
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Text with marked spans: "Take the Blue Line to [[Pier Street station]]" → the bracketed words become
 * <span data-mark="0"> so markerCircle / markerUnderline can measure them. Everything else is escaped.
 */
export function marked(text) {
  let i = 0;
  return esc(text).replace(/\[\[(.+?)\]\]/g, (_, w) => `<span class="nk-m" data-mark="${i++}" style="white-space:nowrap">${w}</span>`);
}

/** The n-th marked span inside an element (or a span found by its text). */
export function markOf(el, which = 0) {
  if (typeof which === 'number') return el.querySelectorAll('[data-mark]')[which] ?? null;
  return [...el.querySelectorAll('[data-mark]')].find((s) => s.textContent.trim() === which) ?? null;
}

/** Illegible filler lines (newspaper body that is neither facts nor invented sentences). */
export const filler = (n, { cls = 'nk-greek', w = 100 } = {}) =>
  Array.from({ length: n }, (_, i) => `<div class="${cls}" style="width:${i % 5 === 4 ? 55 : w}%"></div>`).join('');
