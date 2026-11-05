// @ts-nocheck: the kit is plain browser JS; these tests drive it through jsdom.
// Iteration 10, owner K: kit defects fixed at their source (ITERATION-10-CONTRACT §3). Offline: no model, no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';
import { LIFT_HOLE_IN, liftRest } from '../explainers/reel-ai-drama/kit/components/lift.js';
import { fitPlate } from '../explainers/reel-ai-drama/kit/components/moves.js';
import { PAPER_EDGE } from '../explainers/reel-ai-drama/kit/components/scenes.js';
import { BACKDROP, FONT_FILES, backdropFilter, brightnessOf, isMono, isPage, matchTone } from '../explainers/reel-ai-drama/kit/components/style.js';

const KIT = path.join(process.cwd(), 'explainers', 'reel-ai-drama', 'kit');
const COMPONENTS = path.join(KIT, 'components');
const SKIN = path.join(process.cwd(), 'explainers', 'reel-ai-drama', 'presets', 'reel-ai-drama', 'caption-skin.html');
const source = (file: string) => fs.readFileSync(path.join(COMPONENTS, file), 'utf8');

function dom() {
  const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="w"></div></body></html>');
  nk.installKit(window.document, { fonts: 'assets/fonts/' });
  return window.document;
}

const PAGE = {
  id: 'P1', file: 'media/p1.jpg', width: 1000, height: 600, people: ['A Person'],
  regions: { photos: [{ x: 0.6, y: 0.1, w: 0.35, h: 0.8 }], faces: [{ x: 0.7, y: 0.2, w: 0.15, h: 0.3 }], words: [] },
};

// ── Whiteboard ──────────────────────────────────────────────────────────────────────────────

test('whiteboard: the ground carries no fixed marks, on any framing', () => {
  for (const framing of ['wide', 'close']) {
    const b = nk.whiteboard(dom(), { framing });
    assert.equal(b.board.querySelector('.nk-wb-skin').children.length, 0, 'the board skin is clean melamine');
    assert.equal(b.el.querySelectorAll('svg, path, ellipse, .nk-residue').length, 0, 'no drawing before the frame draws one');
  }
  assert.ok(!/residue/i.test(source('style.js')) && !/RESIDUE/.test(source('scenes.js')));
});

test('whiteboard: the reflection sits under the ink, so it never washes a drawing', () => {
  const b = nk.whiteboard(dom());
  const order = [...b.board.children].map((e) => e.className);
  assert.ok(order.indexOf('nk-wb-glare') < order.indexOf('nk-stage'));
});

test('whiteboard: a logo is drawn solid, never through the streaked dry-erase mask', () => {
  const body = source('moves.js').split('export function drawnLogo')[1].split('\nexport ')[0];
  assert.ok(!/nk-ink dry/.test(body));
});

test('whiteboard: the first drawing draws in, except on the reel\'s first frame', () => {
  const media = { id: 'M1', file: 'media/m1.png', width: 800, height: 600, made: true, made_kind: 'drawing' };
  const build = (opening: boolean) => {
    const d = dom();
    const host = d.getElementById('w');
    if (opening) host.setAttribute('data-opening', '');
    const b = nk.whiteboard(d);
    host.append(b.el);
    const piece = nk.drawn(d, { media, x: 0, y: 0, w: 400 });
    b.stage.append(piece.el);
    return piece;
  };
  const later = build(false);
  later.render(0);
  assert.equal(later.el.style.visibility, 'hidden', 'nothing on the board at the first instant');
  later.render(2);
  assert.equal(later.el.style.visibility, '');
  const first = build(true);
  first.render(0);
  assert.equal(first.el.style.visibility, '', 'frame 1 opens with it there');
});

test('whiteboard: drawing in stays a pure function of t', () => {
  const d = dom();
  const b = nk.whiteboard(d);
  d.getElementById('w').append(b.el);
  const piece = nk.drawn(d, { media: { id: 'M1', file: 'media/m1.png', width: 800, height: 600, made: true, made_kind: 'drawing' }, w: 400 });
  b.stage.append(piece.el);
  piece.render(0.4);
  const a = piece.el.outerHTML;
  piece.render(3);
  piece.render(0.4);
  assert.equal(piece.el.outerHTML, a);
});

// ── Lift ────────────────────────────────────────────────────────────────────────────────────

test('lift: the original spot is covered once the piece has risen, and not before', () => {
  const d = dom();
  const l = nk.lift(d, { media: PAGE, at: 1, duration: 4 });
  d.getElementById('w').append(l.el);
  const hole = l.el.querySelector('[data-lift-from]');
  l.render(0.5);
  assert.equal(Number(hole.style.opacity), 0, 'the page is whole before the peel');
  l.render(1 + LIFT_HOLE_IN);
  assert.equal(Number(hole.style.opacity), 1);
  assert.ok(/#14100c|rgb\(20, 16, 12\)/i.test(hole.style.background), 'opaque, so no ghost head shows through');
  l.render(3);
  assert.equal(Number(hole.style.opacity), 1, 'it stays covered');
  const b = l.page.picture.box(l.region);
  if (b) assert.equal(parseFloat(hole.style.width), b.w, 'exactly the printed region');
  assert.ok(hole.parentElement === l.page.picture.frame, 'it moves with the page');
});

test('lift: nothing in the frame dims when the face lifts', () => {
  const d = dom();
  const l = nk.lift(d, { media: PAGE, at: 1, duration: 4 });
  d.getElementById('w').append(l.el);
  const shades = () => [...l.el.querySelectorAll('.rd-shade')].map((s) => s.style.opacity);
  l.render(0);
  const before = shades();
  l.render(3);
  assert.deepEqual(shades(), before);
  assert.ok(!/zIndex: '49'|dim\b/.test(source('lift.js')));
});

test('lift: inside a box, the piece rests inside the box and the frame\'s furniture stays out', () => {
  const rest = liftRest(0.8, { height: 760, box: { w: 400, h: 300 } });
  assert.ok(rest.x >= 0 && rest.y >= 0 && rest.x + rest.w <= 400.01 && rest.y + rest.h <= 300.01);
  const d = dom();
  const l = nk.lift(d, { media: PAGE, at: 1, duration: 4, box: { w: 500, h: 400 } });
  assert.equal(l.el.querySelectorAll('.rd-vignette, .nk-grain, .rd-shade, .rd-credit').length, 0);
  const sheet = l.page.sheet;
  assert.ok(parseFloat(sheet.style.left) >= 0 && parseFloat(sheet.style.width) <= 500);
  assert.ok(parseFloat(sheet.style.top) + parseFloat(sheet.style.height) <= 400.01);
});

// ── Captions ────────────────────────────────────────────────────────────────────────────────

test('captions: one bright colour whatever the tone, with no ink words', () => {
  const skin = fs.readFileSync(SKIN, 'utf8');
  const css = skin.match(/<style>([\s\S]*?)<\/style>/)[1];
  const colours = [...css.matchAll(/(?:^|[\s;{])color:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual([...new Set(colours)], ['#FEF9F3']);
  assert.ok(!skin.includes('#1F1915'));
  assert.ok(/tone === "dark" \? " on-dark" : " on-plate"/.test(skin), 'a ground the words can\'t read on gets the plate');
});

test('captions: the words sit above every layer a frame can draw, at full opacity', () => {
  const skin = fs.readFileSync(SKIN, 'utf8');
  const layer = Number(skin.match(/\.caption-layer \{[\s\S]*?z-index: (\d+);/)[1]);
  const files = fs.readdirSync(COMPONENTS).filter((f) => f.endsWith('.js')).map((f) => path.join(COMPONENTS, f));
  files.push(path.join(KIT, 'stage-layout.js'), path.join(KIT, 'close.js'));
  let highest = 0;
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/z-?[iI]ndex['"]?\s*:\s*['"]?(\d+)/g)) highest = Math.max(highest, Number(m[1]));
  }
  assert.ok(highest > 0 && layer > highest, `the caption layer (${layer}) is above the kit's highest layer (${highest})`);
  assert.ok(!/opacity:\s*0\.\d/.test(skin), 'the words never fade to grey');
});

// ── Pages and plates ────────────────────────────────────────────────────────────────────────

test('pages: a screen capture filed as made is still a page; a made drawing is not', () => {
  assert.equal(isPage({ kind: 'headline', made: true, made_kind: null }), true);
  assert.equal(isPage({ kind: 'object', made: true, made_kind: 'drawing' }), false);
  assert.equal(isPage({ kind: 'event_photo', regions: { words: Array.from({ length: 12 }, () => ({})) } }), true);
  assert.equal(isPage({ kind: 'person_photo', regions: { words: [] } }), false);
  assert.equal(isPage(null), false);
});

test('pages: drawn() never keys a page to bare text; it stays on its paper in its own ink', () => {
  const d = dom();
  const host = d.getElementById('w');
  const media = { id: 'V1', kind: 'headline', made: true, file: 'media/v1.png', width: 1080, height: 1920 };
  const piece = nk.drawn(d, { media, x: 0, y: 0, w: 500 });
  host.append(piece.el);
  // A loaded picture: keying would start here.
  Object.defineProperty(piece.img, 'complete', { value: true });
  Object.defineProperty(piece.img, 'naturalWidth', { value: 1080 });
  piece.render(1);
  assert.equal(piece.img.__keyed, undefined, 'never sent to the keyer');
  assert.ok(piece.el.style.background, 'it has paper under it');
  assert.equal(piece.el.dataset.ink, undefined, 'no ink change');
});

test('pages: a print, a card or a sheet is paper even when its file has no ground', () => {
  const css = source('style.js');
  assert.ok(/\[data-framed\]\{background:#F4EFE4;\}/.test(css));
  assert.ok(/\.rd-sheet\{position:absolute;background:#F4EFE4;/.test(css));
});

test('plates: a speech plate fits the longest line of its words', () => {
  const fake = (widths: number[]) => {
    const words = { getClientRects: () => widths.map((width) => ({ width })) };
    return { querySelector: () => words, ownerDocument: { defaultView: { getComputedStyle: () => ({ boxSizing: 'border-box', paddingLeft: '24px', paddingRight: '24px' }) } } };
  };
  assert.equal(fitPlate(fake([90, 130]), 440, 1), 180);
  assert.equal(fitPlate(fake([90, 130]), 440, 0.5), 310, 'screen px back to frame px');
  assert.equal(fitPlate(fake([500]), 440, 1), 440, 'never past its limit');
  assert.equal(fitPlate({ querySelector: () => null }, 440, 1), 440, 'unmeasured: left as it was');
});

// ── Handwriting ─────────────────────────────────────────────────────────────────────────────

test('handwriting: the kit\'s hand is an OFL face that ships with its licence, used everywhere', () => {
  assert.equal(FONT_FILES.hand, 'PatrickHand-Regular.ttf');
  assert.ok(fs.existsSync(path.join(KIT, 'fonts', FONT_FILES.hand)));
  assert.ok(/SIL Open Font License/.test(fs.readFileSync(path.join(KIT, 'fonts', 'PatrickHand-OFL.txt'), 'utf8')));
  for (const f of fs.readdirSync(COMPONENTS)) assert.ok(!/Gochi/.test(source(f)), `${f} still names the old face`);
  const css = source('style.js');
  assert.ok(/\.nk\{[^}]*--hand:'Patrick Hand'|--hand:'Patrick Hand',cursive;--rd-orange/.test(css), 'the hand is defined on the .rd scope as well as .nk');
});

// ── Backdrops ───────────────────────────────────────────────────────────────────────────────

test('backdrops: blur and darkening stop short of erasing the place', () => {
  assert.ok(BACKDROP.blur <= 6 && BACKDROP.brightness >= 0.55);
  assert.ok(/brightness\(0\.62\)/.test(backdropFilter()));
  for (const f of ['treatments.js', 'stat.js', 'scenes.js']) {
    for (const m of source(f).matchAll(/blur\((\d+(?:\.\d+)?)px\)/g)) assert.ok(Number(m[1]) <= 6, `${f}: blur(${m[1]}px)`);
    for (const m of source(f).matchAll(/grayscale\(\.[67]\) brightness\(\.(\d+)\)/g)) assert.fail(`${f}: an old backdrop grade, brightness .${m[1]}`);
  }
  const d = dom();
  const s = nk.stat(d, { kind: 'counter', value: '4', at: 0, duration: 3, over: { id: 'V5', file: 'media/v5.jpg', width: 1000, height: 1000 } });
  const cover = s.el.querySelector('img.rd-cover');
  assert.ok(cover.style.filter.includes(`blur(${BACKDROP.blur}px)`));
});

test('backdrops: behind a black-and-white figure, the backdrop has no colour either', () => {
  const d = dom();
  const figure = { id: 'C1', file: 'media/c1.png', width: 800, height: 1000, shows: 'A black-and-white portrait of a man.' };
  const s = nk.cutoutLift(d, { cutout: figure, media: figure, backdrop: 'media/b.jpg', at: [0.1, 0.7], duration: 3 });
  assert.ok(s.el.querySelector('img.rd-cover').style.filter.startsWith('grayscale(1)'));
});

// ── Tone ────────────────────────────────────────────────────────────────────────────────────

const toned = (digit: string, extra = {}) => ({ regions: { tone: { w: 2, h: 2, cells: digit.repeat(4) } }, ...extra });
const greyOf = (filter: string) => Number(filter.match(/grayscale\(([\d.]+)\)/)[1]);
const levelOf = (filter: string) => Number(filter.match(/brightness\(([\d.]+)\)/)[1]);

test('matchTone: one black-and-white picture takes the frame to black and white', () => {
  const mono = { shows: 'A black and white photo of a man' };
  const colour = { shows: 'A man in a red jacket' };
  assert.equal(isMono(mono), true);
  assert.equal(isMono(colour), false);
  assert.equal(isMono({ regions: { chroma: 0.02 }, shows: 'colourful' }), true, 'a measurement leads');
  assert.equal(isMono({ regions: { chroma: 0.4 }, shows: 'black and white' }), false, 'a measurement leads');
  assert.equal(greyOf(matchTone(colour, [mono])), 1);
  assert.equal(greyOf(matchTone(mono, [colour])), 1);
});

test('matchTone: colour pictures share a stronger desaturation than a lone one, which removes casts', () => {
  const a = { shows: 'A man' }, b = { shows: 'A page' };
  assert.equal(greyOf(matchTone(a, [b])), greyOf(matchTone(b, [a])));
  assert.ok(greyOf(matchTone(a, [b])) > greyOf(matchTone(a)));
});

test('matchTone: brightness moves pictures toward each other, within reach', () => {
  const dark = toned('4'), light = toned('c');
  assert.ok(Math.abs(brightnessOf(dark) - 4 / 15) < 0.02);
  const up = levelOf(matchTone(dark, [light]));
  const down = levelOf(matchTone(light, [dark]));
  assert.ok(up > down);
  const before = Math.abs(brightnessOf(light) - brightnessOf(dark));
  const after = Math.abs(brightnessOf(light) * down - brightnessOf(dark) * up);
  assert.ok(after < before, 'they end closer');
  assert.ok(up <= 0.9 * 1.18 + 1e-6 && down >= 0.9 * 0.82 - 1e-6, 'a grade never rescues or crushes a picture');
});

test('matchTone: never throws on what it can\'t read, and is pure', () => {
  assert.equal(levelOf(matchTone(null, [null, undefined])), 0.9);
  assert.equal(levelOf(matchTone({}, [{}])), 0.9);
  const m = toned('8');
  assert.equal(matchTone(m, [toned('2')]), matchTone(m, [toned('2')]));
});

// ── Cutouts ─────────────────────────────────────────────────────────────────────────────────

test('cutouts: the paper edge is thin and even, with no offset to throw spikes off stray hair', () => {
  const offsets = [...PAPER_EDGE.matchAll(/drop-shadow\((-?\d+)(?:px)? (-?\d+)(?:px)? (\d+)px/g)];
  assert.ok(offsets.length > 0);
  for (const [, x, y, blur] of offsets) {
    assert.equal(Number(x), 0);
    assert.equal(Number(y), 0);
    assert.ok(Number(blur) <= 1);
  }
});
