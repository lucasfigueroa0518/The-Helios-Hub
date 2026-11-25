// `stat` (iteration 4): a number beat that moves, built by code (no asset needed): a counter, bars, or a
// scale comparison, centred in the subject column (y ≈ 800–1100) on a dark ground or a darkened picture.
// Each carries its own sound cues ({ t, kind, what?, dur? } in frame seconds, the events.json format):
// `cues` on the result and `data-cues` on its element, which assemble merges into the frame's events, so
// a frame never writes them by hand. render(t) is pure.
//
// A stat's world reaches past the frame on every side (WORLD_BLEED): a camera a frame puts around the stat, or
// the stat's own `camera`, never opens a gap at the edge (iteration 8: the ground used to end at the frame, so
// a zoom's translate showed the white page behind it as a border down one side).
import { h, esc } from './dom.js';
import { BACKDROP, backdropFilter } from './style.js';
import { CAPTION_KEEPOUT, OVERLAY, overlapArea, picture, regionsOf } from './anchor.js';
import { burst } from './moves.js';
import { easeInOut, easeOut, seg } from '../geometry.js';
import { countUp, grainOffset, wipe } from '../treatment-geometry.js';

const W = 1080;
const H = 1920;
export const STAT_KINDS = ['counter', 'bar', 'scale'];
/** Where a stat's content centres (the subject line). */
export const STAT_CENTRE = { x: 540, y: 950 };

/** How far past the frame a stat's ground, grain and vignette reach on every side, in px. */
export const WORLD_BLEED = 1600;

/** The number in a value string ("$6M" → 6, "1,200" → 1200, "38%" → 38); NaN without one. */
export const valueOf = (v) => {
  if (typeof v === 'number') return v;
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(String(v ?? ''));
  return m ? Number(m[1].replace(/,/g, '')) : NaN;
};

/** A counter's type size: 220px, smaller for a long figure so it fits the overlay width (x 96–940). Pure. */
export const counterSize = (value, { max = 220, width = 844, em = 0.72 } = {}) => Math.round(Math.min(max, width / Math.max(1, String(value ?? '').length * em)));

/** Bars: each item's share of the largest (0–1), never 0 for a positive value (a 1 beside 1000 still shows). */
export function barShares(items) {
  const vals = items.map((i) => Math.max(0, valueOf(i.value)));
  const max = Math.max(...vals, 0) || 1;
  return vals.map((v) => (v > 0 ? Math.max(0.012, v / max) : 0));
}

/** A scale comparison: circle radii with area ∝ value, the largest `maxR` px, the smallest at least `minR`. */
export function scaleRadii(items, { maxR = 280, minR = 7 } = {}) {
  const vals = items.map((i) => Math.max(0, valueOf(i.value)));
  const max = Math.max(...vals, 0) || 1;
  return vals.map((v) => Math.max(minR, maxR * Math.sqrt(v / max)));
}

/**
 * The box a stat's graphic and its words take at rest (frame px, before any layout move): title, figure or
 * bars or discs, and their labels. Pure.
 */
export function statBox(o = {}) {
  const kind = STAT_KINDS.includes(o.kind) ? o.kind : 'counter';
  const cy = STAT_CENTRE.y;
  let x0, x1, y0, y1;
  if (kind === 'counter') {
    const size = counterSize(o.value);
    const w = Math.min(844, String(o.value ?? '').length * 0.68 * size);
    x0 = 540 - w / 2; x1 = 540 + w / 2;
    y0 = cy - Math.round(size * 0.6); y1 = o.label ? cy + 110 + 70 : y0 + size;
    if (o.title) y0 = 700;
    if (o.label) { x0 = Math.min(x0, 96); x1 = Math.max(x1, W - 140); }
  } else if (kind === 'bar') {
    const n = Math.min(5, (o.items ?? []).length) || 1;
    const top0 = cy - (n * 132) / 2;
    x0 = 120; x1 = 960; y0 = o.title ? 640 : top0; y1 = top0 + (n - 1) * 132 + 108;
  } else {
    const items = (o.items ?? []).slice(0, 3);
    const radii = scaleRadii(items.length ? items : [{ value: 1 }]);
    const total = radii.reduce((a, r) => a + 2 * r, 0) + 60 * (radii.length - 1);
    const left = Math.max(60, W / 2 - total / 2);
    const base = cy + 200;
    x0 = left - 40; x1 = left + total + 40;
    y0 = o.title ? 640 : base - 2 * Math.max(...radii); y1 = base + 24 + 112;
  }
  if (o.title) { x0 = Math.min(x0, 96); x1 = Math.max(x1, W - 140); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Faces behind a stat keep this share of their size clear around them (the labels' keep-out pad). */
export const STAT_FACE_PAD = 0.12;
/** The backdrop picture's own scale (it is softened and slightly enlarged). */
const BACK_SCALE = 1.06;

/**
 * Where a stat's graphic and its backdrop go so the graphic never covers a face in the picture behind it
 * (the faces keep out like they do for labels) and no face sits under the caption band. Tried in order of
 * cost: the default (graphic on the subject line, picture centred); the picture slid along its spare
 * width or height; the graphic moved up or down the overlay zone, then shrunk (to 0.7); the picture slid
 * down (its top fading into the dark ground). Inputs: box (statBox), faces (0–1 of the picture), width,
 * height (the picture's px). Returns { pos: [x, y] (object-position, 0–1), dy (px), scale, cy (the
 * graphic's centre line), clear (false: no layout clears every face; the screen check reports it) }. Pure.
 * @param {{ box: { x: number, y: number, w: number, h: number }, faces?: { x: number, y: number, w: number, h: number }[], width?: number, height?: number }} opts
 */
export function statLayout({ box, faces = [], width = 0, height = 0 }) {
  const none = { pos: [0.5, 0.5], dy: 0, scale: 1, cy: STAT_CENTRE.y, clear: true };
  if (!faces.length || !(width > 0 && height > 0)) return none;
  const k = Math.max(W / width, H / height);
  const dw = width * k, dh = height * k;
  const facesAt = (px, py, dy) => faces.map((f) => {
    const x = (W - dw) * px + f.x * dw, y = (H - dh) * py + f.y * dh;
    return { x: W / 2 + (x - W / 2) * BACK_SCALE, y: H / 2 + (y - H / 2) * BACK_SCALE + dy, w: f.w * dw * BACK_SCALE, h: f.h * dh * BACK_SCALE };
  });
  const pad = (f) => ({ x: f.x - f.w * STAT_FACE_PAD, y: f.y - f.h * STAT_FACE_PAD, w: f.w * (1 + 2 * STAT_FACE_PAD), h: f.h * (1 + 2 * STAT_FACE_PAD) });
  const placed = (scale, cy) => ({ x: 540 + (box.x - 540) * scale, y: cy + (box.y - STAT_CENTRE.y) * scale, w: box.w * scale, h: box.h * scale });
  const xs = dw - W > 1 ? [0.5, 0, 0.25, 0.75, 1] : [0.5];
  const ys = dh - H > 1 ? [0.5, 0, 0.25, 0.75, 1] : [0.5];
  const dys = [0];
  for (let d = 80; d <= 1280; d += 40) dys.push(d);
  const scales = [1, 0.9, 0.8, 0.7];
  let best = null, worst = null;
  for (const px of xs) for (const py of ys) for (const dy of dys) {
    const fs = facesAt(px, py, dy);
    // A face under the caption band (a third of it or more) is not a layout.
    const banded = fs.some((f) => overlapArea(f, CAPTION_KEEPOUT) >= 0.25 * f.w * f.h);
    const padded = fs.map(pad);
    for (const scale of scales) {
      for (let cy = STAT_CENTRE.y - 350; cy <= STAT_CENTRE.y + 350; cy += 25) {
        const g = placed(scale, cy);
        if (g.y < Math.min(OVERLAY.y0, box.y) - 1 || g.y + g.h > Math.max(OVERLAY.y1, box.y + box.h) + 1) continue;
        const hit = padded.reduce((n, f) => n + overlapArea(f, g), 0);
        const cost = 3 * (1 - scale) + Math.abs(cy - STAT_CENTRE.y) / 600 + (2 * dy) / H + 0.3 * (Math.abs(px - 0.5) + Math.abs(py - 0.5));
        if (!banded && hit === 0) { if (!best || cost < best.cost - 1e-9) best = { pos: [px, py], dy, scale, cy, clear: true, cost }; }
        else if (!worst || hit + (banded ? 1e9 : 0) < worst.hit) worst = { pos: [px, py], dy, scale, cy, clear: false, hit: hit + (banded ? 1e9 : 0) };
      }
    }
  }
  const pick = best ?? worst ?? { ...none, clear: false };
  return { pos: pick.pos, dy: pick.dy, scale: pick.scale, cy: pick.cy, clear: pick.clear };
}

/**
 * The sound cues of a stat (frame seconds): a counter ticks while it counts and lands on an impact; bars
 * tick as each starts to grow and pop as the last lands; a scale comparison pops the small one in and lands
 * the large one on an impact. Pure.
 */
export function statCues(o = {}) {
  const kind = o.kind ?? 'counter';
  const at = o.at ?? 0.3;
  const out = [];
  if (kind === 'counter') {
    const dur = o.count ?? 1.2;
    const n = Math.min(10, Math.max(3, Math.round(dur / 0.14)));
    for (let i = 0; i < n; i++) out.push({ t: round(at + (i * dur) / n), kind: 'tick' });
    out.push({ t: round(at + dur), kind: 'impact' });
  } else if (kind === 'bar') {
    const items = o.items ?? [];
    items.forEach((_, i) => out.push({ t: round(at + i * (o.stagger ?? 0.35)), kind: 'tick' }));
    if (items.length) out.push({ t: round(at + (items.length - 1) * (o.stagger ?? 0.35) + 0.6), kind: 'pop' });
  } else {
    const items = o.items ?? [];
    items.forEach((_, i) => out.push({ t: round(at + i * (o.stagger ?? 0.7) + (i === items.length - 1 ? 0.55 : 0.05)), kind: i === items.length - 1 ? 'impact' : 'pop' }));
  }
  return out;
}
const round = (n) => Math.round(n * 1000) / 1000;

/**
 * The stat's ground: dark charcoal with grain, or the place's picture, held back but still that place, over it (`over`: a ctx.media
 * entry or src). The picture's faces are measured (its box sidecar or inventory face) and laid out by
 * `layout` (statLayout): slid so the graphic clears them, its top fading into the charcoal when slid down.
 * The ground, vignette and grain are sized past the frame (WORLD_BLEED), centred on it.
 */
function ground(doc, el, o, layout) {
  const world = { left: `${-WORLD_BLEED}px`, top: `${-WORLD_BLEED}px`, width: `${W + 2 * WORLD_BLEED}px`, height: `${H + 2 * WORLD_BLEED}px` };
  el.style.background = 'none';
  el.style.overflow = 'visible';
  // The gradients keep the sizes they had on a 1080×1920 ground, so the look doesn't change.
  el.append(h(doc, 'div', { class: 'abs', 'data-bleed': '', 'data-world': '', style: { ...world, background: 'radial-gradient(ellipse 764px 1358px at 50% 49.5%,#2a2521 0%,#0d0b0a 72%)' } }));
  let pic = null;
  if (o.over) {
    const media = typeof o.over === 'object' ? o.over : null;
    const src = media ? media.file ?? media.src ?? '' : o.over;
    const fade = layout.dy > 0 ? { maskImage: 'linear-gradient(180deg,transparent 0,#000 420px)', webkitMaskImage: 'linear-gradient(180deg,transparent 0,#000 420px)' } : {};
    const img = h(doc, 'img', { class: 'rd-cover', src, alt: '', 'data-bleed': '', style: { filter: `${backdropFilter()} blur(${BACKDROP.blur}px)`, objectPosition: `${layout.pos[0] * 100}% ${layout.pos[1] * 100}%`, transform: `translateY(${layout.dy}px) scale(${BACK_SCALE})`, ...fade } });
    el.append(img);
    // Its faces are keep-outs (labels, the screen check); a backdrop face is never the frame's subject.
    if (media && regionsOf(media).faces.length) {
      pic = picture(doc, img, media);
      pic.frame.setAttribute('data-backdrop', '');
    }
  }
  el.append(h(doc, 'div', { class: 'rd-vignette', 'data-bleed': '', style: { ...world, background: 'radial-gradient(ellipse 764px 1358px at 50% 49.2%,transparent 45%,rgba(0,0,0,0.6) 100%)' } }));
  const g = h(doc, 'div', { class: 'nk-grain', 'data-bleed': '', style: { ...world, opacity: '0.18' } });
  el.append(g);
  return (t) => { pic?.sync(); const [x, y] = grainOffset(t); g.style.backgroundPosition = `${x}px ${y}px`; };
}

/** How long a counted figure stays at its last value before it goes, seconds: the number has to land. */
export const STAT_HOLD = 1.4;
/** The counting time a stat's life leaves: the count gives way to the hold. Pure. */
export function heldCount(count = 1.2, life = Infinity) {
  return Number.isFinite(life) ? Math.min(count, Math.max(0.3, life - STAT_HOLD)) : count;
}

/** Where a stat's camera looks: `on` is an item's index (a bar's row, a disc), else the figure. Frame px. Pure. */
export function statFocus(o = {}, on = 0) {
  const kind = STAT_KINDS.includes(o.kind) ? o.kind : 'counter';
  if (kind === 'counter') return [STAT_CENTRE.x, STAT_CENTRE.y];
  const items = o.items ?? [];
  const i = Math.max(0, Math.min(items.length - 1, on));
  if (kind === 'bar') {
    const list = items.slice(0, 5);
    return [540, STAT_CENTRE.y - (list.length * 132) / 2 + i * 132 + 60];
  }
  const list = items.slice(0, 3);
  const radii = scaleRadii(list);
  const total = radii.reduce((a, r) => a + 2 * r, 0) + 60 * (list.length - 1);
  let x = Math.max(60, W / 2 - total / 2);
  for (let k = 0; k < i; k++) x += 2 * radii[k] + 60;
  return [x + radii[i], STAT_CENTRE.y + 200 - radii[i]];
}

/**
 * The stat's own camera, opening close on `focus` and pulling out to the whole graphic over [t0, t1]: a pure
 * { s, x, y } (scale about the frame's top-left, then translate) at t. `to` is where the focus sits while close.
 */
export function statCamera(t, { focus, scale = 2, at = [0, 0.6], to = [540, 900] }) {
  const k = easeInOut(seg(t, at[0], at[1]));
  const s = scale + (1 - scale) * k;
  return { s, x: (to[0] - focus[0] * scale) * (1 - k), y: (to[1] - focus[1] * scale) * (1 - k) };
}

/**
 * `stat`: options kind (counter | bar | scale), at (the stat starts), duration, title (a short line
 * above it, optional), label (the line under a counter), credit, over (a picture behind it, darkened: a
 * ctx.media entry, so its faces are known and the graphic keeps clear of them; statLayout), burst (a list of
 * ctx.media entries, or { media, at, duration, opacity }: moves.js's burst, between the ground and the number),
 * camera ({ on, scale, at: [t0, t1] }: opens close on item `on`, or the figure, and pulls out; only the graphic
 * moves and the ground stays, with a sound on the pull).
 *   counter: value ("$6M"), count (seconds of counting, 1.2), tone (paper | orange)
 *   bar:     items [{ label, value, display? }] (2–5; `display` is the text shown, default `value`), stagger (0.35)
 *   scale:   items [{ label, value, display? }] (2–3, smallest first), stagger (0.7)
 * Returns { el, render, cues, events, layout }: `cues` are the stat's own, `events` add its burst's.
 */
export function stat(doc, o = {}) {
  const kind = STAT_KINDS.includes(o.kind) ? o.kind : 'counter';
  const el = h(doc, 'div', { class: 'rd rd-stat', 'data-treatment': 'stat', 'data-stat': kind });
  const over = o.over && typeof o.over === 'object' ? o.over : null;
  const layout = statLayout({ box: statBox({ ...o, kind }), faces: over ? regionsOf(over).faces : [], width: over?.width ?? 0, height: over?.height ?? 0 });
  const grain = ground(doc, el, o, layout);
  const at = o.at ?? 0.3;
  const count = o.count ?? 1.2;
  const flips = o.burst ? burst(doc, { at, duration: kind === 'counter' ? count + 0.2 : 1.4, ...(Array.isArray(o.burst) ? { media: o.burst } : o.burst) }) : null;
  if (flips) el.append(flips.el);
  // The graphic and its words, as one layer: moved and scaled by the layout about the subject line.
  const body = h(doc, 'div', { class: 'rd-layer', style: { transformOrigin: `540px ${STAT_CENTRE.y}px`, transform: layout.scale === 1 && layout.cy === STAT_CENTRE.y ? '' : `translateY(${layout.cy - STAT_CENTRE.y}px) scale(${layout.scale})` } });
  const lens = o.camera ? h(doc, 'div', { class: 'rd-layer', 'data-stat-camera': '' }) : null;
  if (lens) { lens.append(body); el.append(lens); } else el.append(body);
  const parts = [];
  const add = (node, render) => { body.append(node); parts.push(render); };
  const title = o.title ? h(doc, 'div', { class: 'rd-stat-title', style: { top: `${kind === 'counter' ? 700 : 640}px` } }, esc(o.title)) : null;
  if (title) add(title, (t) => { title.style.visibility = t >= at - 0.05 ? '' : 'hidden'; title.style.clipPath = wipe(easeOut(seg(t, at - 0.05, at + 0.3))); });

  if (kind === 'counter') {
    const size = counterSize(o.value);
    const big = h(doc, 'div', { class: 'rd-stat-big', 'data-graphic': 'figure', style: { top: `${STAT_CENTRE.y - Math.round(size * 0.6)}px`, fontSize: `${size}px`, color: o.tone === 'paper' ? 'var(--rd-paper-lit)' : 'var(--rd-orange)' } }, esc(o.value ?? ''));
    add(big, (t) => {
      big.style.visibility = t >= at ? '' : 'hidden';
      big.textContent = countUp(o.value ?? '', seg(t, at, at + count));
    });
    if (o.label) {
      const lab = h(doc, 'div', { class: 'rd-stat-label', style: { top: `${STAT_CENTRE.y + 110}px` } }, esc(o.label));
      add(lab, (t) => { const u = easeOut(seg(t, at + count * 0.6, at + count + 0.3)); lab.style.visibility = u > 0 ? '' : 'hidden'; lab.style.clipPath = wipe(u); });
    }
  } else if (kind === 'bar') {
    const items = (o.items ?? []).slice(0, 5);
    const shares = barShares(items);
    const row = 132;
    const top0 = STAT_CENTRE.y - (items.length * row) / 2;
    const x0 = 120, full = 840;
    const stagger = o.stagger ?? 0.35;
    items.forEach((it, i) => {
      const y = top0 + i * row;
      const lab = h(doc, 'div', { class: 'rd-stat-barlabel', style: { left: `${x0}px`, top: `${y}px` } }, esc(it.label ?? ''));
      const bar = h(doc, 'div', { class: 'rd-stat-bar', 'data-graphic': 'bar', style: { left: `${x0}px`, top: `${y + 50}px`, width: `${Math.max(10, full * shares[i])}px`, background: it.highlight || i === o.highlight ? 'var(--rd-orange)' : 'var(--rd-paper-lit)' } });
      const val = h(doc, 'div', { class: 'rd-stat-barvalue', style: { left: `${Math.min(x0 + full * shares[i] + 18, W - 300)}px`, top: `${y + 46}px` } }, esc(it.display ?? String(it.value ?? '')));
      const a = at + i * stagger;
      add(lab, (t) => { lab.style.visibility = t >= a ? '' : 'hidden'; lab.style.clipPath = wipe(easeOut(seg(t, a, a + 0.25))); });
      add(bar, (t) => { const u = easeOut(seg(t, a, a + 0.6)); bar.style.visibility = u > 0 ? '' : 'hidden'; bar.style.transform = `scaleX(${u.toFixed(4)})`; });
      add(val, (t) => { const u = seg(t, a + 0.5, a + 0.75); val.style.visibility = u > 0 ? '' : 'hidden'; val.style.opacity = u.toFixed(3); });
    });
  } else {
    const items = (o.items ?? []).slice(0, 3);
    const radii = scaleRadii(items);
    const base = STAT_CENTRE.y + 200;
    const gap = 60;
    const widths = radii.map((r) => 2 * r);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
    let x = Math.max(60, W / 2 - total / 2);
    const stagger = o.stagger ?? 0.7;
    items.forEach((it, i) => {
      const r = radii[i];
      const last = i === items.length - 1;
      const disc = h(doc, 'div', { class: 'rd-stat-disc', 'data-graphic': 'disc', style: { left: `${x}px`, top: `${base - 2 * r}px`, width: `${2 * r}px`, height: `${2 * r}px`, background: last ? 'var(--rd-orange)' : 'var(--rd-paper-lit)' } });
      const lab = h(doc, 'div', { class: 'rd-stat-scalelabel', style: { left: `${x + r}px`, top: `${base + 24}px` } }, `<div class="v">${esc(it.display ?? String(it.value ?? ''))}</div><div class="l">${esc(it.label ?? '')}</div>`);
      const a = at + i * stagger;
      const grow = last ? 0.55 : 0.2;
      add(disc, (t) => { const u = easeOut(seg(t, a, a + grow)); disc.style.visibility = u > 0 ? '' : 'hidden'; disc.style.transform = `scale(${u.toFixed(4)})`; });
      add(lab, (t) => { const u = easeOut(seg(t, a + grow, a + grow + 0.3)); lab.style.visibility = u > 0 ? '' : 'hidden'; lab.style.clipPath = wipe(u); });
      x += 2 * r + gap;
    });
  }
  if (o.credit) el.append(h(doc, 'div', { class: 'rd-credit', 'data-credit': '', style: { top: '1600px' } }, esc(o.credit)));
  const shot = o.camera ? { focus: statFocus({ ...o, kind }, o.camera.on ?? 0), scale: o.camera.scale ?? 2, at: o.camera.at ?? [at, at + 0.6] } : null;
  const cues = statCues({ ...o, kind, at });
  if (shot) cues.push({ t: round((shot.at[0] + shot.at[1]) / 2), kind: 'whoosh' });
  cues.sort((a, b) => a.t - b.t);
  el.setAttribute('data-cues', JSON.stringify(cues));
  const render = (t) => {
    if (lens) {
      const c = statCamera(t, shot);
      lens.style.transform = `translate(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px) scale(${c.s.toFixed(4)})`;
    }
    flips?.render(t);
    for (const r of parts) r(t);
    grain(t);
  };
  render(0);
  return { el, render, cues, events: [...cues, ...(flips?.events ?? [])].sort((a, b) => a.t - b.t), kind, layout };
}

