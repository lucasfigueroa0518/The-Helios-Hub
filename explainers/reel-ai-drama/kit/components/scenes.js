// The three scenes (grounds): board, whiteboard, newspaper, their staged moments (playersBoard, frontPage),
// then the composed shots (tableau, collage, drawn layers, expression marks; see the section near the end).
// The three scenes return the same shape:
//   { el, cam, ground, stage, front, scene }
// el = the 1080×1920 frame root · cam = what the camera moves · stage = where items go (board: the cork;
// whiteboard: the board surface, in board coordinates; newspaper: the page) · front = lamp/vignette,
// fixed to the lens, above the items · film grain sits on top of everything.
import { h, filler, esc, marked, place, svgEl } from './dom.js';
import { cord, pushPin } from './fasteners.js';
import { BACKDROP, backdropFilter, isPage } from './style.js';
import { linkInk, skipMark } from './marks.js';
import { behindColour, findFace, inkBounds as inkOf, isOpening, keyPaper, luma, parseTarget, picture, pictureOf, regionsOf } from './anchor.js';

/** Made kinds that are drawings: their paper is never shown (keyed out when the file has none clear). */
const DRAWN_KINDS = new Set(['sketch', 'drawing', 'expression']);

/**
 * Chalk: a made drawing's dark ink, lit for a dark ground. The paper is keyed out, so dark lines would
 * vanish into kraft, charcoal or a darkened picture; inverted they read as warm chalk (paper-lit), and a
 * hairline glow of the same colour is the stroke-weight floor (a thin line never drops below ~1.5px).
 */
export const CHALK_FILTER = 'invert(1) sepia(.22) saturate(.85) brightness(1.02) drop-shadow(0 0 .7px rgba(254,249,243,.95))';
/** Grounds a drawing keeps its dark ink on: the whiteboard, a newspaper page, the cork board, paper. */
const LIGHT_GROUND = '[data-ground="whiteboard"], [data-ground="newspaper"], [data-ground="board"], [data-ground="light"], .nk-np, .rd-paper';
/** The ink a drawing takes where it sits when the pixels can't be read: 'dark' on a light ground, else 'chalk'. */
export function inkFor(el) {
  return el?.closest?.(LIGHT_GROUND) ? 'dark' : 'chalk';
}
/** The ink a drawing takes from the pixels behind it: chalk on anything dark, dark on anything light; null when they can't be read. */
function drawingInk(doc, el) {
  const r = el.getBoundingClientRect?.();
  const behind = r?.width > 0 && r?.height > 0 ? behindColour(doc, r, el) : null;
  if (!behind) return null;
  return luma(behind) > 0.3 ? 'dark' : 'chalk';
}
import { arrive, easeInOut, easeOut, pinPress, seg, strokeSeconds, tornPolygon } from '../geometry.js';
import { grainOffset, kbTransform, kenBurns, softReveal, wipe } from '../treatment-geometry.js';
import { EXPRESSIONS, SETTINGS, collageSvg, crossesHead, headOf, settingSvg } from '../settings/index.js';
import { headIn, isCut } from '../stage-layout.js';

function shell(doc, scene) {
  const el = h(doc, 'div', { class: `nk nk-scene-${scene}`, 'data-ground': scene });
  const cam = h(doc, 'div', { class: 'nk-cam' });
  const front = h(doc, 'div', { class: 'nk-front' });
  el.append(cam, front, filmGrain(doc));
  return { el, cam, front, scene };
}

export const filmGrain = (doc) => h(doc, 'div', { class: 'nk-grain' });

/** When a whiteboard drawing with no reveal of its own draws in (seconds into the frame). */
export const DRAW_IN = [0, 0.9];

/** The bulletin board: three-layer turbulence cork, warm lamp, vignette. */
export function board(doc) {
  const s = shell(doc, 'board');
  const ground = h(doc, 'div', { class: 'nk-cork' });
  const stage = h(doc, 'div', { class: 'nk-stage' });
  s.cam.append(ground, stage);
  s.front.classList.add('nk-lamp');
  return { ...s, ground, stage };
}

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
 * a window reflection on clean melamine (nothing is on the board but what the frame draws). framing: 'wide' | 'close' | {x,y,w,h}.
 */
export function whiteboard(doc, { framing = 'wide' } = {}) {
  const s = shell(doc, 'whiteboard');
  const f = typeof framing === 'string' ? WHITEBOARD_FRAMING[framing] : framing;
  const ground = h(doc, 'div', { class: 'nk-room' });
  const wb = h(doc, 'div', { class: 'nk-wb', style: { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` } });
  wb.append(h(doc, 'div', { class: 'nk-wb-skin' }));
  const stage = h(doc, 'div', { class: 'nk-stage' });
  // The reflection is on the melamine, under the ink: it never washes a drawing or a logo.
  wb.append(h(doc, 'div', { class: 'nk-wb-glare' }), stage);
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

// ── Staged moments (iteration 8): the board as connected players, the newspaper as an arrival ────────

/** Where 2 to 5 players sit on the board: card size and centres, inside the overlay zone, no card in the middle. */
const PLAYER_SPOTS = {
  1: { w: 460, h: 540, at: [[540, 960]] },
  2: { w: 380, h: 460, at: [[280, 950], [760, 990]] },
  3: { w: 320, h: 380, at: [[540, 800], [270, 1280], [770, 1280]] },
  4: { w: 300, h: 360, at: [[270, 810], [770, 790], [270, 1270], [770, 1290]] },
  // The middle card sits low enough for a cord between the outer two to hang above it.
  5: { w: 260, h: 320, at: [[540, 910], [215, 770], [865, 770], [780, 1310], [300, 1310]] },
};
const CARD_TILT = [-1.6, 1.3, -0.9, 1.7, -1.3];
/** How far a cord hangs below its two pins at its middle, px. */
const CORD_SAG = 60;

/**
 * The cards and cords of a players board. `links` [{ from, to }] are player indices. Each cord runs from a pin on
 * one card's top edge to a pin on the other's, slightly varied, and hangs between them: { cards: [{ x, y, w, h, cx, cy, rot }],
 * cords: [{ from, to, a: [x, y], b: [x, y], mid: [x, y] }] }. Pure.
 */
export function playersLayout(count, links = []) {
  const spot = PLAYER_SPOTS[Math.max(1, Math.min(5, count))];
  const cards = spot.at.map(([cx, cy], i) => ({ x: cx - spot.w / 2, y: cy - spot.h / 2, w: spot.w, h: spot.h, cx, cy, rot: CARD_TILT[i] }));
  // A pin along the card's top edge, leaning towards the other card (never the same spot twice), so the cord hangs between.
  // `extra` leans it further, for a cord that would otherwise run over a third card.
  const pinOn = (c, o, k, extra = 0) => {
    const lean = Math.sign(o.cx - c.cx) || (k % 2 ? 1 : -1);
    const along = 0.5 + lean * Math.min(0.46, 0.14 + ((k * 7) % 5) * 0.035 + extra);
    const a = (c.rot * Math.PI) / 180;
    const dx = (along - 0.5) * c.w;
    return [c.cx + dx * Math.cos(a) + (c.h / 2 - 14) * Math.sin(a), c.cy + dx * Math.sin(a) - (c.h / 2 - 14) * Math.cos(a)];
  };
  const cords = links
    .filter((l) => cards[l.from] && cards[l.to] && l.from !== l.to)
    .map((l, k) => {
      const hung = (extra) => {
        const a = pinOn(cards[l.from], cards[l.to], k * 2 + l.from, extra);
        const b = pinOn(cards[l.to], cards[l.from], k * 2 + l.to + 1, extra);
        return { from: l.from, to: l.to, a, b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + CORD_SAG * Math.min(1, Math.hypot(b[0] - a[0], b[1] - a[1]) / 500)] };
      };
      const others = cards.filter((_, i) => i !== l.from && i !== l.to);
      const over = (p, q) => others.some((c) => Array.from({ length: 21 }, (_, s) => [p[0] + ((q[0] - p[0]) * s) / 20, p[1] + ((q[1] - p[1]) * s) / 20]).some(([x, y]) => x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h));
      for (const extra of [0, 0.08, 0.16, 0.24, 0.32]) {
        const c = hung(extra);
        if (!over(c.a, c.b) && !over(c.a, c.mid) && !over(c.mid, c.b)) return c;
      }
      return hung(0.32);
    });
  return { cards, cords };
}

/** A caption's size on a card: 38px, smaller for a long name, never under the readable floor. */
const captionSize = (name, w) => Math.max(26, Math.min(38, Math.round((w * 1.9) / Math.max(1, String(name ?? '').length))));

/**
 * `playersBoard`: three or more connected players as a clear scene on the cork: one card per player, each pinned
 * up as it is named, a red cord pulled between those the line connects. Options: players [{ media, name, at, logo }]
 * (2–5, a person's photo or cutout, or `logo: true` for a logo printed untouched on paper; `name` is the card's
 * caption), links [{ from, to, at, label }] (player indices; `label`: a few words on the cord), duration, credit.
 * Everything before its `at` is hidden; with no `at` it follows the one before. Returns { el, cam, stage, cards
 * (each { el, picture, … }), cords, render, events }.
 */
export function playersBoard(doc, o = {}) {
  const s = board(doc);
  s.el.dataset.treatment = 'board';
  const players = (o.players ?? []).slice(0, 5);
  const layout = playersLayout(players.length, o.links ?? []);
  const grain = s.el.querySelector('.nk-grain');
  const events = [];
  let clock = 0;
  const cards = players.map((p, i) => {
    const c = layout.cards[i];
    const media = p.media ?? null;
    const at = p.at ?? clock;
    clock = at + 0.6;
    const src = srcOfMedia(p);
    const card = h(doc, 'div', { class: 'nk-polaroid', 'data-player': String(i), 'data-name': p.name ?? '', style: { padding: '18px 18px 74px', zIndex: '1' } });
    place(card, { x: c.x, y: c.y, w: c.w, h: c.h, rot: c.rot });
    const ph = h(doc, 'div', { class: 'nk-ph', style: p.logo ? { background: '#FBF9F4' } : {} });
    const face = regionsOf(media).faces[0] ?? null;
    const cover = !p.logo && !media?.character_image && !isRealCutout(media);
    const img = h(doc, 'img', { src, alt: '', style: p.logo
      ? { left: '12%', bottom: '14%', width: '76%', height: '72%', objectFit: 'contain', objectPosition: '50% 50%' }
      : cover ? { width: '100%', height: '100%', objectFit: 'cover', objectPosition: `50% ${face ? Math.round(Math.max(0, Math.min(1, face.y + face.h / 2 - 0.1)) * 100) : 30}%`, filter: FIGURE_GRADE }
        : { filter: FIGURE_GRADE } });
    ph.append(img);
    card.append(ph);
    const pic = p.logo ? null : picture(doc, img, media);
    if (p.name) card.append(h(doc, 'div', { class: 'nk-cap', style: { fontSize: `${captionSize(p.name, c.w)}px`, bottom: '24px', padding: '0 12px', whiteSpace: 'nowrap' } }, esc(p.name)));
    s.stage.append(card);
    events.push({ t: at, kind: 'foley', what: 'paper landing' }, { t: at + 0.3, kind: 'tick' });
    return { el: card, at, picture: pic, media, spot: c, rot: c.rot };
  });
  const cords = layout.cords.map((c, i) => {
    const link = (o.links ?? []).filter((l) => cards[l.from] && cards[l.to] && l.from !== l.to)[i];
    const after = Math.max(cards[c.from].at, cards[c.to].at) + 0.4;
    const at = link.at ?? after;
    const line = cord(doc, [c.a, c.mid, c.b]);
    const pins = [c.a, c.b].map(([x, y]) => pushPin(doc, { x, y }));
    for (const pin of pins) pin.style.zIndex = '2';
    // The cord runs behind the cards, from pins pressed into their top edges: it never crosses a face.
    line.el.style.zIndex = '0';
    s.stage.insertBefore(line.el, cards[0]?.el ?? null);
    s.stage.append(...pins);
    let tag = null;
    if (link.label) {
      tag = h(doc, 'div', { class: 'abs nk-paperish', 'data-name': link.label, style: { left: `${c.mid[0]}px`, top: `${c.mid[1]}px`, transform: 'translate(-50%,-50%) rotate(-1.5deg)', padding: '6px 16px 8px', background: '#F6F1E4', color: '#22201B', font: "400 32px/1.1 'Patrick Hand',cursive", whiteSpace: 'nowrap', boxShadow: '0 8px 14px -6px rgba(0,0,0,.6)', zIndex: '21' } }, esc(link.label));
      s.stage.append(tag);
    }
    events.push({ t: at, kind: 'foley', what: 'cord pulled', dur: 0.4 }, { t: at + 0.4, kind: 'tick' });
    return { line, pins, tag, at };
  });
  s.el.setAttribute('data-cues', JSON.stringify(events.map((e) => ({ ...e, t: Math.round(e.t * 1000) / 1000 })).sort((a, b) => a.t - b.t)));
  if (o.credit) s.el.append(h(doc, 'div', { class: 'rd-credit', 'data-credit': '', style: { top: '1560px', zIndex: '60' } }, esc(o.credit)));
  const dur = o.duration ?? 6;
  const render = (t) => {
    s.cam.style.transformOrigin = '540px 1000px';
    s.cam.style.transform = `scale(${(1 + 0.05 * easeInOut(seg(t, 0, dur))).toFixed(4)})`;
    for (const c of cards) {
      const m = c.at <= 0 ? { x: 0, y: 0, scale: 1, visible: true } : arrive(seg(t, c.at, c.at + 0.34), { from: [0, -70], lift: 0.05, settle: 2 });
      c.el.style.visibility = m.visible ? '' : 'hidden';
      c.el.style.transform = `translate(${m.x.toFixed(2)}px, ${m.y.toFixed(2)}px) rotate(${c.rot}deg) scale(${m.scale.toFixed(4)})`;
      c.picture?.sync();
    }
    for (const c of cords) {
      const u = easeInOut(seg(t, c.at, c.at + 0.4));
      c.line.progress(u, 1);
      c.line.el.style.visibility = u > 0 ? '' : 'hidden';
      c.pins.forEach((pin, i) => {
        const m = pinPress(seg(t, c.at + (i ? 0.38 : 0), c.at + (i ? 0.46 : 0.08)));
        pin.style.visibility = m.visible ? '' : 'hidden';
        pin.style.transform = `scale(${m.scale.toFixed(4)})`;
      });
      if (c.tag) c.tag.style.visibility = t >= c.at + 0.4 ? '' : 'hidden';
    }
    const [x, y] = grainOffset(t);
    if (grain) grain.style.backgroundPosition = `${x}px ${y}px`;
  };
  render(0);
  return { ...s, cards, cords, render, events: JSON.parse(s.el.getAttribute('data-cues')) };
}

/** The headline's type size on the front page: as big as fits the measure in three lines. Pure. */
export const frontHeadlineSize = (text) => Math.round(Math.max(72, Math.min(132, 5400 / Math.max(1, String(text ?? '').replace(/\[\[|\]\]/g, '').length))));

/** The front page's beats after `at`: it falls and lands, then the headline lands (default). */
export const FRONT = { fall: 0.3, headline: 0.75, slam: 0.16 };

/**
 * `frontPage`: the newspaper as a moment: a front page thrown onto the desk, and a headline that lands on its cue
 * word. Options: masthead, date, headline (as printed; [[words]] can be marked), deck, photo (a ctx.media entry,
 * printed in halftone above the headline), at (the page falls; 0: it lies there from the start), landAt (the
 * headline lands), duration, credit, vol, price. The page's top stays below the caption band. Returns { el, cam,
 * page, headline (mark it with target 'el:headline'), picture, render, events }.
 */
export function frontPage(doc, o = {}) {
  const at = o.at ?? 0.1;
  const landed = at + FRONT.fall;
  const landAt = o.landAt ?? at + FRONT.headline;
  const s = shell(doc, 'newspaper');
  s.el.dataset.treatment = 'newspaper';
  const ground = h(doc, 'div', { class: 'nk-desk' });
  const under = [[-48, 610, 2.6], [-14, 640, -3.2]].map(([x, y, rot]) => h(doc, 'div', { class: 'nk-np', 'data-set': '', style: { left: `${x}px`, top: `${y}px`, width: '1140px', height: '1500px', padding: '60px 70px 0', filter: 'blur(1.5px) brightness(.8)', transform: `rotate(${rot}deg)` } }, filler(70)));
  const TOP = 602;
  const page = h(doc, 'div', { class: 'nk-np', 'data-front-page': '', style: { left: '-30px', top: `${TOP}px`, width: '1140px', height: '1420px', padding: '0 70px', transformOrigin: '570px 0px' } });
  const masthead = o.masthead ?? '';
  page.append(h(doc, 'div', { 'data-set': '' }, `<div class="nk-dateline" style="padding-top:16px;font-size:20px"><span>${esc(o.vol ?? '')}</span><span>${esc(o.date ?? '')}</span><span>${esc(o.price ?? '')}</span></div><div class="nk-rule" style="margin:8px 0 6px"></div><div class="nk-mast" style="font-size:${Math.min(84, mastheadSize(masthead))}px">${esc(masthead)}</div><div class="nk-rule" style="margin:6px 0 0"></div>`));
  // The page's body flows: the picture, the headline's place (held while it is hidden), the deck, then columns
  // of filler down past the frame, so no part of the page reads as blank.
  const flow = h(doc, 'div', { class: 'abs', style: { left: '70px', top: '150px', width: '1000px', height: '1270px', display: 'flex', flexDirection: 'column', gap: '18px', overflow: 'hidden' } });
  const photo = o.photo ?? null;
  let pic = null;
  if (photo) {
    const face = regionsOf(photo).faces[0] ?? null;
    const box = h(doc, 'div', { class: 'nk-halftone', style: { flex: '0 0 370px', width: '1000px', height: '370px' } });
    const img = h(doc, 'img', { src: srcOfMedia({ media: photo }), alt: '', style: { objectPosition: `50% ${face ? Math.round(Math.max(0, Math.min(1, face.y + face.h / 2 - 0.1)) * 100) : 30}%` } });
    box.append(img);
    flow.append(box);
    pic = picture(doc, img, photo);
  }
  const size = frontHeadlineSize(o.headline);
  const words = h(doc, 'div', { 'data-name': 'headline', 'data-headline': '', style: { flex: '0 0 auto', width: '1000px', padding: '6px 0 10px', font: `700 ${size}px/0.98 var(--head)`, letterSpacing: '-0.015em', transformOrigin: '500px 40%', color: '#14120F' } }, marked(o.headline ?? ''));
  flow.append(words);
  const deck = o.deck ? h(doc, 'div', { 'data-deck': '', style: { flex: '0 0 auto', width: '1000px', font: 'italic 400 38px/1.15 var(--serif)', color: '#3A362F' } }, esc(o.deck)) : null;
  if (deck) flow.append(deck);
  flow.append(h(doc, 'div', { 'data-set': '', style: { flex: '1 1 0', minHeight: '0', overflow: 'hidden', borderTop: '3px solid #14120F', paddingTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '26px', opacity: '0.85' } }, [0, 1, 2].map(() => `<div>${filler(48)}</div>`).join('')));
  page.append(flow);
  s.cam.append(ground, ...under, page);
  s.front.classList.add('nk-np-lamp');
  if (o.credit) s.el.append(h(doc, 'div', { class: 'rd-credit', 'data-credit': '', style: { top: '1560px', zIndex: '60' } }, esc(o.credit)));
  const events = [
    ...(at > 0 ? [{ t: at, kind: 'foley', what: 'newspaper' }, { t: at + 0.12, kind: 'whoosh' }, { t: landed, kind: 'impact' }] : []),
    { t: landAt, kind: 'impact' },
    { t: landAt, kind: 'foley', what: 'rubber stamp' },
  ].map((e) => ({ ...e, t: Math.round(e.t * 1000) / 1000 })).sort((a, b) => a.t - b.t);
  s.el.setAttribute('data-cues', JSON.stringify(events));
  const grain = s.el.querySelector('.nk-grain');
  const dur = o.duration ?? 6;
  const render = (t) => {
    // The page falls toward the desk from the lens, turning flat, and stops dead.
    const fall = at > 0 ? easeOut(seg(t, at, landed)) : 1;
    page.style.visibility = at > 0 && t < at ? 'hidden' : '';
    page.style.transform = `rotate(${(-6.5 + 5.3 * fall).toFixed(3)}deg) scale(${(1.42 - 0.42 * fall).toFixed(4)})`;
    page.style.opacity = (at > 0 ? seg(t, at, at + 0.05) : 1).toFixed(3);
    page.style.boxShadow = `0 ${Math.round(30 + 90 * (1 - fall))}px ${Math.round(60 + 80 * (1 - fall))}px -20px rgba(0,0,0,${(0.6 + 0.2 * (1 - fall)).toFixed(2)})`;
    // The headline stamps down on its word.
    const slam = easeOut(seg(t, landAt, landAt + FRONT.slam));
    words.style.visibility = t >= landAt ? '' : 'hidden';
    words.style.opacity = slam.toFixed(3);
    words.style.transform = `scale(${(1.34 - 0.34 * slam).toFixed(4)})`;
    if (deck) { const d = seg(t, landAt + 0.25, landAt + 0.55); deck.style.visibility = d > 0 ? '' : 'hidden'; deck.style.opacity = d.toFixed(3); }
    // Each landing jolts the desk once; after the headline the camera creeps toward it, the page's top held.
    const jolt = (from, px) => { const u = seg(t, from, from + 0.2); return u > 0 && u < 1 ? px * (1 - u) * Math.cos(u * Math.PI * 1.5) : 0; };
    const dy = (at > 0 ? jolt(landed, 9) : 0) + jolt(landAt + 0.04, 7);
    s.cam.style.transformOrigin = '540px 620px';
    s.cam.style.transform = `translateY(${dy.toFixed(2)}px) scale(${(1 + 0.05 * easeInOut(seg(t, landAt, Math.max(landAt + 1, dur)))).toFixed(4)})`;
    pic?.sync();
    const [x, y] = grainOffset(t);
    if (grain) grain.style.backgroundPosition = `${x}px ${y}px`;
  };
  render(0);
  return { ...s, ground, page, headline: words, picture: pic, stage: page, render, events };
}

// ── Composed shots (MD-59, research 06): staged settings, drawn layers, collage ─────────────────────
// tableau(): cutouts staged in a setting (a seeded one from kit/settings, or a made setting picture),
// grounded by the setting's own layers and a contact shadow, one grade over every layer.
// collage(): paper, photo and marker layers stacked on a ground. drawn(): a made drawing revealed as if
// drawn. expressionMarks(): marker marks of an inner state drawn around a face. All render(t) pure.

const FW = 1080;
const FH = 1920;

/** The figure grade every staged cutout shares, so all layers read as one world (research 06 §1). */
export const FIGURE_GRADE = 'grayscale(.35) contrast(1.08) brightness(.9) sepia(.12)';
/**
 * MD-127: a real photo's cutout shows its cut: a thin paper edge round its outline (the news kit's cut-paper
 * look), so a scene built from cutouts reads as a collage of real photos, never as one blended photograph.
 */
export const PAPER_EDGE = 'drop-shadow(0 0 1px #F4EFE4) drop-shadow(0 0 1px #F4EFE4)';
/** A real cutout (a transparent picture cut from a real photo: a person, a table, a lamp), not a drawing. */
export const isRealCutout = (media) =>
  Boolean(media) && !media.made && !DRAWN_KINDS.has(media.made_kind) && isCut(media);
/** A plain collage ground: kraft paper or charcoal (a picture ground is a layer of its own). */
export const plainGround = (doc, ground) =>
  h(doc, 'div', { class: 'rd-layer', 'data-set': '', 'data-bleed': '' }, collageSvg('kraft-ground').replace('#3b2e22', ground === 'kraft' ? '#3b2e22' : '#1f1c1a'));

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
 *   setting: a seeded setting id ('dinner-table', 'boardroom', 'stage', 'phone-call', 'hearing-room'), a
 *            setting picture (media | src: a real place photo, or a made setting) — then pass `seats` —
 *            or nothing: the scene is built on `ground` ('charcoal' default | 'kraft') from cutouts alone.
 *   props:   [{ media | src, x, y, w?, h?, front?, rot?, at?, shadow? }] (MD-127): real cutouts of things (a
 *            table, plates, a lamp) placed in the scene. `x` is the prop's centre and `y` its baseline (frame
 *            px); `h` (default 320) or `w` sizes it; `front` (default true) puts it in front of the cast (a
 *            table hides the figures' cut edges), false behind them; `at` slaps it on (hidden before);
 *            `shadow: false` for a thing that hangs (no contact shadow).
 *   edge:    'paper' | 'none': a thin paper edge round every real cutout (MD-127: the scene reads as a
 *            collage of real photos). Default 'paper' unless the setting is seeded or made (drawn scenes).
 *   seats:   [{ id, x, y, h, under?, clip? }] to add or override seats (frame px; y is the baseline).
 *   cast:    [{ media | src, seat, h?, dx?, enter?: { at: [t0, t1], from: 'left' | 'right' } }]: a figure
 *            without `enter` is in place from t = 0; with it, it starts wholly outside the frame.
 *   screen:  { media | src, on: screen id, at? }: a logo or picture on one of the setting's screens.
 *   move, focus [fx, fy] (0–1 of the frame), amount (0.08), dir, at [t0, t1], duration, grade, credit.
 *   lower:   how far the staged scene is scaled down from the top so the faces sit on the subject line
 *            (y ≈ 800–1100; default 1.14 for the seeded settings, whose seats put faces near y 700).
 * Each cast entry may carry its ctx.media entry (`media`): the figure is then a measured picture (faces for
 * labels, marks and the screen check). Returns { el, stage (an overlay layer inside the camera for marks
 * and labels), figures (each { el, picture, … }), seats, render }.
 */
export function tableau(doc, o = {}) {
  const el = h(doc, 'div', { class: 'rd rd-tableau', 'data-treatment': 'tableau' });
  const cam = h(doc, 'div', { class: 'rd-layer' });
  // The staged scene, scaled about the top centre so its faces come down to the subject line (the top edge
  // stays put: no gap; the bottom it pushes out is the platform-UI zone).
  const lower = h(doc, 'div', { class: 'rd-layer', style: { transformOrigin: '540px 0px', transform: `scale(${o.lower ?? (typeof o.setting === 'string' ? 1.14 : 1)})` } });
  lower.append(cam);
  el.append(lower);
  let layers;
  let seats;
  let screens = [];
  const seeded = typeof o.setting === 'string';
  const madeSetting = seeded || Boolean(o.setting?.media?.made ?? o.setting?.made);
  const edge = o.edge ?? (madeSetting ? 'none' : 'paper');
  if (seeded) {
    const s = setting(doc, o.setting);
    layers = s.layers;
    seats = s.seats;
    screens = s.screens;
  } else if (o.setting) {
    const back = h(doc, 'div', { class: 'rd-layer', 'data-bleed': '' });
    // A real place photo sits a little darker than the cutouts on it, in the same grade, so they read as laid on it.
    back.append(h(doc, 'img', { class: 'rd-cover', src: srcOfMedia(o.setting), alt: '', style: madeSetting ? {} : { filter: 'grayscale(.25) contrast(1.04) brightness(.78) sepia(.08)' } }));
    layers = [back];
    seats = [];
  } else {
    layers = [plainGround(doc, o.ground ?? 'charcoal')];
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
  const nCast = (o.cast ?? []).length;
  const figures = (o.cast ?? []).map((c, i) => {
    // No seat for it: spread the cast across the frame (never all on one spot).
    const seat = seats.find((x) => x.id === c.seat) ?? seats[i] ?? { x: Math.round((FW * (i + 1)) / (nCast + 1)), y: 1400, h: 700, under: 99 };
    const ht = c.h ?? seat.h;
    const box = h(doc, 'div', { class: 'abs', 'data-figure': String(i), style: { left: '0px', top: '0px', width: `${FW}px`, height: `${FH}px` } });
    if (seat.clip) box.style.clipPath = `inset(${seat.clip.y}px ${FW - seat.clip.x - seat.clip.w}px ${FH - seat.clip.y - seat.clip.h}px ${seat.clip.x}px)`;
    const shadow = h(doc, 'div', { class: 'abs', style: { left: `${seat.x - ht * 0.28}px`, top: `${seat.y - 22}px`, width: `${ht * 0.56}px`, height: '44px', borderRadius: '50%', background: 'radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.55),rgba(0,0,0,0) 70%)' } });
    const cut = edge === 'paper' && !c.media?.made && !DRAWN_KINDS.has(c.media?.made_kind) ? `${PAPER_EDGE} ` : '';
    const fig = h(doc, 'img', { class: 'abs', src: srcOfMedia(c), alt: '', ...(cut ? { 'data-cut': 'paper' } : {}), style: { left: `${seat.x + (c.dx ?? 0)}px`, top: `${seat.y - ht}px`, height: `${ht}px`, transform: 'translateX(-50%)', filter: `${FIGURE_GRADE} ${cut}drop-shadow(-8px 14px 18px rgba(0,0,0,.45))` } });
    box.append(shadow, fig);
    const pic = picture(doc, fig, c.media ?? null);
    const under = Math.min(seat.under ?? 99, layers.length);
    (under < layers.length ? slots[under] : tail).push({ y: seat.y, box });
    return { el: fig, box, seat, dx: c.dx ?? 0, enter: c.enter ?? null, picture: pic, media: c.media ?? null };
  });
  // Props (MD-127): real cutouts of things, each on its baseline with a contact shadow, in the cast's grade.
  const props = (o.props ?? []).map((p, i) => {
    const box = h(doc, 'div', { class: 'abs', 'data-prop': String(i), style: { left: '0px', top: '0px', width: `${FW}px`, height: `${FH}px` } });
    const aspect = p.media?.width && p.media?.height ? p.media.width / p.media.height : null;
    const ht = p.h ?? (p.w && aspect ? p.w / aspect : p.w ? null : 320);
    const wd = p.w ?? (ht && aspect ? ht * aspect : null);
    const x = p.x ?? FW / 2;
    const y = p.y ?? 1400;
    if (p.shadow !== false) {
      const sw = (wd ?? ht ?? 320) * 0.9;
      box.append(h(doc, 'div', { class: 'abs', style: { left: `${x - sw / 2}px`, top: `${y - 18}px`, width: `${sw}px`, height: '36px', borderRadius: '50%', background: 'radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.5),rgba(0,0,0,0) 70%)' } }));
    }
    const cut = edge === 'paper' && !p.media?.made && !DRAWN_KINDS.has(p.media?.made_kind) ? `${PAPER_EDGE} ` : '';
    const size = ht != null ? { height: `${ht}px` } : { width: `${wd}px` };
    const img = h(doc, 'img', { class: 'abs', src: srcOfMedia(p), alt: '', 'data-name': p.name ?? p.media?.id ?? `prop-${i}`, ...(cut ? { 'data-cut': 'paper' } : {}), style: { left: `${x}px`, top: `${y}px`, ...size, transformOrigin: '50% 100%', filter: `${FIGURE_GRADE} ${cut}drop-shadow(-6px 12px 14px rgba(0,0,0,.4))` } });
    img.dataset.rot = String(p.rot ?? 0);
    box.append(img);
    return { el: img, box, x, front: p.front !== false, at: p.at ?? null, picture: picture(doc, img, p.media ?? null), media: p.media ?? null };
  });
  layers.forEach((layer, k) => {
    for (const f of slots[k].sort((a, b) => a.y - b.y)) cam.append(f.box);
    cam.append(layer);
    if (k === 0) for (const p of props.filter((q) => !q.front)) cam.append(p.box);
  });
  for (const f of tail.sort((a, b) => a.y - b.y)) cam.append(f.box);
  for (const p of props.filter((q) => q.front)) cam.append(p.box);
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
    for (const p of props) {
      // Wholly inside the frame, whatever its width (MD-58), then slapped on at `at` (hidden before).
      const pw = p.el.offsetWidth;
      if (pw) p.el.style.left = `${Math.min(FW - pw / 2 - 8, Math.max(pw / 2 + 8, p.x)).toFixed(1)}px`;
      const rot = Number(p.el.dataset.rot || 0);
      if (p.at == null) { p.el.style.transform = `translate(-50%, -100%) rotate(${rot}deg)`; p.box.style.visibility = ''; }
      else {
        const m = arrive(seg(t, p.at, p.at + 0.35), { from: [0, -70], lift: 0.04, settle: 2 });
        p.el.style.transform = `translate(calc(-50% + ${m.x.toFixed(2)}px), calc(-100% + ${m.y.toFixed(2)}px)) rotate(${(rot + m.rot).toFixed(3)}deg) scale(${m.scale.toFixed(4)})`;
        p.box.style.visibility = m.visible ? '' : 'hidden';
      }
    }
    for (const f of figures) f.picture.sync();
    for (const p of props) p.picture.sync();
    if (screenImg && o.screen.at != null) screenImg.style.opacity = seg(t, o.screen.at, o.screen.at + 0.3).toFixed(3);
    const [x, y] = grainOffset(t);
    g.style.backgroundPosition = `${x}px ${y}px`;
  };
  render(0);
  return { el, cam, stage, figures, props, seats, screens, render, edge };
}

/**
 * `collage`: paper, photo and marker layers stacked on a ground (research 06 §1, §3). Options:
 *   ground: 'kraft' (default) | 'charcoal' | a picture (media | src; graded, darkened, softened).
 *   layers: [{ media | src | seed, x, y, w, h?, rot, at, halftone, torn, z, color, around, pad }] in frame px.
 *           `seed` is a collage layer from kit/settings ('torn-paper', 'tape', 'scribble-ring',
 *           'halftone'); `halftone` prints a photo as newsprint dots; `torn` tears its edges; `at` is when
 *           it is slapped on (hidden before it), absent = there from t = 0. A 'scribble-ring' takes
 *           `around` (the index of the layer it rings), `target` (what on it: 'face:<name or index>',
 *           'photo:<index>'; default its ink, never its transparent padding) and `pad`; its x, y, w are ignored.
 *   style:  'colour' | 'halftone' | 'torn-halftone': one print for every picture layer with a face (MD-94:
 *           within a scene every face is in one style). A layer's own halftone/torn are ignored when set.
 *   edge:   'paper' (default) | 'none': real cutouts (people and things cut from real photos, MD-127) get a
 *           thin paper edge and a soft shadow from their outline; a layer's own `edge` overrides. A cutout
 *           is never torn (tearing is for a whole rectangular picture); its halftone dots stay inside it.
 *   move, focus, amount (0.06), duration, credit.
 * Returns { el, cam, stage, items (each { el, picture, … }), render }.
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
    back.append(h(doc, 'img', { class: 'rd-cover', src: srcOfMedia(ground), alt: '', style: { filter: `${backdropFilter()} blur(${BACKDROP.blur}px)`, transform: 'scale(1.06)' } }));
    cam.append(back);
  }
  // One style for every face in the scene (MD-94): the collage's `style`, else the first face layer's own.
  const hasFace = (l) => !l.seed && regionsOf(l.media).faces.length > 0;
  const firstFace = (o.layers ?? []).find(hasFace);
  const faceStyle = o.style ?? (firstFace ? (firstFace.halftone ? (firstFace.torn ? 'torn-halftone' : 'halftone') : 'colour') : null);
  const items = (o.layers ?? []).map((l0, i) => {
    const l1 = faceStyle && hasFace(l0) ? { ...l0, halftone: faceStyle !== 'colour', torn: faceStyle === 'torn-halftone' } : l0;
    const realCut = !l1.seed && isRealCutout(l1.media);
    const l = realCut && l1.torn ? { ...l1, torn: false } : l1;
    const wrap = h(doc, 'div', { class: 'abs', style: { left: `${l.x ?? 0}px`, top: `${l.y ?? 0}px`, width: `${l.w ?? 600}px`, zIndex: String(l.z ?? i + 1) } });
    if (l.h != null) wrap.style.height = `${l.h}px`;
    wrap.dataset.rot = String(l.rot ?? 0);
    if (l.seed) {
      wrap.dataset.set = '';
      wrap.innerHTML = collageSvg(l.seed, { color: l.color }).replace('<svg ', '<svg style="width:100%;height:auto;display:block" ');
    } else {
      const img = h(doc, 'img', { src: srcOfMedia(l), alt: '', style: { width: '100%', display: 'block', filter: l.halftone ? 'grayscale(1) contrast(1.35) brightness(1.05)' : 'grayscale(.3) contrast(1.08) brightness(.92)' } });
      wrap.append(img);
      // A cutout's dots are masked to its outline (never a dotted rectangle round it).
      if (l.halftone) wrap.append(h(doc, 'div', { class: 'abs', style: { inset: '0', backgroundImage: 'radial-gradient(rgba(0,0,0,.5) 32%, transparent 36%)', backgroundSize: '9px 9px', mixBlendMode: 'multiply', ...(realCut ? { maskImage: `url("${srcOfMedia(l)}")`, maskSize: '100% 100%', webkitMaskImage: `url("${srcOfMedia(l)}")`, webkitMaskSize: '100% 100%' } : {}) } }));
      // A box shadow is a rectangle: a drawing or a cutout (no paper around it) casts its shadow from its ink.
      const loose = DRAWN_KINDS.has(l.media?.made_kind) || realCut;
      // Every collage ground is dark (kraft, charcoal, a darkened picture): a drawing's ink is chalk there
      const chalk = DRAWN_KINDS.has(l.media?.made_kind);
      if (chalk) { wrap.style.filter = `${CHALK_FILTER} drop-shadow(0 6px 10px rgba(0,0,0,.4))`; wrap.dataset.ink = 'chalk'; }
      else if (realCut && (l.edge ?? o.edge ?? 'paper') === 'paper') { wrap.style.filter = `${PAPER_EDGE} drop-shadow(0 10px 14px rgba(0,0,0,.35))`; wrap.dataset.cut = 'paper'; }
      else if (loose) wrap.style.filter = 'drop-shadow(0 10px 14px rgba(0,0,0,.35))';
      else wrap.style.boxShadow = '0 18px 30px rgba(0,0,0,.45)';
    }
    if (l.torn) wrap.style.clipPath = tornPolygon(i + 3, 2.4);
    cam.append(wrap);
    const img = wrap.querySelector('img');
    // A made drawing never shows its paper: its white is keyed out once it loads (drawn()'s rule).
    const keyed = img && DRAWN_KINDS.has(l.media?.made_kind) ? h(doc, 'canvas', { style: { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'none' } }) : null;
    if (keyed) img.after(keyed);
    const pic = img ? picture(doc, img, l.media ?? null) : null;
    return { el: wrap, at: l.at ?? null, picture: pic, img, keyed, media: l.media ?? null };
  });
  // A scribble ring is a mark: it rings the layer named by `around` (its index), sized from what it marks on
  // that layer (a face, a photo region, the layer's ink), and is tied to it for the screen check. A ring
  // with no `around` has no target ([mark_on_nothing]).
  const rings = [];
  (o.layers ?? []).forEach((l, i) => {
    if (l.seed !== 'scribble-ring') return;
    const ring = items[i].el;
    const T = Number.isInteger(l.around) && l.around !== i ? (o.layers ?? [])[l.around] : null;
    if (!T) { ring.setAttribute('data-ink', 'ring'); return; }
    const tw = T.w ?? 600;
    const th = T.h ?? (T.media?.width && T.media?.height ? (tw * T.media.height) / T.media.width : tw);
    // What the ring is around, 0–1 of the layer: its `target` (a face, a photo region), else the whole layer
    // until its ink is measured (the cutout's figure, not its transparent padding).
    const spec = l.target ? parseTarget(l.target) : null;
    const region = spec?.kind === 'face' ? findFace(T.media, spec.value) : spec?.kind === 'photo' ? regionsOf(T.media).photos[Number(spec.value || 0)] ?? null : null;
    if (spec && !region) throw new Error(`[mark_on_nothing] scribble-ring target "${l.target}" is not on layer ${l.around}'s measured boxes`);
    rings.push({ ring, item: items[l.around], T, tw, th, region, pad: l.pad, measured: Boolean(region) });
    const place = (b) => {
      const pad = l.pad ?? Math.round(0.1 * Math.max(b.w, b.h) + 6);
      Object.assign(ring.style, { left: `${(T.x ?? 0) + b.x - pad}px`, top: `${(T.y ?? 0) + b.y - pad}px`, width: `${b.w + 2 * pad}px`, height: `${b.h + 2 * pad}px`, zIndex: String(Math.max(Number(ring.style.zIndex) || 0, (T.z ?? l.around + 1) + 1)) });
    };
    rings.at(-1).place = place;
    place(region ? { x: region.x * tw, y: region.y * th, w: region.w * tw, h: region.h * th } : { x: 0, y: 0, w: tw, h: th });
    if (l.rot == null) ring.dataset.rot = String(T.rot ?? 0);
    const svg = ring.querySelector('svg');
    if (svg) { svg.setAttribute('preserveAspectRatio', 'none'); svg.style.height = '100%'; }
    linkInk(items[l.around].el, 'ring', ring);
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
      if (it.keyed && keyPaper(it.img, it.keyed) && it.img.__keyed) { it.img.style.opacity = '0'; it.keyed.style.display = 'block'; }
    }
    for (const r of rings) {
      if (r.measured || !r.item.img) continue;
      const ink = r.item.img.__ink ?? (r.item.img.complete && r.item.img.naturalWidth ? inkOf(r.item.img) : undefined);
      if (ink === undefined) continue;
      r.measured = true;
      if (ink) r.place({ x: ink.x * r.tw, y: ink.y * r.th, w: ink.w * r.tw, h: ink.h * r.th });
    }
    for (const it of items) {
      const rot = Number(it.el.dataset.rot || 0);
      if (it.at == null) { it.el.style.transform = `rotate(${rot}deg)`; continue; }
      const m = arrive(seg(t, it.at, it.at + 0.35), { from: [0, -70], lift: 0.04, settle: 2 });
      it.el.style.transform = `translate(${m.x.toFixed(2)}px, ${m.y.toFixed(2)}px) rotate(${(rot + m.rot).toFixed(3)}deg) scale(${m.scale.toFixed(4)})`;
      it.el.style.visibility = m.visible ? '' : 'hidden';
    }
    for (const it of items) it.picture?.sync();
    const [x, y] = grainOffset(t);
    g.style.backgroundPosition = `${x}px ${y}px`;
  };
  render(0);
  return { el, cam, stage, items, render, style: faceStyle };
}

/**
 * A made drawing (an expression sketch, a drawn object or scene: a `made` asset) revealed as if drawn.
 * Options: media | src, x, y, w, h (default from the media's aspect, so marks measure a real box), at [t0, t1]
 * (the reveal; default there from t = 0, except on a whiteboard, where a drawing is always drawn in: only the reel's
 * first frame opens with it already there), dir 'down' | 'right'. Its ink is never chosen by hand (from the
 * ground it sits on, read from the pixels behind it: dark ink on anything light, chalk on anything dark; `behind`,
 * 0–1, is that brightness when the caller has measured it). Drawings never show paper: a transparent drawing sits on any ground as it is; an opaque one has
 * its paper keyed out when it loads. Returns { el, img, picture, render }: marks and labels attach to
 * `picture` (or the result itself as `on`).
 */
export function drawn(doc, o = {}) {
  const media = o.media ?? null;
  const w = o.w ?? 800;
  const ht = o.h ?? (media?.width > 0 && media?.height > 0 ? Math.round((w * media.height) / media.width) : null);
  // `filter` is declared up front (the ink sets it later), so render(t) writes one property order whatever ran before.
  const el = h(doc, 'div', { class: 'abs', 'data-set': '', 'data-drawn': '', style: { left: `${o.x ?? 140}px`, top: `${o.y ?? 640}px`, width: `${w}px`, ...(ht ? { height: `${ht}px` } : {}), filter: 'none' } });
  const img = h(doc, 'img', { src: srcOfMedia(o), alt: '', style: { display: 'block', width: '100%', height: ht ? '100%' : 'auto', ...(o.blend ? { mixBlendMode: o.blend } : {}) } });
  const canvas = h(doc, 'canvas', { style: { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'none' } });
  el.append(img, canvas);
  const pic = picture(doc, img, media);
  const given = winOf(o.at, 1.2);
  // The ink is decided once the drawing is in its frame (build() runs before it is placed).
  let ink = Number.isFinite(o.behind) ? (o.behind > 0.5 ? 'dark' : 'chalk') : null;
  const setInk = () => {
    if (!ink && el.isConnected) ink = drawingInk(doc, el) ?? inkFor(el);
    if (!ink || el.dataset.ink === ink) return;
    el.dataset.ink = ink;
    el.style.filter = ink === 'chalk' ? CHALK_FILTER : 'none';
  };
  // A page keeps its paper and its own ink: keyed, it would be bare text on the ground.
  const paged = isPage(media);
  if (paged) Object.assign(el.style, { background: '#F4EFE4', boxShadow: '0 18px 30px rgba(0,0,0,.45)' });
  const render = (t) => {
    if (!paged) setInk();
    if (!paged && keyPaper(img, canvas)) {
      if (img.__keyed) { img.style.opacity = '0'; canvas.style.display = 'block'; }
      else if (!img.__ink && !o.blend) {
        // Opaque and unreadable: the old blend. In chalk the paper inverts to black, which `screen` drops.
        if (ink === 'chalk') { el.style.filter = 'none'; img.style.filter = CHALK_FILTER; img.style.mixBlendMode = 'screen'; }
        else img.style.mixBlendMode = 'multiply';
      }
    }
    pic.sync();
    const win = given ?? (el.closest?.('[data-ground="whiteboard"]') ? DRAW_IN : null);
    if (!win) return;
    // The reel's first frame is on from its first instant (anchor.js isOpening).
    const u = isOpening(el) ? 1 : seg(t, win[0], win[1]);
    const mask = softReveal(u, o.dir === 'right' ? 'right' : 'down');
    el.style.setProperty('mask-image', mask);
    el.style.setProperty('-webkit-mask-image', mask);
    el.style.visibility = u > 0 ? '' : 'hidden';
  };
  render(0);
  return { el, img, picture: pic, render };
}

/** An expression mark with nothing to draw around: skipped and reported, never a thrown frame. */
const skipExpression = (doc, kind, why) => ({ ...skipMark(doc, kind, why), render() {} });

/**
 * Marker marks of an inner state beside a head (kit/settings EXPRESSIONS: worry, anger, shock,
 * thought, question, idea, argue), drawn from the face's measured box and never across the head: `on` is the picture (a treatment
 * result, a figure, a drawn() result) and `target` the face ('face:<name or index>', default 'face:0').
 * They take the head's other side when the first runs off the frame; with no room on either they are skipped and reported.
 * at: when the first stroke starts; color: ink on light grounds (default), paper-lit or orange on dark.
 * (`face` as a box in the layer's coordinates is the old form, kept for old frames.)
 * @param {Document} doc
 * @param {{ kind: string, face?: { x: number, y: number, w: number, h: number }, on?: any, target?: string, media?: any, at?: number, color?: string, gap?: number }} [opts]
 */
export function expressionMarks(doc, { kind, face, on, target = 'face:0', media, at = 0.3, color = '#15110e', gap = 0.12, side = 1, fixed = false, region: wantedRegion = null, head: wantedHead = null } = {}) {
  const fn = EXPRESSIONS[kind];
  if (!fn) throw new Error(`expressionMarks: no expression "${kind}"`);
  if (on) {
    const pic = pictureOf(doc, on, media);
    if (!pic) return skipExpression(doc, kind, 'it needs `on`: the picture whose face it is drawn around');
    const spec = parseTarget(target);
    const region = wantedRegion ?? (spec.kind === 'face' ? findFace(pic.media, spec.value) : null);
    if (!region) return skipExpression(doc, kind, `${pic.media?.id ?? 'the picture'} has no measured face for "${spec.value}"`);
    // The head, measured on the silhouette: the marks sit on its top, whatever its size.
    const headRegion = wantedHead ?? headIn(pic.media, region);
    // A shot that can pull back (a tour's close-up) makes the room first; the side it found is the one that fits.
    const roomy = typeof on?.makeRoom === 'function' ? on.makeRoom(kind, region, headRegion, at) : null;
    if (roomy) side = roomy;
    // Room was made for them: they stay where they were drawn.
    if (roomy) fixed = 'room';
    const el = svgEl(doc, 'svg', { width: 1, height: 1, style: 'position:absolute;left:0;top:0;overflow:visible', 'data-set': '', 'data-expression': kind });
    pic.frame.append(el);
    const st = { strokes: null, end: at + 1, face: null, head: null, side };
    const measure = () => {
      pic.sync();
      const b = pic.box(region);
      if (!b || b.w < 4 || b.h < 4) return false;
      let start = at;
      st.face = b;
      st.head = pic.boxUnclipped(headRegion) ?? headOf(b);
      st.strokes = fn(b, st.side, st.head).map((p) => {
        const path = svgEl(doc, 'path', { d: p.d, fill: 'none', stroke: color, 'stroke-width': p.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        el.append(path);
        const L = path.getTotalLength?.() || 300;
        const w = [start, start + strokeSeconds(L, 900)];
        start = w[1] + gap;
        return { path, L, w };
      });
      st.end = start;
      return true;
    };
    // What anchor.js's settling asks of the marks once they are on the page.
    el.__expression = {
      kind,
      fixed: Boolean(fixed),
      inked: fixed === true,
      flip() {
        if (!st.strokes) return;
        st.side = -st.side;
        fn(st.face, st.side, st.head).forEach((p, i) => {
          const s = st.strokes[i];
          s.path.setAttribute('d', p.d);
          s.L = s.path.getTotalLength?.() || s.L;
        });
      },
      crosses(dx, dy) {
        if (!st.strokes) return false;
        const points = st.strokes.flatMap((s) => (s.path.getPointAtLength ? Array.from({ length: 21 }, (_, i) => s.path.getPointAtLength((s.L * i) / 20)) : []).map((p) => [p.x + dx, p.y + dy]));
        return crossesHead(points, st.head ?? headOf(st.face));
      },
    };
    const render = (t) => {
      if (!st.strokes && !measure()) return;
      pic.sync();
      for (const s of st.strokes) {
        const u = seg(t, s.w[0], s.w[1]);
        s.path.style.strokeDasharray = `${s.L} ${s.L + 10}`;
        s.path.style.strokeDashoffset = String(s.L * (1 - u));
        s.path.style.opacity = u > 0 ? '1' : '0';
      }
    };
    render(0);
    return { el, render, get end() { return st.end; } };
  }
  const el = svgEl(doc, 'svg', { class: 'abs', width: FW, height: FH, viewBox: `0 0 ${FW} ${FH}`, style: 'left:0;top:0;overflow:visible', 'data-set': '', 'data-expression': kind });
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
