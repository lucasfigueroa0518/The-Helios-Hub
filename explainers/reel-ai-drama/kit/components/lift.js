// `lift` (iteration 4): a person or picture lifted off a real artifact (an article, a post, a page). The
// page lies on its desk like `document`; at `at` the cut-out (the box sidecar's `lift` PNG, cut from the
// page's main photo region) peels up from exactly where it is printed and settles in the subject column,
// scrapbook-style: a lift, a small turn, a growing shadow, with a peel and a landing sound. What it leaves
// is a cut hole in the page, so the same head is never on screen twice, and the frame keeps its light.
// Without a lift PNG the photo region itself is cut out as a paper piece. Marks and labels attach to
// `piece` (face:… on the lifted picture) or `page` (text:… on the page).
import { h } from './dom.js';
import { mainPhoto, picture, regionsOf, overlapArea, SUBJECT } from './anchor.js';
import { documentSheet, page as pageSheet } from './treatments.js';
import { easeInOut, lerp, seg } from '../geometry.js';

/** How long the hole takes to open under the piece as it starts to rise (seconds): the piece hides it while it does. */
export const LIFT_HOLE_IN = 0.12;
/** What shows through the hole: the desk under the page, with the cut's shadow on it. */
const HOLE = { background: '#14100c', boxShadow: 'inset 0 5px 14px rgba(0,0,0,.75), 0 0 0 1px rgba(0,0,0,.35)' };

/**
 * The lifted piece's resting box for a region of aspect `aspect` (w / h) with its face at `faceY` (0–1 of
 * the piece): on the frame's subject line in frame px, or centred inside `box` ({ w, h }) in the box's own px.
 * @param {number} aspect
 * @param {{ faceY?: number | null, height?: number, maxW?: number, top?: number, box?: { w: number, h: number } | null }} [opts]
 */
export function liftRest(aspect, { faceY = null, height = 760, maxW = 840, top = 600, box = null } = {}) {
  if (box) {
    const ht = Math.min(height, box.h, box.w / aspect);
    const w = ht * aspect;
    return { x: (box.w - w) / 2, y: (box.h - ht) / 2, w, h: ht };
  }
  let ht = height;
  let w = ht * aspect;
  if (w > maxW) { w = maxW; ht = w / aspect; }
  const y = faceY == null ? SUBJECT.cy - ht / 2 : SUBJECT.cy - faceY * ht;
  return { x: 540 - w / 2, y: Math.max(top, Math.min(y, 1500 - ht)), w, h: ht };
}

/** The faces of a page that sit in a region, re-expressed in 0–1 of that region (the lifted piece's own faces). */
export function facesIn(media, region) {
  return regionsOf(media).faces
    .filter((f) => overlapArea(f, region) >= 0.5 * f.w * f.h)
    .map((f) => ({ ...f, x: (f.x - region.x) / region.w, y: (f.y - region.y) / region.h, w: f.w / region.w, h: f.h / region.h }));
}

/**
 * `lift`: options media (the artifact: a ctx.media entry whose box sidecar has `photos` and `lift`), lift
 * (the cut-out's src; default the sidecar's), region (0–1 box on the page; default the sidecar's
 * `lift_from`, else the photo region with the main face), at (the peel starts, default 0.8), size (the piece's height at rest, 760), sheet ('page' |
 * 'document', how the artifact lies; default 'document'), fit, x, y, tilt (as `document`), marks (page marks),
 * duration, credit, box ({ w, h, x?, y? }: draw inside a box of that size, as `document`, the piece resting inside it), sheetBox ({ w, h }: the sheet's own box, when the piece's box is only part of it). Returns { el, page, piece: { el, picture }, picture (the piece's), render, cues }.
 */
export function lift(doc, o = {}) {
  const media = o.media ?? {};
  const regions = regionsOf(media);
  const region = o.region ?? (regions.lift && regions.lift_from) ?? mainPhoto(media) ?? (media.face ? { x: Math.max(0, media.face.x - media.face.w), y: Math.max(0, media.face.y - media.face.h * 0.6), w: Math.min(1, media.face.w * 3), h: Math.min(1, media.face.h * 3.2) } : null);
  const base = (o.sheet === 'page' ? pageSheet : documentSheet)(doc, { ...o, box: o.sheetBox ?? o.box ?? null, push: o.push ?? { at: [0, Math.max(0.1, (o.at ?? 0.8))], scale: 1.04 } });
  const el = base.el;
  el.dataset.treatment = 'lift';
  if (!region) return { el, page: base, piece: null, picture: null, render: base.render, cues: [] };
  const W = media.width || 1000, H = media.height || 1000;
  const aspect = (region.w * W) / (region.h * H);
  const pieceFaces = facesIn(media, region);
  const pieceMedia = { id: media.id ? `${media.id}:lift` : 'lift', width: Math.round(region.w * W), height: Math.round(region.h * H), people: media.people ?? [], regions: { faces: pieceFaces } };
  const settled = liftRest(aspect, { faceY: pieceFaces[0] ? pieceFaces[0].y + pieceFaces[0].h / 2 : null, height: o.size ?? 760, box: o.box ?? null });
  // A box may sit anywhere on the sheet: the piece rests inside it, not at the sheet's corner.
  const rest = { ...settled, x: settled.x + (o.box?.x ?? 0), y: settled.y + (o.box?.y ?? 0) };
  // Where the photo is printed on the page: a spot in the page's picture frame, read every render.
  const pagePic = base.picture;
  // It is also the hole the piece leaves: opaque, exactly over what was printed there.
  const spot = h(doc, 'div', { 'data-lift-from': '', style: { position: 'absolute', pointerEvents: 'none', opacity: '0', ...HOLE } });
  pagePic.frame.append(spot);
  const src = o.lift ?? regions.lift;
  const piece = src
    ? h(doc, 'img', { class: 'rd-lift', src, alt: '', 'data-lifted': '' })
    : h(doc, 'div', { class: 'rd-lift rd-lift-cut', 'data-lifted': '', style: { backgroundImage: `url("${media.file ?? ''}")`, backgroundSize: `${100 / region.w}% ${100 / region.h}%`, backgroundPosition: `${region.w < 1 ? (region.x / (1 - region.w)) * 100 : 0}% ${region.h < 1 ? (region.y / (1 - region.h)) * 100 : 0}%` } });
  el.append(piece);
  const pic = picture(doc, piece, pieceMedia);
  for (const f of pic.faceEls) f.el.setAttribute('data-lifted', media.id ?? '');
  // Where the piece rests, for labels placed by it (keep-outs measure pictures at rest).
  const restBox = { left: `${rest.x}px`, top: `${rest.y}px`, width: `${rest.w}px`, height: `${rest.h}px`, transform: 'none', visibility: '' };
  piece.setAttribute('data-rest', JSON.stringify(restBox));
  pic.frame.setAttribute('data-rest', JSON.stringify(restBox));
  const at = o.at ?? 0.8;
  const dur = 0.75;
  const cues = [
    { t: Math.round(at * 1000) / 1000, kind: 'foley', what: 'paper peeling off a page', dur: 0.45 },
    { t: Math.round((at + dur) * 1000) / 1000, kind: 'foley', what: 'paper landing on paper' },
  ];
  el.setAttribute('data-cues', JSON.stringify(cues));
  const render = (t) => {
    base.render(t);
    pagePic.sync();
    const b = pagePic.box(region);
    if (b) Object.assign(spot.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    const u = easeInOut(seg(t, at, at + dur));
    const R = el.getBoundingClientRect?.();
    const S = spot.getBoundingClientRect?.();
    // The element's own width, not the frame's: it may be drawn in a box, or scaled by whoever holds it.
    const k = R && R.width ? R.width / (el.offsetWidth || o.box?.w || 1080) : 1;
    const from = R && S && S.width ? { x: (S.left - R.left) / k, y: (S.top - R.top) / k, w: S.width / k, h: S.height / k } : rest;
    const lifted = t >= at;
    piece.style.visibility = lifted ? '' : 'hidden';
    Object.assign(piece.style, { left: `${lerp(from.x, rest.x, u).toFixed(1)}px`, top: `${lerp(from.y, rest.y, u).toFixed(1)}px`, width: `${lerp(from.w, rest.w, u).toFixed(1)}px`, height: `${lerp(from.h, rest.h, u).toFixed(1)}px` });
    // Scrapbook motion: up off the page, a small turn, the shadow growing as it rises.
    const rise = Math.sin(Math.PI * Math.min(1, u * 1.15));
    piece.style.transform = `rotate(${(-2.5 * u).toFixed(3)}deg) scale(${(1 + 0.05 * rise).toFixed(4)})`;
    piece.style.filter = `drop-shadow(0 ${(8 + 34 * u).toFixed(1)}px ${(10 + 40 * u).toFixed(1)}px rgba(0,0,0,${(0.35 + 0.3 * u).toFixed(2)}))`;
    spot.style.opacity = seg(t, at, at + LIFT_HOLE_IN).toFixed(3);
    pic.sync();
  };
  render(0);
  return { el, page: base, piece: { el: piece, picture: pic }, picture: pic, render, cues, region };
}
