// The three scenes (grounds): board, whiteboard, newspaper, then the composed shots (tableau, collage,
// drawn layers, expression marks; see the section near the end). The three scenes return the same shape:
//   { el, cam, ground, stage, front, scene }
// el = the 1080×1920 frame root · cam = what the camera moves · stage = where items go (board: the cork;
// whiteboard: the board surface, in board coordinates; newspaper: the page) · front = lamp/vignette,
// fixed to the lens, above the items · film grain sits on top of everything.
import { h, filler, esc, svgEl } from './dom.js';
import { arrive, easeOut, seg, strokeSeconds, tornPolygon } from '../geometry.js';
import { grainOffset, kbTransform, kenBurns, wipe } from '../treatment-geometry.js';
import { EXPRESSIONS, SETTINGS, collageSvg, settingSvg } from '../settings/index.js';

function shell(doc, scene) {
  const el = h(doc, 'div', { class: `nk nk-scene-${scene}`, 'data-ground': scene });
  const cam = h(doc, 'div', { class: 'nk-cam' });
  const front = h(doc, 'div', { class: 'nk-front' });
  el.append(cam, front, filmGrain(doc));
  return { el, cam, front, scene };
}

export const filmGrain = (doc) => h(doc, 'div', { class: 'nk-grain' });

/** The bulletin board: three-layer turbulence cork, warm lamp, vignette. */
export function board(doc) {
  const s = shell(doc, 'board');
  const ground = h(doc, 'div', { class: 'nk-cork' });
  const stage = h(doc, 'div', { class: 'nk-stage' });
  s.cam.append(ground, stage);
  s.front.classList.add('nk-lamp');
  return { ...s, ground, stage };
}

const RESIDUE = `<svg class="nk-residue" width="1300" height="1800" viewBox="0 0 1100 1700" preserveAspectRatio="none"><path d="M80 220 C 180 180, 300 260, 420 220 S 620 190, 700 240" stroke="#34405a" stroke-width="12" fill="none"/><path d="M520 1260 C 600 1230, 760 1290, 980 1240" stroke="#34405a" stroke-width="14" fill="none"/><ellipse cx="860" cy="200" rx="120" ry="52" stroke="#a33" stroke-width="10" fill="none"/><path d="M120 900 l 80 -60 l 40 90 l 70 -70" stroke="#2a3f9a" stroke-width="10" fill="none"/></svg>`;

export const WHITEBOARD_FRAMING = {
  /** The whole board in the room, tray in view. */
  wide: { x: 60, y: 300, w: 960, h: 1400 },
  /** Close on the board; its top-left frame corner still in view. */
  close: { x: -40, y: 420, w: 1200, h: 1700 },
};

function trayMarkers(doc, x, y) {
  const out = [];
  for (const [c, dx] of [['#1E3FAF', 0], ['#C3271B', 120], ['#111', 240]]) {
    out.push(h(doc, 'div', { class: 'abs', style: { left: `${x + dx}px`, top: `${y}px`, width: '104px', height: '22px', borderRadius: '11px', background: 'linear-gradient(180deg,#fafafa,#cfcfcf)', boxShadow: '0 4px 6px rgba(0,0,0,0.35)' } },
      `<div style="position:absolute;right:-2px;top:-2px;width:36px;height:26px;border-radius:8px;background:${c}"></div>`));
  }
  out.push(h(doc, 'div', { class: 'abs', style: { left: `${x + 380}px`, top: `${y - 18}px`, width: '150px', height: '44px', borderRadius: '8px', background: 'linear-gradient(180deg,#3a3a3a,#1c1c1c)', boxShadow: '0 6px 8px rgba(0,0,0,0.4)' } },
    '<div style="position:absolute;left:0;right:0;bottom:0;height:12px;background:#9a958b;border-radius:0 0 8px 8px"></div>'));
  return out;
}

/**
 * The whiteboard in its room: aluminum frame, gray corner caps, tray with three markers and an eraser,
 * a window reflection on the melamine, faint ghosting of old notes. framing: 'wide' | 'close' | {x,y,w,h}.
 */
export function whiteboard(doc, { framing = 'wide' } = {}) {
  const s = shell(doc, 'whiteboard');
  const f = typeof framing === 'string' ? WHITEBOARD_FRAMING[framing] : framing;
  const ground = h(doc, 'div', { class: 'nk-room' });
  const wb = h(doc, 'div', { class: 'nk-wb', style: { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` } });
  wb.append(h(doc, 'div', { class: 'nk-wb-skin' }, RESIDUE));
  const stage = h(doc, 'div', { class: 'nk-stage' });
  wb.append(stage, h(doc, 'div', { class: 'nk-wb-glare' }));
  const corner = (x, y) => h(doc, 'div', { class: 'nk-wb-corner', style: { left: `${x}px`, top: `${y}px` } });
  const tray = h(doc, 'div', { class: 'nk-wb-tray', style: { left: `${f.x - 18}px`, top: `${f.y + f.h + 16}px`, width: `${f.w + 36}px` } });
  s.cam.append(ground, wb, corner(f.x - 18, f.y - 18), corner(f.x + f.w - 16, f.y - 18), tray, ...trayMarkers(doc, f.x + 60, f.y + f.h + 4));
  s.front.classList.add('nk-wb-lamp');
  return { ...s, ground, stage, board: wb, framing: f };
}

/** Masthead size that fits the 1000px page measure (display-serif caps run about 0.5em a character). */
export const mastheadSize = (name) => Math.round(Math.min(112, 1000 / (Math.max(1, String(name).length) * 0.5)));

/**
 * A full newsprint page as the surface: datelines, rules, masthead, then columns of illegible filler.
 * Articles (article()) are placed on `stage`, which sits over the page's body area.
 */
export function newspaper(doc, { masthead = 'The Daily Ledger', date = '', vol = 'Vol. CXII · No. 257', price = '$2.00', section = null, rot = -1.2, x = -30, y = 160 } = {}) {
  const s = shell(doc, 'newspaper');
  const ground = h(doc, 'div', { class: 'nk-desk' });
  const under = h(doc, 'div', { class: 'nk-np', style: { left: '-40px', top: '60px', width: '1160px', height: '1900px', filter: 'blur(1.5px)', padding: '120px 70px 0', transform: 'rotate(1.4deg)' } }, filler(120));
  const page = h(doc, 'div', { class: 'nk-np', style: { left: `${x}px`, top: `${y}px`, width: '1140px', height: '1820px', padding: '0 70px', transform: `rotate(${rot}deg)` } });
  const head = section
    ? `<div class="nk-dateline" style="padding-top:40px"><span>${esc(section)}</span><span>${esc(date)}</span><span>${esc(vol.split('·')[1] ?? '')}</span></div><div class="nk-rule"></div>`
    : `<div class="nk-dateline" style="padding-top:40px"><span>${esc(vol)}</span><span>${esc(date)}</span><span>${esc(price)}</span></div>
       <div class="nk-rule"></div><div class="nk-mast" style="font-size:${mastheadSize(masthead)}px">${esc(masthead)}</div><div class="nk-rule"></div>`;
  page.innerHTML = `<div data-set>${head}</div>`;
  const top = section ? 110 : 280;
  // Filler body under the articles: three columns, so empty page reads as newsprint, never as blank.
  const body = h(doc, 'div', { class: 'abs', style: { left: '70px', right: '70px', top: `${top}px`, bottom: '40px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '26px', opacity: '0.9' } },
    [0, 1, 2].map(() => `<div>${filler(62)}</div>`).join(''));
  const stage = h(doc, 'div', { class: 'nk-stage', style: { left: '70px', top: `${top}px`, right: 'auto', bottom: 'auto', width: '1000px', height: `${1820 - top - 40}px` } });
  page.append(body, stage);
  s.cam.append(ground, under, page);
  s.front.classList.add('nk-np-lamp');
  return { ...s, ground, stage, page, filler: body };
}

// ── Composed shots (MD-59, research 06): staged settings, drawn layers, collage ─────────────────────
// tableau(): cutouts staged in a setting (a seeded one from kit/settings, or a made setting picture),
// grounded by the setting's own layers and a contact shadow, one grade over every layer.
// collage(): paper, photo and marker layers stacked on a ground. drawn(): a made drawing revealed as if
// drawn. expressionMarks(): marker marks of an inner state drawn around a face. All render(t) pure.

const FW = 1080;
const FH = 1920;

/** The figure grade every staged cutout shares, so all layers read as one world (research 06 §1). */
const FIGURE_GRADE = 'grayscale(.35) contrast(1.08) brightness(.9) sepia(.12)';

/** A seeded setting as stacked layers: { el, layers[], seats, screens }. Layer 0 is the back. */
export function setting(doc, id) {
  const s = SETTINGS[id];
  if (!s) throw new Error(`setting: no seeded setting "${id}" (kit/settings)`);
  const el = h(doc, 'div', { class: 'rd-layer', 'data-setting': id });
  const layers = s.layers.map((_, i) => h(doc, 'div', { class: 'rd-layer', 'data-set': '', 'data-bleed': '', 'data-layer': String(i) }, settingSvg(id, { layer: i })));
  return { el, layers, seats: s.seats.map((x) => ({ ...x })), screens: s.screens.map((x) => ({ ...x })) };
}

const srcOfMedia = (o) => o?.src ?? o?.media?.file ?? o?.file ?? '';
const winOf = (at, d) => (Array.isArray(at) ? at : typeof at === 'number' ? [at, at + d] : null);

/**
 * `tableau`: people (character cutouts) staged in a setting. Options:
 *   setting: a seeded setting id ('dinner-table', 'boardroom', 'stage', 'phone-call', 'hearing-room') or
 *            a made setting picture (media | src) — then pass `seats` (no seeded seats exist for it).
 *   seats:   [{ id, x, y, h, under?, clip? }] to add or override seats (frame px; y is the baseline).
 *   cast:    [{ media | src, seat, h?, dx?, enter?: { at: [t0, t1], from: 'left' | 'right' } }]: a figure
 *            without `enter` is in place from t = 0; with it, it starts wholly outside the frame.
 *   screen:  { media | src, on: screen id, at? }: a logo or picture on one of the setting's screens.
 *   move, focus [fx, fy] (0–1 of the frame), amount (0.08), dir, at [t0, t1], duration, grade, credit.
 * Returns { el, stage (an overlay layer inside the camera for marks and labels), figures, seats, render }.
 */
export function tableau(doc, o = {}) {
  const el = h(doc, 'div', { class: 'rd rd-tableau', 'data-treatment': 'tableau' });
  const cam = h(doc, 'div', { class: 'rd-layer' });
  el.append(cam);
  let layers;
  let seats;
  let screens = [];
  if (typeof o.setting === 'string') {
    const s = setting(doc, o.setting);
    layers = s.layers;
    seats = s.seats;
    screens = s.screens;
  } else {
    const back = h(doc, 'div', { class: 'rd-layer', 'data-bleed': '' });
    back.append(h(doc, 'img', { class: 'rd-cover', src: srcOfMedia(o.setting), alt: '' }));
    layers = [back];
    seats = [];
  }
  for (const extra of o.seats ?? []) {
    const i = seats.findIndex((x) => x.id === extra.id);
    if (i >= 0) seats[i] = { ...seats[i], ...extra };
    else seats.push({ under: layers.length > 1 ? 1 : 99, facing: 'front', ...extra });
  }
  // Figures go between the layers: a figure `under` layer k is appended just before layer k.
  const slots = layers.map(() => []);
  const tail = [];
  const figures = (o.cast ?? []).map((c, i) => {
    const seat = seats.find((x) => x.id === c.seat) ?? seats[i] ?? { x: FW / 2, y: 1400, h: 700, under: 99 };
    const ht = c.h ?? seat.h;
    const box = h(doc, 'div', { class: 'abs', 'data-figure': String(i), style: { left: '0px', top: '0px', width: `${FW}px`, height: `${FH}px` } });
    if (seat.clip) box.style.clipPath = `inset(${seat.clip.y}px ${FW - seat.clip.x - seat.clip.w}px ${FH - seat.clip.y - seat.clip.h}px ${seat.clip.x}px)`;
    const shadow = h(doc, 'div', { class: 'abs', style: { left: `${seat.x - ht * 0.28}px`, top: `${seat.y - 22}px`, width: `${ht * 0.56}px`, height: '44px', borderRadius: '50%', background: 'radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.55),rgba(0,0,0,0) 70%)' } });
    const fig = h(doc, 'img', { class: 'abs', src: srcOfMedia(c), alt: '', style: { left: `${seat.x + (c.dx ?? 0)}px`, top: `${seat.y - ht}px`, height: `${ht}px`, transform: 'translateX(-50%)', filter: `${FIGURE_GRADE} drop-shadow(-8px 14px 18px rgba(0,0,0,.45))` } });
    box.append(shadow, fig);
    const under = Math.min(seat.under ?? 99, layers.length);
    (under < layers.length ? slots[under] : tail).push({ y: seat.y, box });
    return { el: fig, box, seat, dx: c.dx ?? 0, enter: c.enter ?? null };
  });
  layers.forEach((layer, k) => {
    for (const f of slots[k].sort((a, b) => a.y - b.y)) cam.append(f.box);
    cam.append(layer);
  });
  for (const f of tail.sort((a, b) => a.y - b.y)) cam.append(f.box);
  let screenImg = null;
  if (o.screen) {
    const sc = screens.find((x) => x.id === (o.screen.on ?? screens[0]?.id));
    if (sc) {
      screenImg = h(doc, 'img', { class: 'abs', src: srcOfMedia(o.screen), alt: '', style: { left: `${sc.x + 16}px`, top: `${sc.y + 16}px`, width: `${sc.w - 32}px`, height: `${sc.h - 32}px`, objectFit: 'contain' } });
      layers[0].after(screenImg);
    }
  }
  const stage = h(doc, 'div', { class: 'rd-layer' });
  cam.append(stage);
  el.append(h(doc, 'div', { class: 'rd-tint', style: { background: 'linear-gradient(160deg,#24303a 0%,#7a4a26 100%)', opacity: String(o.tint ?? 0.35) } }));
  el.append(h(doc, 'div', { class: 'rd-vignette' }));
  const g = filmGrain(doc);
  el.append(g);
  if (o.credit) el.append(h(doc, 'div', { class: 'rd-credit', 'data-credit': '', style: { top: '1560px' } }, esc(o.credit)));
  const dur = o.duration ?? 6;
  const [t0, t1] = winOf(o.at, 0) ?? [0, dur];
  const focus = o.focus ?? [0.5, 0.55];
  const render = (t) => {
    cam.style.transform = kbTransform(kenBurns(o.move ?? 'push', seg(t, t0, t1), { at: [focus[0] * FW, focus[1] * FH], amount: o.amount ?? 0.08, dir: o.dir ?? 'left' }));
    for (const f of figures) {
      // Keep each seated figure wholly inside the frame (or its panel), whatever the cutout's width (MD-58).
      const fw = f.el.offsetWidth;
      if (fw) {
        const lo = (f.seat.clip ? f.seat.clip.x : 0) + fw / 2 + 8;
        const hi = (f.seat.clip ? f.seat.clip.x + f.seat.clip.w : FW) - fw / 2 - 8;
        const want = f.seat.x + (f.dx ?? 0);
        f.el.style.left = `${(lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, want))).toFixed(1)}px`;
      }
      if (!f.enter) continue;
      const [a, b] = winOf(f.enter.at, 0.6) ?? [0.2, 0.8];
      const u = easeOut(seg(t, a, b));
      const w = f.el.offsetWidth || f.seat.h * 0.7;
      // Wholly outside the frame before the entrance, from its own box (MD-58: never visible early).
      const off = f.enter.from === 'right' ? FW - (f.seat.x - w / 2) + 40 : -(f.seat.x + w / 2 + 40);
      // Transform before visibility: one property order whatever ran before (render(t) stays pure).
      f.box.style.transform = `translateX(${(off * (1 - u)).toFixed(1)}px)`;
      f.box.style.visibility = t < a ? 'hidden' : '';
    }
    if (screenImg && o.screen.at != null) screenImg.style.opacity = seg(t, o.screen.at, o.screen.at + 0.3).toFixed(3);
    const [x, y] = grainOffset(t);
    g.style.backgroundPosition = `${x}px ${y}px`;
  };
  render(0);
  return { el, cam, stage, figures, seats, screens, render };
}

/**
 * `collage`: paper, photo and marker layers stacked on a ground (research 06 §1, §3). Options:
 *   ground: 'kraft' (default) | 'charcoal' | a picture (media | src; graded, darkened, softened).
 *   layers: [{ media | src | seed, x, y, w, h?, rot, at, halftone, torn, z, color }] in frame px.
 *           `seed` is a collage layer from kit/settings ('torn-paper', 'tape', 'scribble-ring',
 *           'halftone'); `halftone` prints a photo as newsprint dots; `torn` tears its edges; `at` is when
 *           it is slapped on (hidden before it), absent = there from t = 0.
 *   move, focus, amount (0.06), duration, credit.
 * Returns { el, cam, stage, items, render }.
 */
export function collage(doc, o = {}) {
  const el = h(doc, 'div', { class: 'rd rd-collage', 'data-treatment': 'collage' });
  const cam = h(doc, 'div', { class: 'rd-layer' });
  el.append(cam);
  const ground = o.ground ?? 'kraft';
  if (ground === 'kraft' || ground === 'charcoal') {
    cam.append(h(doc, 'div', { class: 'rd-layer', 'data-set': '', 'data-bleed': '' }, collageSvg('kraft-ground').replace('#3b2e22', ground === 'charcoal' ? '#1f1c1a' : '#3b2e22')));
  } else {
    const back = h(doc, 'div', { class: 'rd-layer', 'data-bleed': '' });
    back.append(h(doc, 'img', { class: 'rd-cover', src: srcOfMedia(ground), alt: '', style: { filter: 'grayscale(.7) brightness(.4) blur(6px)', transform: 'scale(1.06)' } }));
    cam.append(back);
  }
  const items = (o.layers ?? []).map((l, i) => {
    const wrap = h(doc, 'div', { class: 'abs', style: { left: `${l.x ?? 0}px`, top: `${l.y ?? 0}px`, width: `${l.w ?? 600}px`, zIndex: String(l.z ?? i + 1) } });
    if (l.h != null) wrap.style.height = `${l.h}px`;
    wrap.dataset.rot = String(l.rot ?? 0);
    if (l.seed) {
      wrap.dataset.set = '';
      wrap.innerHTML = collageSvg(l.seed, { color: l.color }).replace('<svg ', '<svg style="width:100%;height:auto;display:block" ');
    } else {
      const img = h(doc, 'img', { src: srcOfMedia(l), alt: '', style: { width: '100%', display: 'block', filter: l.halftone ? 'grayscale(1) contrast(1.35) brightness(1.05)' : 'grayscale(.3) contrast(1.08) brightness(.92)' } });
      wrap.append(img);
      if (l.halftone) wrap.append(h(doc, 'div', { class: 'abs', style: { inset: '0', backgroundImage: 'radial-gradient(rgba(0,0,0,.5) 32%, transparent 36%)', backgroundSize: '9px 9px', mixBlendMode: 'multiply' } }));
      wrap.style.boxShadow = '0 18px 30px rgba(0,0,0,.45)';
    }
    if (l.torn) wrap.style.clipPath = tornPolygon(i + 3, 2.4);
    cam.append(wrap);
    return { el: wrap, at: l.at ?? null };
  });
  const stage = h(doc, 'div', { class: 'rd-layer', style: { zIndex: '40' } });
  cam.append(stage);
  el.append(h(doc, 'div', { class: 'rd-vignette' }));
  const g = filmGrain(doc);
  el.append(g);
  if (o.credit) el.append(h(doc, 'div', { class: 'rd-credit', 'data-credit': '', style: { top: '1560px' } }, esc(o.credit)));
  const dur = o.duration ?? 6;
  const focus = o.focus ?? [0.5, 0.5];
  const render = (t) => {
    cam.style.transform = kbTransform(kenBurns(o.move ?? 'push', seg(t, 0, dur), { at: [focus[0] * FW, focus[1] * FH], amount: o.amount ?? 0.06, dir: o.dir ?? 'left' }));
    for (const it of items) {
      const rot = Number(it.el.dataset.rot || 0);
      if (it.at == null) { it.el.style.transform = `rotate(${rot}deg)`; continue; }
      const m = arrive(seg(t, it.at, it.at + 0.35), { from: [0, -70], lift: 0.04, settle: 2 });
      it.el.style.transform = `translate(${m.x.toFixed(2)}px, ${m.y.toFixed(2)}px) rotate(${(rot + m.rot).toFixed(3)}deg) scale(${m.scale.toFixed(4)})`;
      it.el.style.visibility = m.visible ? '' : 'hidden';
    }
    const [x, y] = grainOffset(t);
    g.style.backgroundPosition = `${x}px ${y}px`;
  };
  render(0);
  return { el, cam, stage, items, render };
}

/**
 * A made drawing (an expression sketch, a drawn object or scene: a `made` asset) revealed as if drawn.
 * Options: media | src, x, y, w, at [t0, t1] (the reveal; default there from t = 0), dir 'down' | 'right',
 * blend (default 'multiply': the white paper of the drawing drops out on a whiteboard or paper ground).
 */
export function drawn(doc, o = {}) {
  const el = h(doc, 'img', { class: 'abs', src: srcOfMedia(o), alt: '', 'data-set': '', style: { left: `${o.x ?? 140}px`, top: `${o.y ?? 640}px`, width: `${o.w ?? 800}px`, mixBlendMode: o.blend ?? 'multiply' } });
  const win = winOf(o.at, 1.2);
  const render = (t) => {
    if (!win) { el.style.clipPath = ''; return; }
    const u = seg(t, win[0], win[1]);
    el.style.clipPath = o.dir === 'right' ? wipe(u) : `inset(-20px -20px ${(100 - 100 * u).toFixed(2)}% -20px)`;
    el.style.visibility = u > 0 ? '' : 'hidden';
  };
  render(0);
  return { el, render };
}

/**
 * Marker marks of an inner state around a face (kit/settings EXPRESSIONS: worry, anger, shock,
 * thought, question, idea, argue). face: { x, y, w, h } in the coordinates of the layer you append to;
 * at: when the first stroke starts; color: ink on light grounds (default), paper-lit or orange on dark.
 * @param {Document} doc
 * @param {{ kind: string, face: { x: number, y: number, w: number, h: number }, at?: number, color?: string, gap?: number }} opts
 */
export function expressionMarks(doc, { kind, face, at = 0.3, color = '#15110e', gap = 0.12 } = {}) {
  const fn = EXPRESSIONS[kind];
  if (!fn) throw new Error(`expressionMarks: no expression "${kind}"`);
  const el = svgEl(doc, 'svg', { class: 'abs', width: FW, height: FH, viewBox: `0 0 ${FW} ${FH}`, style: 'left:0;top:0;overflow:visible', 'data-set': '' });
  const strokes = fn(face).map((p, i) => {
    const path = svgEl(doc, 'path', { d: p.d, fill: 'none', stroke: color, 'stroke-width': p.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    el.append(path);
    return { path, i, L: null };
  });
  let start = at;
  const windows = strokes.map((s) => {
    s.L = s.path.getTotalLength?.() || 300;
    const w = [start, start + strokeSeconds(s.L, 900)];
    start = w[1] + gap;
    return w;
  });
  const render = (t) => strokes.forEach((s, k) => {
    const u = seg(t, windows[k][0], windows[k][1]);
    s.path.style.strokeDasharray = `${s.L} ${s.L + 10}`;
    s.path.style.strokeDashoffset = String(s.L * (1 - u));
    s.path.style.opacity = u > 0 ? '1' : '0';
  });
  render(0);
  return { el, render, end: start };
}
