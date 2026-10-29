// Reel AI Drama's full-screen treatments (MD-03, MD-41–46; the approved reel-ai-drama-look stills).
// Each is a kit function `nk.<name>(doc, options)` that returns { el, render(t), ... }: append `el` to
// the frame root in build(), call `render(t)` from the frame's render(t). render is a pure function of
// frame time. Words use Helios type (Pragmatica Extended Bold + Roboto) in paper-lit and orange;
// pictures keep the documentary grade and grain (MD-44). FRAME.md documents every option.
//
// Media come from ctx.media (assets/inventory.json): pass the entry itself as `media` (its file,
// width, height, boxes, map) or a plain `src`.
import { h, svgEl, esc, marked, plate } from './dom.js';
import { board, whiteboard, newspaper } from './scenes.js';
import { clipping, printout } from './evidence.js';
import { arrive, seg, easeOut, easeInOut, clamp, toPath, cameraAt, cameraTransform } from '../geometry.js';
import {
  coverFit, kenBurns, kbTransform, kbPoint, toFrame, findBox, scaleBox, markShape, markWindow, countUp, grainOffset, wipe,
} from '../treatment-geometry.js';

const W = 1080;
const H = 1920;

/** The documentary grades (MD-44): CSS filters on the picture plus a soft-light tint. */
export const GRADES = {
  documentary: { filter: 'grayscale(.45) contrast(1.18) brightness(.8)', tint: 'linear-gradient(160deg,#24303a 0%,#7a4a26 100%)', tintOpacity: 0.5 },
  cool: { filter: 'grayscale(.5) contrast(1.15) brightness(.78) saturate(.85)', tint: 'linear-gradient(160deg,#1c2a3a 0%,#3a4f63 100%)', tintOpacity: 0.55 },
  warm: { filter: 'sepia(.25) contrast(1.12) brightness(.82)', tint: 'linear-gradient(160deg,#3a2a1c 0%,#8a5a2a 100%)', tintOpacity: 0.45 },
  mono: { filter: 'grayscale(1) contrast(1.22) brightness(.82)', tint: null, tintOpacity: 0 },
  archival: { filter: 'sepia(.55) grayscale(.3) contrast(1.1) brightness(.85)', tint: 'linear-gradient(160deg,#2a2016 0%,#6b4e2c 100%)', tintOpacity: 0.4 },
  none: { filter: '', tint: null, tintOpacity: 0 },
};

/** Shades that keep words legible: dark under the caption band (top) and under the overlay words (bottom). */
export const SHADES = {
  top: 'linear-gradient(180deg,rgba(8,6,5,.82) 0%,rgba(8,6,5,.35) 30%,rgba(8,6,5,0) 45%)',
  bottom: 'linear-gradient(180deg,rgba(8,6,5,0) 50%,rgba(8,6,5,.55) 72%,rgba(8,6,5,.9) 100%)',
};

const srcOf = (o) => o.src ?? o.media?.file ?? '';
const sizeOf = (o) => [o.width ?? o.media?.width ?? 0, o.height ?? o.media?.height ?? 0];
/** The share of the frame height a face's centre sits at when the crop follows it (the upper third). */
export const FACE_LINE = 0.36;
/**
 * The cover-fit focus that puts a photo's face (the harvest's normalised `face` box) on FACE_LINE,
 * so a portrait is never "a shot of his shirt". Null without a face or a size.
 */
export function faceFocus(face, width, height) {
  if (!face || !(width > 0) || !(height > 0)) return null;
  const s = Math.max(W / width, H / height);
  const fx = face.x + face.w / 2;
  const fy = face.y + face.h / 2 + ((0.5 - FACE_LINE) * H) / s / height;
  return [Math.min(1, Math.max(0, fx)), Math.min(1, Math.max(0, fy))];
}
const win = (at, dflt) => (Array.isArray(at) ? at : typeof at === 'number' ? [at, at + dflt] : null);

/** A moving film-grain layer (coarse, subtle; research 03 §7). */
export function grain(doc, { opacity = 0.2 } = {}) {
  const el = h(doc, 'div', { class: 'nk-grain', style: { opacity: String(opacity) } });
  return { el, render(t) { const [x, y] = grainOffset(t); el.style.backgroundPosition = `${x}px ${y}px`; } };
}

/** The small source credit line (CC licences need it on screen). Not checked as readable text. */
export function credit(doc, text, { y = 1560, light = false } = {}) {
  return h(doc, 'div', { class: `rd-credit${light ? ' on-light' : ''}`, 'data-credit': '', style: { top: `${y}px` } }, esc(text));
}

/** A picture cover-fitted into a 1080×1920 layer that the Ken Burns camera moves. */
function coverLayer(doc, { src, width, height, focus, filter = '', blur = 0 }) {
  const fit = coverFit(width, height, focus);
  const layer = h(doc, 'div', { class: 'rd-layer' });
  const img = width > 0 && height > 0
    ? h(doc, 'img', { class: 'rd-img', src, alt: '', style: { left: `${fit.x}px`, top: `${fit.y}px`, width: `${fit.w}px`, height: `${fit.h}px` } })
    : h(doc, 'img', { class: 'rd-cover', src, alt: '', style: { objectPosition: `${(focus[0] * 100).toFixed(1)}% ${(focus[1] * 100).toFixed(1)}%` } });
  const f = [filter, blur ? `blur(${blur}px)` : ''].filter(Boolean).join(' ');
  if (f) img.style.filter = f;
  layer.append(img);
  return { layer, img, fit };
}

/** The shared look of a graded picture: tint, shades, vignette, grain. */
function finish(doc, el, { grade = 'documentary', top = true, bottom = true, vignette = true, grainOpacity = 0.2 } = {}) {
  const g = GRADES[grade] ?? GRADES.documentary;
  if (g.tint) el.append(h(doc, 'div', { class: 'rd-tint', style: { background: g.tint, opacity: String(g.tintOpacity) } }));
  if (top) el.append(h(doc, 'div', { class: 'rd-shade', style: { background: SHADES.top } }));
  if (bottom) el.append(h(doc, 'div', { class: 'rd-shade', style: { background: SHADES.bottom } }));
  if (vignette) el.append(h(doc, 'div', { class: 'rd-vignette' }));
  const gr = grain(doc, { opacity: grainOpacity });
  el.append(gr.el);
  return gr;
}

/**
 * `photo`: a real photo full screen, graded, with grain and vignette, moved by a Ken Burns camera.
 * Options: media | src, width, height, focus [fx, fy] (0–1 of the image; the detail the narration
 * names; default: the media's face on the upper third, else [0.5, 0.4]), move (push | pull | pan | hold), dir (pan: left | right | up | down), amount, at [t0, t1] (the
 * move's window; default the whole frame via `duration`), duration, grade, top, bottom, vignette, grain,
 * blur, credit, parallax { fg, plate?, depth } (MD-14: the subject cut from this same photo moves a
 * little more than the plate behind it; the gap it opens is filled by `plate`, an inpainted copy, or by
 * the photo itself softened).
 */
export function photo(doc, o = {}) {
  const [width, height] = sizeOf(o);
  const focus = o.focus ?? faceFocus(o.media?.face, width, height) ?? [0.5, 0.4];
  const grade = GRADES[o.grade ?? 'documentary'] ?? GRADES.documentary;
  const el = h(doc, 'div', { class: 'rd rd-photo', 'data-treatment': 'photo' });
  const base = coverLayer(doc, {
    src: o.parallax?.plate ?? srcOf(o), width, height, focus, filter: grade.filter,
    blur: o.blur ?? (o.parallax && !o.parallax.plate ? 3 : 0),
  });
  el.append(base.layer);
  const fg = o.parallax?.fg ? coverLayer(doc, { src: o.parallax.fg, width, height, focus, filter: grade.filter }) : null;
  if (fg) el.append(fg.layer);
  const gr = finish(doc, el, { grade: o.grade, top: o.top ?? true, bottom: o.bottom ?? true, vignette: o.vignette ?? true, grainOpacity: o.grain ?? 0.2 });
  if (o.credit) el.append(credit(doc, o.credit));
  const [t0, t1] = win(o.at, 0) ?? [0, o.duration ?? 6];
  const at = toFrame(base.fit, [focus[0] * (width || 1), focus[1] * (height || 1)]);
  const move = o.move ?? 'push';
  const depth = o.parallax?.depth ?? 0.06;
  const render = (t) => {
    const u = seg(t, t0, t1);
    const cam = kenBurns(move, u, { at: width ? at : [focus[0] * W, focus[1] * H], amount: o.amount ?? 0.12, dir: o.dir ?? 'left' });
    base.layer.style.transform = kbTransform(cam);
    if (fg) {
      // The subject rides a little ahead of the plate: more scale about the same point.
      const s = cam.s * (1 + depth * u);
      const p = width ? at : [focus[0] * W, focus[1] * H];
      const [px, py] = kbPoint(cam, p);
      fg.layer.style.transform = kbTransform({ s, tx: px - p[0] * s, ty: py - p[1] * s });
    }
    gr.render(t);
  };
  render(0);
  return { el, base, fg, render, at };
}

/**
 * `cutout_lift`: a banked character cutout (MD-41) lifted off a dark or softened backdrop, then a slow
 * push. Options: cutout (src), backdrop (src; blurred and darkened; default a dark ground), height
 * (px, default 1440), bottom (px from the frame bottom, 180), at [t0, t1] (the lift), duration, name,
 * role (a built-in lower third after the lift), credit.
 */
export function cutoutLift(doc, o = {}) {
  const el = h(doc, 'div', { class: 'rd rd-cutout-lift', 'data-treatment': 'cutout_lift' });
  let back = null;
  if (o.backdrop) {
    back = coverLayer(doc, { src: o.backdrop, width: o.backdropWidth ?? 0, height: o.backdropHeight ?? 0, focus: o.backdropFocus ?? [0.5, 0.35], filter: 'grayscale(.6) brightness(.45)', blur: 22 });
    back.layer.style.transformOrigin = '50% 40%';
    el.append(back.layer);
  } else {
    el.style.background = 'radial-gradient(ellipse at 50% 40%,#2b2622 0%,#0d0b0a 75%)';
  }
  el.append(h(doc, 'div', { class: 'rd-tint', style: { background: GRADES.documentary.tint, opacity: '0.5' } }));
  const ht = o.height ?? 1440;
  const fig = h(doc, 'img', { class: 'abs', src: o.cutout ?? '', alt: '', style: { left: '50%', bottom: `${o.bottom ?? 180}px`, height: `${ht}px`, transformOrigin: '50% 100%', filter: 'contrast(1.08) brightness(.95) drop-shadow(0 30px 50px rgba(0,0,0,.6))' } });
  el.append(fig);
  el.append(h(doc, 'div', { class: 'rd-shade', style: { background: 'linear-gradient(180deg,rgba(8,6,5,0) 60%,rgba(8,6,5,.85) 78%,#080605 92%)' } }));
  el.append(h(doc, 'div', { class: 'rd-shade', style: { background: SHADES.top, opacity: '0.7' } }));
  el.append(h(doc, 'div', { class: 'rd-vignette' }));
  const gr = grain(doc);
  el.append(gr.el);
  const [t0, t1] = win(o.at, 0.6) ?? [0.1, 0.7];
  const dur = o.duration ?? 6;
  const l3 = o.name ? lowerThird(doc, { name: o.name, role: o.role, at: t1 + 0.15 }) : null;
  if (l3) el.append(l3.el);
  if (o.credit) el.append(credit(doc, o.credit));
  const render = (t) => {
    const m = arrive(seg(t, t0, t1), { from: [0, 60], lift: -0.03, settle: 2 });
    const push = 1 + 0.04 * easeInOut(seg(t, t1, dur));
    fig.style.visibility = m.visible ? '' : 'hidden';
    fig.style.transform = `translate(-50%, ${m.y.toFixed(2)}px) scale(${(m.scale * push).toFixed(4)})`;
    if (back) back.layer.style.transform = `scale(${(1.2 + 0.03 * seg(t, 0, dur)).toFixed(4)})`;
    l3?.render(t);
    gr.render(t);
  };
  render(0);
  return { el, figure: fig, lowerThird: l3, render };
}

/**
 * `collision`: two people (character cutouts) slide in from opposite sides and meet, with what they
 * fight over (a logo or object) between them. Options: left { src, height }, right { src, height },
 * center { src, w, light } (light: a dark one-colour logo shown light on the dark ground), at [t0, t1]
 * (the meeting), credit.
 */
export function collision(doc, o = {}) {
  const el = h(doc, 'div', { class: 'rd rd-collision', 'data-treatment': 'collision', style: { background: 'radial-gradient(ellipse at 50% 40%,#2b2622 0%,#0d0b0a 75%)' } });
  const centre = o.center?.src ? h(doc, 'img', { class: 'abs', src: o.center.src, alt: '', 'data-role': 'logo', style: { left: '50%', top: `${o.center.y ?? 620}px`, width: `${o.center.w ?? 240}px`, transform: 'translateX(-50%)', filter: o.center.light ? 'invert(1) brightness(.85)' : '' } }) : null;
  if (centre) el.append(centre);
  const side = (s, which) => h(doc, 'img', { class: 'abs', src: s?.src ?? '', alt: '', style: { [which]: `${s?.inset ?? (which === 'left' ? -150 : -70)}px`, bottom: `${s?.bottom ?? 640}px`, height: `${s?.height ?? 780}px`, filter: 'grayscale(.3) contrast(1.1) brightness(.92)' } });
  const L = side(o.left, 'left');
  const R = side(o.right, 'right');
  el.append(L, R);
  el.append(h(doc, 'div', { class: 'rd-shade', style: { background: 'linear-gradient(180deg,rgba(13,11,10,0) 52%,#0d0b0a 70%)' } }));
  el.append(h(doc, 'div', { class: 'rd-shade', style: { background: SHADES.top, opacity: '0.6' } }));
  el.append(h(doc, 'div', { class: 'rd-vignette' }));
  const gr = grain(doc);
  el.append(gr.el);
  if (o.credit) el.append(credit(doc, o.credit));
  const [t0, t1] = win(o.at, 0.7) ?? [0.1, 0.8];
  const render = (t) => {
    const u = easeOut(seg(t, t0, t1));
    // Each side starts wholly outside the frame, whatever its width (MD-58: never visible before its entrance).
    const offL = Math.max(520, L.offsetLeft + L.offsetWidth + 40);
    const offR = Math.max(520, W - R.offsetLeft + 40);
    L.style.transform = `translateX(${(-offL * (1 - u)).toFixed(1)}px)`;
    R.style.transform = `translateX(${(offR * (1 - u)).toFixed(1)}px)`;
    if (centre) {
      const c = seg(t, t1 - 0.1, t1 + 0.25);
      centre.style.opacity = c.toFixed(3);
      centre.style.transform = `translateX(-50%) scale(${(0.94 + 0.06 * easeOut(c)).toFixed(4)})`;
    }
    gr.render(t);
  };
  render(0);
  return { el, left: L, right: R, center: centre, render };
}

/** Draw measured marks into an SVG: [{ box: index | text, kind, at: cue, color, width }]. */
function drawMarks(doc, svg, boxes, marks, k, { color = 'var(--rd-orange)' } = {}) {
  const out = [];
  (marks ?? []).forEach((m, i) => {
    const b = findBox(boxes, m.box ?? i);
    if (!b) return;
    const kind = m.kind ?? 'circle';
    const shape = markShape(kind, scaleBox(b, k), { seed: i + 1, pad: m.pad ?? 14 });
    const p = svgEl(doc, 'path', { d: toPath(shape.pts), stroke: m.color ?? color, 'stroke-width': kind === 'highlight' ? shape.width : (m.width ?? 11) });
    if (kind === 'highlight') { p.setAttribute('class', 'hl'); p.setAttribute('stroke', m.color ?? '#FFB23A'); p.setAttribute('stroke-opacity', '0.45'); }
    svg.append(p);
    const L = shape.length;
    const w = markWindow(kind, L, m.at ?? 1);
    const progress = (u) => {
      const x = clamp(u);
      p.style.strokeDasharray = `${L} ${L + 10}`;
      p.style.strokeDashoffset = String(L * (1 - x));
      p.style.opacity = x > 0 ? '1' : '0';
    };
    progress(0);
    out.push({ el: p, kind, box: b, shape, window: w, progress, render: (t) => progress(seg(t, w.start, w.end)) });
  });
  return out;
}

/** The camera of an evidence image: a slow push from the frame toward the marked box. */
function evidenceCamera(doc, el, sheet, { x, y, scale, tilt, fit }, target, o) {
  const cam = h(doc, 'div', { class: 'rd-layer' });
  cam.append(sheet);
  el.append(cam);
  const [t0, t1] = win(o.push?.at, 0) ?? [0, o.duration ?? 6];
  const to = target ? [x + (target.x + target.w / 2) * scale, y + (target.y + target.h / 2) * scale] : [W / 2, y + (fit / 2)];
  const zoom = o.push?.scale ?? 1.12;
  const keys = [
    { t: t0, x: W / 2, y: H / 2, scale: 1, ease: 'inOut' },
    { t: t1, x: W / 2 + (to[0] - W / 2) * 0.5, y: H / 2 + (to[1] - H / 2) * 0.35, scale: zoom, ease: 'inOut' },
  ];
  return { cam, apply: (t) => { cam.style.transform = cameraTransform(cameraAt(t, keys)); } };
}

/**
 * `page`: a real page's screenshot (MD-43) with marks measured onto the words. Options: media | src,
 * width, height (image px), boxes (the harvest's [{ text, x, y, w, h }] in image px; default
 * media.boxes), marks [{ box: index | text, kind: circle | underline | highlight | box, at: cue seconds
 * (the stroke ends on it), color }], fit (display width, 1300), x, y (top-left on screen, -40 / 640),
 * tilt (deg, -1.2), push { at: [t0, t1], scale }, duration, credit, arrive (seconds: the page slides in).
 */
export function page(doc, o = {}) {
  return evidence(doc, o, { treatment: 'page', fit: 1300, x: -40, y: 640, tilt: -1.2, ground: '#100e0c', paper: false });
}

/**
 * `document`: a real document (a scan, a filing, a letter, a paper's PDF page) as paper on a desk, with
 * measured marks. Same options as `page`; defaults fit 1000, x 40, y 620, tilt 1.4, paper texture on.
 * With `text` instead of a picture it prints a recreation (a statement on letterhead) and labels it
 * "Recreated from <credit>" (research 03 §7: a rebuilt document must read as one).
 */
export function documentSheet(doc, o = {}) {
  if (!srcOf(o) && o.text) return recreated(doc, o, 'document', 'statement');
  return evidence(doc, o, { treatment: 'document', fit: 1000, x: 40, y: 620, tilt: 1.4, ground: 'radial-gradient(80% 60% at 50% 45%,#3a2e22,#14100c 85%)', paper: true });
}

/**
 * `post`: a real social post's screenshot as a card, with measured marks. Same options as `page`;
 * defaults fit 940, x 70, y 660, tilt 0, rounded card; `backdrop` (src) softens a picture behind it.
 * With `text` (and speaker, date) instead of a picture it prints a labelled recreation.
 */
export function post(doc, o = {}) {
  if (!srcOf(o) && o.text) return recreated(doc, o, 'post', 'post');
  return evidence(doc, o, { treatment: 'post', fit: 940, x: 70, y: 660, tilt: 0, ground: '#0f0d0c', paper: false, card: true });
}

function evidence(doc, o, d) {
  const [width, height] = sizeOf(o);
  const fit = o.fit ?? d.fit;
  const k = width > 0 ? fit / width : 1;
  const dispH = height > 0 ? height * k : fit * 0.7;
  const x = o.x ?? d.x, y = o.y ?? d.y, tilt = o.tilt ?? d.tilt;
  const el = h(doc, 'div', { class: 'rd', 'data-treatment': d.treatment, style: { background: d.ground } });
  if (o.backdrop) {
    const b = coverLayer(doc, { src: o.backdrop, width: 0, height: 0, focus: [0.5, 0.4], filter: 'grayscale(.6) brightness(.4)', blur: 24 });
    el.append(b.layer);
  }
  const sheet = h(doc, 'div', { class: `rd-sheet${d.paper ? ' rd-paper' : ''}${d.card ? ' rd-postcard' : ''}`, style: { left: `${x}px`, top: `${y}px`, width: `${fit}px`, height: `${dispH}px`, transform: tilt ? `rotate(${tilt}deg)` : '' } });
  const img = h(doc, 'img', { class: 'abs', src: srcOf(o), alt: '', style: { left: '0', top: '0', width: `${fit}px`, height: `${dispH}px`, filter: d.paper ? 'contrast(1.05) brightness(.96) sepia(.12)' : 'contrast(1.05) brightness(.97)' } });
  const svg = svgEl(doc, 'svg', { class: 'rd-ink', width: fit, height: Math.round(dispH) });
  sheet.append(img, svg);
  const boxes = o.boxes ?? o.media?.boxes ?? [];
  const marks = drawMarks(doc, svg, boxes, o.marks, k);
  const target = marks[0] ? scaleBox(marks[0].box, k) : null;
  const camera = evidenceCamera(doc, el, sheet, { x, y, scale: 1, tilt, fit: dispH }, target, o);
  // The top fade keeps the caption band on the dark ground (approved still 4).
  el.append(h(doc, 'div', { class: 'rd-shade', style: { background: `linear-gradient(180deg,${d.treatment === 'document' ? '#14100c' : d.ground.startsWith('#') ? d.ground : '#100e0c'} 30%,rgba(16,14,12,0) 34%)`, height: '640px', bottom: 'auto' } }));
  el.append(h(doc, 'div', { class: 'rd-vignette' }));
  const gr = grain(doc, { opacity: 0.18 });
  el.append(gr.el);
  if (o.credit) el.append(credit(doc, o.credit, { y: 1600 }));
  const inAt = o.arrive ?? null;
  const render = (t) => {
    camera.apply(t);
    if (inAt != null) {
      const m = arrive(seg(t, inAt, inAt + 0.35), { from: [0, 140], lift: 0.02, settle: 2 });
      sheet.style.visibility = m.visible ? '' : 'hidden';
      sheet.style.transform = `translate(0, ${m.y.toFixed(2)}px) rotate(${tilt}deg) scale(${m.scale.toFixed(4)})`;
    }
    for (const m of marks) m.render(t);
    gr.render(t);
  };
  render(0);
  return { el, sheet, img, marks, scale: k, render };
}

function recreated(doc, o, treatment, kind) {
  const el = h(doc, 'div', { class: 'rd', 'data-treatment': treatment, style: { background: 'radial-gradient(80% 60% at 50% 45%,#3a2e22,#14100c 85%)' } });
  const sheet = printout(doc, { kind, speaker: o.speaker ?? '', date: o.date ?? '', text: o.text ?? '', x: 110, y: 700, w: 860, rot: o.tilt ?? -1 });
  sheet.style.zIndex = '2';
  el.append(sheet);
  el.append(h(doc, 'div', { class: 'rd-vignette' }));
  const gr = grain(doc, { opacity: 0.18 });
  el.append(gr.el);
  el.append(credit(doc, `Recreated from ${o.credit ?? 'the record'}`, { y: 1600 }));
  const inAt = o.arrive ?? 0;
  const render = (t) => {
    const m = arrive(seg(t, inAt, inAt + 0.35), { from: [0, 140], lift: 0.02, settle: 2 });
    sheet.style.visibility = m.visible ? '' : 'hidden';
    sheet.style.transform = `translate(0, ${m.y.toFixed(2)}px) rotate(${o.tilt ?? -1}deg) scale(${m.scale.toFixed(4)})`;
    gr.render(t);
  };
  render(0);
  return { el, sheet, marks: [], render, recreated: true };
}

/**
 * `map`: a printed map (kit/maps/render-map.mjs, at harvest time) with an orange pin dropped on the
 * place and a Helios label. Options: media (its .map sidecar: plain image, pin, label, sublabel) or src,
 * width, height, pin [x, y] (image px), label, sublabel, at (the pin drops), move (push), amount,
 * duration, credit (default OpenStreetMap's).
 */
export function map(doc, o = {}) {
  const meta = o.media?.map ?? {};
  const src = o.src ?? meta.plain ?? o.media?.file ?? '';
  const width = o.width ?? meta.width ?? o.media?.width ?? 0;
  const height = o.height ?? meta.height ?? o.media?.height ?? 0;
  const pin = o.pin ?? (meta.pin ? [meta.pin.x, meta.pin.y] : [width / 2, height / 2]);
  const focus = width ? [pin[0] / width, pin[1] / height] : [0.5, 0.5];
  const el = h(doc, 'div', { class: 'rd', 'data-treatment': 'map', style: { background: '#E9DFCB' } });
  const base = coverLayer(doc, { src, width, height, focus });
  el.append(base.layer);
  const [px, py] = width ? toFrame(base.fit, pin) : [W / 2, H / 2];
  const dot = h(doc, 'div', { class: 'rd-pin', style: { left: `${px}px`, top: `${py}px` } });
  const label = o.label ?? meta.label;
  const sub = o.sublabel ?? meta.sublabel;
  const right = px < W * 0.55;
  const card = label ? h(doc, 'div', { class: 'rd-maplabel', style: right ? { left: `${px + 52}px`, top: `${py - 46}px` } : { right: `${W - px + 52}px`, top: `${py - 46}px` } },
    `<div class="t">${esc(label)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}`) : null;
  base.layer.append(dot);
  if (card) base.layer.append(card);
  el.append(h(doc, 'div', { class: 'rd-shade', style: { background: 'linear-gradient(180deg,rgba(14,11,9,.88) 0%,rgba(14,11,9,.6) 18%,rgba(14,11,9,0) 32%)' } }));
  el.append(h(doc, 'div', { class: 'rd-shade', style: { background: 'radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(50,32,16,.4) 100%)' } }));
  const gr = grain(doc, { opacity: 0.16 });
  el.append(gr.el);
  el.append(credit(doc, o.credit ?? 'Map: © OpenStreetMap contributors, OpenFreeMap', { light: true }));
  const dropAt = o.at ?? 0.5;
  const dur = o.duration ?? 6;
  const render = (t) => {
    const cam = kenBurns(o.move ?? 'push', seg(t, 0, dur), { at: [px, py], amount: o.amount ?? 0.14, dir: o.dir ?? 'left' });
    base.layer.style.transform = kbTransform(cam);
    const m = arrive(seg(t, dropAt, dropAt + 0.3), { from: [0, -50], lift: 0.1, settle: 2 });
    dot.style.visibility = m.visible ? '' : 'hidden';
    dot.style.transform = `translate(0, ${m.y.toFixed(2)}px) scale(${m.scale.toFixed(4)})`;
    if (card) card.style.clipPath = wipe(easeOut(seg(t, dropAt + 0.25, dropAt + 0.6)), 30);
    gr.render(t);
  };
  render(0);
  return { el, pin: dot, label: card, render, pinAt: [px, py] };
}

/**
 * `headline`: a real headline as published. With a screenshot (media | src + boxes + marks) it is a
 * `page`; with `text` it is a paper strip (publication, date, the headline in the paper's serif, [[words]]
 * underlined in orange at `markAt`) slammed onto a dark or softened photo, below the face. Options: text,
 * publication, date, over (photo options for the picture behind), at (the strip lands), markAt, y (strip top, 1120),
 * credit.
 */
export function headline(doc, o = {}) {
  if (srcOf(o) && !o.text) return evidence(doc, o, { treatment: 'headline', fit: 1040, x: 20, y: 700, tilt: -0.8, ground: '#100e0c', paper: false });
  const bg = o.over ? photo(doc, { ...o.over, duration: o.duration ?? 5 }) : null;
  const el = bg ? bg.el : h(doc, 'div', { class: 'rd', style: { background: 'radial-gradient(ellipse at 50% 45%,#2b2622 0%,#0d0b0a 75%)' } });
  el.dataset.treatment = 'headline';
  const strip = h(doc, 'div', { class: 'rd-strip', style: { left: '70px', top: `${o.y ?? 1120}px`, width: '940px', zIndex: '45' } },
    `<div class="k" data-set><span>${esc(o.publication ?? '')}</span><span>${esc(o.date ?? '')}</span></div><div class="hl">${marked(o.text ?? '')}</div>`);
  el.append(strip);
  const svg = svgEl(doc, 'svg', { class: 'rd-ink', width: 940, height: 600 });
  svg.style.zIndex = '3';
  strip.append(svg);
  let line = null;
  const at = o.at ?? 0.2;
  const markAt = o.markAt ?? at + 1.2;
  const measure = () => {
    const span = strip.querySelector('[data-mark]');
    if (!span || line || !(span.offsetWidth > 0)) return;
    const b = { x: span.offsetLeft, y: span.offsetTop, w: span.offsetWidth, h: span.offsetHeight };
    const shape = markShape('underline', b);
    line = svgEl(doc, 'path', { d: toPath(shape.pts), stroke: 'var(--rd-orange)', 'stroke-width': 10 });
    svg.append(line);
    line.dataset.len = String(shape.length);
  };
  if (!bg) { const gr = grain(doc); el.append(gr.el); el.__grain = gr; }
  if (o.credit) el.append(credit(doc, o.credit));
  const render = (t) => {
    bg?.render(t);
    el.__grain?.render(t);
    const m = arrive(seg(t, at, at + 0.28), { from: [0, -90], lift: 0.03, settle: 2 });
    strip.style.visibility = m.visible ? '' : 'hidden';
    strip.style.transform = `translate(0, ${m.y.toFixed(2)}px) rotate(-1deg) scale(${m.scale.toFixed(4)})`;
    measure();
    if (line) {
      const L = Number(line.dataset.len);
      const u = seg(t, markAt - 0.3, markAt);
      line.style.strokeDasharray = `${L} ${L + 10}`;
      line.style.strokeDashoffset = String(L * (1 - u));
      line.style.opacity = u > 0 ? '1' : '0';
    }
  };
  render(0);
  return { el, strip, render };
}

/**
 * `lower_third`: a person's name and role, Helios type, wiped in. Usually layered on a photo or cutout
 * lift. Options: name, role, at (seconds), x (96), y (1300), plate (default true: a dark plate behind it).
 */
export function lowerThird(doc, o = {}) {
  const el = h(doc, 'div', { class: 'rd-words', 'data-treatment': 'lower_third', style: { left: `${o.x ?? 96}px`, top: `${o.y ?? 1300}px` } },
    `<div class="rd-l3-bar"></div><div class="rd-l3-name">${esc(o.name ?? '')}</div>${o.role ? `<div class="rd-l3-role">${esc(o.role)}</div>` : ''}`);
  // On a plate by default: a lower third usually sits on a photo (MD-58). plate: false only on a clean ground.
  if (o.plate !== false) plate(el, { pad: [16, 24] });
  const bar = el.firstChild;
  const at = o.at ?? 0.4;
  const render = (t) => {
    bar.style.clipPath = wipe(easeOut(seg(t, at, at + 0.25)), 0);
    const u = easeOut(seg(t, at + 0.1, at + 0.45));
    for (const c of [...el.children].slice(1)) c.style.clipPath = wipe(u);
    el.style.visibility = t >= at ? '' : 'hidden';
  };
  render(0);
  return { el, render };
}

/**
 * `number`: a big stat in Helios type (approved stills 1 and 3). Options: value ("$12M"), label (a
 * short line under it), tone (paper | orange: the number's colour), labelTone (orange | muted), at
 * (seconds), countUp (the number counts up over 0.7s), x (96), y (1130), size (118), plate (default true).
 */
export function number(doc, o = {}) {
  const el = h(doc, 'div', { class: 'rd-words', 'data-treatment': 'number', style: { left: `${o.x ?? 96}px`, top: `${o.y ?? 1130}px`, right: '140px' } });
  const big = h(doc, 'div', { class: 'rd-big', style: { fontSize: `${o.size ?? 118}px`, color: o.tone === 'orange' ? 'var(--rd-orange)' : 'var(--rd-paper-lit)' } }, esc(o.value ?? ''));
  el.append(big);
  const lab = o.label ? h(doc, 'div', { class: o.labelTone === 'muted' ? 'rd-label' : 'rd-sub' }, esc(o.label)) : null;
  if (lab) el.append(lab);
  // On a plate by default, sized to the words: a number sits over the frame's picture (MD-58).
  if (o.plate !== false) Object.assign(plate(el, { pad: [18, 28] }).style, { right: 'auto', maxWidth: `${W - 2 * (o.x ?? 96)}px` });
  const at = o.at ?? 0.3;
  const render = (t) => {
    el.style.visibility = t >= at ? '' : 'hidden';
    if (o.countUp) big.textContent = countUp(o.value ?? '', seg(t, at, at + 0.7));
    big.style.clipPath = o.countUp ? '' : wipe(easeOut(seg(t, at, at + 0.3)));
    if (lab) lab.style.clipPath = wipe(easeOut(seg(t, at + 0.35, at + 0.7)));
  };
  render(0);
  return { el, value: big, label: lab, render };
}

/**
 * `board`, `whiteboard`, `newspaper`: the news kit's three scenes as tools for a moment (MD-03). Same
 * shape as nk.board() etc. ({ el, cam, stage, front, … }), plus a moving-grain render(t).
 */
export function scene(doc, name, opts = {}) {
  // The newspaper page starts below the caption band, so the captions sit on the dark desk.
  const s = name === 'whiteboard' ? whiteboard(doc, opts) : name === 'newspaper' ? newspaper(doc, { y: 600, ...opts }) : board(doc);
  s.el.dataset.treatment = name;
  // The blurred sheet under the newspaper page moves down with it, so the desk stays dark behind the captions.
  if (name === 'newspaper' && s.cam.children[1]) s.cam.children[1].style.top = `${(opts.y ?? 600) - 100}px`;
  const g = s.el.querySelector('.nk-grain');
  return { ...s, render(t) { const [x, y] = grainOffset(t); if (g) g.style.backgroundPosition = `${x}px ${y}px`; } };
}

/** The treatment builders by storyboard name (FRAME.md). `close` is the kit's close.js. */
export const TREATMENT_BUILDERS = {
  photo, cutout_lift: cutoutLift, collision, page, map, document: documentSheet, post, headline,
  lower_third: lowerThird, number,
  board: (doc, o) => scene(doc, 'board', o), whiteboard: (doc, o) => scene(doc, 'whiteboard', o), newspaper: (doc, o) => scene(doc, 'newspaper', o),
};
