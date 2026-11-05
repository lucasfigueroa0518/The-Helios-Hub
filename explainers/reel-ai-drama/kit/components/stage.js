// `nk.stage`: the only way anything reaches the screen. The frame says what the shot is (ground, who and what is on, when,
// what the camera aims at); kit/stage-layout.js plans the final layout from measured pictures. Pieces land in their final
// spots and the camera reveals them. There are no pixel numbers here: position, size, depth and movement all come from
// solveTimeline. A treatment is an existing component drawn in the box the solver assigned. Render is pure.
import { h, esc, plate } from './dom.js';
import { isOpening, mark, picture } from './anchor.js';
import { inkLayer, linkInk, markerNote } from './marks.js';
import { drawn, expressionMarks, frontPage, FIGURE_GRADE, PAPER_EDGE, plainGround, playersBoard } from './scenes.js';
import { credit, documentSheet, GRADES, grain, headline, label, lowerThird, map, number, page, post, publicCredit, scene, SHADES } from './treatments.js';
import { burst, clickReveal, drawnLogo, flashReveal, phoneShot } from './moves.js';
import { pullQuote } from './evidence.js';
import { lift } from './lift.js';
import { heldCount, stat, statBox } from './stat.js';
import { isMono, matchTone } from './style.js';
import { arrive, arrowBetween, easeInOut, easeOut, seg, toPath } from '../geometry.js';
import { EXPRESSIONS } from '../settings/index.js';
import { applyPose, backdropBand, bareSheets, boxInFrame, headlinePhrase, lensRoom, poseAt, slideAt, STAGE, WHITEBOARD_BOUNDS, softGround, solveTimeline, toneBehind, toneIn, hashString } from '../stage-layout.js';

const LEAVE = 0.35;
const PRINT_EDGE = '0 0 0 10px #F4EFE4, 0 20px 34px 8px rgba(0,0,0,.45)';
/** How dark a plain ground is, 0–1 (kraft and charcoal are both drawn dark). */
const PLAIN_TONE = { charcoal: 0.1, kraft: 0.2, whiteboard: 0.92 };
const CHIP_CONTRAST = 0.38;
const GROUND_LOOK = 'grayscale(.25) contrast(1.04) brightness(.78) sepia(.08)';
const BACKDROP_LOOK = 'grayscale(.45) brightness(.45) blur(26px)';
/** A picture all words: nothing of a letter is left to read behind the captions. */
const BACKDROP_WORDY = 'grayscale(.55) brightness(.4) blur(52px)';
const SHADOW = 'drop-shadow(0 10px 14px rgba(0,0,0,.35))';
const srcOf = (m) => m?.src ?? m?.file ?? '';

/** A whole frame's brightness behind a box (frame px), from the ground's measured tone. */
function groundToneAt(ground, box) {
  if (typeof ground === 'string') return PLAIN_TONE[ground] ?? 0.1;
  const tone = toneIn(ground?.regions, box ? { x: box.x / STAGE.W, y: box.y / STAGE.H, w: box.w / STAGE.W, h: box.h / STAGE.H } : undefined) ?? toneIn(ground?.regions);
  return tone == null ? 0.25 : tone * (ground?.made ? 1 : 0.78);
}

/** The same picture, as far as a frame can tell: its record, a near-duplicate, its cut-out. */
const pictureKeys = (m) => [m?.id, m?.dup_of ?? m?.regions?.dup_of, m?.cutout_of].filter(Boolean);
const sameCrop = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Normalise the frame's words and pieces: a piece's own `label`, a label's `for`, a note's role; a picture on the stage
 * twice is dropped (I19), with what named it moved to the one kept; an arrow mark becomes an arrow. Pure.
 */
export function stageSpec(o = {}) {
  const seen = new Map();
  const merged = new Map();
  const dropped = [];
  const pieces = [];
  (o.pieces ?? []).forEach((p0, i) => {
    let p = { ...p0, id: p0.id ?? `p${i}`, at: Math.max(0, p0.at ?? 0) };
    if (p.note != null && ['figure', 'place', 'date', 'body'].includes(p.role) && !p.note_role) { p = { ...p, note_role: p.role }; delete p.role; }
    const keys = p.media && !p.onto ? pictureKeys(p.media) : [];
    const hit = keys.map((k) => seen.get(k)).find(Boolean);
    if (hit && sameCrop(hit.crop, p.crop)) {
      merged.set(p.id, hit.id);
      dropped.push(p.id);
      return;
    }
    for (const k of keys) if (!seen.has(k)) seen.set(k, p);
    pieces.push(p);
  });
  const to = (id) => merged.get(id) ?? id;
  const ids = new Set(pieces.map((p) => p.id));
  const labels = [];
  for (const p of pieces) {
    if (p.label == null) continue;
    const l = typeof p.label === 'string' ? { text: p.label } : p.label;
    labels.push({ ...l, owner: p.id, at: l.at ?? p.at, id: `label-${p.id}` });
  }
  (o.labels ?? []).forEach((l, i) => {
    const owner = to(l.for ?? l.owner ?? null);
    labels.push({ ...l, owner: owner && ids.has(owner) ? owner : null, id: l.id ?? `label-${i}` });
  });
  // On a plain ground something is on from the first instant.
  if (pieces.length && typeof (o.ground ?? 'charcoal') === 'string' && !pieces.some((p) => p.at <= 0)) {
    const first = pieces.reduce((a, b) => (b.at < a.at ? b : a));
    first.at = 0;
  }
  const arrows = (o.arrows ?? []).map((a, i) => ({ ...a, from: to(a.from), to: to(a.to), id: a.id ?? `arrow-${i}` }));
  const marks = [];
  (o.marks ?? []).forEach((m, i) => {
    if (m.kind === 'arrow' && typeof m.from === 'string' && ids.has(to(m.from)) && ids.has(to(m.on))) {
      arrows.push({ from: to(m.from), to: to(m.on), at: m.at ?? 0, id: m.id ?? `mark-${i}` });
      return;
    }
    marks.push({ ...m, id: m.id ?? `mark-${i}`, on: m.on ? to(m.on) : null });
  });
  const speech = (o.speech ?? []).map((sp, i) => ({ ...sp, on: to(sp.on), id: sp.id ?? `speech-${i}` }));
  // Only a first appearance gets a name (`known_names`: who the reel has already named), and a logo says its own.
  const plain = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const known = new Set((o.known_names ?? []).map(plain));
  const logoSays = (p) => plain(String(p?.media?.shows ?? p?.media?.name ?? '').split(/[,.(]/)[0].replace(/\s*(logo|wordmark)\b.*$/i, ''));
  const kept = labels.filter((l) => {
    if (!l.owner) return true;
    if (known.has(plain(l.text))) return false;
    const owner = pieces.find((p) => p.id === l.owner);
    return !(owner?.media?.kind === 'logo' && !l.sub && logoSays(owner) && logoSays(owner) === plain(l.text));
  });
  return { pieces, labels: kept, marks, arrows, speech, dropped };
}

/** Where a piece is at time t, and how it shows: one place for its whole life. Pure. */
export function placementAt(moments, id, t, entrance = 'arrive') {
  let i = 0;
  while (i + 1 < moments.length && moments[i + 1].t <= t) i += 1;
  const here = (k) => moments[k]?.pieces.find((p) => p.id === id) ?? null;
  const cur = here(i);
  if (!cur) {
    const was = here(i - 1);
    if (was && t < moments[i].t + LEAVE) return { ...was, state: 'leaving', u: seg(t, moments[i].t, moments[i].t + LEAVE) };
    return null;
  }
  const prev = here(i - 1);
  if (!prev) return { ...cur, state: moments[i].t <= 0 ? 'on' : 'arriving', since: moments[i].t, entrance };
  return { ...cur, state: 'on' };
}

function croppedImg(doc, src, c, style = {}) {
  const box = h(doc, 'div', { class: 'abs', style: { left: '0', top: '0', width: '100%', height: '100%', overflow: 'hidden' } });
  const img = h(doc, 'img', { src, alt: '', style: { position: 'absolute', left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%`, width: `${(1 / c.w) * 100}%`, height: `${(1 / c.h) * 100}%`, maxWidth: 'none', ...style } });
  box.append(img);
  return { box, img };
}

/** Tone steps (of 15) that count as a mark drawn inside a logo's silhouette. */
const LOGO_TONE_STEP = 3;
/** The share of a silhouette only tone draws, past which one ink would erase the logo. */
const LOGO_TONE_DETAIL = 0.15;
/** A silhouette this full of its box is a plate or a disc, so far less tone-only detail is all it has to show. */
const LOGO_PLATE_FILL = 0.9;
const LOGO_PLATE_DETAIL = 0.02;

/**
 * Whether a logo's shape would collapse if it were flattened to one ink: what it shows is drawn by tone inside its silhouette
 * (a seal, a wordmark on a plate), so one ink leaves a solid shape. Measured on its tone grid, opaque cells only: a cell counts when
 * all four neighbours are opaque too, so an edge the silhouette draws by itself (letters, a gap) is never counted, and a one-colour
 * mark has nothing to lose. Unmeasured, it can't be said to collapse. Pure.
 */
export function logoCollapses(media) {
  const g = media?.regions?.tone;
  if (!g?.cells || !(g.w > 0) || !(g.h > 0)) return false;
  const at = (x, y) => {
    const c = x < 0 || y < 0 || x >= g.w || y >= g.h ? '.' : g.cells[y * g.w + x];
    return c === '.' || c === undefined ? null : parseInt(c, 16);
  };
  let opaque = 0, x0 = g.w, x1 = -1, y0 = g.h, y1 = -1;
  const inner = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const t = at(x, y);
      if (t === null) continue;
      opaque += 1;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if ([at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].every((n) => n !== null)) inner.push(t);
    }
  }
  if (!inner.length) return false;
  const median = [...inner].sort((a, b) => a - b)[inner.length >> 1];
  const detail = inner.filter((t) => Math.abs(t - median) >= LOGO_TONE_STEP).length / opaque;
  const fill = opaque / ((x1 - x0 + 1) * (y1 - y0 + 1));
  return detail >= LOGO_TONE_DETAIL || (fill >= LOGO_PLATE_FILL && detail >= LOGO_PLATE_DETAIL);
}

function logoHolder(doc, holder, p, src, chip, ink = null) {
  const c = p.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const pad = chip ? 0.1 : 0;
  const inner = h(doc, 'div', { class: 'abs', style: { left: `${pad * 100 * 0.7}%`, top: `${pad * 100}%`, width: `${100 - 2 * pad * 100 * 0.7}%`, height: `${100 - 2 * pad * 100}%` } });
  inner.append(croppedImg(doc, src, c).box);
  if (ink) { inner.style.filter = ink; holder.dataset.inked = ''; }
  if (chip) {
    holder.dataset.chip = '';
    Object.assign(holder.style, { background: '#FBF9F4', borderRadius: '4px', boxShadow: '0 10px 18px rgba(0,0,0,.4)' });
  }
  holder.append(inner);
}

/** A component's own frame furniture goes: the stage has one ground, one grain, one credit. */
function stripFurniture(el) {
  for (const x of el.querySelectorAll('.rd-shade, .rd-vignette, .rd-tint, .nk-grain, [data-credit], .rd-backdrop, [data-world]')) x.remove();
  el.style.background = 'transparent';
  el.style.overflow = 'visible';
}

const STILL = { at: [0, 0.01], scale: 1 };
/** A sheet (page, post, document, a headline's screenshot), its width the box's. */
function embedSheet(holder, made) {
  stripFurniture(made.el);
  holder.append(made.el);
  const layers = [...made.el.querySelectorAll('.rd-layer')];
  return {
    picture: made.picture ?? null,
    aim: made.aim,
    render(t) {
      made.render?.(t);
      for (const l of layers) l.style.transform = 'none';
    },
  };
}
/** A component that draws a whole frame: its 1080×1920 scaled into the box, about the part it uses. */
function embedFull(holder, made, base, inner = null) {
  stripFurniture(made.el);
  const box = inner ?? { x: 0, y: (STAGE.H - base.h * (STAGE.W / base.w)) / 2, w: STAGE.W, h: base.h * (STAGE.W / base.w) };
  const k = Math.min(base.w / box.w, base.h / box.h);
  Object.assign(made.el.style, { position: 'absolute', left: `${(base.w - box.w * k) / 2 - box.x * k}px`, top: `${(base.h - box.h * k) / 2 - box.y * k}px`, width: `${STAGE.W}px`, height: `${STAGE.H}px`, transformOrigin: '0 0', transform: `scale(${k.toFixed(4)})` });
  holder.style.overflow = inner ? 'visible' : 'hidden';
  holder.append(made.el);
  return { picture: made.picture ?? null, render: (t) => made.render?.(t) };
}
/** Words a component places itself: at the box's corner, scaled to fill it. */
function embedWords(holder, made, base) {
  made.el.style.transformOrigin = '0 0';
  holder.append(made.el);
  let k = null;
  return {
    picture: null,
    render(t) {
      made.render?.(t);
      if (k == null) {
        const r = made.el.offsetWidth > 0 ? Math.min(1.25, base.w / made.el.offsetWidth, base.h / Math.max(1, made.el.offsetHeight)) : 1;
        k = r;
      }
      made.el.style.transform = `${made.el.style.transform && made.el.style.transform !== 'none' ? made.el.style.transform.replace(/ ?scale\([^)]*\)/, '') : ''} scale(${k.toFixed(4)})`;
    },
  };
}

/** Where a lifted piece rests in its card: over the spot it came from, so the words beside it stay read. Pure. */
export function liftBox(media, base) {
  const from = media?.regions?.lift_from ?? null;
  const w = base.w * 0.72, h = base.h * 0.72;
  if (!from) return { x: base.w * 0.14, y: base.h * 0.1, w, h };
  const side = from.x + from.w / 2;
  // The piece grows from its own spot toward the near edge of the card.
  const x = side >= 0.5 ? base.w * Math.max(0.28, from.x) : base.w * Math.min(0, from.x);
  return { x: Math.min(x, base.w - w * 0.6), y: base.h * 0.1, w: Math.min(w, base.w - x), h };
}

/** The photo a cut came from, by its id. Pure. */
export function cutoutSource(media) {
  const flag = (media?.flags ?? []).find((f) => /^cutout_of:/.test(f));
  return media?.cutout_of ?? (flag ? flag.slice('cutout_of:'.length) : null);
}

/** The treatment a piece asks for, built in its box. */
function buildTreatment(doc, p, base, holder, mediaIndex, keeps = []) {
  const o = p.opts ?? {};
  const media = p.source ?? p.media;
  const sheet = { ...o, media: p.treatment === 'headline' && !media?.width ? undefined : media, fit: base.w, x: 0, y: 0, tilt: 0, push: STILL, credit: null, duration: o.duration ?? 60 };
  switch (p.treatment) {
    case 'page': {
      const made = embedSheet(holder, page(doc, sheet));
      // A line the picture's own edge cuts stays out of sight above the sheet's edge.
      if (p.crop && !p.rebased && p.kind === 'card' && media?.width > 0) {
        const full = base.w * (media.height / media.width);
        holder.style.overflow = 'hidden';
        holder.firstElementChild.style.transform = `translateY(${(-p.crop.y * full).toFixed(1)}px)`;
      }
      return made;
    }
    case 'post': return embedSheet(holder, post(doc, sheet));
    case 'document': return embedSheet(holder, documentSheet(doc, sheet));
    case 'headline': return p.media?.width > 1 ? embedSheet(holder, headline(doc, sheet)) : embedFull(holder, headline(doc, { ...o, credit: null }), base);
    case 'lift': {
      const made = lift(doc, { ...sheet, at: p.at + (o.after ?? 0.8), box: liftBox(media, base), sheetBox: { w: base.w, h: base.h } });
      return { ...embedSheet(holder, made), page: made.page };
    }
    case 'map': return embedFull(holder, map(doc, { ...o, credit: null, duration: o.duration ?? 60, move: 'hold' }), base);
    case 'newspaper': return embedFull(holder, frontPage(doc, { ...o, media }), base);
    case 'board': return embedFull(holder, playersBoard(doc, o), base);
    case 'stat': {
      const at = o.at ?? p.at;
      const camera = o.camera ? { ...o.camera, scale: Math.min(o.camera.scale ?? 2, lensRoom(base, keeps)) } : undefined;
      return embedFull(holder, stat(doc, { ...o, at, count: heldCount(o.count, p.until - at), ...(camera ? { camera } : {}) }), base, statBox(o));
    }
    case 'number': return embedWords(holder, number(doc, { ...o, at: o.at ?? p.at + 0.1, placed: { x: 0, y: 0 } }), base);
    case 'lower_third': return embedWords(holder, lowerThird(doc, { ...o, at: o.at ?? p.at + 0.1, placed: { x: 0, y: 0 } }), base);
    case 'flash_reveal': return embedFull(holder, flashReveal(doc, { ...o, media, at: o.at ?? p.at, duration: o.duration ?? 60, credit: null }), base);
    case 'phone_shot': return embedFull(holder, phoneShot(doc, { ...o, media, at: o.at ?? p.at, duration: o.duration ?? 60, credit: null }), base);
    case 'click_reveal': return embedFull(holder, clickReveal(doc, { ...o, media, at: o.at ?? p.at, duration: o.duration ?? 60, credit: null }), base);
    case 'burst': return embedFull(holder, burst(doc, { ...o, media: (o.assets ?? []).map((id) => mediaIndex?.[id]).filter(Boolean), at: o.at ?? p.at, duration: o.duration ?? 60 }), base);
    case 'pull_quote': {
      const quote = pullQuote(doc, { ...o, at: o.at ?? p.at });
      return embedFull(holder, quote.el ? quote : { el: quote }, base);
    }
    case 'photo': {
      const img = h(doc, 'img', { src: srcOf(media), alt: '', style: { display: 'block', width: '100%', height: '100%', objectFit: 'cover', filter: (GRADES[o.grade] ?? GRADES.documentary).filter } });
      holder.append(img);
      holder.dataset.framed = '';
      holder.style.boxShadow = PRINT_EDGE;
      return { picture: null, render: () => {} };
    }
    default: throw new Error(`no treatment "${p.treatment}"`);
  }
}

/** The ledge: a torn strip of paper across the foot of the frame, for bodies to stand behind. Seeded; fixed for the frame. */
function ledge(doc, y, seed, light, ground = 'charcoal') {
  let r = seed >>> 0 || 1;
  const rnd = () => { r ^= r << 13; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; };
  const W = STAGE.W + 80;
  const pts = [];
  for (let x = -40; x <= W; x += 22 + rnd() * 26) pts.push([x, 10 + rnd() * 16 + Math.sin(x / 170 + seed) * 5]);
  const edge = pts.map(([x, v]) => `${x.toFixed(1)} ${v.toFixed(1)}`).join(' L');
  const ht = STAGE.H - y + 400;
  const el = h(doc, 'div', { class: 'abs', 'data-ledge': '', style: { left: '0', top: `${y}px`, width: `${STAGE.W}px`, height: `${ht}px`, zIndex: '100', pointerEvents: 'none', filter: 'drop-shadow(0 -8px 12px rgba(0,0,0,.4))' } });
  // A real sheet in the frame's own material, lighter than what it lies on, lit from above: never a band of nothing.
  const fill = light ? '#EFE9DC' : ground === 'kraft' ? '#7B6246' : '#3D362F';
  const lit = light ? '#F7F2E8' : ground === 'kraft' ? '#8F7453' : '#4C443B';
  const sheet = h(doc, 'div', { class: 'abs rd-paper', 'data-ledge-sheet': '', style: { left: '0', top: '0', width: `${W}px`, height: `${ht}px`, background: `linear-gradient(180deg,${lit} 0,${fill} 170px)`, clipPath: `path('M${edge} L${W} ${ht} L-40 ${ht} Z')` } });
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${ht}" viewBox="0 0 ${W} ${ht}" style="position:absolute;left:0;top:0;overflow:visible"><path d="M${edge} L${W} ${ht} L-40 ${ht} Z" fill="none"/><path d="M${edge}" fill="none" stroke="#F4EFE4" stroke-width="4" stroke-opacity=".82"/></svg>`;
  el.prepend(sheet);
  return el;
}

/** An arrow between two real items, drawn at its time. */
function arrowOf(doc, a, color) {
  const line = arrowBetween(a.fromBox, a.toBox, { pad: 18, bend: a.bend });
  const el = h(doc, 'div', { class: 'abs', 'data-arrow': a.id, style: { left: '0', top: '0', width: `${STAGE.W}px`, height: `${STAGE.H}px`, pointerEvents: 'none', zIndex: '90' } });
  const part = (seg_) => `<path d="${toPath(seg_.pts)}" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${seg_.length.toFixed(1)}" stroke-dashoffset="${seg_.length.toFixed(1)}"/>`;
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${STAGE.W}" height="${STAGE.H}" style="position:absolute;left:0;top:0;overflow:visible">${part(line.shaft)}${part(line.flick1)}${part(line.flick2)}</svg>`;
  const paths = [...el.querySelectorAll('path')];
  const lens = [line.shaft.length, line.flick1.length, line.flick2.length];
  const spans = [[0, 0.72], [0.72, 0.86], [0.86, 1]];
  const span = 0.55;
  return {
    el,
    render(t) {
      const u = seg(t, a.at, a.at + span);
      el.style.visibility = t >= a.at ? '' : 'hidden';
      paths.forEach((path, i) => {
        const v = seg(u, spans[i][0], spans[i][1]);
        path.style.visibility = v > 0 ? '' : 'hidden';
        path.setAttribute('stroke-dashoffset', (lens[i] * (1 - v)).toFixed(1));
      });
    },
  };
}

/** The large hook words. */
function hookOf(doc, hook, color, onPicture) {
  const el = h(doc, 'div', { class: 'rd-words', 'data-hook': '', 'data-keepout': 'label', style: { left: `${hook.x}px`, top: `${hook.y}px`, width: `${hook.w}px`, font: `700 ${hook.font}px/1.06 'Pragmatica Extended',sans-serif`, color, whiteSpace: 'pre', zIndex: '48' } }, esc(hook.lines.join('\n')));
  if (onPicture) plate(el, { pad: [10, 16] });
  return {
    el,
    render(t) {
      const u = easeOut(seg(t, hook.at, hook.at + 0.22));
      el.style.visibility = t >= hook.at ? '' : 'hidden';
      el.style.opacity = u.toFixed(3);
    },
  };
}

const TAIL = 18;
/** A speech plate, at its solved spot. */
function plateOf(doc, sp) {
  // The plate fits its words, inside the box the solver gave it, on the side its tail points from.
  const across = sp.tail === 'right' ? { right: `${STAGE.W - sp.x - sp.w}px` } : { left: `${sp.x}px` };
  const el = h(doc, 'div', { class: 'rd-speech', 'data-speech': '', 'data-keepout': 'label', 'data-for': sp.on, style: { position: 'absolute', ...across, top: `${sp.y}px`, width: 'fit-content', maxWidth: `${sp.w}px`, height: `${sp.h}px`, boxSizing: 'border-box', padding: '16px 24px', zIndex: '49', font: `400 ${sp.font}px/1.04 var(--hand)`, color: '#FEF9F3', whiteSpace: 'pre', background: 'rgba(14,12,10,.92)', borderRadius: '16px', visibility: 'hidden' } }, esc((sp.lines ?? [sp.text]).join('\n')));
  if (sp.tail) {
    const at = sp.tail === 'bottom' ? { left: `${(sp.tailX ?? sp.w / 2) - TAIL}px`, bottom: `${-TAIL + 4}px` } : sp.tail === 'left' ? { left: `${-TAIL + 4}px`, top: `${sp.h / 2 - TAIL}px` } : { right: `${-TAIL + 4}px`, top: `${sp.h / 2 - TAIL}px` };
    el.append(h(doc, 'div', { style: { position: 'absolute', width: `${TAIL * 2}px`, height: `${TAIL * 2}px`, background: 'rgba(14,12,10,.92)', transform: 'rotate(45deg) scale(.7)', ...at } }));
  }
  return {
    el, sp,
    render(t) {
      const on = t >= sp.at && t < sp.until;
      el.style.visibility = on ? '' : 'hidden';
      el.style.opacity = on ? easeOut(seg(t, sp.at, sp.at + 0.16)).toFixed(3) : '0';
    },
  };
}

/** A camera past this scale has pieces running past the frame's edges on purpose. */
const ZOOMED = 1.02;

/**
 * The stage. Options: ground ('charcoal' | 'kraft' | 'whiteboard' | a picture record), style ('cutouts' | 'paper'),
 * arrangement ('face_off' | 'lead_inset' | 'row' | 'pile' | 'facing' | 'turned_away' | 'leads_to' | 'solo'), pieces (id,
 * media, role, at, until, side, belongs, label, note, crop, or treatment + opts, fill, onto, custom), labels, marks,
 * arrows, speech, hook, camera, peak, ground_tone, in_turn, known_names, duration, credit, treatment (the frame's name),
 * mediaIndex (id → record: a rejected cut's source photo), ctx (for a custom piece).
 * Returns { el, cam, stage, pieces, picture, pictures, render, layout, report, events, labels, marks, manifest }.
 */
export function stage(doc, o = {}) {
  const asked = o.ground ?? (o.style === 'paper' ? 'kraft' : 'charcoal');
  // Plain black isn't a ground.
  const ground = asked === 'black' ? 'charcoal' : asked;
  const style = o.style ?? 'cutouts';
  const onBoard = ground === 'whiteboard';
  const pictureGround = typeof ground === 'object' && ground ? ground : null;
  const given = pictureGround ? { ...o, pieces: [{ id: 'ground', media: pictureGround, fill: true, at: 0, asGround: true }, ...(o.pieces ?? [])] } : o;
  const spec = stageSpec({ ...given, ground });
  const dur = o.duration ?? 6;
  const legacy = o.camera ? null : o.move ? { move: o.move === 'pan' || o.move === 'hold' ? 'hold' : o.move === 'pull' ? 'push' : o.move === 'drift' ? 'drift' : 'push', stops: [{ at: 0, aim: 'whole' }] } : null;
  const seed = o.seed ?? hashString(`${spec.pieces.map((p) => p.media?.id ?? p.id).join('|')}:${o.treatment ?? ''}`);
  const statAspect = (p) => {
    if (p.treatment !== 'stat' || p.aspect) return p;
    const b = statBox(p.opts ?? {});
    return { ...p, aspect: b.w / Math.max(1, b.h) };
  };
  const layout = solveTimeline({
    pieces: spec.pieces.map(statAspect),
    labels: spec.labels,
    marks: spec.marks,
    arrows: spec.arrows,
    speech: spec.speech,
    hook: o.hook ?? null,
    camera: o.camera ?? legacy ?? undefined,
    peak: Boolean(o.peak),
    in_turn: o.in_turn,
    ground_tone: o.ground_tone,
    arrangement: o.arrangement,
    style,
    seed,
    bounds: onBoard ? WHITEBOARD_BOUNDS : undefined,
    duration: dur,
  });
  if (spec.dropped.length) layout.report.notes.push(`repeated_picture: ${spec.dropped.join(', ')} repeat a picture already on this stage`);
  const prepared = layout.prepared;
  const onPicture = prepared.some((p) => p.kind === 'fill');
  const baseOf = (id) => {
    for (let i = layout.moments.length - 1; i >= 0; i--) {
      const p = layout.moments[i].pieces.find((x) => x.id === id);
      if (p) return p;
    }
    return null;
  };

  // The ground: fixed to the lens, so a move never shows its edge. A whiteboard is its own scene.
  let root;
  let cam;
  let boardScene = null;
  let groundEl = null;
  const toneAt = (box) => groundToneAt(pictureGround ?? ground, box);
  if (onBoard) {
    boardScene = scene(doc, 'whiteboard', { framing: 'wide' });
    root = boardScene.el;
    cam = boardScene.cam;
    root.dataset.treatment = o.treatment ?? 'whiteboard';
    groundEl = cam.firstElementChild;
  } else {
    root = h(doc, 'div', { class: 'rd rd-stage', 'data-treatment': o.treatment ?? (style === 'paper' ? 'collage' : 'collision'), 'data-style': style });
    groundEl = plainGround(doc, typeof ground === 'string' ? ground : 'charcoal');
    root.append(groundEl);
    cam = h(doc, 'div', { class: 'rd-layer' });
    root.append(cam);
  }
  cam.style.transformOrigin = '0 0';
  // A print that couldn't fill the frame takes its own blurred self as the ground: never a void.
  // So does a sheet on its own that leaves the frame half bare. Each has its own, for its own time, from what of it has no words.
  const bare = new Set(bareSheets(layout.moments, prepared, typeof ground === 'string' ? ground : null));
  const backdrops = prepared.filter((p) => (p.backdrop || bare.has(p.id)) && p.media).map((p) => {
    const media = p.source ?? p.media;
    const band = backdropBand(media);
    const shown = Math.max(STAGE.H, STAGE.W / Math.max(0.01, (media.width || 1) / (media.height || 1)));
    const k = Math.max(1.08, STAGE.H / Math.max(1, band.h * shown));
    const y = STAGE.H / 2 + (band.y + band.h / 2 - 0.5) * shown;
    const back = h(doc, 'div', { class: 'rd-layer', 'data-bleed': '', 'data-backdrop': p.id });
    back.append(h(doc, 'img', { class: 'rd-cover', src: srcOf(media), alt: '', style: { filter: band.words ? BACKDROP_WORDY : BACKDROP_LOOK, transformOrigin: `50% ${y.toFixed(1)}px`, transform: `translateY(${(STAGE.H / 2 - y).toFixed(1)}px) scale(${k.toFixed(3)})` } }));
    root.insertBefore(back, cam);
    return { el: back, at: p.at, until: p.until };
  });
  const layer = h(doc, 'div', { class: 'rd-layer', 'data-stage-pieces': '', style: { zIndex: '20' } });
  cam.append(layer);
  if (layout.ledge != null) layer.append(ledge(doc, layout.ledge, seed, onBoard, typeof ground === 'string' ? ground : 'charcoal'));

  // The pieces.
  const pictured = prepared.filter((p) => p.media && (p.kind === 'person' || p.kind === 'print' || p.kind === 'fill' || p.kind === 'thing'));
  const lookOf = (p) => (p.asGround ? GROUND_LOOK : style === 'paper' && p.kind === 'person' ? 'grayscale(.3) contrast(1.08) brightness(.92)' : matchTone(p.media, pictured.filter((q) => q !== p).map((q) => q.media)));
  const pieces = {};
  const events = [];
  const records = [];
  const problems = [];
  prepared.forEach((p) => {
    const base = baseOf(p.id);
    if (!base) return;
    const media = p.media;
    const src = srcOf(media) || p.src || '';
    const holder = h(doc, 'div', { class: 'abs', 'data-piece': p.id, 'data-kind': p.kind, ...(media?.id ? { 'data-asset': media.id } : {}), style: { left: `${base.x}px`, top: `${base.y}px`, width: `${base.w}px`, height: `${base.h}px`, zIndex: p.kind === 'fill' ? '0' : String(layout.z[p.id] ?? 1), transformOrigin: '50% 50%' } });
    // What the measured net reads off the render (kit/screen.mjs measureStage).
    if (p.kind === 'person' && p.measuredHead) holder.dataset.head = JSON.stringify(p.head);
    if (p.open && (p.open.left || p.open.right || p.open.bottom)) holder.dataset.open = JSON.stringify(p.open);
    if (Number.isFinite(p.maxW) && !softGround(p)) holder.dataset.maxw = String(Math.round(p.maxW));
    layer.append(holder);
    let inner = null;
    let pictureFromInner = null;
    const toneHere = toneAt(base);
    const writeIn = (dur_) => (p.at > 0 ? [p.at, p.at + dur_] : [0, dur_]);
    if (p.custom) {
      const mod = p.custom.module ?? o.customModules?.[p.custom.file] ?? null;
      try {
        if (!mod) throw new Error('no module');
        mod.build?.(holder, { ...(o.ctx ?? {}), box: { w: base.w, h: base.h }, at: p.at, until: p.until, duration: dur });
        inner = { render: (t) => mod.render?.(t) };
      } catch (err) {
        problems.push(`custom_failed: ${p.id}: ${err.message}`);
      }
    } else if (p.treatment) {
      try {
        // What a stat's own lens has to stay off: the subject of a picture under it.
        const under = prepared.filter((q) => q.kind === 'fill' && q.focus && q.at < p.until && p.at < q.until);
        const restOf = (q) => layout.moments.flatMap((x) => x.pieces).find((x) => x.id === q.id);
        const keeps = under.map((q) => (restOf(q) ? boxInFrame(restOf(q), q.focus) : null)).filter(Boolean);
        inner = buildTreatment(doc, p, base, holder, o.mediaIndex, keeps);
        pictureFromInner = inner.picture;
      } catch (err) {
        problems.push(`treatment_failed: ${p.id} (${p.treatment}): ${err.message}`);
        if (src) {
          holder.dataset.framed = '';
          holder.style.boxShadow = PRINT_EDGE;
          holder.append(h(doc, 'img', { src, alt: '', style: { display: 'block', width: '100%', height: '100%', objectFit: 'cover', filter: lookOf(p) } }));
        }
      }
    } else if (p.note) {
      holder.dataset.set = ''; // Ink on the board: its colour comes from what's behind it, measured here.
      const ink = inkLayer(doc, holder, { kind: onBoard ? 'dry' : 'chalk' });
      const size = p.note.font * (base.w / p.note.w);
      const color = toneHere > 0.5 ? '#15110e' : '#FEF9F3';
      const lines = p.note.lines.map((text, i) => markerNote(doc, ink, text, { x: 0, y: i * size * 1.12, size, color }));
      const chars = p.note.lines.reduce((n, l) => n + l.length, 0) || 1;
      const span = Math.min(1.6, 0.3 + chars * 0.035);
      const [t0, t1] = writeIn(span);
      inner = {
        render(t) {
          const u = isOpening(holder) ? 1 : seg(t, t0, t1);
          let done_ = 0;
          lines.forEach((n, i) => {
            const share = p.note.lines[i].length / chars;
            n.progress(Math.max(0, Math.min(1, (u - done_) / Math.max(0.001, share))));
            done_ += share;
          });
        },
      };
      events.push({ t: t0, kind: 'foley', what: 'marker writing', dur: t1 - t0 });
    } else if (p.kind === 'drawing') {
      // The first item draws in too, except on the reel's first frame.
      inner = drawn(doc, { media, x: 0, y: 0, w: base.w, h: base.h, at: writeIn(0.9), behind: toneHere });
      holder.append(inner.el);
      events.push({ t: p.at, kind: 'foley', what: 'marker writing', dur: 0.9 });
    } else if (p.kind === 'logo' && onBoard && !media?.regions?.chip && !logoCollapses(media)) {
      inner = drawnLogo(doc, { media, at: p.at, duration: 1.2, x: 0, y: 0, w: base.w });
      holder.append(inner.el);
    } else if (p.kind === 'logo') {
      const lum = toneIn(media?.regions);
      const beneath = records.filter((r) => (layout.z[r.p.id] ?? 0) < (layout.z[p.id] ?? 0)).map((r) => ({ p: r.p, pl: { ...r.base, z: layout.z[r.p.id] ?? 0 } }));
      const behind = toneBehind(base, beneath, (x, y) => toneAt({ x: x - 2, y: y - 2, w: 4, h: 4 }));
      const lost = lum != null && Math.abs(lum - behind) < CHIP_CONTRAST;
      const collapses = logoCollapses(media);
      // A one-colour mark has no colour to keep: it takes the ink that reads here, unless one ink would leave a solid shape. The rest keep their colours: a mark that can't be keyed, has colours of its own to lose, or would collapse goes on a chip where it would otherwise be lost, and always on a whiteboard, where it can't be drawn.
      const ink = lost && !media?.regions?.chip && !collapses && isMono(media) ? (behind < 0.5 ? 'brightness(0) invert(.93) sepia(.08)' : 'brightness(0)') : null;
      logoHolder(doc, holder, p, src, !ink && (Boolean(media?.regions?.chip) || lost || (onBoard && collapses)), ink);
    } else {
      // A rejected cut shows the photo it came from, when there is one; else on paper of its own.
      const original = p.asPrint ? o.mediaIndex?.[cutoutSource(media)] ?? null : null;
      const shown = srcOf(original) || src;
      const filter = lookOf(p);
      const made = p.rebased ? croppedImg(doc, srcOf(p.source) || shown, p.crop, { filter }) : null;
      const img = made?.img ?? h(doc, 'img', { src: shown, alt: '', style: { display: 'block', width: '100%', height: '100%', filter, ...(original ? { objectFit: 'cover' } : {}) } });
      holder.append(made?.box ?? img);
      if (p.kind === 'print' || p.kind === 'card') {
        holder.dataset.framed = '';
        holder.style.boxShadow = PRINT_EDGE;
        if (p.asPrint && !original) holder.style.background = '#F4EFE4';
        if (style === 'paper') holder.append(h(doc, 'div', { class: 'nk-tape', style: { left: 'calc(50% - 75px)', top: '-26px', transform: `rotate(${((hashString(p.id) % 7) - 3)}deg)`, zIndex: '2' } }));
      } else if (p.kind === 'person' || p.kind === 'thing') {
        // One outline weight, no glow.
        img.style.filter = `${filter} ${PAPER_EDGE} ${SHADOW}`;
        holder.dataset.cut = 'paper';
      }
    }
    const pic = pictureFromInner ?? (media ? picture(doc, holder, media, { faces: !p.rebased }) : picture(doc, holder, null, { faces: false }));
    if (pic?.frame) pic.frame.style.zIndex = '30';
    if (pic && !pictureFromInner) pic.ink = p.rebased ? { x: 0, y: 0, w: 1, h: 1 } : p.vis;
    if (p.at > 0 && p.kind !== 'drawing' && !p.note && p.kind !== 'fill') events.push({ t: p.at, kind: 'foley', what: p.kind === 'person' ? 'paper landing on paper' : 'paper landing' }, { t: p.at + 0.3, kind: 'tick' });
    const record = { p, el: holder, picture: pic, media, inner, base };
    pieces[p.id] = record;
    records.push(record);
  });

  // Labels: fixed to the lens, above the pieces, where the solver left them. They ride with the pose, unscaled.
  const labelFinal = new Map(layout.moments.flatMap((m) => m.labels).map((l) => [l.id, l]));
  const labelRecords = spec.labels.map((l) => {
    const when = layout.labelTimes[l.id];
    const spot = labelFinal.get(l.id);
    if (!when || !spot) return null;
    const placed = { x: spot.x, y: spot.y };
    const made = l.kind === 'number'
      ? number(doc, { value: spot.text, label: spot.sub, at: when.at, size: 84, placed, for: l.owner, until: Number.isFinite(when.until) ? when.until : undefined })
      : label(doc, { text: spot.text, sub: spot.sub, kind: l.kind ?? null, at: when.at, until: Number.isFinite(when.until) ? when.until : undefined, placed, for: l.owner });
    if (spot.wrap) Object.assign(made.el.style, { whiteSpace: 'normal', width: `${spot.wrap}px` });
    return { l, made, spot };
  }).filter(Boolean);
  const words = h(doc, 'div', { class: 'rd-layer', 'data-stage-labels': '', style: { zIndex: '46' } });
  for (const r of labelRecords) words.append(r.made.el);

  // Marks.
  const placedNow = () => records.map((r) => ({ p: r.p, pl: { ...r.base, z: layout.z[r.p.id] ?? 0 } }));
  const markTimes = [];
  const markRecords = spec.marks.map((m) => {
    const when = m.on ? pieces[m.on] : null;
    const at = Math.max(m.at ?? 0.3, when && when.p.at > 0 ? when.p.at + 0.45 : 0);
    // The manifest says what is really drawn: the plan check has to see a mark that couldn't land.
    const entry = { kind: m.kind, on: m.on, target: m.target ?? null, at };
    markTimes.push(entry);
    const skip = (why) => {
      entry.skipped = why;
      return null;
    };
    if (EXPRESSIONS[m.kind]) {
      if (!when) return skip(`no piece "${m.on}"`);
      const spot = layout.moments.flatMap((x) => x.marks).find((k) => k.on === m.on && k.kind === m.kind && !k.skipped);
      if (!when.p.markable) return skip('no measured head to put it by');
      if (!spot) return skip('no clear spot beside the head');
      // The ink comes from what is measured behind the marks' spot.
      const light = toneBehind(spot.box, placedNow().filter((x) => (x.p.at ?? 0) <= at && at < x.p.until), (x, y) => toneAt({ x: x - 2, y: y - 2, w: 4, h: 4 })) < 0.5;
      // The room the solver left round the hair, in the picture's own measure.
      const k = spot.roomK ?? 1;
      const head = { x: when.p.head.x + (when.p.head.w * (1 - k)) / 2, y: when.p.head.y + (when.p.head.h * (1 - k)) / 2, w: when.p.head.w * k, h: when.p.head.h * k };
      return expressionMarks(doc, { kind: m.kind, on: when.picture, media: when.media, region: when.p.face, head, at, side: spot.side || 1, fixed: true, color: light ? '#FEF9F3' : '#15110e' });
    }
    const target = m.target && when ? (String(m.target).includes(':') ? m.target : when.el) : when?.el;
    // Words on a lifted page are the page's, not the lifted piece's.
    const onPage = when?.inner?.page && /^text:/i.test(String(m.target ?? ''));
    // A mark on a piece runs round what shows of it, not its empty margin.
    const inkOf = (r) => (r.p.rebased ? { x: 0, y: 0, w: 1, h: 1 } : r.p.vis);
    const made = mark(doc, { kind: m.kind, on: onPage ? when.inner.page.picture : when?.picture, media: when?.media, target, ink: when && target === when.el ? inkOf(when) : null, from: m.from ? pieces[m.from]?.el ?? m.from : undefined, at, duration: dur, color: m.color, seed: m.seed });
    if (made?.skipped && when && /^text:/i.test(String(m.target ?? ''))) {
      // The words aren't on the picture, as far as anything can read: the mark still lands, on the piece. The plan check says so.
      entry.target_fallback = made.skipped;
      const head = headlinePhrase(when.media);
      const pic = onPage ? when.inner.page.picture : when.picture;
      const onHead = head ? mark(doc, { kind: m.kind, on: pic, media: when.media, target: `text:${head}`, at, duration: dur, color: m.color, seed: m.seed }) : null;
      if (onHead && !onHead.skipped) return onHead;
      const kind = m.kind === 'highlight' ? 'underline' : m.kind;
      return mark(doc, { kind, on: when.picture, media: when.media, target: when.el, ink: inkOf(when), at, duration: dur, color: m.color, seed: m.seed });
    }
    if (made?.skipped) entry.skipped = made.skipped;
    return made;
  }).filter(Boolean);

  // Arrows, between what the solver measured.
  const arrowColor = toneAt({ x: 300, y: 900, w: 480, h: 300 }) > 0.5 ? '#15110e' : '#FEF9F3';
  const arrowRecords = (layout.arrows ?? []).map((a) => {
    const made = arrowOf(doc, a, arrowColor);
    layer.append(made.el);
    const tgt = pieces[a.to]?.el;
    if (tgt) linkInk(tgt, 'arrow', ...made.el.querySelectorAll('path'));
    // An arrow rides with what it joins while that moves over.
    return { render(t) { made.render(t); const d = slideAt(layout.camera.slide, a.from, t).dx; made.el.style.transform = d ? `translateX(${d.toFixed(2)}px)` : ''; } };
  });

  // The hook and the plates.
  const hookRecord = layout.hook ? hookOf(doc, layout.hook, onBoard ? '#15110e' : '#FEF9F3', onPicture) : null;
  if (hookRecord) words.append(hookRecord.el);
  const plateRecords = (layout.speech ?? []).map((sp) => {
    const made = plateOf(doc, sp);
    words.append(made.el);
    return made;
  });

  // Over everything but the words: vignette, shade, grain. The caption keeps its band.
  if (!onBoard) {
    if (onPicture || layout.camera.keys.some((k) => k.s > 1.01)) root.append(h(doc, 'div', { class: 'rd-shade', 'data-caption-shade': '', style: { background: SHADES.bottom, zIndex: '30' } }));
    root.append(h(doc, 'div', { class: 'rd-vignette' }));
  }
  const gr = onBoard ? null : grain(doc);
  if (gr) root.append(gr.el);
  root.append(words);

  // Credits: one line, for what's on; never stacked.
  const creditOf = (t) => {
    const out = [];
    for (const r of records) {
      if (!(r.p.at <= t && t < r.p.until) || !r.media) continue;
      const c = publicCredit(r.media.credit ?? r.p.source?.credit ?? '');
      if (c && !out.includes(c)) out.push(c);
    }
    return out.join(' · ');
  };
  const creditLines = new Map();
  for (const m of layout.moments) {
    const text = creditOf(m.t) || (o.credit ? publicCredit(o.credit) : '');
    if (text && !creditLines.has(text)) {
      const el = credit(doc, text, { light: onBoard });
      el.style.visibility = 'hidden';
      plate(el, { pad: [4, 10], opacity: 0.55 });
      // One line, however many pictures: never a stack.
      const size = Math.max(14, Math.min(20, 868 / Math.max(1, text.length * 0.5)));
      Object.assign(el.style, { fontSize: `${size.toFixed(1)}px`, maxWidth: '888px', overflow: 'hidden', textOverflow: 'ellipsis' });
      creditLines.set(text, el);
      root.append(el);
    }
  }

  if (events.length) root.setAttribute('data-cues', JSON.stringify(events.map((e) => ({ ...e, t: Math.round(e.t * 1000) / 1000 })).sort((a, b) => a.t - b.t)));
  layout.report.notes.push(...problems);
  if (layout.report.tight) {
    root.setAttribute('data-stage-tight', layout.report.notes.join('; '));
    (doc.__stageReports ??= []).push(...layout.report.notes);
  }
  if (layout.report.notes.length) (doc.__stageNotes ??= []).push(...layout.report.notes);

  // A picture ground is a piece of its own, over the plain layer: its tone is what the plan asks to change.
  const toneEl = () => (pictureGround ? pieces.ground?.el.querySelector('img') ?? null : groundEl);
  const toneValue = (t) => {
    if (!layout.groundTone.length) return null;
    let v = 0.5;
    for (const g of layout.groundTone) {
      const u = easeInOut(seg(t, g.at, g.at + 0.8));
      v += (g.to - v) * u;
    }
    return 0.4 + 1.2 * v;
  };
  const showIn = (l, pose) => {
    // A word's centre follows the pose; its size doesn't; it stays in the words zone.
    const c = applyPose(pose, { x: l.x + l.w / 2, y: l.y + l.h / 2, w: 0, h: 0 });
    return { x: c.x - (l.x + l.w / 2), y: c.y - (l.y + l.h / 2) };
  };
  const render = (t) => {
    const pose = poseAt(layout.camera.keys, t);
    cam.style.transform = pose.s === 1 && pose.tx === 0 && pose.ty === 0 ? 'none' : `translate(${pose.tx.toFixed(2)}px, ${pose.ty.toFixed(2)}px) scale(${pose.s.toFixed(4)})`;
    // Read by the checks: past the frame's edges on purpose, and how wide a picture really shows.
    if (pose.s > ZOOMED) cam.dataset.zoom = pose.s.toFixed(3);
    else delete cam.dataset.zoom;
    const tone = toneValue(t);
    if (tone != null && toneEl()) toneEl().style.filter = toneEl() === groundEl ? `brightness(${tone.toFixed(3)})` : `${GROUND_LOOK} brightness(${tone.toFixed(3)})`;
    for (const r of records) {
      const { p, el } = r;
      const at = placementAt(layout.moments, p.id, t);
      if (!at) {
        el.style.visibility = 'hidden';
        el.style.transform = 'none';
        r.inner?.render(t);
        r.picture?.sync?.();
        continue;
      }
      const slid = slideAt(layout.camera.slide, p.id, t);
      let dx = slid.dx;
      let dy = slid.dy;
      let scale = 1;
      let rot = at.rot;
      let visible = true;
      const visLeft = at.x + p.vis.x * at.w, visRight = visLeft + p.vis.w * at.w;
      if (at.state === 'arriving') {
        if (p.kind === 'person') {
          const fromLeft = p.side ? p.side === 'left' : (visLeft + visRight) / 2 < STAGE.W / 2;
          const off = fromLeft ? -(visRight + 40) : STAGE.W - visLeft + 40;
          dx += off * (1 - easeOut(seg(t, at.since, at.since + 0.6)));
        } else if (p.kind !== 'drawing' && !p.note && !(p.kind === 'logo' && onBoard)) {
          const m = arrive(seg(t, at.since, at.since + 0.35), { from: [0, -70], lift: 0.04, settle: 2 });
          dx += m.x;
          dy += m.y;
          rot += m.rot;
          scale *= m.scale;
          visible = m.visible;
        }
      } else if (at.state === 'leaving') {
        const toLeft = (visLeft + visRight) / 2 < STAGE.W / 2;
        dx += (toLeft ? -(visRight + 40) : STAGE.W - visLeft + 40) * easeInOut(at.u);
      }
      el.style.visibility = visible ? '' : 'hidden';
      el.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
      r.inner?.render(t);
      r.picture?.sync?.();
    }
    for (const r of labelRecords) {
      r.made.render(t);
      const s = showIn(r.spot, pose);
      const slid = r.l.owner ? slideAt(layout.camera.slide, r.l.owner, t) : { dx: 0, dy: 0 };
      r.made.el.style.transform = `translate(${(s.x + slid.dx * pose.s).toFixed(2)}px, ${(s.y + slid.dy * pose.s).toFixed(2)}px)`;
    }
    for (const r of plateRecords) {
      r.render(t);
      const s = showIn(r.sp, pose);
      const slid = slideAt(layout.camera.slide, r.sp.on, t);
      r.el.style.transform = `translate(${(s.x + slid.dx * pose.s).toFixed(2)}px, ${(s.y + slid.dy * pose.s).toFixed(2)}px)`;
    }
    hookRecord?.render(t);
    for (const b of backdrops) b.el.style.visibility = t >= b.at && t < b.until ? '' : 'hidden';
    for (const m of markRecords) m.render(t);
    for (const a of arrowRecords) a.render(t);
    const nowCredit = creditOf(t) || (o.credit ? publicCredit(o.credit) : '');
    // Never an explicit 'visible': it would show through the hidden clip of a frame that isn't playing.
    for (const [text, el] of creditLines) el.style.visibility = text === nowCredit ? '' : 'hidden';
    gr?.render(t);
    boardScene?.render(t);
  };
  render(0);
  const finite = (v) => (Number.isFinite(v) ? v : dur);
  const manifest = () => ({
    pieces: records.map((r) => ({ id: r.p.id, asset: r.media?.id ?? null, at: r.p.at, until: finite(r.p.until), side: r.p.side ?? null, box_at_rest: { x: r.base.x, y: r.base.y, w: r.base.w, h: r.base.h } })),
    labels: labelRecords.map((r) => ({ text: r.spot.text, ...(r.spot.sub ? { sub: r.spot.sub } : {}), owner: r.l.owner ?? null, at: layout.labelTimes[r.l.id].at, until: finite(layout.labelTimes[r.l.id].until) })),
    marks: [...markTimes.filter((m) => !m.skipped), ...(layout.arrows ?? []).map((a) => ({ kind: 'arrow', on: a.to, from: a.from, target: null, at: a.at }))],
    arrows: (layout.arrows ?? []).map((a) => ({ from: a.from, to: a.to, at: a.at, length: a.length })),
    speech: (layout.speech ?? []).map((s) => ({ on: s.on, text: s.text, at: s.at, until: finite(s.until) })),
    hook: layout.hook ? { text: layout.hook.text, at: layout.hook.at } : null,
    camera: { move: layout.camera.move, stops: layout.camera.stops.map((s) => ({ at: s.at, aim: s.aim, zoom: s.zoom })) },
    skipped_marks: markTimes.filter((m) => m.skipped),
  });
  const firstPerson = records.find((r) => r.p.kind === 'person') ?? records[0] ?? null;
  return { el: root, cam, stage: words, pieces, picture: firstPerson?.picture ?? null, pictures: records.map((r) => r.picture), render, layout, report: layout.report, events, labels: labelRecords.map((r) => r.made), marks: markRecords, manifest };
}
