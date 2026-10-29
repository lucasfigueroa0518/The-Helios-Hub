// The three scenes (grounds): board, whiteboard, newspaper. Each returns the same shape:
//   { el, cam, ground, stage, front, scene }
// el = the 1080×1920 frame root · cam = what the camera moves · stage = where items go (board: the cork;
// whiteboard: the board surface, in board coordinates; newspaper: the page) · front = lamp/vignette,
// fixed to the lens, above the items · film grain sits on top of everything.
import { h, filler, esc } from './dom.js';

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
