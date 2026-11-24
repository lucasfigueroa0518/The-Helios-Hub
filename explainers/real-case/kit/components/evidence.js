// Evidence: the physical objects that carry the story on any scene. Every piece is a real-world object
// (a clipping, a printout, a notice, a typed card, a tag, a Polaroid, a cutout, a printed logo), never a
// UI tile or a card standing for a concept. Text in [[double brackets]] becomes a marked span that
// marker marks can measure (markOf). Newspaper body text is either verified facts or filler lines.
//
// Every component takes `doc` first and a placement { x, y, w, h, rot, z } in its options, and returns
// an absolutely positioned element.
import { h, place, esc, marked, filler } from './dom.js';
import { tornPolygon } from '../geometry.js';

const pos = (o) => ({ x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot ?? 0, z: o.z });
const paras = (body) => (Array.isArray(body) ? body : body ? [body] : []).map((p) => `<p>${marked(p)}</p>`).join('');

/** A newspaper clipping: masthead kicker, display-serif headline, deck, halftone photo, facts + filler columns. */
export function clipping(doc, o = {}) {
  const { masthead = '', date = '', kicker = '', headline = '', deck = '', body = [], photo = null, photoH = 300, fillerLines = 6, torn = true, seed = 1 } = o;
  const el = h(doc, 'div', { class: 'nk-clip', style: { padding: '46px 50px 52px' } });
  if (torn) el.style.clipPath = tornPolygon(seed);
  el.innerHTML = `
    <div class="nk-kicker" data-set><span>${esc(masthead)}</span><span>${esc(kicker || date)}</span></div>
    ${headline ? `<h1 style="font-size:${o.headSize ?? 84}px">${marked(headline)}</h1>` : ''}
    ${deck ? `<h2>${marked(deck)}</h2>` : ''}
    ${photo ? `<div class="nk-halftone" style="height:${photoH}px;margin:0 0 18px"><img src="${esc(photo)}" alt=""></div>` : ''}
    <div class="nk-cols">${paras(body)}${filler(fillerLines, { cls: 'nk-greek' })}</div>`;
  el.querySelectorAll('.nk-greek').forEach((g) => { g.style.height = '9px'; g.style.margin = '9px 0'; g.style.background = '#3a352e'; g.style.opacity = '0.5'; });
  return place(el, pos({ w: 900, ...o }));
}

/** An article set straight on the newspaper page (no paper of its own; the page is the surface). */
export function article(doc, o = {}) {
  const { headline = '', deck = '', body = [], photo = null, photoH = 420, fillerLines = 10, headSize = 80, columns = 2 } = o;
  const el = h(doc, 'div', { class: 'nk-article abs', style: { background: '#E9E1CD' } });
  el.innerHTML = `
    ${headline ? `<div class="nk-hl" style="font-size:${headSize}px">${marked(headline)}</div>` : ''}
    ${deck ? `<div class="nk-deck">${marked(deck)}</div>` : ''}
    ${photo ? `<div class="nk-halftone" style="height:${photoH}px;margin:22px 0 16px"><img src="${esc(photo)}" alt=""></div>` : ''}
    <div class="nk-body" style="column-count:${columns}">${(Array.isArray(body) ? body : [body]).filter(Boolean).map(marked).join(' ')}${filler(fillerLines)}</div>`;
  return place(el, pos({ w: 1000, ...o }));
}

/** A pull quote as the paper prints it (a verbatim artifact), rules above and below. */
export function pullQuote(doc, o = {}) {
  const { text = '', speaker = '' } = o;
  const el = h(doc, 'div', { class: 'abs', style: { background: '#E9E1CD', borderTop: '3px solid #1B1A17', borderBottom: '3px solid #1B1A17', padding: '16px 0', font: "italic 400 36px/1.25 var(--serif)", color: '#1B1A17' } },
    `“${marked(text)}”<div data-set style="font:700 20px var(--serif);font-style:normal;letter-spacing:0.14em;margin-top:10px">— ${esc(speaker).toUpperCase()}</div>`);
  return place(el, pos({ w: 460, ...o }));
}

/**
 * An artifact recreated on office paper (word for word), never a copy of a real product screen.
 * kind: 'post' (a public post) | 'statement' (letterhead statement) | 'reply' (a chat reply).
 */
export function printout(doc, o = {}) {
  const { kind = 'post', speaker = '', date = '', text = '' } = o;
  const el = h(doc, 'div', { class: `nk-print nk-${kind}` });
  const initial = esc((speaker.trim()[0] || '?').toUpperCase());
  if (kind === 'statement') {
    el.innerHTML = `<div class="nk-lh" data-set><span>Statement</span><span>${esc(date)}</span></div>${marked(text)}<div style="margin-top:26px;font:700 22px Roboto;letter-spacing:0.14em">— ${esc(speaker).toUpperCase()}</div>`;
  } else if (kind === 'reply') {
    el.innerHTML = `<div class="nk-name" style="margin-bottom:14px">${esc(speaker)}</div><div class="nk-bubble">${marked(text)}</div>${date ? `<div class="nk-date" style="margin-top:14px">${esc(date)}</div>` : ''}`;
  } else {
    el.innerHTML = `<div class="nk-who"><div class="nk-av">${initial}</div><div><div class="nk-name">${esc(speaker)}</div><div class="nk-date">${esc(date)}</div></div></div>${marked(text)}`;
  }
  return place(el, pos({ w: 820, ...o }));
}

/** A typed notice on a sheet (NOTICE heading, typewriter body). */
export function notice(doc, o = {}) {
  const { title = 'NOTICE', lines = [], foot = '' } = o;
  const el = h(doc, 'div', { class: 'nk-sheet nk-paperish', style: { padding: '70px 60px', font: '400 40px/1.4 var(--type)', textAlign: 'center' } },
    `<div style="font:700 92px/1 var(--head);letter-spacing:0.02em;margin-bottom:30px">${esc(title)}</div>${lines.map(marked).join('<br>')}${foot ? `<div style="font-size:30px;margin-top:40px">${esc(foot)}</div>` : ''}`);
  return place(el, pos({ w: 780, ...o }));
}

/** A typed index card: optional red exhibit label, then lines (the first line large). */
export function indexCard(doc, o = {}) {
  const { label = '', lines = [] } = o;
  const el = h(doc, 'div', { class: 'nk-index' },
    `${label ? `<div style="font-size:28px;color:#7A2D24;margin-bottom:34px">${esc(label)}</div>` : ''}${lines.map((l, i) => `<div style="font-size:${i === 0 ? 66 : 44}px;line-height:1.25">${marked(l)}</div>`).join('')}`);
  return place(el, pos({ w: 780, ...o }));
}

/** A manila evidence tag with a typed line and a string hole. Hangs from its hole (transform-origin). */
export function evidenceTag(doc, o = {}) {
  const el = h(doc, 'div', { class: 'nk-tag' }, marked(o.text ?? ''));
  return place(el, pos(o));
}

/** A Polaroid of a banked person's real cutout, caption in hand. */
export function polaroid(doc, o = {}) {
  const { cutout: src = '', caption = '' } = o;
  const el = h(doc, 'div', { class: 'nk-polaroid' },
    `<div class="nk-ph">${src ? `<img src="${esc(src)}" alt="">` : ''}</div>${caption ? `<div class="nk-cap">${esc(caption)}</div>` : ''}`);
  return place(el, pos({ w: 520, h: 560, ...o }));
}

/** A photo cutout with a hand-cut paper edge and a lifted shadow. edge: 'paper' | 'clean'. */
export function cutout(doc, o = {}) {
  const el = h(doc, 'img', { class: `nk-cut${o.edge === 'clean' ? ' nk-clean' : ''}`, src: o.src ?? '', alt: '' });
  return place(el, pos({ w: 600, ...o }));
}

/** A banked logo, untouched, printed on a sheet of paper. */
export function logoPrint(doc, o = {}) {
  const el = h(doc, 'div', { class: 'nk-logo nk-paperish' }, `<img src="${esc(o.logo ?? '')}" alt="">`);
  return place(el, pos({ w: 340, h: 220, ...o }));
}

const POSES = {
  front: '<circle cx="100" cy="70" r="42"/><path d="M28 230 C 30 150, 70 122, 100 122 C 130 122, 170 150, 172 230 Z"/>',
  side: '<ellipse cx="106" cy="72" rx="38" ry="42"/><path d="M40 230 C 44 156, 76 124, 108 124 C 140 124, 166 160, 168 230 Z"/>',
  back: '<circle cx="100" cy="68" r="44"/><path d="M24 230 C 26 146, 66 120, 100 120 C 134 120, 174 146, 176 230 Z"/>',
};
/** A faceless silhouette for anyone who is not banked (private people are never shown at all). */
export function silhouette(doc, o = {}) {
  const pose = POSES[o.pose] ? o.pose : 'front';
  const el = h(doc, 'div', { class: 'nk-sheet', style: { padding: '24px', background: '#EDE8DD' } },
    `<svg viewBox="0 0 200 230" width="100%" style="display:block"><rect width="200" height="230" fill="#CFC8BA"/><g fill="#2E2A25">${POSES[pose]}</g></svg>`);
  return place(el, pos({ w: 300, ...o }));
}

/** A dictionary entry, clipped out (the concept's term as a real object, RC-42). */
export function dictionaryClipping(doc, o = {}) {
  const { term = '', pos: partOfSpeech = 'noun', meaning = '', guide = '' } = o;
  const el = h(doc, 'div', { class: 'nk-clip', style: { padding: '50px 56px 56px', background: '#F2ECDD', clipPath: tornPolygon(o.seed ?? 3) } },
    `${guide ? `<div data-set style="font:400 22px var(--serif);letter-spacing:0.2em;color:#6A6355;border-bottom:1px solid #9A9284;padding-bottom:8px;margin-bottom:22px">${esc(guide)}</div>` : ''}
     <div style="font:700 76px/1 var(--serif)">${marked(term)}</div>
     <div style="font:italic 400 32px var(--serif);color:#5A544A;margin:12px 0 20px">${esc(partOfSpeech)}</div>
     <div style="font:400 38px/1.35 var(--serif)">${marked(meaning)}</div>`);
  return place(el, pos({ w: 840, ...o }));
}

/** A strip of translucent tape over a corner. */
export const tape = (doc, o = {}) => place(h(doc, 'div', { class: 'nk-tape' }), pos(o));

/** A rubber-stamp impression (Helios orange, ink-distressed). */
export function stamp(doc, o = {}) {
  const el = h(doc, 'div', { class: 'nk-stamp', style: { fontSize: `${o.size ?? 66}px` } }, esc(o.text ?? '').replace(/\n/g, '<br>'));
  return place(el, pos(o));
}

/** A manila case folder (the sting and the close sit on it). */
export function caseFolder(doc, o = {}) {
  const el = h(doc, 'div', { class: 'nk-folder' });
  if (o.tab) el.innerHTML = `<div class="abs" style="left:120px;top:-70px;width:360px;height:90px;background:linear-gradient(180deg,#E9D099,#DDBF7E);border-radius:16px 16px 0 0"></div>
    <div class="abs" style="left:150px;top:-48px;font:400 30px var(--type);color:#4A3A1A">${esc(o.tab)}</div>`;
  return place(el, pos({ w: 1160, h: 980, ...o }));
}
