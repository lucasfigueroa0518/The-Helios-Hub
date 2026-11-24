// Moves (iteration 8, MD-136, MD-138): more than a screenshot and a ring. Each is built once and drawn by a
// pure render(t), and returns { el, render, events }: `events` are its sound cues in the events-file shape,
// also on `data-cues`, so assemble merges them into the frame's events (FRAME.md § Moves). Nothing shows
// before `at`; with `duration`, nothing shows after `at + duration`.
import { expressionBounds } from '../settings/index.js';
import { STAGE } from '../stage-layout.js';
import { h, esc, plate, svgEl } from './dom.js';
import { COLORS } from './style.js';
import { findFace, isOpening, OVERLAY, overlapArea, parseTarget, picture, pictureOf, SUBJECT } from './anchor.js';
import { credit as creditLine, finish, GRADES, page as pageShot } from './treatments.js';
import { clamp, easeInOut, easeOut, lerp, rng, seg } from '../geometry.js';
import { grainOffset, kbTransform, wipe } from '../treatment-geometry.js';

/** A move with nothing to attach to: skipped and reported, never a thrown frame. */
const skipMove = (doc, kind, why) => {
  (doc.__markSkips ??= []).push(`a ${kind} was skipped: ${why}`);
  return { el: h(doc, 'div', { style: { display: 'none' } }), render() {}, events: [] };
};

const W = 1080;
const H = 1920;
const srcOf = (m) => (typeof m === 'string' ? m : m?.file ?? m?.src ?? '');
const round = (n) => Math.round(n * 1000) / 1000;
const byTime = (a, b) => a.t - b.t;
const CHARCOAL = 'radial-gradient(ellipse at 50% 48%,#2a2521 0%,#0d0b0a 72%)';

/** Sets a move's cues on its element, for the measure step, and returns them. */
function cue(el, events) {
  const list = events.map((e) => ({ ...e, t: round(e.t) })).sort(byTime);
  el.setAttribute('data-cues', JSON.stringify(list));
  return list;
}
const live = (t, at, until) => t >= at && (until == null || t < until);
/** The end of a move, or null when it holds to the frame's end. */
const endOf = (at, duration) => (Number.isFinite(duration) ? at + duration : null);

/** A move's root over a charcoal ground with the kit's vignette and moving grain. */
function grounded(doc, name) {
  const el = h(doc, 'div', { class: 'rd', 'data-move': name, style: { background: CHARCOAL } });
  const vignette = h(doc, 'div', { class: 'rd-vignette' });
  const grain = h(doc, 'div', { class: 'nk-grain', style: { opacity: '0.18' } });
  return { el, vignette, grain, drift: (t) => { const [x, y] = grainOffset(t); grain.style.backgroundPosition = `${x}px ${y}px`; } };
}

// ── flashReveal ─────────────────────────────────────────────────────────────────────────────────────

/** How the flash runs: the blink before it (the shutter closing), its decay, the page settling after it. */
export const FLASH = { blink: 0.05, decay: 0.3, settle: 0.42 };

/**
 * `flashReveal`: a white flash on `at`, then the page, with a shutter on the flash. Options: media (a
 * ctx.media entry), at, duration, credit, and any `page` option (fit, x, y, tilt, marks, push). Returns
 * { el, render, events, page }: marks go on `page`.
 */
export function flashReveal(doc, o = {}) {
  const at = o.at ?? 0;
  const until = endOf(at, o.duration);
  const { at: _at, duration: _dur, ...rest } = o;
  const el = h(doc, 'div', { class: 'rd', 'data-move': 'flash-reveal' });
  const shot = pageShot(doc, { push: { at: [at, at + (o.duration ?? 6)], scale: 1.08 }, ...rest, duration: at + (o.duration ?? 6) });
  const flash = h(doc, 'div', { class: 'abs', 'data-flash': '', style: { left: '0', top: '0', width: `${W}px`, height: `${H}px`, background: '#FFFFFF', zIndex: '70', pointerEvents: 'none' } });
  el.append(shot.el, flash);
  const id = typeof o.media === 'object' ? o.media?.id : null;
  const events = cue(el, [{ t: at, kind: 'foley', what: 'camera shutter', ...(id ? { shown: id } : {}) }]);
  const render = (t) => {
    el.style.visibility = live(t, at - FLASH.blink, until) ? '' : 'hidden';
    shot.el.style.visibility = t >= at ? '' : 'hidden';
    flash.style.opacity = t < at ? '0' : (1 - easeOut(seg(t, at, at + FLASH.decay))).toFixed(3);
    shot.el.style.transform = `scale(${(1.05 - 0.05 * easeOut(seg(t, at, at + FLASH.settle))).toFixed(4)})`;
    shot.render(t);
  };
  render(0);
  return { el, render, events, page: shot };
}

// ── phoneShot ───────────────────────────────────────────────────────────────────────────────────────

/** The phone in the frame: below the caption band, above the platform UI, on the subject line. */
export const PHONE = { x: 290, y: 606, w: 500, h: 880, bezel: 14, status: 54, tilt: -1.2 };
const SCROLL_PER_SECOND = 38;

/** How far a page scrolls on the phone over `seconds`: gently, and never past its end. Pure. */
export function phoneScroll({ pageH, viewH, seconds }) {
  return Math.max(0, Math.min(pageH - viewH, SCROLL_PER_SECOND * Math.max(0, seconds)));
}

/**
 * `phoneShot`: a page on a clean phone with no brand, held in frame, gently scrolling. Options: media, at,
 * duration, credit. A later `at` slides the phone up into the frame. Returns { el, render, events, picture }.
 */
export function phoneShot(doc, o = {}) {
  const at = o.at ?? 0;
  const span = o.duration ?? 6;
  const until = endOf(at, o.duration);
  const media = typeof o.media === 'object' ? o.media : null;
  const { el, vignette, grain, drift } = grounded(doc, 'phone-shot');
  const back = h(doc, 'img', { class: 'rd-cover', src: srcOf(o.media), alt: '', 'data-bleed': '', style: { filter: 'grayscale(.7) brightness(.26) blur(26px)', transform: 'scale(1.12)' } });
  const rig = h(doc, 'div', { class: 'abs', 'data-phone': '', style: { left: `${PHONE.x}px`, top: `${PHONE.y}px`, width: `${PHONE.w}px`, height: `${PHONE.h}px`, borderRadius: '68px', background: 'linear-gradient(160deg,#2b2724,#100e0c 42%,#1b1816)', boxShadow: '0 0 0 2px #4a4541,0 44px 90px rgba(0,0,0,.72),inset 0 0 0 2px rgba(255,255,255,.06)' } });
  const b = PHONE.bezel;
  const viewW = PHONE.w - 2 * b;
  const viewH = PHONE.h - 2 * b;
  const screen = h(doc, 'div', { class: 'abs', style: { left: `${b}px`, top: `${b}px`, width: `${viewW}px`, height: `${viewH}px`, borderRadius: '54px', overflow: 'hidden', background: '#FFFFFF' } });
  const pageH = media?.width > 0 && media?.height > 0 ? (viewW * media.height) / media.width : viewH * 1.6;
  const shown = h(doc, 'img', { class: 'abs', src: srcOf(o.media), alt: '', style: { left: '0', top: `${PHONE.status}px`, width: `${viewW}px`, height: `${pageH}px` } });
  screen.append(shown);
  const pic = picture(doc, shown, media);
  screen.append(h(doc, 'div', { class: 'abs', 'data-set': '', style: { left: `${viewW / 2 - 62}px`, top: '14px', width: '124px', height: '30px', borderRadius: '15px', background: '#0b0a09' } }));
  rig.append(screen);
  el.append(back, rig, vignette, grain);
  if (o.credit) el.append(creditLine(doc, o.credit));
  const land = at + 0.36;
  const start = at + 0.5;
  const travel = phoneScroll({ pageH, viewH: viewH - PHONE.status, seconds: span - 0.5 });
  const events = cue(el, [...(at > 0 ? [{ t: land, kind: 'tick' }] : []), { t: start, kind: 'click' }]);
  const render = (t) => {
    el.style.visibility = live(t, at, until) ? '' : 'hidden';
    const rise = at > 0 ? 170 * (1 - easeOut(seg(t, at, land))) : 0;
    rig.style.transform = `translateY(${rise.toFixed(2)}px) rotate(${PHONE.tilt}deg) scale(${(1 + 0.03 * seg(t, at, at + span)).toFixed(4)})`;
    shown.style.transform = `translateY(${(-travel * easeInOut(seg(t, start, at + span))).toFixed(2)}px)`;
    pic.sync();
    drift(t);
  };
  render(0);
  return { el, render, events, picture: pic };
}

// ── clickReveal ─────────────────────────────────────────────────────────────────────────────────────

/** The window the cursor works in, and how long each step takes after the click (scaled to a short duration). */
export const CLICK = { x: 96, y: 668, w: 848, h: 812, bar: 58, notifIn: [0.1, 0.4], swap: [1.15, 1.6], rowY: 150 };

/** Where the cursor is at k (0–1) of its trip: a slight arc to the row. Pure. */
export function cursorAt(k, from = [860, 1560], to = [CLICK.x + 300, CLICK.y + CLICK.bar + CLICK.rowY]) {
  const u = easeInOut(k);
  return [lerp(from[0], to[0], u), lerp(from[1], to[1], u) - 90 * Math.sin(Math.PI * u)];
}

/**
 * `clickReveal`: a cursor travels across a plain window and clicks, a breaking-news notification drops in,
 * then the article takes the window. Options: media (the article), headline and source (the notification's
 * words, as the publication printed them), at, clickAt (the click, on its cue word; default at + 0.9),
 * duration, credit. Returns { el, render, events, picture }.
 */
export function clickReveal(doc, o = {}) {
  const at = o.at ?? 0;
  const clickAt = o.clickAt ?? at + 0.9;
  const until = endOf(at, o.duration);
  const after = Number.isFinite(o.duration) ? Math.max(0.6, at + o.duration - clickAt) : 3;
  const k = Math.min(1, after / (CLICK.swap[1] + 0.3));
  const media = typeof o.media === 'object' ? o.media : null;
  const { el, vignette, grain, drift } = grounded(doc, 'click-reveal');
  const win = h(doc, 'div', { class: 'abs', 'data-window': '', style: { left: `${CLICK.x}px`, top: `${CLICK.y}px`, width: `${CLICK.w}px`, height: `${CLICK.h}px`, borderRadius: '26px', overflow: 'hidden', background: '#181513', boxShadow: '0 0 0 2px #3b3632,0 40px 80px rgba(0,0,0,.65)' } });
  const dots = ['#4a4541', '#4a4541', '#4a4541'].map((c, i) => `<span style="position:absolute;left:${28 + i * 26}px;top:22px;width:14px;height:14px;border-radius:50%;background:${c}"></span>`).join('');
  win.append(h(doc, 'div', { class: 'abs', 'data-set': '', style: { left: '0', top: '0', width: '100%', height: `${CLICK.bar}px`, background: '#211d1a' } }, dots));
  const rows = [0, 1, 2, 3].map((i) => {
    const y = CLICK.bar + 60 + i * 180;
    const row = h(doc, 'div', { class: 'abs', 'data-set': i === 0 ? null : '', style: { left: '30px', top: `${y}px`, width: `${CLICK.w - 60}px`, height: '150px', borderRadius: '14px', background: 'rgba(254,249,243,.05)' } },
      `<div style="position:absolute;left:18px;top:18px;width:114px;height:114px;border-radius:10px;background:rgba(254,249,243,.12)"></div>
       ${i === 0 ? `<div style="position:absolute;left:156px;top:22px;font:700 34px/1.1 Roboto,sans-serif;color:#FEF9F3;white-space:nowrap">${esc(o.source ?? '')}</div>` : '<div style="position:absolute;left:156px;top:30px;width:300px;height:18px;border-radius:4px;background:rgba(254,249,243,.2)"></div>'}
       <div style="position:absolute;left:156px;top:76px;width:${500 - i * 40}px;height:14px;border-radius:4px;background:rgba(254,249,243,.12)"></div>
       <div style="position:absolute;left:156px;top:106px;width:${380 - i * 30}px;height:14px;border-radius:4px;background:rgba(254,249,243,.12)"></div>`);
    win.append(row);
    return row;
  });
  const hit = h(doc, 'div', { class: 'abs', style: { left: '0', top: '0', width: '100%', height: '100%', borderRadius: '14px', background: 'rgba(255,94,26,.32)', opacity: '0' } });
  rows[0].append(hit);
  const sheet = h(doc, 'div', { class: 'abs', style: { left: '0', top: `${CLICK.bar}px`, width: '100%', height: `${CLICK.h - CLICK.bar}px`, overflow: 'hidden', background: '#FFFFFF' } });
  const pageH = media?.width > 0 && media?.height > 0 ? (CLICK.w * media.height) / media.width : CLICK.h * 1.5;
  const article = h(doc, 'img', { class: 'abs', src: srcOf(o.media), alt: '', style: { left: '0', top: '0', width: `${CLICK.w}px`, height: `${pageH}px` } });
  sheet.append(article);
  const pic = picture(doc, article, media);
  win.append(sheet);
  const size = String(o.headline ?? '').length > 64 ? 38 : 44;
  const notif = h(doc, 'div', { class: 'abs', 'data-notification': '', style: { left: `${CLICK.x}px`, top: '610px', width: `${CLICK.w}px`, padding: '26px 32px 30px', borderRadius: '26px', background: '#FEF9F3', color: '#1F1915', boxShadow: '0 26px 60px rgba(0,0,0,.6)', zIndex: '60' } },
    `<div style="display:flex;justify-content:space-between;align-items:center;font:700 28px/1.1 Roboto,sans-serif;letter-spacing:.06em;text-transform:uppercase"><span style="color:#D94A0E"><span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:#FF5E1A;margin-right:12px"></span>Breaking news</span><span style="letter-spacing:0;text-transform:none;font-weight:500;color:#524a43">${esc(o.source ?? '')}</span></div>
     <div style="margin-top:16px;font:700 ${size}px/1.14 'Pragmatica Extended',Helvetica,Arial,sans-serif;letter-spacing:-.015em">${esc(o.headline ?? '')}</div>`);
  const ripple = h(doc, 'div', { class: 'abs', style: { left: '-60px', top: '-60px', width: '120px', height: '120px', borderRadius: '50%', border: '6px solid #FEF9F3', opacity: '0', zIndex: '61' } });
  const cursor = svgEl(doc, 'svg', { class: 'abs', width: 58, height: 84, viewBox: '0 0 58 84', 'data-set': '', style: 'left:0;top:0;overflow:visible;z-index:62;transform-origin:0 0' });
  cursor.append(svgEl(doc, 'path', { d: 'M3 3 L3 66 L19 51 L31 79 L44 73 L32 46 L54 46 Z', fill: '#FEF9F3', stroke: '#15110E', 'stroke-width': 4, 'stroke-linejoin': 'round' }));
  el.append(win, notif, ripple, cursor, vignette, grain);
  if (o.credit) el.append(creditLine(doc, o.credit));
  const inA = clickAt + CLICK.notifIn[0] * k, inB = clickAt + CLICK.notifIn[1] * k;
  const swapA = clickAt + CLICK.swap[0] * k, swapB = clickAt + CLICK.swap[1] * k;
  const span = after + (clickAt - at);
  const events = cue(el, [{ t: clickAt, kind: 'click' }, { t: inA + 0.04, kind: 'foley', what: 'notification' }, { t: swapA, kind: 'foley', what: 'page turn' }]);
  const render = (t) => {
    el.style.visibility = live(t, at, until) ? '' : 'hidden';
    const [cx, cy] = cursorAt(seg(t, at, clickAt - 0.03));
    const press = t >= clickAt && t < clickAt + 0.09 ? 0.86 : 1;
    cursor.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px) scale(${press})`;
    cursor.style.visibility = t < swapB ? '' : 'hidden';
    const r = seg(t, clickAt, clickAt + 0.36);
    ripple.style.opacity = r > 0 && r < 1 ? (0.85 * (1 - r)).toFixed(3) : '0';
    ripple.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px) scale(${(0.35 + 1.1 * easeOut(r)).toFixed(4)})`;
    hit.style.opacity = t < clickAt ? '0' : (1 - 0.6 * seg(t, clickAt + 0.1, clickAt + 0.5)).toFixed(3);
    const down = easeOut(seg(t, inA, inB));
    const away = easeInOut(seg(t, swapA, swapB));
    notif.style.visibility = down > 0 && away < 1 ? '' : 'hidden';
    notif.style.opacity = (down * (1 - away)).toFixed(3);
    notif.style.transform = `translateY(${(lerp(-34, 0, down) - 26 * away).toFixed(2)}px)`;
    const open = easeInOut(seg(t, swapA, swapB));
    sheet.style.visibility = open > 0 ? '' : 'hidden';
    sheet.style.clipPath = `inset(0 0 ${(100 - 100 * open).toFixed(2)}% 0)`;
    const travel = Math.max(0, Math.min(pageH - (CLICK.h - CLICK.bar), SCROLL_PER_SECOND * span));
    article.style.transform = `translateY(${(-travel * easeInOut(seg(t, swapB, at + span))).toFixed(2)}px)`;
    pic.sync();
    drift(t);
  };
  render(0);
  return { el, render, events, picture: pic };
}

// ── burst ───────────────────────────────────────────────────────────────────────────────────────────

/** One picture's turn in a burst. */
export const BURST_STEP = 0.09;

/**
 * A burst's flips, in order: { t, pick, x, y, scale, rot, dx, dy }. Each flip is a different picture than the
 * last, at its own offset and angle, and travels a little while it shows. Pure and seeded.
 */
export function burstFlips({ count, at = 0, duration = 1.2, seed = 11 }) {
  const n = Math.max(1, Math.floor(duration / BURST_STEP));
  const r = rng(seed);
  const out = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    let pick = Math.floor(r() * count);
    if (count > 1 && pick === last) pick = (pick + 1) % count;
    last = pick;
    out.push({ t: at + i * BURST_STEP, pick, x: (r() - 0.5) * 140, y: (r() - 0.5) * 220, scale: 1.22 + r() * 0.3, rot: (r() - 0.5) * 7, dx: (r() - 0.5) * 70, dy: (r() - 0.5) * 70 });
  }
  return out;
}

/**
 * `burst`: pictures flip past fast at low opacity, behind a number or a title. Options: media (a list of
 * ctx.media entries), at, duration (1.2), opacity (0.2), seed. It fills the frame and reads as ground: layer
 * it under the words, or give it to `nk.stat` as `burst`. Returns { el, render, events, flips }.
 */
export function burst(doc, o = {}) {
  const at = o.at ?? 0;
  const duration = o.duration ?? 1.2;
  const level = o.opacity ?? 0.2;
  const list = (o.media ?? []).filter((m) => srcOf(m));
  const el = h(doc, 'div', { class: 'rd-layer', 'data-burst': '', 'data-bleed': '', style: { overflow: 'hidden', pointerEvents: 'none' } });
  const imgs = list.map((m) => {
    const img = h(doc, 'img', { class: 'rd-cover', src: srcOf(m), alt: '', style: { filter: 'grayscale(.2) contrast(1.08)', visibility: 'hidden' } });
    el.append(img);
    return img;
  });
  const flips = list.length ? burstFlips({ count: list.length, at, duration, seed: o.seed }) : [];
  const beats = [];
  if (list.length) {
    beats.push({ t: at + 0.08, kind: 'whoosh' });
    for (let s = at; s < at + duration - 0.1; s += 0.3) beats.push({ t: s, kind: 'foley', what: 'card flip' });
  }
  const events = cue(el, beats);
  const render = (t) => {
    const end = at + duration;
    const on = list.length > 0 && t >= at && t < end;
    const i = on ? Math.min(flips.length - 1, Math.floor((t - at) / BURST_STEP)) : -1;
    const f = i >= 0 ? flips[i] : null;
    imgs.forEach((img, k) => {
      const mine = f && f.pick === k;
      img.style.visibility = mine ? '' : 'hidden';
      if (!mine) { img.style.transform = ''; return; }
      const u = (t - f.t) / BURST_STEP;
      img.style.transform = `translate(${(f.x + f.dx * u).toFixed(2)}px, ${(f.y + f.dy * u).toFixed(2)}px) rotate(${f.rot.toFixed(3)}deg) scale(${f.scale.toFixed(4)})`;
    });
    el.style.visibility = on ? '' : 'hidden';
    el.style.opacity = on ? (level * Math.min(seg(t, at, at + 0.12), 1 - seg(t, end - 0.2, end))).toFixed(3) : '0';
  };
  render(0);
  return { el, render, events, flips };
}

// ── speech ──────────────────────────────────────────────────────────────────────────────────────────

/** The narrowest column beside a face that still reads; with less room the words go under the face. */
export const SPEECH_MIN_W = 220;

/** A paraphrase never carries quote marks, so it can't read as a verbatim quote. Pure. */
export const unquoted = (text) => String(text ?? '').replace(/["“”«»]/g, '').replace(/^['‘’]+|['‘’]+$/g, '').trim();

/**
 * Where a person's speech text goes, in frame px, from their face at rest: { x, y, w, tail }. Tries `side` ('left'
 * or 'right'; 'auto' starts with the roomier), the other side, under the face, over it, and takes the first that
 * covers the least of this face and `others` (other faces, frame px). Stays in the overlay zone; `tail` is the
 * plate's side that points at the face. Pure.
 */
export function speechSpot({ face, size, side = 'auto', others = [], zone = OVERLAY, gap = 34 }) {
  const roomL = face.x - gap - zone.x0;
  const roomR = zone.x1 - (face.x + face.w + gap);
  const beside = (s) => {
    const room = s === 'left' ? roomL : roomR;
    if (room < SPEECH_MIN_W) return null;
    const w = Math.min(size.w, room);
    return { x: s === 'left' ? face.x - gap - w : face.x + face.w + gap, y: clamp(face.y + face.h * 0.12, zone.y0, Math.max(zone.y0, zone.y1 - size.h)), w, tail: s === 'left' ? 'right' : 'left' };
  };
  const w = Math.min(size.w, zone.x1 - zone.x0);
  const x = clamp(face.x + face.w / 2 - w / 2, zone.x0, zone.x1 - w);
  const under = { x, y: clamp(face.y + face.h + gap, zone.y0, Math.max(zone.y0, zone.y1 - size.h)), w, tail: 'top' };
  const overY = face.y - gap - size.h;
  const over = overY >= zone.y0 ? { x, y: overY, w, tail: 'bottom' } : null;
  const sides = side === 'left' ? ['left', 'right'] : side === 'right' ? ['right', 'left'] : roomR >= roomL ? ['right', 'left'] : ['left', 'right'];
  const covered = (c) => [face, ...others].reduce((n, f) => n + overlapArea({ x: c.x, y: c.y, w: c.w, h: size.h }, f), 0);
  let best = null;
  for (const c of [...sides.map(beside), under, over]) {
    if (!c) continue;
    const cost = covered(c);
    if (!best || cost < best.cost - 1) best = { ...c, cost };
  }
  const { cost: _cost, ...spot } = best;
  return spot;
}

const PLATE = '#15110E';
const TAILS = {
  left: { left: '-22px', top: '26px', width: '23px', height: '32px', clipPath: 'polygon(100% 0,0 50%,100% 100%)' },
  right: { right: '-22px', top: '26px', width: '23px', height: '32px', clipPath: 'polygon(0 0,100% 50%,0 100%)' },
  top: { left: '40px', top: '-22px', width: '32px', height: '23px', clipPath: 'polygon(0 100%,50% 0,100% 100%)' },
  bottom: { left: '40px', bottom: '-22px', width: '32px', height: '23px', clipPath: 'polygon(0 0,100% 0,50% 100%)' },
};
const ORIGINS = { left: '0 40px', right: '100% 40px', top: '50px 0', bottom: '50px 100%' };

/** A plate's width for its words as they wrap now: their longest line plus its padding, never wider than `max`. `k`: screen px per frame px. */
export function fitPlate(el, max, k) {
  const words = el.querySelector?.('[data-speech-words]');
  const lines = words?.getClientRects?.();
  if (!lines?.length) return max;
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  const pad = cs.boxSizing === 'border-box' ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 0;
  const longest = Math.max(...Array.from(lines, (r) => r.width)) / k;
  return Math.min(max, Math.ceil(longest + pad) + 2);
}

/**
 * `speech`: a short paraphrase beside a person, tied to their figure: it keeps its place relative to the face
 * through every move of the picture, so render it after `on`. Options: on (the picture: a treatment result, a
 * figure), target (`face:<person>`, default `face:0`), text (the storyboard's words; quote marks are removed),
 * side ('left' | 'right' | 'auto'), at, duration. It keeps clear of other faces. Throws `[mark_on_nothing]` when
 * the picture has no such face. Returns { el, render, events }.
 */
export function speech(doc, o = {}) {
  const at = o.at ?? 0.3;
  const until = endOf(at, o.duration);
  const pic = pictureOf(doc, o.on, o.media);
  if (!pic) return skipMove(doc, 'speech', 'it needs `on`: the picture of the person speaking');
  const spec = parseTarget(o.target ?? 'face:0');
  const region = spec.kind === 'face' ? findFace(pic.media, spec.value) : null;
  if (!region) return skipMove(doc, 'speech', `${pic.media?.id ?? 'the picture'} has no measured face for "${spec.value}"`);
  const el = h(doc, 'div', { class: 'rd-speech', 'data-speech': '', 'data-keepout': 'label', style: { position: 'absolute', left: '0px', top: '0px', width: '440px', zIndex: '49', font: '400 50px/1.04 var(--hand)', whiteSpace: 'normal', pointerEvents: 'none' } }, `<span data-speech-words>${esc(unquoted(o.text))}</span>`);
  plate(el, { tone: 'dark', opacity: 1, pad: [16, 24], radius: 16 });
  el.style.background = PLATE;
  const tail = h(doc, 'div', { style: { position: 'absolute', background: PLATE } });
  el.append(tail);
  // Over the picture's vignette and grain, in the frame's root; a probe in the picture's frame follows the face.
  const rootOf = () => pic.frame.closest?.('.rd, .nk') ?? null;
  rootOf()?.append(el);
  const probe = h(doc, 'div', { 'data-speech-probe': '', style: { position: 'absolute', pointerEvents: 'none' } });
  pic.frame.append(probe);
  let rest = null;
  const faceNow = (R, k) => {
    const f = probe.getBoundingClientRect();
    return { x: (f.left - R.left) / k, y: (f.top - R.top) / k, w: f.width / k, h: f.height / k };
  };
  // Measured once, with the camera and entrances lifted, so the spot never depends on the moment.
  const place = (root) => {
    const b = pic.box(region);
    if (!b) return;
    Object.assign(probe.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    const lifted = [];
    for (let e = pic.frame.parentElement; e && e !== root.parentElement; e = e.parentElement) {
      if (e.style?.transform) { lifted.push([e, e.style.transform]); e.style.transform = 'none'; }
    }
    const R = root.getBoundingClientRect();
    const k = R.width / W;
    const face = faceNow(R, k);
    const others = [...root.querySelectorAll('[data-face]')]
      .map((f) => { const r = f.getBoundingClientRect(); return { x: (r.left - R.left) / k, y: (r.top - R.top) / k, w: r.width / k, h: r.height / k }; })
      .filter((f) => f.w > 0 && (Math.abs(f.x - face.x) > 2 || Math.abs(f.y - face.y) > 2));
    const first = speechSpot({ face, size: { w: 440, h: el.offsetHeight }, side: o.side ?? 'auto', others });
    el.style.width = `${first.w}px`;
    el.style.width = `${fitPlate(el, first.w, k)}px`;
    const spot = speechSpot({ face, size: { w: parseFloat(el.style.width), h: el.offsetHeight }, side: o.side ?? 'auto', others });
    el.style.left = `${spot.x}px`;
    el.style.top = `${spot.y}px`;
    Object.assign(tail.style, TAILS[spot.tail]);
    el.style.transformOrigin = ORIGINS[spot.tail];
    rest = face;
    for (const [e, v] of lifted.reverse()) e.style.transform = v;
  };
  const events = cue(el, [{ t: at, kind: 'pop' }]);
  const render = (t) => {
    pic.sync();
    const root = rootOf();
    const ready = root?.getBoundingClientRect && root.getBoundingClientRect().width > 0 && el.offsetHeight > 0;
    if (ready && !rest) place(root);
    let dx = 0, dy = 0;
    if (ready && rest) {
      const R = root.getBoundingClientRect();
      const now = faceNow(R, R.width / W);
      dx = now.x - rest.x;
      dy = now.y - rest.y;
    }
    const u = easeOut(seg(t, at, at + 0.18));
    el.style.visibility = live(t, at, until) ? '' : 'hidden';
    el.style.opacity = u.toFixed(3);
    el.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${(0.9 + 0.1 * u).toFixed(4)})`;
  };
  render(0);
  return { el, render, events };
}

// ── cuts ────────────────────────────────────────────────────────────────────────────────────────────

const wordKey = (w) => String(w ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * When the voice starts saying `phrase` (a shot's `at`): the start of the first place in `words`
 * (ctx.timing.words) that says it, from `after` on. A voice that differs mid-phrase still lands on the longest
 * opening it says. Null when none of it is spoken. Pure.
 */
export function cueAt(words, phrase, after = 0) {
  const want = String(phrase ?? '').split(/\s+/).map(wordKey).filter(Boolean);
  const list = (words ?? []).filter((w) => w.start >= after);
  const said = list.map((w) => wordKey(w.text));
  for (let n = want.length; n >= 1; n--) {
    for (let i = 0; i + n <= said.length; i++) {
      if (want.slice(0, n).every((x, k) => said[i + k] === x)) return list[i].start;
    }
  }
  return null;
}

/** Which shot shows at t, by `at` (the frame opens on the first shot). Pure. */
export function cutIndex(ats, t) {
  let i = 0;
  for (let k = 1; k < ats.length; k++) if (t >= ats[k]) i = k;
  return i;
}

/** How much bigger a picture must come back for a cut to it to read as a close-up, not a re-entry. */
export const RECUT_CLOSE_UP = 1.6;

/**
 * Whether a cut re-enters the same picture: every picture of the later shot was in the shot before, and it comes
 * back at less than RECUT_CLOSE_UP times its size. Each list is [{ src, width }], its on-screen width at the cut. Pure.
 */
export function sameImageRecut(before, after) {
  if (!before.length || !after.length || !after.every((p) => before.some((b) => b.src === p.src))) return false;
  return after.some((p) => {
    const was = Math.max(0, ...before.filter((b) => b.src === p.src).map((b) => b.width));
    return was > 0 && p.width / was < RECUT_CLOSE_UP;
  });
}

/**
 * `cuts`: one frame carrying several beats: `shots` [{ at, el, render }] in order, each cut in on its `at` (the
 * first from the frame's start) and rendered from its own time, seconds since it cut in. Build each shot with a
 * treatment or a move as if it started at 0. Their sounds move with them. Returns { el, render, events, shots }.
 */
export function cuts(doc, shots = []) {
  const el = h(doc, 'div', { class: 'rd-layer', 'data-move': 'cuts' });
  // Always in order: a shot whose words weren't found (no `at`) follows the one before by a second.
  const starts = [];
  shots.forEach((s, i) => { starts.push(i === 0 ? 0 : Number.isFinite(s.at) ? Math.max(starts[i - 1], s.at) : starts[i - 1] + 1); });
  const moved = [];
  const holders = shots.map((s) => {
    // A holder per shot: a shot's own render may show or hide its element, the cut decides above that.
    const holder = h(doc, 'div', { class: 'rd-layer', 'data-shot': '' });
    holder.append(s.el);
    el.append(holder);
    return holder;
  });
  shots.forEach((s, i) => {
    // A shot's cues are in its own time: shifted here, so the measure step reads frame seconds.
    const nodes = [...(s.el.matches?.('[data-cues]') ? [s.el] : []), ...(s.el.querySelectorAll?.('[data-cues]') ?? [])];
    let found = false;
    for (const n of nodes) {
      try { moved.push(...JSON.parse(n.getAttribute('data-cues')).map((e) => ({ ...e, t: e.t + starts[i] }))); found = true; } catch { /* a broken cue list is left out */ }
      n.removeAttribute('data-cues');
    }
    if (!found && Array.isArray(s.events)) moved.push(...s.events.map((e) => ({ ...e, t: e.t + starts[i] })));
  });
  const events = cue(el, moved);
  // Read by the screen check (`same_image_recut`): each cut, the picture as it leaves and as it comes back.
  const shown = (holder) => [...holder.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src') ?? '', width: i.getBoundingClientRect().width })).filter((p) => p.src);
  el.__recuts = () => holders.slice(1).flatMap((holder, k) => {
    render(starts[k + 1]);
    return sameImageRecut(shown(holders[k]), shown(holder)) ? [`shot ${k + 2} at ${starts[k + 1].toFixed(2)}s`] : [];
  });
  const render = (t) => {
    const now = cutIndex(starts, t);
    shots.forEach((s, i) => {
      holders[i].style.visibility = i === now ? '' : 'hidden';
      // Every shot is drawn at every t (its own first or last moment when it isn't showing), so the DOM at t
      // never depends on what was drawn before.
      const end = i + 1 < shots.length ? starts[i + 1] - starts[i] : Infinity;
      s.render?.(Math.min(end, Math.max(0, t - starts[i])));
    });
  };
  render(0);
  return { el, render, events, shots, starts };
}


// ── tour ───────────────────────────────────────────────────────────────────

/** A tour's camera: its shortest and longest travel between stops, its pace over a longer way (px a second), how much of the travel leads the words, the slow drift over the whole shot, its default zooms. */
export const TOUR = { travel: 1.1, maxTravel: 1.6, pace: 1200, lead: 0.25, drift: 0.02, zoom: 1.25, faceH: 460, maxZoom: 2.6, focusBox: 90, gap: 18 };

/**
 * The camera's times: each stop's move [from, to] (none for the first) and its `show` span, between arriving and
 * leaving for the next. `lengths` are how far each move travels, in px on screen: the camera never rushes a long way
 * when the words leave it time. Pure.
 */
export function tourTimes(ats, duration, lengths = []) {
  const out = ats.map((at) => ({ at, from: at, to: at, show: [at, duration] }));
  for (let i = 1; i < out.length; i++) {
    const gap = Math.max(0.05, ats[i] - ats[i - 1]);
    const travel = Math.min(clamp((lengths[i] ?? 0) / TOUR.pace, TOUR.travel, TOUR.maxTravel), gap * 0.7);
    out[i].from = Math.max(out[i - 1].to, ats[i] - TOUR.lead * travel);
    out[i].to = out[i].from + travel;
    out[i].show[0] = out[i].to;
    out[i - 1].show[1] = out[i].from;
  }
  return out;
}

/** The camera { s, tx, ty } looking at `point` (px on the fitted picture) at scale s: the point on the subject line, the picture always covering the frame. Pure. */
export function tourCamera(point, s, fit, lower = 0) {
  return {
    s,
    tx: clamp(W / 2 - point[0] * s, W - fit.w * s, 0),
    ty: clamp(SUBJECT.cy - point[1] * s, H - fit.h * s, 0) + lower,
  };
}

/** How far a lowered picture's top fades into the dark, px of the picture. */
const LOWER_FADE = 300;

/** The camera at t: one eased move from stop to stop, and a slow drift over the whole shot so it never sits frozen. Pure. */
export function tourPose(stops, times, t, fit, duration) {
  let i = 0;
  for (let k = 1; k < stops.length; k++) if (t >= times[k].from) i = k;
  const a = stops[Math.max(0, i - 1)], b = stops[i];
  const u = i === 0 ? 1 : easeInOut(seg(t, times[i].from, times[i].to));
  const s = Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), u)) * (1 + TOUR.drift * clamp(t / Math.max(0.01, duration)));
  return tourCamera([lerp(a.point[0], b.point[0], u), lerp(a.point[1], b.point[1], u)], s, fit, lerp(a.lower ?? 0, b.lower ?? 0, u));
}

/** Where a stop's name goes: under what it names, above when there's no room, always inside the overlay zone. `box` is in frame px. Pure. */
export function tourLabelSpot(box, size, gap = TOUR.gap) {
  const below = box.y + box.h + gap;
  const y = below + size.h <= OVERLAY.y1 ? below : box.y - gap - size.h;
  return {
    x: clamp(box.x + box.w / 2 - size.w / 2, OVERLAY.x0, Math.max(OVERLAY.x0, OVERLAY.x1 - size.w)),
    y: clamp(y, OVERLAY.y0, Math.max(OVERLAY.y0, OVERLAY.y1 - size.h)),
  };
}

/**
 * `tour`: one image carrying several beats, worked by one continuous camera: `stops` [{ at, focus | face, zoom, label }].
 * The camera moves, eased, from stop to stop, arriving as the words do. `focus` is [fx, fy], 0–1 of the image; `face` a
 * person in it (`zoom` defaults to a close framing of them). `label` is a name that shows only while the camera holds
 * on that stop, always inside the frame. Options: media, stops, duration, credit, grade. Returns { el, render, events,
 * picture, stops }: marks go `on` the result.
 */
export function tour(doc, o = {}) {
  const media = typeof o.media === 'object' ? o.media : null;
  const iw = media?.width, ih = media?.height;
  if (!(iw > 0 && ih > 0)) return skipMove(doc, 'tour', 'it needs a measured picture as its `media`');
  if (!o.stops?.length) return skipMove(doc, 'tour', 'it needs at least one stop');
  const k = Math.max(W / iw, H / ih);
  const fit = { w: iw * k, h: ih * k };
  const duration = o.duration ?? 6;
  const stops = [];
  for (const raw of o.stops) {
    const face = raw.face != null ? findFace(media, raw.face) : null;
    if (raw.face != null && !face) (doc.__markSkips ??= []).push(`a tour stop was skipped: ${media.id ?? 'the picture'} has no measured face for "${raw.face}"`);
    if (raw.face != null && !face) continue;
    const at = Math.max(stops.at(-1)?.at ?? 0, Number.isFinite(raw.at) ? raw.at : (stops.at(-1)?.at ?? -1) + 1);
    const focus = face ? [face.x + face.w / 2, face.y + face.h / 2] : raw.focus ?? [0.5, 0.45];
    const zoom = clamp(raw.zoom ?? (face ? TOUR.faceH / Math.max(1, face.h * fit.h) : TOUR.zoom), 1, TOUR.maxZoom);
    const hw = TOUR.focusBox / fit.w / zoom, hh = TOUR.focusBox / fit.h / zoom;
    stops.push({ at, point: [focus[0] * fit.w, focus[1] * fit.h], zoom, label: raw.label ?? null, box: face ?? { x: focus[0] - hw, y: focus[1] - hh, w: 2 * hw, h: 2 * hh } });
  }
  if (!stops.length) return skipMove(doc, 'tour', 'none of its stops is on the picture');
  const lengths = stops.map((s, i) => (i ? Math.hypot(s.point[0] - stops[i - 1].point[0], s.point[1] - stops[i - 1].point[1]) * s.zoom : 0));
  const times = tourTimes(stops.map((s) => s.at), duration, lengths);
  const el = h(doc, 'div', { class: 'rd rd-photo', 'data-move': 'tour' });
  const layer = h(doc, 'div', { class: 'rd-layer' });
  const filter = (GRADES[o.grade ?? 'documentary'] ?? GRADES.documentary).filter;
  const img = h(doc, 'img', { class: 'rd-img', src: srcOf(media), alt: '', style: { left: '0px', top: '0px', width: `${fit.w}px`, height: `${fit.h}px`, ...(filter ? { filter } : {}) } });
  layer.append(img);
  el.append(layer);
  const pic = picture(doc, img, media);
  const gr = finish(doc, el, { grade: o.grade });
  if (o.credit) el.append(creditLine(doc, o.credit));
  const names = stops.map((stop, i) => {
    if (!stop.label) return null;
    const tag = h(doc, 'div', { class: 'rd-words rd-tag', 'data-treatment': 'label', 'data-label-kind': 'label', 'data-tour-label': '' }, `<div class="rd-tag-t">${esc(stop.label)}</div>`);
    plate(tag, { tone: 'dark', pad: [12, 20] });
    el.append(tag);
    const cam = tourCamera(stop.point, stop.zoom, fit);
    const box = { x: stop.box.x * fit.w * cam.s + cam.tx, y: stop.box.y * fit.h * cam.s + cam.ty, w: stop.box.w * fit.w * cam.s, h: stop.box.h * fit.h * cam.s };
    let placed = false;
    const seat = () => {
      const measured = tag.offsetWidth > 0;
      // Roboto's 36px runs about 0.52em a letter, with the plate's padding: only until the real size can be read.
      const spot = tourLabelSpot(box, measured ? { w: tag.offsetWidth, h: tag.offsetHeight } : { w: 0.52 * 36 * stop.label.length + 40, h: 65 });
      tag.style.left = `${Math.round(spot.x)}px`;
      tag.style.top = `${Math.round(spot.y)}px`;
      placed = measured;
    };
    seat();
    const [from, to] = times[i].show;
    return (t) => {
      if (!placed) seat();
      const on = t >= from && t < to;
      tag.style.visibility = on ? '' : 'hidden';
      tag.style.clipPath = on ? wipe(easeOut(seg(t, from, from + 0.25)), 30) : '';
    };
  });
  const events = cue(el, []);
  const render = (t) => {
    layer.style.transform = kbTransform(tourPose(stops, times, t, fit, duration));
    pic.sync();
    gr.render(t);
    for (const n of names) n?.(t);
  };
  render(0);
  /**
   * Marks of an inner state need room around the top of the head: the stop they land in pulls back until they fit
   * (expressionMarks asks, as it is built). The camera's whole path is known before anything moves.
   */
  const makeRoom = (kind, region, head, at = 0) => {
    let i = 0;
    for (let k = 1; k < stops.length; k++) if (at >= times[k].from) i = k;
    const stop = stops[i];
    const box = (b, cam) => ({ x: b.x * fit.w * cam.s + cam.tx, y: b.y * fit.h * cam.s + cam.ty, w: b.w * fit.w * cam.s, h: b.h * fit.h * cam.s });
    const inFrame = (m) => m && m.x >= 24 && m.x + m.w <= W - 24;
    // The closest shot where the marks fit and the face stays on the subject line; lowering a picture is the last resort,
    // its top then fades into the dark.
    let best = null;
    for (let zoom = stop.zoom; zoom >= 1; zoom = zoom > 1 ? Math.max(1, zoom * 0.94) : 0) {
      const cam = tourCamera(stop.point, zoom * (1 + TOUR.drift), fit);
      const f = box(region, cam);
      for (const side of [1, -1]) {
        const m = expressionBounds(kind, f, side, box(head, cam));
        if (!inFrame(m)) continue;
        const lower = Math.max(0, STAGE.top - m.y);
        const cx = f.x + f.w / 2, cy = f.y + f.h / 2 + lower;
        const off = Math.max(0, 300 - cx) + Math.max(0, cx - 780) + Math.max(0, cy - 1130);
        if (!best || off < best.off - 1 || (off <= best.off + 1 && lower < best.lower)) best = { zoom, side, lower, off };
      }
    }
    if (!best) return null;
    stop.zoom = best.zoom;
    if (best.lower > 0) {
      stop.lower = best.lower;
      const mask = `linear-gradient(to bottom, transparent ${Math.round(LOWER_FADE * 0.1)}px, #000 ${LOWER_FADE}px)`;
      img.style.setProperty('mask-image', mask);
      img.style.setProperty('-webkit-mask-image', mask);
    }
    return best.side;
  };
  return { el, render, events, picture: pic, stops, times, fit, makeRoom };
}

// ── drawnLogo ───────────────────────────────────────────────────────────────────────────────────────

const collinear = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) === (b[1] - a[1]) * (c[0] - a[0]);
const loopLength = (pts) => pts.reduce((n, p, i) => n + Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]), 0);

/** Corner-cutting: a marker's rounded line instead of the pixel stairs. */
function rounded(pts) {
  const out = [];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
  });
  return out;
}

/**
 * The closed outlines of a binary mask (1 = ink; w × h, row by row), longest first, each a list of [x, y] in
 * mask px: what a marker follows to draw the shape. Specks under `minLength` are dropped. Pure.
 */
export function logoOutlines(mask, w, h, { minLength = 14 } = {}) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const next = new Map();
  const key = (x, y) => y * (w + 1) + x;
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    if (!next.has(k)) next.set(k, []);
    next.get(k).push([x1, y1]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const k of [...next.keys()].sort((a, b) => a - b)) {
    while (next.get(k)?.length) {
      const first = [k % (w + 1), Math.floor(k / (w + 1))];
      const pts = [first];
      let cur = next.get(k).shift();
      while (cur[0] !== first[0] || cur[1] !== first[1]) {
        pts.push(cur);
        const list = next.get(key(cur[0], cur[1]));
        if (!list?.length) break;
        cur = list.shift();
      }
      const clean = pts.filter((p, i) => !collinear(pts[(i - 1 + pts.length) % pts.length], p, pts[(i + 1) % pts.length]));
      if (clean.length >= 3 && loopLength(clean) >= minLength) loops.push(rounded(clean));
    }
  }
  return loops.sort((a, b) => loopLength(b) - loopLength(a));
}

/** A logo's ink as a mask: its opaque pixels, or on an opaque picture whatever differs from its corners. Pure. */
export function logoMask(rgba, w, h) {
  const n = w * h;
  const mask = new Uint8Array(n);
  let clear = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 128) clear += 1;
  const corners = [0, w - 1, n - w, n - 1].map((i) => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
  const bg = [0, 1, 2].map((c) => corners.reduce((a, p) => a + p[c], 0) / 4);
  const keyed = clear < n * 0.02;
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    const far = Math.abs(rgba[i * 4] - bg[0]) + Math.abs(rgba[i * 4 + 1] - bg[1]) + Math.abs(rgba[i * 4 + 2] - bg[2]);
    mask[i] = !keyed || far > 90 ? 1 : 0;
  }
  return mask;
}

/**
 * `drawnLogo`: a real logo's own shape drawn in marker ink, on the whiteboard only (MD-138): the marker follows
 * its outline, then fills it. Never a logo written as a word, never a redrawn or invented shape: the outline is
 * traced from the file, its edges and fill solid and clean (a logo is never streaked like a marker note). On the
 * reel's first frame it is on from the first instant. Put `el` on the scene's `stage`. Options: media, at, duration (1.6), x, y, w (board
 * coordinates; default centred), color (a marker colour). Skipped and reported off a whiteboard. Returns { el, render, events }.
 */
export function drawnLogo(doc, o = {}) {
  const at = o.at ?? 0.3;
  const duration = o.duration ?? 1.6;
  const media = typeof o.media === 'object' ? o.media : null;
  const w = o.w ?? 620;
  const color = o.color ?? COLORS.dry.black;
  const el = h(doc, 'div', { class: 'abs', 'data-set': '', 'data-drawn-logo': '', style: { left: `${o.x ?? 170}px`, top: `${o.y ?? 420}px`, width: `${w}px` } });
  const source = h(doc, 'img', { src: srcOf(o.media), alt: '', style: { display: 'none' } });
  el.append(source);
  const events = cue(el, [{ t: at, kind: 'foley', what: 'marker writing', dur: Math.min(8, Math.max(0.2, duration)) }]);
  let drawn = null;
  const trace = () => {
    if (drawn !== null || !source.complete || !source.naturalWidth) return;
    try {
      // Traced finer than it is drawn, so its edges stay clean at any size.
      const n = Math.max(480, Math.min(1200, Math.round(w * 1.5)));
      // Its true proportions, from the file (a logo is never distorted).
      const m = Math.max(1, Math.round((n * source.naturalHeight) / source.naturalWidth));
      const ht = Math.round((w * m) / n);
      el.style.height = `${ht}px`;
      const c = h(doc, 'canvas', { class: 'nk-ink', style: { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', overflow: 'hidden' } });
      c.width = n; c.height = m;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(source, 0, 0, n, m);
      const data = g.getImageData(0, 0, n, m);
      const mask = logoMask(data.data, n, m);
      g.clearRect(0, 0, n, m);
      g.fillStyle = color;
      for (let y = 0; y < m; y++) for (let x = 0; x < n; x++) if (mask[y * n + x]) g.fillRect(x, y, 1, 1);
      const svg = svgEl(doc, 'svg', { class: 'nk-ink', width: w, height: ht, viewBox: `0 0 ${n} ${m}` });
      const lines = logoOutlines(mask, n, m).map((pts) => {
        const path = svgEl(doc, 'path', { d: `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} Z`, stroke: color, 'stroke-width': ((n / w) * Math.max(5, w * 0.012)).toFixed(2) });
        svg.append(path);
        return { path, length: loopLength(pts) };
      });
      el.append(c, svg);
      drawn = { fill: c, lines, total: lines.reduce((a, l) => a + l.length, 0) };
    } catch {
      drawn = false; // an unreadable file: its silhouette wipes in as ink
      source.style.display = 'block';
      source.style.width = '100%';
      source.style.filter = 'brightness(0)';
    }
  };
  const render = (t) => {
    if (el.isConnected && !el.closest('[data-ground="whiteboard"]')) {
      (doc.__markSkips ??= []).push('a drawn logo was skipped: nk.drawnLogo goes on the whiteboard only');
      el.style.display = 'none';
      return;
    }
    trace();
    el.style.visibility = t >= at ? '' : 'hidden';
    const opening = isOpening(el);
    if (opening) el.style.visibility = '';
    if (drawn === false) { source.style.clipPath = `inset(0 ${(100 - 100 * (opening ? 1 : seg(t, at, at + duration))).toFixed(2)}% 0 0)`; return; }
    if (!drawn) return;
    let budget = (opening ? 1 : easeInOut(seg(t, at, at + duration * 0.68))) * drawn.total;
    for (const l of drawn.lines) {
      const part = Math.min(budget, l.length);
      l.path.style.strokeDasharray = `${part.toFixed(2)} ${(l.length + 10).toFixed(2)}`;
      l.path.style.opacity = budget > 0 ? '1' : '0';
      budget -= l.length;
    }
    const fill = opening ? 1 : easeInOut(seg(t, at + duration * 0.6, at + duration));
    drawn.fill.style.clipPath = `inset(0 ${(100 - 100 * fill).toFixed(2)}% 0 0)`;
    drawn.fill.style.visibility = fill > 0 ? '' : 'hidden';
  };
  render(0);
  return { el, render, events };
}

