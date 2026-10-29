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
    // A frame may hand over an inventory record (ctx.media.V4) where a path belongs; use its file.
    else if ((k === 'src' || k === 'href') && typeof v === 'object') { const f = v.src ?? v.file; if (f) el.setAttribute(k, String(f)); }
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  if (typeof kids === 'string') el.innerHTML = kids;
  else if (Array.isArray(kids)) for (const k of kids) if (k) el.append(k);
  return el;
}

/**
 * Resolve every <img> under `host` to the project's assets and wait until each is loaded and decoded
 * (MD-58). A frame that wrote an inventory path bare (bare, or with ctx.assets added to a path that already has it) still
 * finds its picture, and no frame is drawn while a picture is still decoding. Returns the images that
 * failed to load (screen.mjs reports them).
 */
export async function settleImages(host, assets = 'assets/') {
  const base = assets.replace(/\/?$/, '/');
  const imgs = [...host.querySelectorAll('img')];
  for (const img of imgs) {
    const src = img.getAttribute('src') ?? '';
    if (!src || /^(?:[a-z]+:|\/)/i.test(src)) continue;
    // One canonical path whatever the frame wrote: "media/V4.jpg", "assets/media/V4.jpg", ctx.assets + either.
    const rel = src.replace(/^(?:\.\.?\/)+/, '').replace(/^(?:assets\/)+/, '');
    if (base + rel !== src) img.setAttribute('src', base + rel);
  }
  const failed = [];
  await Promise.all(imgs.map(async (img) => {
    if (!img.getAttribute('src')) return;
    if (!img.complete) await new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });
    if (!img.naturalWidth) { failed.push(img.getAttribute('src')); return; }
    await img.decode?.().catch(() => null);
  }));
  return failed;
}

/**
 * Put a plate under text that sits on a picture, a page or a light ground, so it reads (MD-58: no text
 * on text, contrast ≥ 3:1). tone: 'dark' (light text on a dark plate, default) | 'light' (dark ink on a
 * paper plate). Returns the element.
 */
export function plate(el, { tone = 'dark', pad = [14, 22], radius = 6, opacity = 0.82 } = {}) {
  const dark = tone !== 'light';
  Object.assign(el.style, {
    background: dark ? `rgba(13,11,10,${opacity})` : `rgba(254,249,243,${Math.max(opacity, 0.9)})`,
    color: dark ? '#FEF9F3' : '#1F1915',
    padding: `${pad[0]}px ${pad[1]}px`,
    borderRadius: `${radius}px`,
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  });
  el.dataset.plate = tone;
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
